"""Password lock for GestionMoney. Stdlib only.

One password unlocks the app; profiles are separate budgets, not separate
logins. What is stored is a PBKDF2 hash and a random salt - never the password
itself - and sessions are kept as hashes too, so a stolen database file gives
an attacker neither your password nor a usable session.
"""
import hashlib
import hmac
import os
import secrets
import time
import datetime

import db

ITERATIONS = 240_000
SESSION_DAYS = 30
MIN_LENGTH = 6

# Brute-force slowdown, per client address. Cleared when the server restarts,
# which is fine - the lockout only has to outlast an automated run of guesses.
_fails = {}
MAX_FAILS = 5
LOCK_SECONDS = 60


def _con():
    con = db.profiles_con()
    con.executescript("""
        CREATE TABLE IF NOT EXISTS app_auth (
            id         INTEGER PRIMARY KEY CHECK (id = 1),
            salt       BLOB NOT NULL,
            hash       BLOB NOT NULL,
            iterations INTEGER NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        );
    """)
    return con


def _derive(password, salt, iterations=ITERATIONS):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)


def is_enabled():
    con = _con()
    try:
        return con.execute("SELECT 1 FROM app_auth WHERE id=1").fetchone() is not None
    finally:
        con.close()


def set_password(password):
    """Set or replace the password. Callers must check the old one first."""
    password = (password or "").strip()
    if len(password) < MIN_LENGTH:
        raise ValueError("The password needs at least %d characters." % MIN_LENGTH)
    salt = os.urandom(16)
    con = _con()
    try:
        con.execute(
            "INSERT INTO app_auth(id,salt,hash,iterations,updated_at)"
            " VALUES(1,?,?,?,?)"
            " ON CONFLICT(id) DO UPDATE SET salt=excluded.salt, hash=excluded.hash,"
            " iterations=excluded.iterations, updated_at=excluded.updated_at",
            (salt, _derive(password, salt), ITERATIONS,
             datetime.datetime.now().isoformat(timespec="seconds")))
        con.execute("DELETE FROM sessions")      # changing it logs everyone out
        con.commit()
    finally:
        con.close()


def disable(password):
    """Remove the lock entirely, after checking the current password."""
    if not verify(password):
        return False
    con = _con()
    try:
        con.execute("DELETE FROM app_auth")
        con.execute("DELETE FROM sessions")
        con.commit()
        return True
    finally:
        con.close()


def verify(password):
    con = _con()
    try:
        row = con.execute("SELECT * FROM app_auth WHERE id=1").fetchone()
    finally:
        con.close()
    if not row:
        return False
    expected = bytes(row["hash"])
    got = _derive(password or "", bytes(row["salt"]), row["iterations"])
    return hmac.compare_digest(expected, got)


# ---------- brute-force limiting ----------

def locked_for(client):
    rec = _fails.get(client)
    if not rec:
        return 0
    count, until = rec
    left = int(until - time.time())
    return left if (count >= MAX_FAILS and left > 0) else 0


def note_failure(client):
    count, _ = _fails.get(client, (0, 0))
    count += 1
    # back off harder the longer someone keeps guessing
    wait = LOCK_SECONDS * (2 ** max(0, count - MAX_FAILS)) if count >= MAX_FAILS else 0
    _fails[client] = (count, time.time() + wait)
    return wait


def note_success(client):
    _fails.pop(client, None)


# ---------- sessions ----------

def _hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_session():
    token = secrets.token_urlsafe(32)
    now = datetime.datetime.now()
    con = _con()
    try:
        con.execute(
            "INSERT INTO sessions(token_hash,created_at,expires_at) VALUES(?,?,?)",
            (_hash_token(token), now.isoformat(timespec="seconds"),
             (now + datetime.timedelta(days=SESSION_DAYS)).isoformat(timespec="seconds")))
        con.execute("DELETE FROM sessions WHERE expires_at < ?",
                    (now.isoformat(timespec="seconds"),))
        con.commit()
    finally:
        con.close()
    return token


def valid_session(token):
    if not token:
        return False
    con = _con()
    try:
        row = con.execute(
            "SELECT expires_at FROM sessions WHERE token_hash=?",
            (_hash_token(token),)).fetchone()
    finally:
        con.close()
    if not row:
        return False
    return row["expires_at"] >= datetime.datetime.now().isoformat(timespec="seconds")


def end_session(token):
    if not token:
        return
    con = _con()
    try:
        con.execute("DELETE FROM sessions WHERE token_hash=?", (_hash_token(token),))
        con.commit()
    finally:
        con.close()


def end_all_sessions():
    con = _con()
    try:
        con.execute("DELETE FROM sessions")
        con.commit()
    finally:
        con.close()
