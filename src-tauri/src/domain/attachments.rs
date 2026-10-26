use std::path::PathBuf;

use chrono::NaiveDate;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::transactions;
use crate::db::{get_meta, new_id, now_rfc3339, Db};
use crate::error::{AppError, AppResult};
use crate::ocr::{self, extract::Extracted, llm};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub transaction_id: Option<String>,
    pub sha256: String,
    pub mime: String,
    pub file_name: Option<String>,
    pub size_bytes: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub ocr_text: Option<String>,
    pub ocr_engine: Option<String>,
    pub extracted: Option<Extracted>,
    pub created_at: String,

    pub available: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentFilter {
    #[serde(default)]
    pub inbox: bool,
    pub transaction_id: Option<String>,
}

pub fn original_path(db: &Db, sha: &str) -> PathBuf {
    db.files_dir.join("attachments").join(sha)
}

pub fn thumb_path(db: &Db, sha: &str) -> PathBuf {
    db.files_dir.join("thumbs").join(format!("{sha}.jpg"))
}

const SELECT: &str = "SELECT id, transaction_id, sha256, mime, file_name, size_bytes, width, height,
                             ocr_text, ocr_engine, extracted_json, created_at
                      FROM attachments WHERE deleted = 0";

fn from_row(db: &Db, r: &Row) -> rusqlite::Result<Attachment> {
    let sha: String = r.get(2)?;
    let extracted: Option<String> = r.get(10)?;
    Ok(Attachment {
        id: r.get(0)?,
        transaction_id: r.get(1)?,
        available: original_path(db, &sha).exists(),
        sha256: sha,
        mime: r.get(3)?,
        file_name: r.get(4)?,
        size_bytes: r.get(5)?,
        width: r.get(6)?,
        height: r.get(7)?,
        ocr_text: r.get(8)?,
        ocr_engine: r.get(9)?,
        extracted: extracted.and_then(|s| serde_json::from_str(&s).ok()),
        created_at: r.get(11)?,
    })
}

pub fn list(db: &Db, conn: &Connection, f: &AttachmentFilter) -> AppResult<Vec<Attachment>> {
    let mut sql = String::from(SELECT);
    let mut args: Vec<String> = vec![];
    if f.inbox {
        sql.push_str(" AND transaction_id IS NULL");
    }
    if let Some(t) = &f.transaction_id {
        args.push(t.clone());
        sql.push_str(" AND transaction_id = ?1");
    }
    sql.push_str(" ORDER BY created_at DESC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(args), |r| from_row(db, r))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(db: &Db, conn: &Connection, id: &str) -> AppResult<Attachment> {
    conn.query_row(&format!("{SELECT} AND id = ?1"), [id], |r| from_row(db, r))
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("attachment {id}")))
}

fn sniff_mime(bytes: &[u8]) -> &'static str {
    match image::guess_format(bytes) {
        Ok(image::ImageFormat::Png) => "image/png",
        Ok(image::ImageFormat::WebP) => "image/webp",
        Ok(image::ImageFormat::Gif) => "image/gif",
        Ok(image::ImageFormat::Bmp) => "image/bmp",
        Ok(image::ImageFormat::Tiff) => "image/tiff",
        _ => "image/jpeg",
    }
}

pub fn write_files(db: &Db, bytes: &[u8]) -> AppResult<(String, image::DynamicImage)> {
    let sha = hex::encode(Sha256::digest(bytes));
    let img = ocr::decode(bytes)?;
    let original = original_path(db, &sha);
    if !original.exists() {
        std::fs::create_dir_all(original.parent().unwrap())?;
        std::fs::write(&original, bytes)?;
    }
    let thumb = thumb_path(db, &sha);
    if !thumb.exists() {
        std::fs::create_dir_all(thumb.parent().unwrap())?;
        img.thumbnail(640, 640)
            .to_rgb8()
            .save_with_format(&thumb, image::ImageFormat::Jpeg)
            .map_err(|e| AppError::Invalid(format!("thumbnail: {e}")))?;
    }
    Ok((sha, img))
}

