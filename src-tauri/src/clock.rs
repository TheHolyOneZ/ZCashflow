use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct State {
    millis: u64,
    counter: u32,
}

pub struct Hlc {
    device_id: String,
    state: Mutex<State>,
    now: fn() -> u64,
}

fn wall_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl Hlc {
    pub fn new(device_id: impl Into<String>) -> Self {
        Self::with_clock(device_id, wall_millis)
    }

    fn with_clock(device_id: impl Into<String>, now: fn() -> u64) -> Self {
        Self {
            device_id: device_id.into(),
            state: Mutex::new(State { millis: 0, counter: 0 }),
            now,
        }
    }

    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    pub fn tick(&self) -> String {
        let mut st = self.state.lock().unwrap();
        let wall = (self.now)();
        if wall > st.millis {
            *st = State { millis: wall, counter: 0 };
        } else {
            st.counter += 1;
        }
        self.encode(*st)
    }

    #[allow(dead_code)]
    pub fn observe(&self, remote: &str) {
        let Some(remote) = decode(remote) else { return };
        let mut st = self.state.lock().unwrap();
        let wall = (self.now)();
        let max_millis = wall.max(st.millis).max(remote.millis);
        let counter = if max_millis == st.millis && max_millis == remote.millis {
            st.counter.max(remote.counter) + 1
        } else if max_millis == st.millis {
            st.counter + 1
        } else if max_millis == remote.millis {
            remote.counter + 1
        } else {
            0
        };
        *st = State { millis: max_millis, counter };
    }

    fn encode(&self, st: State) -> String {
        format!("{:013}-{:04}-{}", st.millis, st.counter, self.device_id)
    }
}

#[allow(dead_code)]
fn decode(s: &str) -> Option<State> {
    let mut parts = s.splitn(3, '-');
    let millis = parts.next()?.parse().ok()?;
    let counter = parts.next()?.parse().ok()?;
    Some(State { millis, counter })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frozen() -> u64 {
        1_000
    }

    #[test]
    fn ticks_are_monotonic_with_frozen_wall_clock() {
        let hlc = Hlc::with_clock("a", frozen);
        let t1 = hlc.tick();
        let t2 = hlc.tick();
        let t3 = hlc.tick();
        assert!(t1 < t2 && t2 < t3, "{t1} {t2} {t3}");
    }

    #[test]
    fn observe_moves_past_remote() {
        let hlc = Hlc::with_clock("a", frozen);
        hlc.tick();
        let remote = "0000000005000-0007-b";
        hlc.observe(remote);
        let next = hlc.tick();
        assert!(next.as_str() > remote, "{next} should sort after {remote}");
    }

    #[test]
    fn encoding_sorts_lexicographically() {
        let hlc = Hlc::with_clock("dev", frozen);
        let a = hlc.encode(State { millis: 999, counter: 9999 });
        let b = hlc.encode(State { millis: 1_000, counter: 0 });
        assert!(a < b);
    }
}
