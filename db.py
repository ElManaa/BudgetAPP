"""SQLite schema and connections for GestionMoney.

Each profile gets its own database file. Two people sharing the app never share
a query, a table or a row - the separation is structural, not a WHERE clause
someone could forget.
"""
import sqlite3
import os
import re
import datetime
import contextlib

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
PROFILES_DB = os.path.join(DATA, "profiles.db")

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Master list of things that repeat every month (bills + budget envelopes + savings)
CREATE TABLE IF NOT EXISTS recurring (
    id          INTEGER PRIMARY KEY,
    label       TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'Other',
    kind        TEXT NOT NULL DEFAULT 'bill',   -- bill | budget | saving
    amount      REAL NOT NULL DEFAULT 0,
    due_day     INTEGER,                        -- day of month it is normally due
    active      INTEGER NOT NULL DEFAULT 1,
    sort        INTEGER NOT NULL DEFAULT 0,
    note        TEXT DEFAULT ''
);

-- One row per calendar month
CREATE TABLE IF NOT EXISTS months (
    id          INTEGER PRIMARY KEY,
    ym          TEXT NOT NULL UNIQUE,           -- 'YYYY-MM'
    income      REAL NOT NULL DEFAULT 0,
    extra_income REAL NOT NULL DEFAULT 0,
    note        TEXT DEFAULT '',
    closed      INTEGER NOT NULL DEFAULT 0
);

-- Envelopes: a recurring item materialised into one month
CREATE TABLE IF NOT EXISTS envelopes (
    id            INTEGER PRIMARY KEY,
    month_id      INTEGER NOT NULL REFERENCES months(id) ON DELETE CASCADE,
    recurring_id  INTEGER REFERENCES recurring(id) ON DELETE SET NULL,
    label         TEXT NOT NULL,
    category      TEXT NOT NULL DEFAULT 'Other',
    kind          TEXT NOT NULL DEFAULT 'bill',
    planned       REAL NOT NULL DEFAULT 0,
    rollover      REAL NOT NULL DEFAULT 0,
    sort          INTEGER NOT NULL DEFAULT 0,
    UNIQUE(month_id, label)
);

