use std::collections::HashMap;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::categories::{self, Category};
use crate::db::{new_id, now_rfc3339, Db};
use crate::error::{AppError, AppResult};

const MAX_DEPTH: usize = 32;
const DEFAULT_ICON: &str = "circle-dashed";
const DEFAULT_COLOR: &str = "#0f766e";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct CategoryNode {
    pub name: String,
    #[serde(default, alias = "icon", skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default)]
    pub subcategories: Vec<CategoryNode>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct CategoryFile {
    #[serde(default, alias = "expense", alias = "expenses")]
    pub out: Vec<CategoryNode>,
    #[serde(default, rename = "in", alias = "income")]
    pub income: Vec<CategoryNode>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub both: Vec<CategoryNode>,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub created: u32,
    pub updated: u32,
    pub unchanged: u32,
}

fn label(c: &Category, labels: &HashMap<String, String>) -> String {
    c.system_key.as_ref().and_then(|k| labels.get(k).cloned()).unwrap_or_else(|| c.name.clone())
}

pub fn export(conn: &Connection, labels: &HashMap<String, String>) -> AppResult<CategoryFile> {
    let all = categories::list(conn)?;
    fn build(all: &[Category], parent: Option<&str>, kind: &str, labels: &HashMap<String, String>, depth: usize) -> Vec<CategoryNode> {
        if depth > MAX_DEPTH {
            return Vec::new();
        }
        all.iter()
            .filter(|c| c.parent_id.as_deref() == parent && (parent.is_some() || c.kind == kind))
            .map(|c| CategoryNode {
                name: label(c, labels),
                symbol: c.icon.clone(),
                color: c.color.clone(),
                subcategories: build(all, Some(&c.id), kind, labels, depth + 1),
            })
            .collect()
    }
    Ok(CategoryFile {
        out: build(&all, None, "expense", labels, 0),
        income: build(&all, None, "income", labels, 0),
        both: build(&all, None, "both", labels, 0),
    })
}

fn color(raw: Option<&str>) -> AppResult<Option<String>> {
    let Some(raw) = raw.map(str::trim).filter(|s| !s.is_empty()) else { return Ok(None) };
    let hex = raw.trim_start_matches('#');
    let full = match hex.len() {
        3 => hex.chars().flat_map(|c| [c, c]).collect::<String>(),
        6 => hex.to_owned(),
        _ => return Err(AppError::Invalid(format!("invalid color {raw:?}"))),
    };
    if !full.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::Invalid(format!("invalid color {raw:?}")));
    }
    Ok(Some(format!("#{}", full.to_lowercase())))
}

struct Importer<'a> {
    db: &'a Db,
    conn: &'a Connection,
    labels: &'a HashMap<String, String>,
    hlc: String,
    summary: ImportSummary,
}

impl Importer<'_> {
    fn siblings(&self, parent: Option<&str>, kind: &str) -> AppResult<Vec<Category>> {
        Ok(categories::list(self.conn)?
            .into_iter()
            .filter(|c| c.parent_id.as_deref() == parent && (c.kind == kind || c.kind == "both" || kind == "both"))
            .collect())
    }

    fn nodes(&mut self, nodes: &[CategoryNode], parent: Option<&Category>, kind: &str, depth: usize) -> AppResult<()> {
        if depth > MAX_DEPTH {
            return Err(AppError::Invalid("categories are nested too deeply".into()));
        }
        let parent_id = parent.map(|p| p.id.as_str());
        let existing = self.siblings(parent_id, kind)?;
        let mut placed: Vec<String> = Vec::new();
        for node in nodes {
            let name = node.name.trim();
            if name.is_empty() {
                return Err(AppError::Invalid("every category needs a name".into()));
            }
            let icon = node.symbol.as_deref().map(str::trim).filter(|s| !s.is_empty());
            let color = color(node.color.as_deref())?;
            let wanted = name.to_lowercase();
            let found = existing
                .iter()
                .find(|c| !placed.contains(&c.id) && (c.name.to_lowercase() == wanted || label(c, self.labels).to_lowercase() == wanted));
            let category = match found {
                Some(c) => {
                    let icon_changed = icon.is_some_and(|i| c.icon.as_deref() != Some(i));
                    let color_changed = color.as_ref().is_some_and(|x| c.color.as_ref() != Some(x));
                    if icon_changed || color_changed {
                        self.conn.execute(
                            "UPDATE categories SET icon = coalesce(?2, icon), color = coalesce(?3, color), updated_hlc = ?4 WHERE id = ?1",
                            params![c.id, icon, color, self.hlc],
                        )?;
                        self.summary.updated += 1;
                    } else {
                        self.summary.unchanged += 1;
                    }
                    Category { icon: icon.map(str::to_owned).or(c.icon.clone()), color: color.clone().or(c.color.clone()), ..c.clone() }
                }
                None => {
                    let id = new_id();
                    let node_kind = parent.map_or(kind, |p| if kind == "both" { p.kind.as_str() } else { kind });
                    let color = color.or_else(|| parent.and_then(|p| p.color.clone())).unwrap_or_else(|| DEFAULT_COLOR.into());
                    let icon = icon.unwrap_or(DEFAULT_ICON);
                    self.conn.execute(
                        "INSERT INTO categories (id, parent_id, name, kind, icon, color, created_at, device_id, updated_hlc)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                        params![id, parent_id, name, node_kind, icon, color, now_rfc3339(), self.db.device_id(), self.hlc],
                    )?;
                    self.summary.created += 1;
                    Category {
                        id,
                        parent_id: parent_id.map(str::to_owned),
                        name: name.to_owned(),
                        system_key: None,
                        kind: node_kind.to_owned(),
                        icon: Some(icon.to_owned()),
                        color: Some(color),
                    }
                }
            };
            placed.push(category.id.clone());
            self.nodes(&node.subcategories, Some(&category), kind, depth + 1)?;
        }
        if !nodes.is_empty() {
            let order = existing.iter().map(|c| c.id.clone()).filter(|id| !placed.contains(id)).chain(placed.iter().cloned());
            for (i, id) in order.enumerate() {
                self.conn.execute(
                    "UPDATE categories SET sort_order = ?2, updated_hlc = ?3 WHERE id = ?1 AND sort_order IS NOT ?2",
                    params![id, i as i64, self.hlc],
                )?;
            }
        }
        Ok(())
    }
}

