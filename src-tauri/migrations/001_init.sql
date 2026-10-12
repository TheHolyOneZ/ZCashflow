CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE accounts (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    system_key      TEXT,
    kind            TEXT NOT NULL DEFAULT 'cash'
                    CHECK (kind IN ('cash', 'checking', 'savings', 'credit', 'other')),
    currency        TEXT NOT NULL,
    opening_minor   INTEGER NOT NULL DEFAULT 0,
    color           TEXT,
    archived        INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    device_id       TEXT NOT NULL,
    updated_hlc     TEXT NOT NULL,
    deleted         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE categories (
    id              TEXT PRIMARY KEY,
    parent_id       TEXT REFERENCES categories(id),
    name            TEXT NOT NULL,
    system_key      TEXT,
    kind            TEXT NOT NULL DEFAULT 'expense'
                    CHECK (kind IN ('income', 'expense', 'both')),
    icon            TEXT,
    color           TEXT,
    created_at      TEXT NOT NULL,
    device_id       TEXT NOT NULL,
    updated_hlc     TEXT NOT NULL,
    deleted         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE counterparties (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    kind            TEXT NOT NULL DEFAULT 'merchant'
                    CHECK (kind IN ('merchant', 'employer', 'person', 'institution', 'other')),
    note            TEXT,
    created_at      TEXT NOT NULL,
    device_id       TEXT NOT NULL,
    updated_hlc     TEXT NOT NULL,
    deleted         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX counterparties_name ON counterparties(name COLLATE NOCASE);

CREATE TABLE recurring_rules (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'transfer')),
    amount_minor    INTEGER NOT NULL CHECK (amount_minor > 0),
    currency        TEXT NOT NULL,
    account_id      TEXT NOT NULL REFERENCES accounts(id),
    to_account_id   TEXT REFERENCES accounts(id),
    category_id     TEXT REFERENCES categories(id),
    counterparty_id TEXT REFERENCES counterparties(id),
    freq            TEXT NOT NULL CHECK (freq IN ('daily', 'weekly', 'monthly', 'yearly')),
    interval_n      INTEGER NOT NULL DEFAULT 1 CHECK (interval_n >= 1),
    start_on        TEXT NOT NULL,
    end_on          TEXT,
    max_count       INTEGER,
    auto_post       INTEGER NOT NULL DEFAULT 1,
    note            TEXT,
    created_at      TEXT NOT NULL,
    device_id       TEXT NOT NULL,
    updated_hlc     TEXT NOT NULL,
    deleted         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE debts (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    direction       TEXT NOT NULL CHECK (direction IN ('i_owe', 'owed_to_me')),
    counterparty_id TEXT REFERENCES counterparties(id),
    principal_minor INTEGER NOT NULL CHECK (principal_minor > 0),
    currency        TEXT NOT NULL,
    start_on        TEXT NOT NULL,
    due_on          TEXT,
    interest_bp     INTEGER,
    recurring_rule_id TEXT REFERENCES recurring_rules(id),
    note            TEXT,
    created_at      TEXT NOT NULL,
    device_id       TEXT NOT NULL,
    updated_hlc     TEXT NOT NULL,
    deleted         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE goals (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    target_minor    INTEGER NOT NULL CHECK (target_minor > 0),
    currency        TEXT NOT NULL,
    target_on       TEXT,
    account_id      TEXT REFERENCES accounts(id),
    color           TEXT,
    note            TEXT,
    created_at      TEXT NOT NULL,
    device_id       TEXT NOT NULL,
    updated_hlc     TEXT NOT NULL,
    deleted         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE budgets (
    id              TEXT PRIMARY KEY,
    category_id     TEXT NOT NULL REFERENCES categories(id),
    period          TEXT NOT NULL CHECK (period IN ('day', 'week', 'month', 'year')),
    limit_minor     INTEGER NOT NULL CHECK (limit_minor > 0),
    currency        TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    device_id       TEXT NOT NULL,
    updated_hlc     TEXT NOT NULL,
    deleted         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE transactions (
    id              TEXT PRIMARY KEY,
    ref             TEXT NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'transfer')),
    amount_minor    INTEGER NOT NULL CHECK (amount_minor > 0),
    currency        TEXT NOT NULL,
    occurred_on     TEXT NOT NULL,
    account_id      TEXT NOT NULL REFERENCES accounts(id),
    to_account_id   TEXT REFERENCES accounts(id),
    category_id     TEXT REFERENCES categories(id),
    counterparty_id TEXT REFERENCES counterparties(id),
    title           TEXT NOT NULL,
    note            TEXT,
    tags            TEXT NOT NULL DEFAULT '[]',
    recurring_rule_id TEXT REFERENCES recurring_rules(id),
    occurrence_key  TEXT UNIQUE,
    debt_id         TEXT REFERENCES debts(id),
    goal_id         TEXT REFERENCES goals(id),
    created_at      TEXT NOT NULL,
    device_id       TEXT NOT NULL,
    updated_hlc     TEXT NOT NULL,
    deleted         INTEGER NOT NULL DEFAULT 0,
    CHECK ((kind = 'transfer') = (to_account_id IS NOT NULL))
);
CREATE INDEX transactions_date ON transactions(occurred_on DESC);
CREATE INDEX transactions_account ON transactions(account_id);
CREATE INDEX transactions_category ON transactions(category_id);

CREATE TABLE notes (
    id              TEXT PRIMARY KEY,
    entity_type     TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    body            TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    device_id       TEXT NOT NULL,
    updated_hlc     TEXT NOT NULL,
    deleted         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX notes_entity ON notes(entity_type, entity_id);

CREATE TABLE attachments (
    id              TEXT PRIMARY KEY,
    transaction_id  TEXT REFERENCES transactions(id),
    sha256          TEXT NOT NULL,
    mime            TEXT NOT NULL,
    ocr_text        TEXT,
    extracted_json  TEXT,
    created_at      TEXT NOT NULL,
    device_id       TEXT NOT NULL,
    updated_hlc     TEXT NOT NULL,
    deleted         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX attachments_tx ON attachments(transaction_id);

CREATE VIRTUAL TABLE transactions_fts USING fts5(
    tx_id UNINDEXED,
    title,
    note,
    counterparty,
    ref,
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER transactions_fts_ai AFTER INSERT ON transactions BEGIN
    INSERT INTO transactions_fts (tx_id, title, note, counterparty, ref)
    VALUES (
        new.id, new.title, coalesce(new.note, ''),
        coalesce((SELECT name FROM counterparties WHERE id = new.counterparty_id), ''),
        new.ref
    );
END;

CREATE TRIGGER transactions_fts_au AFTER UPDATE ON transactions BEGIN
    DELETE FROM transactions_fts WHERE tx_id = old.id;
    INSERT INTO transactions_fts (tx_id, title, note, counterparty, ref)
    SELECT new.id, new.title, coalesce(new.note, ''),
           coalesce((SELECT name FROM counterparties WHERE id = new.counterparty_id), ''),
           new.ref
    WHERE new.deleted = 0;
END;

CREATE TRIGGER transactions_fts_ad AFTER DELETE ON transactions BEGIN
    DELETE FROM transactions_fts WHERE tx_id = old.id;
END;