-- Every actual movement of money. This is the source of truth.
CREATE TABLE IF NOT EXISTS tx (
    id          INTEGER PRIMARY KEY,
    date        TEXT NOT NULL,                  -- 'YYYY-MM-DD'
    label       TEXT NOT NULL,
    amount      REAL NOT NULL,                  -- positive; direction given by `kind`
    kind        TEXT NOT NULL DEFAULT 'expense',-- expense | income | transfer
    envelope_id INTEGER REFERENCES envelopes(id) ON DELETE SET NULL,
    category    TEXT NOT NULL DEFAULT 'Other',
    account     TEXT NOT NULL DEFAULT 'Compte',
    payee       TEXT DEFAULT '',
    note        TEXT DEFAULT '',
    oneoff      INTEGER NOT NULL DEFAULT 0,     -- 1 = exceptional, outside any envelope
    sub_id      INTEGER REFERENCES subs(id) ON DELETE SET NULL,
    debt_id     INTEGER REFERENCES debts(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON tx(date);
CREATE INDEX IF NOT EXISTS idx_tx_env  ON tx(envelope_id);

-- Subscriptions, linked to the monthly-plan line that pays for them
CREATE TABLE IF NOT EXISTS subs (
    id           INTEGER PRIMARY KEY,
    label        TEXT NOT NULL,
    amount       REAL NOT NULL DEFAULT 0,
    period       TEXT NOT NULL DEFAULT 'monthly',
    next_date    TEXT,
    category     TEXT NOT NULL DEFAULT 'Subscription',
    account      TEXT NOT NULL DEFAULT 'Compte',
    active       INTEGER NOT NULL DEFAULT 1,
    started      TEXT,
    note         TEXT DEFAULT '',
    recurring_id INTEGER REFERENCES recurring(id),
    in_plan      INTEGER NOT NULL DEFAULT 1
);

-- Debts, both directions
CREATE TABLE IF NOT EXISTS debts (
    id          INTEGER PRIMARY KEY,
    direction   TEXT NOT NULL,                  -- they_owe | i_owe
    person      TEXT NOT NULL,
    amount      REAL NOT NULL,
    reason      TEXT DEFAULT '',
    date        TEXT NOT NULL,
    due_date    TEXT,
    status      TEXT NOT NULL DEFAULT 'open',
    note        TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS debt_payments (
    id       INTEGER PRIMARY KEY,
    debt_id  INTEGER NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
    date     TEXT NOT NULL,
    amount   REAL NOT NULL,
    note     TEXT DEFAULT ''
);

-- Account balance snapshots (Livret A, Compte, Revolut, Cash...)
CREATE TABLE IF NOT EXISTS balances (
    id       INTEGER PRIMARY KEY,
    account  TEXT NOT NULL,
    ym       TEXT NOT NULL,
    amount   REAL NOT NULL DEFAULT 0,
    UNIQUE(account, ym)
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS categories (
    id       INTEGER PRIMARY KEY,
    name     TEXT NOT NULL UNIQUE,
    color    TEXT NOT NULL DEFAULT '',
    sort     INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kinds (
    id        INTEGER PRIMARY KEY,
    name      TEXT NOT NULL UNIQUE,
    label     TEXT NOT NULL DEFAULT '',
    is_saving INTEGER NOT NULL DEFAULT 0,
    is_fixed  INTEGER NOT NULL DEFAULT 0,
    color     TEXT NOT NULL DEFAULT '',
    sort      INTEGER NOT NULL DEFAULT 0,
    archived  INTEGER NOT NULL DEFAULT 0
);
"""

PROFILES_SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS profiles (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    color      TEXT NOT NULL DEFAULT '#4f9cf9',
    sort       INTEGER NOT NULL DEFAULT 0,
    archived   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

DEFAULTS = {
    "currency": "€",
    "default_income": "0",
    "accounts": "Compte,Livret A,Revolut,Cash",
    "categories": "Housing,Utilities,Transport,Food,Groceries,Health,Personal,"
                  "Gifts,Subscription,Savings,Debt,Family,Other",
}

# name, label, is_saving, is_fixed, color
SEED_KINDS = [
    ("bill", "Bill - fixed amount you must pay", 0, 1, "#4f9cf9"),
    ("budget", "Budget - an allowance you set", 0, 0, "#3ecf8e"),
    ("saving", "Saving - money put aside", 1, 0, "#a78bfa"),
]

PALETTE = ["#4f9cf9", "#3ecf8e", "#f5a524", "#f2545b", "#a78bfa", "#38bdf8",
           "#fb7185", "#84cc16", "#e879f9", "#fbbf24", "#2dd4bf", "#94a3b8"]


# ---------- low level ----------

def _open(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    con = sqlite3.connect(path, timeout=15.0)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA busy_timeout=15000")
    con.execute("PRAGMA foreign_keys=ON")
    con.execute("PRAGMA synchronous=NORMAL")
    return con


def db_path(profile_id):
    return os.path.join(DATA, "profile-%d.db" % int(profile_id))


def add_column(con, table, col, decl):
    have = {r["name"] for r in con.execute("PRAGMA table_info(%s)" % table)}
    if col not in have:
        con.execute("ALTER TABLE %s ADD COLUMN %s %s" % (table, col, decl))
        return True
    return False


# ---------- profiles ----------

def profiles_con():
    con = _open(PROFILES_DB)
    con.executescript(PROFILES_SCHEMA)
    return con


def list_profiles():
    con = profiles_con()
    try:
        rows = [dict(r) for r in con.execute(
            "SELECT * FROM profiles ORDER BY archived, sort, id")]
        if not rows:
            con.execute("INSERT INTO profiles(name,color,sort) VALUES(?,?,0)",
                        ("Me", PALETTE[0]))
            con.commit()
            rows = [dict(r) for r in con.execute("SELECT * FROM profiles ORDER BY id")]
        return rows
    finally:
        con.close()


def create_profile(name, color=None):
    name = (name or "").strip()
    if not name:
        raise ValueError("The profile needs a name.")
    con = profiles_con()
    try:
        if con.execute("SELECT 1 FROM profiles WHERE name=?", (name,)).fetchone():
            raise ValueError("There is already a profile called '%s'." % name)
        n = con.execute("SELECT COUNT(*) c FROM profiles").fetchone()["c"]
        pid = con.execute(
            "INSERT INTO profiles(name,color,sort) VALUES(?,?,?)",
            (name, color or PALETTE[n % len(PALETTE)], n * 10)).lastrowid
        con.commit()
    finally:
        con.close()
    init(pid)                      # give it an empty, ready-to-use database
    return pid


def rename_profile(pid, fields):
    con = profiles_con()
    try:
        if "name" in fields:
            nm = (fields["name"] or "").strip()
            if not nm:
                raise ValueError("The profile needs a name.")
            clash = con.execute("SELECT 1 FROM profiles WHERE name=? AND id<>?",
                                (nm, pid)).fetchone()
            if clash:
                raise ValueError("There is already a profile called '%s'." % nm)
            fields["name"] = nm
        sets = ",".join("%s=?" % k for k in fields)
        con.execute("UPDATE profiles SET %s WHERE id=?" % sets,
                    list(fields.values()) + [pid])
        con.commit()
    finally:
        con.close()


def delete_profile(pid):
    """Remove a profile and its database. The last one cannot be deleted."""
    con = profiles_con()
    try:
        n = con.execute("SELECT COUNT(*) c FROM profiles").fetchone()["c"]
        if n <= 1:
            raise ValueError("This is the only profile - there must always be one.")
        con.execute("DELETE FROM profiles WHERE id=?", (pid,))
        con.commit()
    finally:
        con.close()
    for suffix in ("", "-wal", "-shm"):
        p = db_path(pid) + suffix
        if os.path.exists(p):
            try:
                os.remove(p)
            except OSError:
                pass


def resolve_profile(value):
    """Turn whatever the browser sent into a real profile id."""
    profs = list_profiles()
    ids = {str(p["id"]) for p in profs}
    if value is not None and str(value) in ids:
        return int(value)
    return int(profs[0]["id"])


# ---------- per-profile database ----------

def connect(profile_id):
    return _open(db_path(profile_id))


@contextlib.contextmanager
def session(profile_id):
    """Per-request connection that always commits or rolls back, then closes.

    A leaked connection sitting on an uncommitted write is what locks the file
    for everyone else, so closing is not optional.
    """
    con = connect(profile_id)
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def init(profile_id):
    con = connect(profile_id)
    con.executescript(SCHEMA)
    add_column(con, "subs", "recurring_id", "INTEGER REFERENCES recurring(id)")
    add_column(con, "subs", "in_plan", "INTEGER NOT NULL DEFAULT 1")

    for k, v in DEFAULTS.items():
        con.execute("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)", (k, v))

    if not con.execute("SELECT 1 FROM kinds LIMIT 1").fetchone():
        for i, (name, label, sav, fixed, col) in enumerate(SEED_KINDS):
            con.execute(
                "INSERT OR IGNORE INTO kinds(name,label,is_saving,is_fixed,color,sort)"
                " VALUES(?,?,?,?,?,?)", (name, label, sav, fixed, col, i * 10))

    # A profile created before "is_fixed" existed has no way to know which of
    # its kinds meant "bill" - even if you renamed it. Best guess: the
    # non-saving kind that was seeded first (sort order is preserved across a
    # rename). You can always correct it in Categories & types afterwards.
    if add_column(con, "kinds", "is_fixed", "INTEGER NOT NULL DEFAULT 0"):
        row = con.execute(
            "SELECT id FROM kinds WHERE is_saving=0 AND archived=0"
            " ORDER BY sort, id LIMIT 1").fetchone()
        if row:
            con.execute("UPDATE kinds SET is_fixed=1 WHERE id=?", (row["id"],))

    if not con.execute("SELECT 1 FROM categories LIMIT 1").fetchone():
        row = con.execute("SELECT value FROM settings WHERE key='categories'").fetchone()
        names = [c.strip() for c in (row["value"] if row else "").split(",") if c.strip()]
        for name, in con.execute(
                "SELECT DISTINCT category FROM tx"
                " UNION SELECT DISTINCT category FROM envelopes").fetchall():
            if name and name not in names:
                names.append(name)
        for i, name in enumerate(names):
            con.execute("INSERT OR IGNORE INTO categories(name,color,sort)"
                        " VALUES(?,?,?)", (name, PALETTE[i % len(PALETTE)], i * 10))

    con.commit()
    return con


def init_all():
    for p in list_profiles():
        init(p["id"]).close()


def ym_now():
    return datetime.date.today().strftime("%Y-%m")
