pub mod channel;
pub mod rows;

use std::collections::HashMap;
use std::io::Write as _;
use std::net::{IpAddr, SocketAddr, TcpListener, TcpStream};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::db::{get_meta, now_rfc3339, set_meta, SharedDb, SCHEMA_VERSION};
use crate::domain::attachments;
use crate::error::{AppError, AppResult};
use rows::RowChange;

const SERVICE: &str = "_zcashflow._tcp.local.";
const DEFAULT_PORT: u16 = 47_811;
const BLOB_CHUNK: usize = 512 * 1024;
const PAIR_WINDOW: Duration = Duration::from_secs(180);

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "t")]
enum Msg {
    Hello {
        name: String,
        schema: u32,
        version: String,
        #[serde(default)]
        port: u16,
    },
    Pull { since: i64 },
    Changes { rows: Vec<RowChange>, upto: i64, more: bool },
    Notify,
    BlobRequest { sha: String },
    Blob { sha: String, data: String, last: bool },
    BlobMissing { sha: String },
    Bye { reason: String },
}

pub trait Host: Send + Sync + 'static {
    fn emit(&self, event: &str);
}

struct Session {
    tx: mpsc::Sender<Msg>,
    addr: SocketAddr,
    name: String,
    stop: Arc<std::sync::atomic::AtomicBool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovered {
    pub public_key: String,
    pub name: String,
    pub addrs: Vec<String>,
    pub port: u16,
    #[serde(skip_serializing)]
    pub seen: Option<Instant>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Identity {
    pk: String,
    name: String,
    port: u16,
    v: u32,
}

const SCAN_TTL: Duration = Duration::from_secs(180);

struct Pairing {
    code: String,
    expires: Instant,
    failures: u32,
}

pub struct SyncCore {
    db: SharedDb,
    host: Arc<dyn Host>,
    private_key: Vec<u8>,
    public_key: Vec<u8>,
    port: Mutex<u16>,
    sessions: Mutex<HashMap<String, Session>>,
    discovered: Mutex<HashMap<String, Discovered>>,
    pairing: Mutex<Option<Pairing>>,
    mdns: Mutex<Option<mdns_sd::ServiceDaemon>>,
    attempts: Mutex<HashMap<String, Instant>>,
    pair_request: Mutex<Option<(String, Instant)>>,
    scanning: std::sync::atomic::AtomicBool,

    incoming_blobs: Mutex<HashMap<String, Vec<u8>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerView {
    pub public_key: String,
    pub name: String,
    pub paired: bool,
    pub role: Option<String>,
    pub connected: bool,
    pub addr: Option<String>,
    pub last_seen: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub name: String,
    pub public_key: String,
    pub fingerprint: String,
    pub port: u16,
    pub addresses: Vec<String>,
    pub enabled: bool,
    pub discoverable: bool,
    pub peers: Vec<PeerView>,
    pub pairing_code: Option<String>,
    pub pairing_expires_in: Option<u64>,
    pub pairing_request: Option<String>,
    pub scanning: bool,
}

pub fn fingerprint(public_hex: &str) -> String {
    let h = hex::encode(Sha256::digest(public_hex.as_bytes())).to_uppercase();
    format!("{}-{}-{}", &h[0..4], &h[4..8], &h[8..12])
}

fn default_name() -> String {
    if cfg!(target_os = "ios") {
        return "iPhone".into();
    }
    if cfg!(target_os = "android") {
        return "Android".into();
    }
    std::env::var("COMPUTERNAME")
        .ok()
        .or_else(|| std::fs::read_to_string("/etc/hostname").ok())
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "ZCashflow".into())
}

fn local_addresses() -> Vec<IpAddr> {
    let mut out = vec![];
    if let Ok(s) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if s.connect("192.0.2.1:9").is_ok() {
            if let Ok(a) = s.local_addr() {
                out.push(a.ip());
            }
        }
    }
    out
}

impl SyncCore {
    pub fn new(db: SharedDb, host: Arc<dyn Host>) -> AppResult<Arc<Self>> {
        let (private_key, public_key) = {
            let conn = db.conn();
            match (get_meta(&conn, "sync_private_key")?, get_meta(&conn, "sync_public_key")?) {
                (Some(p), Some(q)) => (hex::decode(p).map_err(|e| AppError::Invalid(e.to_string()))?, hex::decode(q).map_err(|e| AppError::Invalid(e.to_string()))?),
                _ => {
                    let (p, q) = channel::generate_keypair()?;
                    set_meta(&conn, "sync_private_key", &hex::encode(&p))?;
                    set_meta(&conn, "sync_public_key", &hex::encode(&q))?;
                    (p, q)
                }
            }
        };
        Ok(Arc::new(Self {
            db,
            host,
            private_key,
            public_key,
            port: Mutex::new(0),
            sessions: Mutex::new(HashMap::new()),
            discovered: Mutex::new(HashMap::new()),
            pairing: Mutex::new(None),
            mdns: Mutex::new(None),
            attempts: Mutex::new(HashMap::new()),
            pair_request: Mutex::new(None),
            scanning: std::sync::atomic::AtomicBool::new(false),
            incoming_blobs: Mutex::new(HashMap::new()),
        }))
    }

