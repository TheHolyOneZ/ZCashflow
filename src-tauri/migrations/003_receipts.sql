ALTER TABLE attachments ADD COLUMN file_name TEXT;
ALTER TABLE attachments ADD COLUMN size_bytes INTEGER;
ALTER TABLE attachments ADD COLUMN width INTEGER;
ALTER TABLE attachments ADD COLUMN height INTEGER;
ALTER TABLE attachments ADD COLUMN ocr_engine TEXT;
CREATE INDEX attachments_sha ON attachments(sha256);

DROP TRIGGER transactions_fts_ai;
DROP TRIGGER transactions_fts_au;
DROP TRIGGER transactions_fts_ad;
DROP TABLE transactions_fts;

CREATE VIRTUAL TABLE transactions_fts USING fts5(
    tx_id UNINDEXED,
    title,
    note,
    counterparty,
    ref,
    ocr,
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER transactions_fts_ai AFTER INSERT ON transactions BEGIN
    INSERT INTO transactions_fts (tx_id, title, note, counterparty, ref, ocr)
    SELECT new.id, new.title, coalesce(new.note, ''),
           coalesce((SELECT name FROM counterparties WHERE id = new.counterparty_id), ''),
           new.ref,
           coalesce((SELECT group_concat(ocr_text, ' ') FROM attachments
                     WHERE transaction_id = new.id AND deleted = 0), '')
    WHERE new.deleted = 0;
END;

CREATE TRIGGER transactions_fts_au AFTER UPDATE ON transactions BEGIN
    DELETE FROM transactions_fts WHERE tx_id = old.id;
    INSERT INTO transactions_fts (tx_id, title, note, counterparty, ref, ocr)
    SELECT new.id, new.title, coalesce(new.note, ''),
           coalesce((SELECT name FROM counterparties WHERE id = new.counterparty_id), ''),
           new.ref,
           coalesce((SELECT group_concat(ocr_text, ' ') FROM attachments
                     WHERE transaction_id = new.id AND deleted = 0), '')
    WHERE new.deleted = 0;
END;

CREATE TRIGGER transactions_fts_ad AFTER DELETE ON transactions BEGIN
    DELETE FROM transactions_fts WHERE tx_id = old.id;
END;

CREATE TRIGGER attachments_fts_ai AFTER INSERT ON attachments WHEN new.transaction_id IS NOT NULL BEGIN
    DELETE FROM transactions_fts WHERE tx_id = new.transaction_id;
    INSERT INTO transactions_fts (tx_id, title, note, counterparty, ref, ocr)
    SELECT t.id, t.title, coalesce(t.note, ''),
           coalesce((SELECT name FROM counterparties WHERE id = t.counterparty_id), ''), t.ref,
           coalesce((SELECT group_concat(ocr_text, ' ') FROM attachments
                     WHERE transaction_id = t.id AND deleted = 0), '')
    FROM transactions t WHERE t.id = new.transaction_id AND t.deleted = 0;
END;

CREATE TRIGGER attachments_fts_au AFTER UPDATE ON attachments BEGIN
    DELETE FROM transactions_fts WHERE tx_id IN (old.transaction_id, new.transaction_id);
    INSERT INTO transactions_fts (tx_id, title, note, counterparty, ref, ocr)
    SELECT t.id, t.title, coalesce(t.note, ''),
           coalesce((SELECT name FROM counterparties WHERE id = t.counterparty_id), ''), t.ref,
           coalesce((SELECT group_concat(ocr_text, ' ') FROM attachments
                     WHERE transaction_id = t.id AND deleted = 0), '')
    FROM transactions t WHERE t.id IN (old.transaction_id, new.transaction_id) AND t.deleted = 0;
END;

INSERT INTO transactions_fts (tx_id, title, note, counterparty, ref, ocr)
SELECT t.id, t.title, coalesce(t.note, ''),
       coalesce((SELECT name FROM counterparties WHERE id = t.counterparty_id), ''), t.ref,
       coalesce((SELECT group_concat(ocr_text, ' ') FROM attachments
                 WHERE transaction_id = t.id AND deleted = 0), '')
FROM transactions t WHERE t.deleted = 0;
