ALTER TABLE recurring_rules ADD COLUMN post_from TEXT;
UPDATE recurring_rules SET post_from = substr(created_at, 1, 10) WHERE post_from IS NULL;

CREATE TABLE recurring_skips (
    occurrence_key  TEXT PRIMARY KEY,
    rule_id         TEXT NOT NULL REFERENCES recurring_rules(id),
    created_at      TEXT NOT NULL,
    device_id       TEXT NOT NULL,
    updated_hlc     TEXT NOT NULL,
    deleted         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE goal_allocations (
    id              TEXT PRIMARY KEY,
    goal_id         TEXT NOT NULL REFERENCES goals(id),
    amount_minor    INTEGER NOT NULL CHECK (amount_minor <> 0),
    occurred_on     TEXT NOT NULL,
    note            TEXT,
    created_at      TEXT NOT NULL,
    device_id       TEXT NOT NULL,
    updated_hlc     TEXT NOT NULL,
    deleted         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX goal_allocations_goal ON goal_allocations(goal_id);

ALTER TABLE goals ADD COLUMN icon TEXT;
ALTER TABLE goals ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE debts ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