pub fn import(db: &Db, bytes: &[u8], file_name: Option<String>, transaction_id: Option<String>, today: NaiveDate) -> AppResult<Attachment> {
    let bytes = ocr::prepare_upload(bytes)?;
    let bytes = bytes.as_ref();
    let (sha, img) = write_files(db, bytes)?;
    let id = new_id();
    {
        let conn = db.conn();
        conn.execute(
            "INSERT INTO attachments (id, transaction_id, sha256, mime, file_name, size_bytes, width, height,
                                      created_at, device_id, updated_hlc)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                id, transaction_id, sha, sniff_mime(bytes), file_name, bytes.len() as i64,
                img.width(), img.height(), now_rfc3339(), db.device_id(), db.hlc.tick()
            ],
        )?;
    }
    process_image(db, &id, img, false, today)?;
    get(db, &db.conn(), &id)
}

struct OcrSettings {
    engine: String,
    llm: Option<llm::LlmConfig>,
}

fn settings(conn: &Connection) -> AppResult<OcrSettings> {
    let engine = get_meta(conn, "ocr_engine")?.unwrap_or_else(|| "auto".into());
    let url = get_meta(conn, "llm_url")?.filter(|s| !s.trim().is_empty());
    let model = get_meta(conn, "llm_model")?.filter(|s| !s.trim().is_empty());
    let llm = match (url, model, get_meta(conn, "llm_enabled")?.as_deref()) {
        (Some(url), Some(model), Some("1")) => Some(llm::LlmConfig {
            url,
            model,
            vision: get_meta(conn, "llm_vision")?.as_deref() == Some("1"),
        }),
        _ => None,
    };
    Ok(OcrSettings { engine, llm })
}

fn process_image(db: &Db, id: &str, img: image::DynamicImage, force_llm: bool, today: NaiveDate) -> AppResult<()> {
    let cfg = settings(&db.conn())?;
    let (text, engine) = match ocr::recognize(img.clone(), &cfg.engine) {
        Ok(r) => r,
        Err(e) => {
            db.conn().execute(
                "UPDATE attachments SET ocr_engine = ?2, updated_hlc = ?3 WHERE id = ?1",
                params![id, format!("error: {e}"), db.hlc.tick()],
            )?;
            return Ok(());
        }
    };
    let mut fields = ocr::extract::extract(&text, today);
    if let Some(llm_cfg) = cfg.llm.as_ref() {
        let jpeg = if llm_cfg.vision {
            let mut buf = std::io::Cursor::new(Vec::new());
            img.thumbnail(1280, 1280).to_rgb8().write_to(&mut buf, image::ImageFormat::Jpeg).ok().map(|_| buf.into_inner())
        } else {
            None
        };
        match llm::refine(llm_cfg, &text, jpeg.as_deref()) {
            Ok(r) => fields = llm::merge(fields, r),
            Err(e) if force_llm => return Err(e),
            Err(e) => eprintln!("llm refine skipped: {e}"),
        }
    }
    db.conn().execute(
        "UPDATE attachments SET ocr_text = ?2, ocr_engine = ?3, extracted_json = ?4, updated_hlc = ?5 WHERE id = ?1",
        params![id, text, engine, serde_json::to_string(&fields).unwrap(), db.hlc.tick()],
    )?;
    Ok(())
}

pub fn reprocess(db: &Db, id: &str, today: NaiveDate) -> AppResult<Attachment> {
    let a = get(db, &db.conn(), id)?;
    let bytes = std::fs::read(original_path(db, &a.sha256))?;
    let img = ocr::decode(&bytes)?;
    process_image(db, id, img, true, today)?;
    get(db, &db.conn(), id)
}

