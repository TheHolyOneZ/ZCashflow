CREATE TABLE account_balance_anchors (
    account_id  TEXT PRIMARY KEY REFERENCES accounts(id),
    anchor_minor INTEGER NOT NULL,
    anchor_on   TEXT NOT NULL,
    anchor_at   TEXT NOT NULL,
    device_id   TEXT NOT NULL,
    updated_hlc TEXT NOT NULL
);

INSERT INTO account_balance_anchors (account_id, anchor_minor, anchor_on, anchor_at, device_id, updated_hlc)
SELECT id, anchor_minor, anchor_on, anchor_at, device_id, updated_hlc
FROM accounts
WHERE anchor_at IS NOT NULL;

CREATE TRIGGER sync_account_balance_anchors_i AFTER INSERT ON account_balance_anchors BEGIN
    DELETE FROM sync_changes WHERE tbl = 'account_balance_anchors' AND row_id = new.account_id;
    INSERT INTO sync_changes (tbl, row_id) VALUES ('account_balance_anchors', new.account_id);
END;

CREATE TRIGGER sync_account_balance_anchors_u AFTER UPDATE ON account_balance_anchors BEGIN
    DELETE FROM sync_changes WHERE tbl = 'account_balance_anchors' AND row_id = new.account_id;
    INSERT INTO sync_changes (tbl, row_id) VALUES ('account_balance_anchors', new.account_id);
END;

INSERT INTO sync_changes (tbl, row_id)
SELECT 'account_balance_anchors', account_id FROM account_balance_anchors;
