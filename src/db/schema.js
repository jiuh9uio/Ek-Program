'use strict';
/**
 * Datenbankschema als fortlaufende Migrationen.
 * "department" trennt Fachbereiche: aktuell nur 'service'. Ein späteres
 * Küchenmodul erhält einen eigenen Bereich ('kueche') ohne Schemaänderung.
 */
module.exports = [
  // ---------- Migration 1: Grundschema ----------
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE counters (
    name  TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE departments (
    code   TEXT PRIMARY KEY,
    name   TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin','service')),
    pass_hash     TEXT NOT NULL,
    permissions   TEXT NOT NULL DEFAULT '[]',
    active        INTEGER NOT NULL DEFAULT 1,
    failed_logins INTEGER NOT NULL DEFAULT 0,
    locked_until  TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE sessions (
    token        TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    user_agent   TEXT
  );

  CREATE TABLE categories (
    id         INTEGER PRIMARY KEY,
    department TEXT NOT NULL DEFAULT 'service' REFERENCES departments(code),
    name       TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1,
    UNIQUE (department, name)
  );

  CREATE TABLE locations (
    id         INTEGER PRIMARY KEY,
    department TEXT NOT NULL DEFAULT 'service' REFERENCES departments(code),
    name       TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1,
    UNIQUE (department, name)
  );

  CREATE TABLE units (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    plural     TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE suppliers (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    customer_no     TEXT,
    contact_person  TEXT,
    phone           TEXT,
    email           TEXT,
    order_days      TEXT NOT NULL DEFAULT '',
    delivery_days   TEXT NOT NULL DEFAULT '',
    min_order_value REAL NOT NULL DEFAULT 0,
    shipping_cost   REAL NOT NULL DEFAULT 0,
    notes           TEXT,
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE articles (
    id                INTEGER PRIMARY KEY,
    department        TEXT NOT NULL DEFAULT 'service' REFERENCES departments(code),
    article_no        TEXT NOT NULL,
    name              TEXT NOT NULL,
    category_id       INTEGER REFERENCES categories(id),
    manufacturer      TEXT,
    supplier_id       INTEGER REFERENCES suppliers(id),
    location_id       INTEGER REFERENCES locations(id),
    pack_size         TEXT,
    unit_id           INTEGER REFERENCES units(id),
    price_net         REAL NOT NULL DEFAULT 0,
    min_stock         REAL NOT NULL DEFAULT 0,
    max_stock         REAL NOT NULL DEFAULT 0,
    current_stock     REAL,                 -- NULL = nie kontrolliert (nicht 0!)
    stock_checked_at  TEXT,
    stock_checked_by  INTEGER REFERENCES users(id),
    check_result      TEXT,                 -- 'counted' | 'ok'
    check_note        TEXT,
    unavailable_since TEXT,
    min_order_qty     REAL NOT NULL DEFAULT 0,
    order_step        REAL NOT NULL DEFAULT 1,
    notes             TEXT,
    image             TEXT,
    active            INTEGER NOT NULL DEFAULT 1,
    archived          INTEGER NOT NULL DEFAULT 0,
    sort_order        INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    UNIQUE (department, article_no),
    CHECK (min_stock >= 0 AND max_stock >= 0 AND order_step > 0 AND min_order_qty >= 0 AND price_net >= 0)
  );
  CREATE INDEX idx_articles_dep ON articles(department, archived, active);

  CREATE TABLE purchase_lists (
    id          INTEGER PRIMARY KEY,
    number      TEXT NOT NULL UNIQUE,
    department  TEXT NOT NULL DEFAULT 'service' REFERENCES departments(code),
    title       TEXT,
    status      TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','ready','ordered','partial','delivered','closed','cancelled')),
    note        TEXT,
    created_by  INTEGER REFERENCES users(id),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    ready_at    TEXT,
    approved_by INTEGER REFERENCES users(id),
    ordered_at  TEXT,
    delivered_at TEXT,
    closed_at   TEXT,
    closed_by   INTEGER REFERENCES users(id),
    cancelled_at TEXT,
    actual_cost REAL,
    version     INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX idx_lists_status ON purchase_lists(department, status);

  CREATE TABLE purchase_items (
    id                INTEGER PRIMARY KEY,
    list_id           INTEGER NOT NULL REFERENCES purchase_lists(id) ON DELETE CASCADE,
    article_id        INTEGER NOT NULL REFERENCES articles(id),
    qty               REAL NOT NULL CHECK (qty > 0),
    qty_received      REAL NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
    unit_price_est    REAL NOT NULL DEFAULT 0,
    unit_price_actual REAL,
    supplier_id       INTEGER REFERENCES suppliers(id),
    note              TEXT,
    purchased         INTEGER NOT NULL DEFAULT 0,
    source            TEXT NOT NULL DEFAULT 'manual',
    added_by          INTEGER REFERENCES users(id),
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    UNIQUE (list_id, article_id)            -- doppelte Artikel werden zusammengeführt
  );
  CREATE INDEX idx_items_article ON purchase_items(article_id);

  CREATE TABLE list_events (
    id        INTEGER PRIMARY KEY,
    list_id   INTEGER NOT NULL REFERENCES purchase_lists(id) ON DELETE CASCADE,
    at        TEXT NOT NULL,
    user_id   INTEGER,
    user_name TEXT,
    action    TEXT NOT NULL,
    details   TEXT
  );
  CREATE INDEX idx_list_events ON list_events(list_id);

  CREATE TABLE stock_movements (
    id          INTEGER PRIMARY KEY,
    article_id  INTEGER NOT NULL REFERENCES articles(id),
    at          TEXT NOT NULL,
    user_id     INTEGER,
    type        TEXT NOT NULL CHECK (type IN ('count','receipt','correction')),
    qty_before  REAL,
    qty_after   REAL,
    delta       REAL,
    unit_price  REAL,
    supplier_id INTEGER,
    list_id     INTEGER,
    note        TEXT
  );
  CREATE INDEX idx_mov_article ON stock_movements(article_id, at);
  CREATE INDEX idx_mov_type ON stock_movements(type, at);

  CREATE TABLE printers (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    protocol        TEXT NOT NULL CHECK (protocol IN ('escpos_tcp','epos_http','windows_raw')),
    host            TEXT,
    port            INTEGER,
    windows_name    TEXT,
    paper_width     INTEGER NOT NULL DEFAULT 80,
    chars_per_line  INTEGER NOT NULL DEFAULT 48,
    codepage        TEXT NOT NULL DEFAULT 'cp858',
    auto_cut        INTEGER NOT NULL DEFAULT 1,
    is_default      INTEGER NOT NULL DEFAULT 0,
    active          INTEGER NOT NULL DEFAULT 1,
    last_status     TEXT,
    last_status_at  TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE print_jobs (
    id           INTEGER PRIMARY KEY,
    printer_id   INTEGER REFERENCES printers(id) ON DELETE SET NULL,
    printer_name TEXT,
    list_id      INTEGER REFERENCES purchase_lists(id) ON DELETE SET NULL,
    kind         TEXT NOT NULL,
    title        TEXT,
    status       TEXT NOT NULL CHECK (status IN ('ok','error')),
    error        TEXT,
    user_id      INTEGER,
    user_name    TEXT,
    at           TEXT NOT NULL,
    doc          TEXT NOT NULL
  );
  CREATE INDEX idx_print_jobs_list ON print_jobs(list_id);

  CREATE TABLE audit_log (
    id        INTEGER PRIMARY KEY,
    at        TEXT NOT NULL,
    user_id   INTEGER,
    user_name TEXT,
    action    TEXT NOT NULL,
    entity    TEXT,
    entity_id INTEGER,
    details   TEXT
  );
  CREATE INDEX idx_audit_at ON audit_log(at);
  `,
];
