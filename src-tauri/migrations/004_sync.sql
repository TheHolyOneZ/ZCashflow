CREATE TABLE sync_changes (
    seq     INTEGER PRIMARY KEY AUTOINCREMENT,
    tbl     TEXT NOT NULL,
    row_id  TEXT NOT NULL,
    UNIQUE (tbl, row_id)
);

CREATE TABLE paired_devices (
    public_key  TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'full' CHECK (role IN ('full', 'view', 'capture')),
    paired_at   TEXT NOT NULL,
    last_seen   TEXT,
    last_addr   TEXT,
    cursor      INTEGER NOT NULL DEFAULT 0
);

CREATE TRIGGER sync_accounts_i AFTER INSERT ON accounts BEGIN
    DELETE FROM sync_changes WHERE tbl = 'accounts' AND row_id = new.id;
    INSERT INTO sync_changes (tbl, row_id) VALUES ('accounts', new.id);
END;

CREATE TRIGGER sync_accounts_u AFTER UPDATE ON accounts BEGIN
    DELETE FROM sync_changes WHERE tbl = 'accounts' AND row_id = new.id;
    INSERT INTO sync_changes (tbl, row_id) VALUES ('accounts', new.id);
END;

CREATE TRIGGER sync_categories_i AFTER INSERT ON categories BEGIN
    DELETE FROM sync_changes WHERE tbl = 'categories' AND row_id = new.id;
    INSERT INTO sync_changes (tbl, row_id) VALUES ('categories', new.id);
END;

CREATE TRIGGER sync_categories_u AFTER UPDATE ON categories BEGIN
    DELETE FROM sync_changes WHERE tbl = 'categories' AND row_id = new.id;
    INSERT INTO sync_changes (tbl, row_id) VALUES ('categories', new.id);
END;

CREATE TRIGGER sync_counterparties_i AFTER INSERT ON counterparties BEGIN
    DELETE FROM sync_changes WHERE tbl = 'counterparties' AND row_id = new.id;
    INSERT INTO sync_changes (tbl, row_id) VALUES ('counterparties', new.id);
END;

CREATE TRIGGER sync_counterparties_u AFTER UPDATE ON counterparties BEGIN
    DELETE FROM sync_changes WHERE tbl = 'counterparties' AND row_id = new.id;
    INSERT INTO sync_changes (tbl, row_id) VALUES ('counterparties', new.id);
END;

CREATE TRIGGER sync_recurring_rules_i AFTER INSERT ON recurring_rules BEGIN
    DELETE FROM sync_changes WHERE tbl = 'recurring_rules' AND row_id = new.id;
    INSERT INTO sync_changes (tbl, row_id) VALUES ('recurring_rules', new.id);
END;

CREATE TRIGGER sync_recurring_rules_u AFTER UPDATE ON recurring_rules BEGIN
    DELETE FROM sync_changes WHERE tbl = 'recurring_rules' AND row_id = new.id;
    INSERT INTO sync_changes (tbl, row_id) VALUES ('recurring_rules', new.id);
END;

CREATE TRIGGER sync_debts_i AFTER INSERT ON debts BEGIN
    DELETE FROM sync_changes WHERE tbl = 'debts' AND row_id = new.id;
    INSERT INTO sync_changes (tbl, row_id) VALUES ('debts', new.id);
END;

CREATE TRIGGER sync_debts_u AFTER UPDATE ON debts BEGIN
    DELETE FROM sync_changes WHERE tbl = 'debts' AND row_id = new.id;
    INSERT INTO sync_changes (tbl, row_id) VALUES ('debts', new.id);
END;

CREATE TRIGGER sync_goals_i AFTER INSERT ON goals BEGIN
    DELETE FROM sync_changes WHERE tbl = 'goals' AND row_id = new.id;
    INSERT INTO sync_changes (tbl, row_id) VALUES ('goals', new.id);
END;

CREATE TRIGGER sync_goals_u AFTER UPDATE ON goals BEGIN
    DELETE FROM sync_changes WHERE tbl = 'goals' AND row_id = new.id;
    INSERT INTO sync_changes (tbl, row_id) VALUES ('goals', new.id);
END;

CREATE TRIGGER sync_budgets_i AFTER INSERT ON budgets BEGIN
    DELETE FROM sync_changes WHERE tbl = 'budgets' AND row_id = new.id;
    INSERT INTO sync_changes (tbl, row_id) VALUES ('budgets', new.id);
END;