    pub fn public_hex(&self) -> String {
        hex::encode(&self.public_key)
    }

    fn setting(&self, key: &str) -> Option<String> {
        get_meta(&self.db.conn(), key).ok().flatten()
    }

    pub fn enabled(&self) -> bool {
        self.setting("sync_enabled").as_deref() != Some("0")
    }

    pub fn name(&self) -> String {
        self.setting("device_name").filter(|s| !s.trim().is_empty()).unwrap_or_else(default_name)
    }

    pub fn start(self: &Arc<Self>, local_only: bool) -> AppResult<()> {
        let listener = TcpListener::bind(("0.0.0.0", DEFAULT_PORT)).or_else(|_| TcpListener::bind(("0.0.0.0", 0)))?;
        *self.port.lock().unwrap() = listener.local_addr()?.port();
        let me = self.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let me = me.clone();
                std::thread::spawn(move || {
                    if let Err(e) = me.handle_incoming(stream) {
                        eprintln!("sync incoming: {e}");
                    }
                });
            }
        });
        if !local_only {
            if let Err(e) = self.start_mdns() {
                eprintln!("mdns unavailable: {e}");
            }
        }
        let me = self.clone();
        std::thread::spawn(move || {
            let mut tick = 0u32;
            loop {
                std::thread::sleep(Duration::from_secs(if tick == 0 { 2 } else { 8 }));
                me.reconnect_paired();
                if !local_only && tick.is_multiple_of(4) && me.wants_scan() {
                    me.scan_network();
                }
                tick = tick.wrapping_add(1);
            }
        });
        Ok(())
    }

    fn wants_scan(&self) -> bool {
        if !self.enabled() {
            return false;
        }
        let paired: Vec<String> = self
            .db
            .conn()
            .prepare("SELECT public_key FROM paired_devices")
            .and_then(|mut st| st.query_map([], |r| r.get(0)).map(|r| r.flatten().collect()))
            .unwrap_or_default();
        let sessions = self.sessions.lock().unwrap();
        let discovered = self.discovered.lock().unwrap();
        paired.iter().any(|pk| !sessions.contains_key(pk) && !discovered.contains_key(pk))
    }

    fn identity(&self) -> Identity {
        Identity { pk: self.public_hex(), name: self.name(), port: self.port(), v: SCHEMA_VERSION }
    }

    pub fn scan_network(self: &Arc<Self>) -> usize {
        use std::sync::atomic::Ordering;
        if !self.enabled() || self.scanning.swap(true, Ordering::SeqCst) {
            return 0;
        }
        self.host.emit("sync-changed");
        let mut targets: Vec<SocketAddr> = vec![];
        for ip in local_addresses() {
            if let IpAddr::V4(v4) = ip {
                if !v4.is_private() {
                    continue;
                }
                let [a, b, c, own] = v4.octets();
                for d in 1..=254u8 {
                    if d != own {
                        targets.push(SocketAddr::new(IpAddr::V4(std::net::Ipv4Addr::new(a, b, c, d)), DEFAULT_PORT));
                    }
                }
            }
        }
        let found = Arc::new(Mutex::new(Vec::<(Identity, IpAddr)>::new()));
        let chunks: Vec<Vec<SocketAddr>> = targets.chunks(8).map(|c| c.to_vec()).collect();
        let handles: Vec<_> = chunks
            .into_iter()
            .map(|chunk| {
                let found = found.clone();
                std::thread::spawn(move || {
                    for addr in chunk {
                        if let Some(id) = probe(addr) {
                            found.lock().unwrap().push((id, addr.ip()));
                        }
                    }
                })
            })
            .collect();
        for h in handles {
            let _ = h.join();
        }
        let me = self.public_hex();
        let found = std::mem::take(&mut *found.lock().unwrap());
        let n = found.len();
        {
            let mut d = self.discovered.lock().unwrap();
            for (id, ip) in found {
                if id.pk == me {
                    continue;
                }
                d.insert(
                    id.pk.clone(),
                    Discovered { public_key: id.pk, name: id.name, addrs: vec![ip.to_string()], port: id.port, seen: Some(Instant::now()) },
                );
            }
        }
        self.scanning.store(false, Ordering::SeqCst);
        self.host.emit("sync-changed");
        self.reconnect_paired();
        n
    }

    pub fn sync_now(self: &Arc<Self>) {
        let me = self.clone();
        std::thread::spawn(move || {
            me.attempts.lock().unwrap().clear();
            me.reconnect_paired();
            if me.wants_scan() {
                me.scan_network();
            }
        });
    }

    pub fn request_pairing(&self, addr: &str) -> AppResult<String> {
        let addr = resolve(addr)?;
        let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(4))?;
        stream.write_all(b"R")?;
        let mut line = serde_json::to_vec(&self.identity()).unwrap();
        line.push(b'\n');
        stream.write_all(&line)?;
        stream.set_read_timeout(Some(Duration::from_secs(4)))?;
        let id = read_identity(&mut stream).ok_or_else(|| AppError::Invalid("sync: device did not answer".into()))?;
        Ok(id.name)
    }

    fn handle_pair_request(&self, mut stream: TcpStream) -> AppResult<()> {
        let from = read_identity(&mut stream).ok_or_else(|| AppError::Invalid("bad pair request".into()))?;
        let mut line = serde_json::to_vec(&self.identity()).unwrap();
        line.push(b'\n');
        stream.write_all(&line)?;
        {
            let mut req = self.pair_request.lock().unwrap();
            if matches!(req.as_ref(), Some((_, at)) if at.elapsed() < Duration::from_secs(2)) {
                return Ok(());
            }
            *req = Some((from.name.clone(), Instant::now()));
        }
        if self.active_code().is_none() {
            self.start_pairing();
        }
        self.host.emit("pair-request");
        self.host.emit("sync-changed");
        Ok(())
    }

    pub fn port(&self) -> u16 {
        *self.port.lock().unwrap()
    }

    fn start_mdns(self: &Arc<Self>) -> AppResult<()> {
        let daemon = mdns_sd::ServiceDaemon::new().map_err(|e| AppError::Invalid(e.to_string()))?;
        let receiver = daemon.browse(SERVICE).map_err(|e| AppError::Invalid(e.to_string()))?;
        *self.mdns.lock().unwrap() = Some(daemon);
        self.refresh_advertisement();
        let me = self.clone();
        std::thread::spawn(move || {
            while let Ok(event) = receiver.recv() {
                match event {
                    mdns_sd::ServiceEvent::ServiceResolved(info) => {
                        let Some(pk) = info.txt_properties.get_property_val_str("pk").map(str::to_owned) else { continue };
                        if pk == me.public_hex() {
                            continue;
                        }
                        let d = Discovered {
                            public_key: pk.clone(),
                            name: info.txt_properties.get_property_val_str("name").unwrap_or("?").to_owned(),
                            addrs: {
                                let mut a: Vec<IpAddr> = info.addresses.iter().map(|a| a.to_ip_addr()).filter(IpAddr::is_ipv4).collect();
                                a.sort_by_key(|ip| ip.is_loopback());
                                a.iter().map(|ip| ip.to_string()).collect()
                            },
                            port: info.port,
                            seen: None,
                        };
                        me.discovered.lock().unwrap().insert(pk, d);
                        me.host.emit("sync-changed");
                        me.reconnect_paired();
                    }
                    mdns_sd::ServiceEvent::ServiceRemoved(_, fullname) => {
                        let mut d = me.discovered.lock().unwrap();
                        d.retain(|pk, _| !fullname.starts_with(&pk[..12]));
                        drop(d);
                        me.host.emit("sync-changed");
                    }
                    _ => {}
                }
            }
        });
        Ok(())
    }

    pub fn refresh_advertisement(&self) {
        let guard = self.mdns.lock().unwrap();
        let Some(daemon) = guard.as_ref() else { return };
        let me = self.public_hex();
        let instance = &me[..12];
        let fullname = format!("{instance}.{SERVICE}");
        let _ = daemon.unregister(&fullname);
        if self.setting("discoverable").as_deref() == Some("0") || !self.enabled() {
            return;
        }
        let props = [("pk", me.as_str()), ("name", &self.name()), ("v", &SCHEMA_VERSION.to_string())];
        let host = format!("zc-{instance}.local.");
        if let Ok(info) = mdns_sd::ServiceInfo::new(SERVICE, instance, &host, "", self.port(), &props[..]) {
            let _ = daemon.register(info.enable_addr_auto());
        }
    }

    pub fn start_pairing(&self) -> String {
        let n = u32::from_le_bytes(uuid::Uuid::new_v4().as_bytes()[..4].try_into().unwrap());
        let code = format!("{:06}", n % 1_000_000);
        *self.pairing.lock().unwrap() = Some(Pairing { code: code.clone(), expires: Instant::now() + PAIR_WINDOW, failures: 0 });
        self.host.emit("sync-changed");
        code
    }

    pub fn stop_pairing(&self) {
        *self.pairing.lock().unwrap() = None;
        *self.pair_request.lock().unwrap() = None;
        self.host.emit("sync-changed");
    }

    fn active_code(&self) -> Option<String> {
        let mut p = self.pairing.lock().unwrap();
        match p.as_ref() {
            Some(w) if w.expires > Instant::now() && w.failures < 5 => Some(w.code.clone()),
            Some(_) => {
                *p = None;
                None
            }
            None => None,
        }
    }

    fn remember_peer(&self, public_hex: &str, name: &str, addr: Option<SocketAddr>) -> AppResult<()> {
        self.db.conn().execute(
            "INSERT INTO paired_devices (public_key, name, paired_at, last_addr) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(public_key) DO UPDATE SET name = excluded.name, last_addr = coalesce(excluded.last_addr, last_addr)",
            params![public_hex, name, now_rfc3339(), addr.map(|a| a.to_string())],
        )?;
        Ok(())
    }

    fn hello(&self) -> Msg {
        Msg::Hello { name: self.name(), schema: SCHEMA_VERSION, version: env!("CARGO_PKG_VERSION").into(), port: self.port() }
    }

    pub fn pair_with(self: &Arc<Self>, addr: &str, code: &str) -> AppResult<String> {
        let addr = resolve(addr)?;
        let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(5))?;
        stream.write_all(b"P")?;
        let (state, remote) = channel::handshake(&mut stream, true, &self.private_key, Some(channel::psk_from_code(code)))
            .map_err(|_| AppError::Invalid("sync: wrong code or pairing not open".into()))?;
        let (mut tx, mut rx) = channel::split(stream, state)?;
        tx.send(&serde_json::to_vec(&self.hello()).unwrap())?;
        let name = match serde_json::from_slice::<Msg>(&rx.recv()?) {
            Ok(Msg::Hello { name, .. }) => name,
            _ => return Err(AppError::Invalid("sync: unexpected pairing reply".into())),
        };
        let remote_hex = hex::encode(remote);
        self.remember_peer(&remote_hex, &name, Some(addr))?;
        tx.shutdown();
        self.host.emit("sync-changed");
        let me = self.clone();
        std::thread::spawn(move || {
            let _ = me.connect(addr);
        });
        Ok(name)
    }

    fn handle_pairing(self: &Arc<Self>, mut stream: TcpStream, addr: SocketAddr) -> AppResult<()> {
        let Some(code) = self.active_code() else {
            return Err(AppError::Invalid("pairing not open".into()));
        };
        let (state, remote) = match channel::handshake(&mut stream, false, &self.private_key, Some(channel::psk_from_code(&code))) {
            Ok(r) => r,
            Err(e) => {
                if let Some(p) = self.pairing.lock().unwrap().as_mut() {
                    p.failures += 1;
                }
                return Err(e);
            }
        };
        let (mut tx, mut rx) = channel::split(stream, state)?;
        let (name, port) = match serde_json::from_slice::<Msg>(&rx.recv()?) {
            Ok(Msg::Hello { name, port, .. }) => (name, port),
            _ => return Err(AppError::Invalid("unexpected pairing message".into())),
        };
        tx.send(&serde_json::to_vec(&self.hello()).unwrap())?;
        self.remember_peer(&hex::encode(remote), &name, Some(SocketAddr::new(addr.ip(), port)))?;
        *self.pairing.lock().unwrap() = None;
        *self.pair_request.lock().unwrap() = None;
        self.host.emit("sync-changed");
        Ok(())
    }

    pub fn unpair(&self, public_hex: &str) -> AppResult<()> {
        self.db.conn().execute("DELETE FROM paired_devices WHERE public_key = ?1", [public_hex])?;
        if let Some(s) = self.sessions.lock().unwrap().remove(public_hex) {
            let _ = s.tx.send(Msg::Bye { reason: "unpaired".into() });
            s.stop.store(true, std::sync::atomic::Ordering::SeqCst);
        }
        self.host.emit("sync-changed");
        Ok(())
    }

    pub fn set_role(&self, public_hex: &str, role: &str) -> AppResult<()> {
        if !matches!(role, "full" | "view" | "capture") {
            return Err(AppError::Invalid(format!("unknown role {role:?}")));
        }
        self.db.conn().execute("UPDATE paired_devices SET role = ?2 WHERE public_key = ?1", [public_hex, role])?;
        self.host.emit("sync-changed");
        Ok(())
    }

    fn peer_role(&self, public_hex: &str) -> Option<String> {
        self.db
            .conn()
            .query_row("SELECT role FROM paired_devices WHERE public_key = ?1", [public_hex], |r| r.get(0))
            .ok()
    }

    fn handle_incoming(self: &Arc<Self>, mut stream: TcpStream) -> AppResult<()> {
        if !self.enabled() {
            return Ok(());
        }
        let addr = stream.peer_addr()?;
        let mut kind = [0u8; 1];
        stream.set_read_timeout(Some(Duration::from_secs(10)))?;
        std::io::Read::read_exact(&mut stream, &mut kind)?;
        match &kind {
            b"P" => self.handle_pairing(stream, addr),
            b"I" => {
                let mut line = serde_json::to_vec(&self.identity()).unwrap();
                line.push(b'\n');
                stream.write_all(&line)?;
                Ok(())
            }
            b"R" => self.handle_pair_request(stream),
            b"S" => {
                let (state, remote) = channel::handshake(&mut stream, false, &self.private_key, None)?;
                self.run_session(stream, state, hex::encode(remote), addr)
            }
            _ => Err(AppError::Invalid("unknown connection type".into())),
        }
    }

    pub fn connect(self: &Arc<Self>, addr: SocketAddr) -> AppResult<()> {
        let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(4))?;
        stream.write_all(b"S")?;
        let (state, remote) = channel::handshake(&mut stream, true, &self.private_key, None)?;
        let me = self.clone();
        let remote_hex = hex::encode(remote);
        std::thread::spawn(move || {
            if let Err(e) = me.run_session(stream, state, remote_hex, addr) {
                eprintln!("sync session: {e}");
            }
        });
        Ok(())
    }

    fn reconnect_paired(self: &Arc<Self>) {
        if !self.enabled() {
            return;
        }
        let peers: Vec<(String, Option<String>)> = match self.db.conn().prepare("SELECT public_key, last_addr FROM paired_devices") {
            Ok(mut stmt) => stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .map(|rows| rows.flatten().collect())
                .unwrap_or_default(),
            Err(_) => return,
        };
        let me = self.public_hex();
        for (pk, last_addr) in peers {
            if self.sessions.lock().unwrap().contains_key(&pk) {
                continue;
            }
            if me > pk {
                let mut attempts = self.attempts.lock().unwrap();
                let first = attempts.entry(pk.clone()).or_insert_with(Instant::now);
                if first.elapsed() < Duration::from_secs(12) {
                    continue;
                }
                *first = Instant::now();
            }
            let found = self.discovered.lock().unwrap().get(&pk).cloned();
            let mut candidates: Vec<SocketAddr> = found
                .map(|d| d.addrs.iter().filter_map(|a| format!("{a}:{}", d.port).parse().ok()).collect())
                .unwrap_or_default();
            if let Some(a) = last_addr.and_then(|a| a.parse::<SocketAddr>().ok()) {
                let a = if a.port() == 0 { SocketAddr::new(a.ip(), DEFAULT_PORT) } else { a };
                if !candidates.contains(&a) {
                    candidates.push(a);
                }
            }
            for addr in candidates {
                if self.connect(addr).is_ok() {
                    break;
                }
            }
        }
    }

    fn run_session(self: &Arc<Self>, stream: TcpStream, state: snow::StatelessTransportState, remote: String, addr: SocketAddr) -> AppResult<()> {
        let Some(role) = self.peer_role(&remote) else {
            return Err(AppError::Invalid("unknown device; pair first".into()));
        };
        let (mut sender, mut receiver) = channel::split(stream, state)?;
        let (tx, rx) = mpsc::channel::<Msg>();
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        {
            let mut sessions = self.sessions.lock().unwrap();
            if sessions.contains_key(&remote) {
                sender.shutdown();
                return Ok(());
            }
            let name = self.db.conn().query_row("SELECT name FROM paired_devices WHERE public_key = ?1", [&remote], |r| r.get(0)).unwrap_or_default();
            sessions.insert(remote.clone(), Session { tx: tx.clone(), addr, name, stop: stop.clone() });
        }
        self.db.conn().execute(
            "UPDATE paired_devices SET last_seen = ?2, last_addr = CASE WHEN ?3 LIKE '%:0' THEN last_addr ELSE ?3 END WHERE public_key = ?1",
            params![remote, now_rfc3339(), addr.to_string()],
        )?;
        self.host.emit("sync-changed");

        let db = self.db.clone();
        let writer_stop = stop.clone();
        let writer = std::thread::spawn(move || {
            let mut last_seq = rows::max_seq(&db.conn()).unwrap_or(0);
            loop {
                if writer_stop.load(std::sync::atomic::Ordering::SeqCst) {
                    break;
                }
                let msg = match rx.recv_timeout(Duration::from_millis(700)) {
                    Ok(m) => Some(m),
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        let seq = rows::max_seq(&db.conn()).unwrap_or(last_seq);
                        (seq > last_seq).then(|| {
                            last_seq = seq;
                            Msg::Notify
                        })
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                };
                if let Some(m) = msg {
                    let bye = matches!(m, Msg::Bye { .. });
                    if sender.send(&serde_json::to_vec(&m).unwrap()).is_err() || bye {
                        break;
                    }
                }
            }
            sender.shutdown();
        });

        let cursor: i64 = self.db.conn().query_row("SELECT cursor FROM paired_devices WHERE public_key = ?1", [&remote], |r| r.get(0)).unwrap_or(0);
        let _ = tx.send(self.hello());
        let _ = tx.send(Msg::Pull { since: cursor });

        let result = self.read_loop(&mut receiver, &tx, &remote, &role);
        stop.store(true, std::sync::atomic::Ordering::SeqCst);
        self.sessions.lock().unwrap().remove(&remote);
        drop(tx);
        let _ = writer.join();
        self.host.emit("sync-changed");
        result
    }

    fn read_loop(&self, rx: &mut channel::Receiver, tx: &mpsc::Sender<Msg>, remote: &str, role: &str) -> AppResult<()> {
        loop {
            let msg: Msg = serde_json::from_slice(&rx.recv()?).map_err(|e| AppError::Invalid(format!("sync: bad message: {e}")))?;
            match msg {
                Msg::Hello { name, schema, port, .. } => {
                    if schema != SCHEMA_VERSION {
                        let _ = tx.send(Msg::Bye { reason: format!("schema {SCHEMA_VERSION} vs {schema}; update both devices") });
                        return Err(AppError::Invalid("schema mismatch".into()));
                    }
                    let ip = self.sessions.lock().unwrap().get(remote).map(|s| s.addr.ip());
                    let addr = ip.filter(|_| port != 0).map(|ip| SocketAddr::new(ip, port).to_string());
                    self.db.conn().execute(
                        "UPDATE paired_devices SET name = ?2, last_addr = coalesce(?3, last_addr) WHERE public_key = ?1",
                        params![remote, name, addr],
                    )?;
                    self.attempts.lock().unwrap().remove(remote);
                    if let Some(s) = self.sessions.lock().unwrap().get_mut(remote) {
                        s.name = name;
                    }
                }
                Msg::Pull { since } => {
                    if role == "capture" {
                        continue;
                    }
                    let mut from = since;
                    loop {
                        let (rows, upto, more) = rows::changes_since(&self.db.conn(), from, 500)?;
                        let _ = tx.send(Msg::Changes { rows, upto, more: false });
                        from = upto;
                        if !more {
                            break;
                        }
                    }
                }
                Msg::Changes { rows, upto, .. } => {
                    let applied = match role {
                        "view" => 0,
                        "capture" => rows::apply(&self.db, &rows, Some(&["attachments"]))?.applied,
                        _ => rows::apply(&self.db, &rows, None)?.applied,
                    };
                    self.db.conn().execute("UPDATE paired_devices SET cursor = max(cursor, ?2), last_seen = ?3 WHERE public_key = ?1", params![remote, upto, now_rfc3339()])?;
                    if applied > 0 {
                        self.host.emit("ledger-changed");
                        self.host.emit("sync-received");
                    }
                    for sha in rows::missing_blobs(&self.db)? {
                        if !self.incoming_blobs.lock().unwrap().contains_key(&sha) {
                            self.incoming_blobs.lock().unwrap().insert(sha.clone(), Vec::new());
                            let _ = tx.send(Msg::BlobRequest { sha });
                        }
                    }
                }
                Msg::Notify => {
                    let cursor: i64 = self.db.conn().query_row("SELECT cursor FROM paired_devices WHERE public_key = ?1", [remote], |r| r.get(0)).unwrap_or(0);
                    let _ = tx.send(Msg::Pull { since: cursor });
                }
                Msg::BlobRequest { sha } => {
                    let path = attachments::original_path(&self.db, &sha);
                    match std::fs::read(&path) {
                        Ok(bytes) => {
                            let mut chunks = bytes.chunks(BLOB_CHUNK).peekable();
                            while let Some(c) = chunks.next() {
                                let data = base64::engine::general_purpose::STANDARD.encode(c);
                                let _ = tx.send(Msg::Blob { sha: sha.clone(), data, last: chunks.peek().is_none() });
                            }
                        }
                        Err(_) => {
                            let _ = tx.send(Msg::BlobMissing { sha });
                        }
                    }
                }
                Msg::Blob { sha, data, last } => {
                    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| AppError::Invalid(e.to_string()))?;
                    let mut blobs = self.incoming_blobs.lock().unwrap();
                    blobs.entry(sha.clone()).or_default().extend_from_slice(&bytes);
                    if last {
                        let full = blobs.remove(&sha).unwrap_or_default();
                        drop(blobs);
                        if hex::encode(Sha256::digest(&full)) == sha {
                            let _ = attachments::write_files(&self.db, &full);
                            self.host.emit("ledger-changed");
                        }
                    }
                }
                Msg::BlobMissing { sha } => {
                    self.incoming_blobs.lock().unwrap().remove(&sha);
                }
                Msg::Bye { reason } => {
                    eprintln!("sync: peer closed: {reason}");
                    return Ok(());
                }
            }
        }
    }

    pub fn status(&self) -> AppResult<SyncStatus> {
        type PairedRow = (String, String, String, Option<String>, Option<String>);
        let paired: Vec<PairedRow> = self
            .db
            .conn()
            .prepare("SELECT public_key, name, role, last_seen, last_addr FROM paired_devices ORDER BY paired_at")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?
            .collect::<Result<_, _>>()?;
        let sessions = self.sessions.lock().unwrap();
        let mut discovered = self.discovered.lock().unwrap();
        discovered.retain(|_, d| d.seen.is_none_or(|t| t.elapsed() < SCAN_TTL));
        let mut peers: Vec<PeerView> = paired
            .iter()
            .map(|(pk, name, role, seen, addr)| {
                let s = sessions.get(pk);
                PeerView {
                    public_key: pk.clone(),
                    name: s.map(|s| s.name.clone()).filter(|n| !n.is_empty()).unwrap_or_else(|| name.clone()),
                    paired: true,
                    role: Some(role.clone()),
                    connected: s.is_some(),
                    addr: s.map(|s| s.addr.to_string()).or_else(|| addr.clone()),
                    last_seen: seen.clone(),
                }
            })
            .collect();
        for d in discovered.values() {
            if !paired.iter().any(|p| p.0 == d.public_key) {
                peers.push(PeerView {
                    public_key: d.public_key.clone(),
                    name: d.name.clone(),
                    paired: false,
                    role: None,
                    connected: false,
                    addr: d.addrs.first().map(|a| format!("{a}:{}", d.port)),
                    last_seen: None,
                });
            }
        }
        let pairing = self.pairing.lock().unwrap();
        let pairing = pairing.as_ref().filter(|p| p.expires > Instant::now() && p.failures < 5);
        Ok(SyncStatus {
            name: self.name(),
            public_key: self.public_hex(),
            fingerprint: fingerprint(&self.public_hex()),
            port: self.port(),
            addresses: local_addresses().iter().map(|a| format!("{a}:{}", self.port())).collect(),
            enabled: self.enabled(),
            discoverable: self.setting("discoverable").as_deref() != Some("0"),
            peers,
            pairing_code: pairing.map(|p| p.code.clone()),
            pairing_expires_in: pairing.map(|p| p.expires.saturating_duration_since(Instant::now()).as_secs()),
            pairing_request: pairing.and(self.pair_request.lock().unwrap().as_ref().map(|(n, _)| n.clone())),
            scanning: self.scanning.load(std::sync::atomic::Ordering::SeqCst),
        })
    }

    pub fn disconnect_all(&self) {
        for (_, s) in self.sessions.lock().unwrap().drain() {
            let _ = s.tx.send(Msg::Bye { reason: "sync disabled".into() });
            s.stop.store(true, std::sync::atomic::Ordering::SeqCst);
        }
        self.host.emit("sync-changed");
    }
}

