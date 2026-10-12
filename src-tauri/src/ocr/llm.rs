use std::time::Duration;

use base64::Engine;
use serde_json::{json, Value};

use super::extract::Extracted;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone)]
pub struct LlmConfig {
    pub url: String,
    pub model: String,

    pub vision: bool,
}

const SYSTEM: &str = "You extract data from shop receipts. Reply with JSON only: \
{\"merchant\": string|null, \"date\": \"YYYY-MM-DD\"|null, \"total\": number|null, \
\"currency\": \"ISO 4217\"|null, \"category\": one of [groceries, food, housing, utilities, \
transport, subscriptions, shopping, health, leisure, other]|null}. \
`total` is the final amount paid, not subtotal or tax.";

fn endpoint(url: &str) -> String {
    let base = url.trim_end_matches('/');
    if base.ends_with("/chat/completions") {
        base.to_owned()
    } else if base.ends_with("/v1") {
        format!("{base}/chat/completions")
    } else {
        format!("{base}/v1/chat/completions")
    }
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(120)))
        .build()
        .into()
}

pub fn refine(cfg: &LlmConfig, ocr_text: &str, jpeg: Option<&[u8]>) -> AppResult<Extracted> {
    let mut content = vec![json!({ "type": "text", "text": format!("Receipt text (OCR):\n{ocr_text}") })];
    if let (true, Some(bytes)) = (cfg.vision, jpeg) {
        let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
        content.push(json!({ "type": "image_url", "image_url": { "url": format!("data:image/jpeg;base64,{b64}") } }));
    }
    let body = json!({
        "model": cfg.model,
        "temperature": 0,
        "response_format": { "type": "json_object" },
        "messages": [
            { "role": "system", "content": SYSTEM },
            { "role": "user", "content": content },
        ],
    });
    let resp: Value = agent()
        .post(&endpoint(&cfg.url))
        .send_json(&body)
        .map_err(|e| AppError::Invalid(format!("LLM: {e}")))?
        .body_mut()
        .read_json()
        .map_err(|e| AppError::Invalid(format!("LLM: {e}")))?;
    let text = resp["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| AppError::Invalid("LLM: empty answer".into()))?;
    parse_answer(text)
}

fn parse_answer(text: &str) -> AppResult<Extracted> {
    let start = text.find('{').ok_or_else(|| AppError::Invalid("LLM: no JSON".into()))?;
    let end = text.rfind('}').ok_or_else(|| AppError::Invalid("LLM: no JSON".into()))?;
    let v: Value = serde_json::from_str(&text[start..=end]).map_err(|e| AppError::Invalid(format!("LLM JSON: {e}")))?;
    let s = |k: &str| v[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned);
    let total = match &v["total"] {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.replace(',', ".").parse().ok(),
        _ => None,
    };
    let date = s("date").filter(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").is_ok());
    Ok(Extracted {
        merchant: s("merchant"),
        date,
        total_minor: total.filter(|t| *t > 0.0).map(|t| (t * 100.0).round() as i64),
        currency: s("currency").map(|c| c.to_uppercase()).filter(|c| c.len() == 3),
        category_hint: s("category"),
        source: "llm".into(),
    })
}

pub fn list_models(url: &str) -> AppResult<Vec<String>> {
    let base = endpoint(url).trim_end_matches("/chat/completions").to_owned();
    let v: Value = agent()
        .get(&format!("{base}/models"))
        .call()
        .map_err(|e| AppError::Invalid(format!("LLM: {e}")))?
        .body_mut()
        .read_json()
        .map_err(|e| AppError::Invalid(format!("LLM: {e}")))?;
    Ok(v["data"]
        .as_array()
        .map(|a| a.iter().filter_map(|m| m["id"].as_str().map(str::to_owned)).collect())
        .unwrap_or_default())
}

pub fn merge(base: Extracted, llm: Extracted) -> Extracted {
    Extracted {
        merchant: llm.merchant.or(base.merchant),
        date: llm.date.or(base.date),
        total_minor: llm.total_minor.or(base.total_minor),
        currency: llm.currency.or(base.currency),
        category_hint: llm.category_hint,
        source: "llm".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoints() {
        assert_eq!(endpoint("http://localhost:11434"), "http://localhost:11434/v1/chat/completions");
        assert_eq!(endpoint("http://x/v1/"), "http://x/v1/chat/completions");
    }

    #[test]
    fn parses_fenced_lenient_json() {
        let e = parse_answer("```json\n{\"merchant\":\"REWE\",\"date\":\"2026-10-06\",\"total\":\"4,32\",\"currency\":\"eur\",\"category\":\"groceries\"}\n```").unwrap();
        assert_eq!(e.total_minor, Some(432));
        assert_eq!(e.currency.as_deref(), Some("EUR"));
        assert_eq!(e.category_hint.as_deref(), Some("groceries"));
        let e = parse_answer("{\"merchant\":null,\"date\":\"06.10.2026\",\"total\":12.5}").unwrap();
        assert_eq!(e.date, None);
        assert_eq!(e.total_minor, Some(1250));
    }
}