CREATE TRIGGER sync_budgets_u AFTER UPDATE ON budgets BEGIN
    DELETE FROM sync_changes WHERE tbl = 'budgets' AND row_id = new.id;
    INSERT INTO sync_changes (tbl, row_id) VALUES ('budgets', new.id);
END;

CREATE TRIGGER sync_transactions_i AFTER INSERT ON transactions BEGIN
    DELETE FROM sync_changes WHERE tbl = 'transactions' AND row_id = new.id;
    INSERT INTO sync_changes (tbl, row_id) VALUES ('transactions', new.id);
END;

CREATE TRIGGER sync_transactions_u AFTER UPDATE ON transactions BEGIN
    DELETE FROM sync_changes WHERE tbl = 'transactions' AND row_id = new.id;
    INSERT INTO sync_changes (tbl, row_id) VALUES ('transactions', new.id);
END;

CREATE TRIGGER sync_notes_i AFTER INSERT ON notes BEGIN
    DELETE FROM sync_changes WHERE tbl = 'notes' AND row_id = new.id;
    INSERT INTO sync_changes (tbl, row_id) VALUES ('notes', new.id);
END;

CREATE TRIGGER sync_notes_u AFTER UPDATE ON notes BEGIN
    DELETE FROM sync_changes WHERE tbl = 'notes' AND row_id = new.id;
    INSERT INTO sync_changes (tbl, row_id) VALUES ('notes', new.id);
END;

CREATE TRIGGER sync_attachments_i AFTER INSERT ON attachments BEGIN
    DELETE FROM sync_changes WHERE tbl = 'attachments' AND row_id = new.id;
    INSERT INTO sync_changes (tbl, row_id) VALUES ('attachments', new.id);
END;

CREATE TRIGGER sync_attachments_u AFTER UPDATE ON attachments BEGIN
    DELETE FROM sync_changes WHERE tbl = 'attachments' AND row_id = new.id;
    INSERT INTO sync_changes (tbl, row_id) VALUES ('attachments', new.id);
END;

CREATE TRIGGER sync_recurring_skips_i AFTER INSERT ON recurring_skips BEGIN
    DELETE FROM sync_changes WHERE tbl = 'recurring_skips' AND row_id = new.occurrence_key;
    INSERT INTO sync_changes (tbl, row_id) VALUES ('recurring_skips', new.occurrence_key);
END;

CREATE TRIGGER sync_recurring_skips_u AFTER UPDATE ON recurring_skips BEGIN
    DELETE FROM sync_changes WHERE tbl = 'recurring_skips' AND row_id = new.occurrence_key;
    INSERT INTO sync_changes (tbl, row_id) VALUES ('recurring_skips', new.occurrence_key);
END;

CREATE TRIGGER sync_goal_allocations_i AFTER INSERT ON goal_allocations BEGIN
    DELETE FROM sync_changes WHERE tbl = 'goal_allocations' AND row_id = new.id;
    INSERT INTO sync_changes (tbl, row_id) VALUES ('goal_allocations', new.id);
END;

CREATE TRIGGER sync_goal_allocations_u AFTER UPDATE ON goal_allocations BEGIN
    DELETE FROM sync_changes WHERE tbl = 'goal_allocations' AND row_id = new.id;
    INSERT INTO sync_changes (tbl, row_id) VALUES ('goal_allocations', new.id);
END;

INSERT INTO sync_changes (tbl, row_id) SELECT 'accounts', id FROM accounts;

INSERT INTO sync_changes (tbl, row_id) SELECT 'categories', id FROM categories;

INSERT INTO sync_changes (tbl, row_id) SELECT 'counterparties', id FROM counterparties;

INSERT INTO sync_changes (tbl, row_id) SELECT 'recurring_rules', id FROM recurring_rules;

INSERT INTO sync_changes (tbl, row_id) SELECT 'debts', id FROM debts;

INSERT INTO sync_changes (tbl, row_id) SELECT 'goals', id FROM goals;

INSERT INTO sync_changes (tbl, row_id) SELECT 'budgets', id FROM budgets;

INSERT INTO sync_changes (tbl, row_id) SELECT 'transactions', id FROM transactions;

INSERT INTO sync_changes (tbl, row_id) SELECT 'notes', id FROM notes;

INSERT INTO sync_changes (tbl, row_id) SELECT 'attachments', id FROM attachments;

INSERT INTO sync_changes (tbl, row_id) SELECT 'recurring_skips', occurrence_key FROM recurring_skips;

INSERT INTO sync_changes (tbl, row_id) SELECT 'goal_allocations', id FROM goal_allocations;