fn read_identity(stream: &mut TcpStream) -> Option<Identity> {
    use std::io::Read;
    let mut buf = Vec::with_capacity(512);
    let mut byte = [0u8; 1];
    while buf.len() < 4096 {
        match stream.read(&mut byte) {
            Ok(1) if byte[0] == b'\n' => break,
            Ok(1) => buf.push(byte[0]),
            _ => break,
        }
    }
    serde_json::from_slice(&buf).ok()
}

fn probe(addr: SocketAddr) -> Option<Identity> {
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(350)).ok()?;
    stream.set_read_timeout(Some(Duration::from_millis(1500))).ok()?;
    stream.write_all(b"I").ok()?;
    read_identity(&mut stream)
}

pub fn resolve(addr: &str) -> AppResult<SocketAddr> {
    use std::net::ToSocketAddrs;
    let a = addr.trim();
    let with_port = if a.contains(':') { a.to_owned() } else { format!("{a}:{DEFAULT_PORT}") };
    with_port
        .to_socket_addrs()
        .map_err(|e| AppError::Invalid(format!("address: {e}")))?
        .next()
        .ok_or_else(|| AppError::Invalid("address not found".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use crate::domain::{accounts, transactions};

    struct Quiet;
    impl Host for Quiet {
        fn emit(&self, _: &str) {}
    }

    fn core() -> Arc<SyncCore> {
        let db = Arc::new(Db::open_in_memory().unwrap());
        let c = SyncCore::new(db, Arc::new(Quiet)).unwrap();

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        *c.port.lock().unwrap() = listener.local_addr().unwrap().port();
        let me = c.clone();
        std::thread::spawn(move || {
            for s in listener.incoming().flatten() {
                let me = me.clone();
                std::thread::spawn(move || {
                    let _ = me.handle_incoming(s);
                });
            }
        });
        c
    }

    fn wait_for(mut f: impl FnMut() -> bool) -> bool {
        for _ in 0..100 {
            if f() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        false
    }

    fn add(db: &Db, title: &str) -> String {
        let acc = accounts::list(&db.conn()).unwrap()[0].id.clone();
        transactions::create(
            db,
            transactions::TransactionInput {
                kind: "expense".into(),
                amount_minor: 850,
                currency: None,
                occurred_on: "2026-10-08".into(),
                occurred_time: None,
                account_id: acc,
                to_account_id: None,
                category_id: None,
                counterparty: None,
                title: title.into(),
                note: None,
                tags: vec![],
                debt_id: None,
                goal_id: None,
            },
        )
        .unwrap()
        .id
    }

    #[test]
    fn pair_then_live_sync_both_ways_with_receipt_image() {
        let a = core();
        let b = core();
        let code = a.start_pairing();
        assert!(b.pair_with(&format!("127.0.0.1:{}", a.port()), "000000").is_err() || code == "000000");
        let name = b.pair_with(&format!("127.0.0.1:{}", a.port()), &code).unwrap();
        assert_eq!(name, a.name());
        assert!(wait_for(|| a.status().unwrap().peers.iter().any(|p| p.connected) && b.status().unwrap().peers.iter().any(|p| p.connected)));

        let id = add(&a.db, "Döner");
        assert!(wait_for(|| transactions::get(&b.db.conn(), &id).is_ok()), "A's booking reaches B");

        let id2 = add(&b.db, "Pizza");
        let img = image::RgbImage::from_fn(30, 30, |x, y| image::Rgb([x as u8 * 8, y as u8 * 8, 99]));
        let mut png = std::io::Cursor::new(Vec::new());
        img.write_to(&mut png, image::ImageFormat::Png).unwrap();
        b.db.conn().execute("INSERT INTO meta (key, value) VALUES ('ocr_engine', 'none')", []).unwrap();
        let att = attachments::import(&b.db, png.get_ref(), None, Some(id2.clone()), chrono::NaiveDate::from_ymd_opt(2026, 10, 8).unwrap()).unwrap();
        assert!(wait_for(|| transactions::get(&a.db.conn(), &id2).is_ok()), "B's booking reaches A");
        assert!(
            wait_for(|| attachments::original_path(&a.db, &att.sha256).exists()),
            "receipt image is transferred"
        );

        a.unpair(&b.public_hex()).unwrap();
        assert!(wait_for(|| !b.status().unwrap().peers.iter().any(|p| p.connected)));
    }

    #[test]
    fn pair_request_shows_code_and_reconnects_after_drop() {
        let a = core();
        let b = core();
        let addr = format!("127.0.0.1:{}", a.port());

        let id = probe(addr.parse().unwrap()).expect("identify probe answers");
        assert_eq!(id.pk, a.public_hex());
        assert_eq!(id.port, a.port());

        assert_eq!(b.request_pairing(&addr).unwrap(), a.name());
        let st = a.status().unwrap();
        assert_eq!(st.pairing_request.as_deref(), Some(b.name().as_str()), "A shows who wants to pair");
        let code = st.pairing_code.expect("pairing window opened automatically");

        b.pair_with(&addr, &code).unwrap();
        assert!(wait_for(|| a.status().unwrap().peers.iter().any(|p| p.connected)));
        assert!(a.status().unwrap().pairing_request.is_none());

        let b_addr: Option<String> = a.db.conn().query_row("SELECT last_addr FROM paired_devices", [], |r| r.get(0)).unwrap();
        assert_eq!(b_addr, Some(format!("127.0.0.1:{}", b.port())), "A learns B's listening port, not port 0");

        a.disconnect_all();
        b.disconnect_all();
        assert!(wait_for(|| !a.status().unwrap().peers.iter().any(|p| p.connected)));
        assert!(wait_for(|| {
            a.attempts.lock().unwrap().clear();
            b.attempts.lock().unwrap().clear();
            a.reconnect_paired();
            b.reconnect_paired();
            a.status().unwrap().peers.iter().any(|p| p.connected) && b.status().unwrap().peers.iter().any(|p| p.connected)
        }), "either side can bring the connection back");
    }

    #[test]
    fn strangers_cannot_sync() {
        let a = core();
        let b = core();
        let addr: SocketAddr = format!("127.0.0.1:{}", a.port()).parse().unwrap();
        let _ = b.connect(addr);
        std::thread::sleep(Duration::from_millis(300));
        assert!(!a.status().unwrap().peers.iter().any(|p| p.connected));
        assert!(b.pair_with(&addr.to_string(), "123456").is_err(), "no pairing window open");
    }
}