pub fn link(db: &Db, id: &str, transaction_id: Option<&str>) -> AppResult<Attachment> {
    let conn = db.conn();
    if let Some(t) = transaction_id {
        super::transactions::get(&conn, t)?;
    }
    let n = conn.execute(
        "UPDATE attachments SET transaction_id = ?2, updated_hlc = ?3 WHERE id = ?1 AND deleted = 0",
        params![id, transaction_id, db.hlc.tick()],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("attachment {id}")));
    }
    get(db, &conn, id)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptPart {
    pub category_id: Option<String>,
    pub amount_minor: i64,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookReceipt {
    pub date: String,
    pub account_id: String,
    pub counterparty: Option<String>,
    pub title: String,
    pub parts: Vec<ReceiptPart>,
}

pub fn book(db: &Db, id: &str, input: BookReceipt) -> AppResult<Vec<String>> {
    if input.parts.is_empty() {
        return Err(AppError::Invalid("nothing to book".into()));
    }
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    let mut ids = Vec::with_capacity(input.parts.len());
    for (i, part) in input.parts.iter().enumerate() {
        let tx_id = transactions::insert(
            db,
            &tx,
            &transactions::TransactionInput {
                kind: "expense".into(),
                amount_minor: part.amount_minor,
                currency: None,
                occurred_on: input.date.clone(),
                account_id: input.account_id.clone(),
                to_account_id: None,
                category_id: part.category_id.clone().filter(|c| !c.is_empty()),
                counterparty: input.counterparty.clone().filter(|c| !c.trim().is_empty()),
                title: input.title.clone(),
                note: part.note.clone().filter(|n| !n.trim().is_empty()),
                tags: vec![],
                debt_id: None,
                goal_id: None,
            },
            transactions::SystemLinks::default(),
        )?;
        let n = if i == 0 {
            tx.execute(
                "UPDATE attachments SET transaction_id = ?2, updated_hlc = ?3 WHERE id = ?1 AND deleted = 0",
                params![id, tx_id, db.hlc.tick()],
            )?
        } else {
            tx.execute(
                "INSERT INTO attachments (id, transaction_id, sha256, mime, file_name, size_bytes, width, height,
                                          ocr_text, ocr_engine, extracted_json, created_at, device_id, updated_hlc)
                 SELECT ?2, ?3, sha256, mime, file_name, size_bytes, width, height, ocr_text, ocr_engine, extracted_json,
                        ?4, ?5, ?6
                 FROM attachments WHERE id = ?1 AND deleted = 0",
                params![id, new_id(), tx_id, now_rfc3339(), db.device_id(), db.hlc.tick()],
            )?
        };
        if n == 0 {
            return Err(AppError::NotFound(format!("attachment {id}")));
        }
        ids.push(tx_id);
    }
    tx.commit()?;
    Ok(ids)
}

pub fn delete(db: &Db, id: &str) -> AppResult<()> {
    let n = db.conn().execute(
        "UPDATE attachments SET deleted = 1, updated_hlc = ?2 WHERE id = ?1 AND deleted = 0",
        params![id, db.hlc.tick()],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("attachment {id}")));
    }
    Ok(())
}