pub fn import(db: &Db, file: &CategoryFile, labels: &HashMap<String, String>, dry_run: bool) -> AppResult<ImportSummary> {
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    let mut importer = Importer { db, conn: &tx, labels, hlc: db.hlc.tick(), summary: ImportSummary::default() };
    importer.nodes(&file.out, None, "expense", 0)?;
    importer.nodes(&file.income, None, "income", 0)?;
    importer.nodes(&file.both, None, "both", 0)?;
    let summary = importer.summary;
    if dry_run {
        tx.rollback()?;
    } else {
        tx.commit()?;
    }
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(name: &str, symbol: Option<&str>, subs: Vec<CategoryNode>) -> CategoryNode {
        CategoryNode { name: name.into(), symbol: symbol.map(str::to_owned), color: None, subcategories: subs }
    }

    #[test]
    fn reads_the_documented_format() {
        let file: CategoryFile = serde_json::from_str(
            r##"{"out":[{"name":"Wohnen","symbol":"house","subcategories":[{"name":"Miete","icon":"house","color":"#abc","subcategories":[]}]}],"in":[]}"##,
        )
        .unwrap();
        assert_eq!(file.out[0].subcategories[0].symbol.as_deref(), Some("house"));
        assert_eq!(color(Some("#ABC")).unwrap().as_deref(), Some("#aabbcc"));
        assert!(color(Some("red")).is_err());
    }

    #[test]
    fn imports_nested_categories_merges_by_name_and_keeps_the_file_order() {
        let db = Db::open_in_memory().unwrap();
        let before = categories::list(&db.conn()).unwrap().len();
        let file = CategoryFile {
            out: vec![node(
                "Wohnen",
                Some("house"),
                vec![
                    node("Miete", Some("house"), vec![node("miete-1", None, vec![]), node("miete-2", None, vec![])]),
                    node("Strom", Some("plug"), vec![]),
                ],
            )],
            income: vec![node("Nebenjob", Some("briefcase"), vec![])],
            both: vec![],
        };
        let labels = HashMap::new();
        let preview = import(&db, &file, &labels, true).unwrap();
        assert_eq!(preview.created, 6);
        assert_eq!(categories::list(&db.conn()).unwrap().len(), before, "a preview changes nothing");

        assert_eq!(import(&db, &file, &labels, false).unwrap(), preview);
        let all = categories::list(&db.conn()).unwrap();
        assert_eq!(all.len(), before + 6);
        let wohnen = all.iter().find(|c| c.name == "Wohnen").unwrap();
        let miete = all.iter().find(|c| c.name == "Miete").unwrap();
        assert_eq!(miete.parent_id.as_deref(), Some(wohnen.id.as_str()));
        assert_eq!(miete.kind, "expense");
        let kids: Vec<&str> = all.iter().filter(|c| c.parent_id.as_deref() == Some(miete.id.as_str())).map(|c| c.name.as_str()).collect();
        assert_eq!(kids, ["miete-1", "miete-2"]);
        assert_eq!(all.iter().find(|c| c.name == "miete-1").unwrap().color, wohnen.color, "subcategories take the parent's color");
        assert_eq!(all.iter().find(|c| c.name == "Nebenjob").unwrap().kind, "income");

        let mut again = file.clone();
        again.out[0].subcategories.reverse();
        again.out[0].subcategories[0].symbol = Some("wifi".into());
        let r = import(&db, &again, &labels, false).unwrap();
        assert_eq!(r, ImportSummary { created: 0, updated: 1, unchanged: 5 });
        let all = categories::list(&db.conn()).unwrap();
        let kids: Vec<&str> = all.iter().filter(|c| c.parent_id.as_deref() == Some(wohnen.id.as_str())).map(|c| c.name.as_str()).collect();
        assert_eq!(kids, ["Strom", "Miete"]);
        assert_eq!(all.iter().find(|c| c.name == "Strom").unwrap().icon.as_deref(), Some("wifi"));
    }

    #[test]
    fn exports_what_it_can_import() {
        let db = Db::open_in_memory().unwrap();
        let file = CategoryFile { out: vec![node("Büro", Some("briefcase"), vec![node("Tee", Some("coffee"), vec![])])], ..Default::default() };
        import(&db, &file, &HashMap::new(), false).unwrap();
        let out = export(&db.conn(), &HashMap::new()).unwrap();
        let office = out.out.iter().find(|n| n.name == "Büro").unwrap();
        assert_eq!(office.subcategories[0].name, "Tee");
        assert_eq!(office.subcategories[0].symbol.as_deref(), Some("coffee"));
        assert!(!out.income.is_empty());
        let fresh = Db::open_in_memory().unwrap();
        let r = import(&fresh, &out, &HashMap::new(), true).unwrap();
        assert_eq!(r.created, 2, "only the new categories are created in a fresh database");
        assert!(import(&db, &CategoryFile { out: vec![node(" ", None, vec![])], ..Default::default() }, &HashMap::new(), false).is_err());
    }
}
