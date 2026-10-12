pub mod extract;
pub mod llm;

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

use image::DynamicImage;
use serde::Serialize;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrStatus {
    pub tesseract: Option<String>,
    pub tesseract_langs: Vec<String>,
    pub ocrs: bool,
}

static MODEL_DIR: OnceLock<PathBuf> = OnceLock::new();
static OCRS: OnceLock<Mutex<Option<ocrs::OcrEngine>>> = OnceLock::new();

pub fn set_model_dir(dir: PathBuf) {
    let _ = MODEL_DIR.set(dir);
}

fn tesseract_cmd() -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new("tesseract");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn tesseract_version() -> Option<String> {
    static VERSION: OnceLock<Option<String>> = OnceLock::new();
    VERSION
        .get_or_init(|| {
            let out = tesseract_cmd().arg("--version").output().ok()?;
            let text = String::from_utf8_lossy(&out.stdout).to_string() + &String::from_utf8_lossy(&out.stderr);
            text.lines().next().map(|l| l.trim().to_owned())
        })
        .clone()
}

fn tesseract_langs() -> Vec<String> {
    tesseract_cmd()
        .arg("--list-langs")
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .skip(1)
                .map(|l| l.trim().to_owned())
                .filter(|l| !l.is_empty() && l != "osd")
                .collect()
        })
        .unwrap_or_default()
}

fn ocrs_models() -> Option<(PathBuf, PathBuf)> {
    let dir = MODEL_DIR.get()?;
    let det = dir.join("text-detection.rten");
    let rec = dir.join("text-recognition.rten");
    (det.exists() && rec.exists()).then_some((det, rec))
}

#[cfg(any(mobile, feature = "embed-ocr"))]
fn embedded_models() -> Option<(rten::Model, rten::Model)> {
    static DET: &[u8] = include_bytes!("../../resources/ocr/text-detection.rten");
    static REC: &[u8] = include_bytes!("../../resources/ocr/text-recognition.rten");
    Some((rten::Model::load_static_slice(DET).ok()?, rten::Model::load_static_slice(REC).ok()?))
}

#[cfg(not(any(mobile, feature = "embed-ocr")))]
fn embedded_models() -> Option<(rten::Model, rten::Model)> {
    None
}

const HAS_EMBEDDED: bool = cfg!(any(mobile, feature = "embed-ocr"));

fn load_models() -> AppResult<(rten::Model, rten::Model)> {
    if let Some((det, rec)) = ocrs_models() {
        let load = |p: &Path| rten::Model::load_file(p).map_err(|e| AppError::Invalid(format!("OCR model: {e}")));
        return Ok((load(&det)?, load(&rec)?));
    }
    embedded_models().ok_or_else(|| AppError::Invalid("OCR models missing".into()))
}

pub fn status() -> OcrStatus {
    let tesseract = tesseract_version();
    OcrStatus {
        tesseract_langs: if tesseract.is_some() { tesseract_langs() } else { vec![] },
        tesseract,
        ocrs: ocrs_models().is_some() || HAS_EMBEDDED,
    }
}

fn normalize(img: DynamicImage) -> DynamicImage {
    let (w, h) = (img.width(), img.height());
    let max = w.max(h);
    if max > 2400 {
        img.resize(w * 2400 / max, h * 2400 / max, image::imageops::FilterType::Triangle)
    } else {
        img
    }
}