pub fn image_bytes(db: &Db, id: &str, thumb: bool) -> AppResult<(Vec<u8>, String)> {
    let a = get(db, &db.conn(), id)?;
    let t = thumb_path(db, &a.sha256);
    if thumb && t.exists() {
        return Ok((std::fs::read(t)?, "image/jpeg".into()));
    }
    let o = original_path(db, &a.sha256);
    if !o.exists() {
        return Err(AppError::NotFound("file not on this device yet".into()));
    }
    let bytes = std::fs::read(&o)?;
    if thumb {
        let _ = write_files(db, &bytes);
        if t.exists() {
            return Ok((std::fs::read(t)?, "image/jpeg".into()));
        }
    }
    Ok((bytes, a.mime))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png() -> Vec<u8> {
        let img = image::RgbImage::from_fn(40, 20, |x, _| image::Rgb([x as u8 * 6, 255, 255]));
        let mut buf = std::io::Cursor::new(Vec::new());
        img.write_to(&mut buf, image::ImageFormat::Png).unwrap();
        buf.into_inner()
    }

    #[test]
    fn stores_dedupes_and_links() {
        let db = Db::open_in_memory().unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 10, 8).unwrap();

        db.conn().execute("INSERT INTO meta (key, value) VALUES ('ocr_engine', 'none')", []).unwrap();
        let a = import(&db, &png(), Some("bon.png".into()), None, today).unwrap();
        assert_eq!(a.mime, "image/png");
        assert_eq!((a.width, a.height), (Some(40), Some(20)));
        assert!(a.available);
        assert!(thumb_path(&db, &a.sha256).exists());

        let b = import(&db, &png(), None, None, today).unwrap();
        assert_eq!(a.sha256, b.sha256, "same content, same file");
        let inbox = list(&db, &db.conn(), &AttachmentFilter { inbox: true, ..Default::default() }).unwrap();
        assert_eq!(inbox.len(), 2);

        let acc = crate::domain::accounts::list(&db.conn()).unwrap()[0].id.clone();
        let tx = crate::domain::transactions::create(
            &db,
            crate::domain::transactions::TransactionInput {
                kind: "expense".into(),
                amount_minor: 432,
                currency: None,
                occurred_on: "2026-10-06".into(),
                account_id: acc,
                to_account_id: None,
                category_id: None,
                counterparty: None,
                title: "Einkauf".into(),
                note: None,
                tags: vec![],
                debt_id: None,
                goal_id: None,
            },
        )
        .unwrap();
        db.conn().execute("UPDATE attachments SET ocr_text = 'BIO BANANEN' WHERE id = ?1", [&a.id]).unwrap();
        link(&db, &a.id, Some(&tx.id)).unwrap();
        let inbox = list(&db, &db.conn(), &AttachmentFilter { inbox: true, ..Default::default() }).unwrap();
        assert_eq!(inbox.len(), 1);

        let found = crate::domain::transactions::list(
            &db.conn(),
            &crate::domain::transactions::TransactionFilter { query: Some("bananen".into()), ..Default::default() },
        )
        .unwrap();
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn one_receipt_books_one_entry_per_category() {
        let db = Db::open_in_memory().unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 10, 8).unwrap();
        db.conn().execute("INSERT INTO meta (key, value) VALUES ('ocr_engine', 'none')", []).unwrap();
        let a = import(&db, &png(), Some("bon.png".into()), None, today).unwrap();
        let acc = crate::domain::accounts::list(&db.conn()).unwrap()[0].id.clone();
        let cats = crate::domain::categories::list(&db.conn()).unwrap();
        let id = |key: &str| cats.iter().find(|c| c.system_key.as_deref() == Some(key)).unwrap().id.clone();
        let ids = book(
            &db,
            &a.id,
            BookReceipt {
                date: "2026-10-07".into(),
                account_id: acc,
                counterparty: Some("REWE".into()),
                title: "REWE".into(),
                parts: vec![
                    ReceiptPart { category_id: Some(id("category.groceries")), amount_minor: 2_340, note: Some("Milch · Brot".into()) },
                    ReceiptPart { category_id: Some(id("category.health")), amount_minor: 599, note: None },
                ],
            },
        )
        .unwrap();
        assert_eq!(ids.len(), 2);
        let all = list(&db, &db.conn(), &AttachmentFilter::default()).unwrap();
        assert_eq!(all.len(), 2, "the second entry gets its own link to the same photo");
        assert!(all.iter().all(|x| x.sha256 == a.sha256 && x.transaction_id.is_some()));
        let tx = crate::domain::transactions::get(&db.conn(), &ids[1]).unwrap();
        assert_eq!((tx.amount_minor, tx.attachment_count), (599, 1));
        assert!(book(&db, "missing", BookReceipt { date: "2026-10-07".into(), account_id: tx.account_id, counterparty: None, title: "x".into(), parts: vec![ReceiptPart { category_id: None, amount_minor: 1, note: None }] }).is_err());
    }
}