fn run_tesseract(img: &DynamicImage) -> AppResult<String> {
    let tmp = std::env::temp_dir().join(format!("zc-ocr-{}.png", uuid::Uuid::now_v7()));
    img.to_luma8().save(&tmp).map_err(|e| AppError::Invalid(format!("image: {e}")))?;
    let langs = tesseract_langs();
    let lang = ["deu", "eng"].iter().filter(|l| langs.iter().any(|x| x == *l)).copied().collect::<Vec<_>>().join("+");
    let mut cmd = tesseract_cmd();
    cmd.arg(&tmp).arg("stdout").args(["--psm", "4"]);
    if !lang.is_empty() {
        cmd.args(["-l", &lang]);
    }
    let out = cmd.output();
    let _ = std::fs::remove_file(&tmp);
    let out = out?;
    if !out.status.success() {
        return Err(AppError::Invalid(format!("tesseract failed: {}", String::from_utf8_lossy(&out.stderr))));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn run_ocrs(img: &DynamicImage) -> AppResult<String> {
    let cell = OCRS.get_or_init(|| Mutex::new(None));
    let mut guard = cell.lock().unwrap();
    if guard.is_none() {
        let (det, rec) = load_models()?;
        let engine = ocrs::OcrEngine::new(ocrs::OcrEngineParams {
            detection_model: Some(det),
            recognition_model: Some(rec),
            ..Default::default()
        })
        .map_err(|e| AppError::Invalid(format!("OCR engine: {e}")))?;
        *guard = Some(engine);
    }
    let engine = guard.as_ref().unwrap();
    let rgb = img.to_rgb8();
    let source = ocrs::ImageSource::from_bytes(rgb.as_raw(), rgb.dimensions())
        .map_err(|e| AppError::Invalid(format!("OCR input: {e}")))?;
    let input = engine.prepare_input(source).map_err(|e| AppError::Invalid(format!("OCR input: {e}")))?;
    let words = engine.detect_words(&input).map_err(|e| AppError::Invalid(format!("OCR: {e}")))?;
    let lines = engine.find_text_lines(&input, &words);
    let texts = engine.recognize_text(&input, &lines).map_err(|e| AppError::Invalid(format!("OCR: {e}")))?;
    Ok(texts
        .iter()
        .flatten()
        .map(|l| l.to_string())
        .filter(|l| l.trim().len() > 1)
        .collect::<Vec<_>>()
        .join("\n"))
}

pub fn recognize(img: DynamicImage, preferred: &str) -> AppResult<(String, &'static str)> {
    if preferred == "none" {
        return Err(AppError::Invalid("OCR disabled".into()));
    }
    let img = normalize(img);
    let has_tesseract = tesseract_version().is_some();
    let order: Vec<&'static str> = match preferred {
        "ocrs" => vec!["ocrs", "tesseract"],
        "tesseract" => vec!["tesseract", "ocrs"],
        _ if has_tesseract => vec!["tesseract", "ocrs"],
        _ => vec!["ocrs", "tesseract"],
    };
    let mut last_err = AppError::Invalid("no OCR engine available".into());
    for engine in order {
        let result = match engine {
            "tesseract" if has_tesseract => run_tesseract(&img),
            "ocrs" if ocrs_models().is_some() || HAS_EMBEDDED => run_ocrs(&img),
            _ => continue,
        };
        match result {
            Ok(text) if !text.trim().is_empty() => return Ok((text, engine)),
            Ok(_) => last_err = AppError::Invalid("no text found".into()),
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

pub fn decode(bytes: &[u8]) -> AppResult<DynamicImage> {
    use image::ImageDecoder;
    let reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| AppError::Invalid(format!("image: {e}")))?;
    let mut decoder = reader.into_decoder().map_err(|e| AppError::Invalid(format!("image: {e}")))?;
    let orientation = decoder.orientation().ok();
    let mut img = DynamicImage::from_decoder(decoder).map_err(|e| AppError::Invalid(format!("image: {e}")))?;
    if let Some(o) = orientation {
        img.apply_orientation(o);
    }
    Ok(img)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore]
    fn ocr_sample() {
        let path = std::env::var("ZC_OCR_SAMPLE").expect("ZC_OCR_SAMPLE");
        set_model_dir(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/ocr"));
        let img = decode(&std::fs::read(path).unwrap()).unwrap();
        for engine in ["tesseract", "ocrs"] {
            let t = std::time::Instant::now();
            let (text, used) = recognize(img.clone(), engine).unwrap();
            let fields = extract::extract(&text, chrono::NaiveDate::from_ymd_opt(2026, 10, 8).unwrap());
            println!("--- {used} ({:?})\n{text}\n=> {fields:?}", t.elapsed());
        }
    }
}
