"""GestionMoney - local money dashboard. Stdlib-only HTTP server + JSON API."""
import json
import os
import re
import sys
import csv
import io
import socket
import sqlite3
import datetime
import threading
import webbrowser
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import db
import api
import auth
from http.cookies import SimpleCookie

COOKIE = "gm_session"


def friendly(e):
    """Turn SQLite's terse errors into something you can act on."""
    msg = str(e)
    if "database is locked" in msg:
        return ("The database is busy. Another copy of GestionMoney is probably "
                "still running - close every GestionMoney console window and "
                "start it again.")
    if "UNIQUE constraint failed: envelopes" in msg:
        return "This month already has an envelope with that name."
    return msg

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "web")
# Hosts like Railway, Render and Heroku pick the port and pass it as PORT.
# Ignoring it means the platform cannot reach the app at all.
PORT = int(os.environ.get("GM_PORT") or os.environ.get("PORT") or "8765")
# 127.0.0.1 keeps it on this machine. Hosting it needs 0.0.0.0, which is why the
# banner then warns that the app has no login of its own.
HOST = os.environ.get("GM_HOST", "127.0.0.1")

# When this process started. After a deploy this resets while your data does
# not - which is exactly how you tell a working volume from a lucky one.
STARTED = datetime.datetime.now()

# Tables exposed through the generic CRUD endpoints, with their writable columns.
TABLES = {
    "recurring": ["label", "category", "kind", "amount", "due_day", "active", "sort", "note"],
    "tx": ["date", "label", "amount", "kind", "envelope_id", "category", "account",
           "payee", "note", "oneoff", "sub_id", "debt_id"],
    "subs": ["label", "amount", "period", "next_date", "category", "account",
             "active", "started", "note", "recurring_id", "in_plan"],
    "debts": ["direction", "person", "amount", "reason", "date", "due_date", "status", "note"],
    "debt_payments": ["debt_id", "date", "amount", "note"],
    "envelopes": ["label", "category", "kind", "planned", "rollover", "sort"],
    "months": ["income", "extra_income", "note", "closed"],
    "balances": ["account", "ym", "amount"],
    "categories": ["name", "color", "sort", "archived"],
    "kinds": ["name", "label", "is_saving", "color", "sort", "archived"],
}

# Where a category / budget-type name is stored, so a rename can follow it.
CAT_REFS = [("tx", "category"), ("envelopes", "category"),
            ("recurring", "category"), ("subs", "category")]
KIND_REFS = [("envelopes", "kind"), ("recurring", "kind")]

NUMERIC = {"amount", "planned", "rollover", "income", "extra_income"}
INTEGER = {"active", "sort", "oneoff", "closed", "due_day",
           "envelope_id", "sub_id", "debt_id", "month_id",
           "archived", "is_saving"}


def csv_list(q, key):
    """Read a repeated or comma-separated query parameter into a list."""
    out = []
    for chunk in q.get(key, []):
        out += [c.strip() for c in chunk.split(",") if c.strip()]
    return out


def filter_params(q):
    get1 = lambda k, d=None: (q.get(k) or [d])[0]
    p = {k: get1(k) for k in ("start", "end", "q", "account", "kind",
                              "envelope_id", "oneoff")}
    if get1("ym"):
        p["start"], p["end"] = api.month_bounds(get1("ym"))
    p["cats"] = csv_list(q, "cats")
    p["kinds"] = csv_list(q, "kinds")
    p["logic"] = get1("logic", "and")
    return {k: v for k, v in p.items() if v not in (None, "")}


def clean(table, payload):
    """Keep only writable columns and coerce types."""
    out = {}
    for k in TABLES[table]:
        if k not in payload:
            continue
        v = payload[k]
        if v == "":
            v = None
        if v is not None and k in NUMERIC:
            v = round(float(v), 2)
        elif v is not None and k in INTEGER:
            v = int(v)
        out[k] = v
    return out


class Handler(BaseHTTPRequestHandler):
    server_version = "GestionMoney"

    def log_message(self, fmt, *args):
        pass  # keep the console quiet

    # ---------- plumbing ----------

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        return json.loads(self.rfile.read(n).decode("utf-8"))

    def _static(self, path):
        rel = path.lstrip("/") or "index.html"
        full = os.path.normpath(os.path.join(WEB, rel))
        if not full.startswith(WEB) or not os.path.isfile(full):
            return self._send(404, "not found", "text/plain")
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    # ---------- routing ----------

    # ---------- the lock ----------

    def _cookie(self):
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        try:
            return SimpleCookie(raw)[COOKIE].value
        except KeyError:
            return None

    def _client(self):
        fwd = self.headers.get("X-Forwarded-For")
        return fwd.split(",")[0].strip() if fwd else self.client_address[0]

    def _https(self):
        return (self.headers.get("X-Forwarded-Proto", "").lower() == "https")

    def _set_cookie(self, token, clear=False):
        bits = ["%s=%s" % (COOKIE, "" if clear else token), "Path=/", "HttpOnly",
                "SameSite=Lax"]
        bits.append("Max-Age=0" if clear else "Max-Age=%d" % (auth.SESSION_DAYS * 86400))
        if self._https():
            bits.append("Secure")
        self.send_header("Set-Cookie", "; ".join(bits))

    def _send_with_cookie(self, code, body, token=None, clear=False):
        data = json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self._set_cookie(token, clear)
        self.end_headers()
        self.wfile.write(data)

    def _authed(self):
        return (not auth.is_enabled()) or auth.valid_session(self._cookie())

    def _auth_route(self, verb, route):
        """Everything under /api/auth. The only part reachable while locked."""
        body = self._body() if verb != "GET" else {}
        client = self._client()

        if route == "auth" and verb == "GET":
            return self._send(200, {
                "enabled": auth.is_enabled(),
                "authed": self._authed(),
                "exposed": HOST not in ("127.0.0.1", "localhost"),
                "min_length": auth.MIN_LENGTH,
            })

        if route == "auth/setup" and verb == "POST":
            if auth.is_enabled():
                return self._send(400, {"error": "A password is already set."})
            auth.set_password(body.get("password"))
            return self._send_with_cookie(200, {"ok": True}, auth.new_session())

        if route == "auth/login" and verb == "POST":
            wait = auth.locked_for(client)
            if wait:
                return self._send(429, {
                    "error": "Too many wrong tries. Wait %d seconds." % wait})
            if not auth.verify(body.get("password")):
                w = auth.note_failure(client)
                return self._send(401, {
                    "error": "Wrong password." + (" Locked for %d seconds." % w if w else "")})
            auth.note_success(client)
            return self._send_with_cookie(200, {"ok": True}, auth.new_session())

        if route == "auth/logout" and verb == "POST":
            auth.end_session(self._cookie())
            return self._send_with_cookie(200, {"ok": True}, clear=True)

        # changing or removing the password needs the current one, even when
        # already unlocked - a borrowed session must not be able to lock you out
        if route == "auth/change" and verb == "POST":
            if auth.is_enabled() and not auth.verify(body.get("current")):
                return self._send(401, {"error": "That is not the current password."})
            auth.set_password(body.get("password"))
            return self._send_with_cookie(200, {"ok": True}, auth.new_session())

        if route == "auth/disable" and verb == "POST":
            if not auth.disable(body.get("current")):
                return self._send(401, {"error": "That is not the current password."})
            return self._send_with_cookie(200, {"ok": True}, clear=True)

        return self._send(404, {"error": "unknown route " + route})

    def _profile(self, q=None):
        """Which profile this request is for: header first, then ?profile=."""
        val = self.headers.get("X-Profile")
        if not val and q:
            val = (q.get("profile") or [None])[0]
        return db.resolve_profile(val)

    def do_GET(self):
        u = urlparse(self.path)
        if not u.path.startswith("/api/"):
            return self._static(u.path)
        q = parse_qs(u.query)
        route = u.path[5:]
        try:
            if route.split("/")[0] == "auth":
                return self._auth_route("GET", route)
            if not self._authed():
                return self._send(401, {"error": "locked"})
            if route == "profiles":
                return self._send(200, {"profiles": db.list_profiles(),
                                        "current": self._profile(q)})
            with db.session(self._profile(q)) as con:
                self._api_get(con, route, q)
        except ValueError as e:
            self._send(400, {"error": str(e)})
        except Exception as e:
            self._send(500, {"error": friendly(e)})

    def do_POST(self):
        self._write("POST")

    def do_PUT(self):
        self._write("PUT")

    def do_DELETE(self):
        self._write("DELETE")

    def _write(self, verb):
        u = urlparse(self.path)
        if not u.path.startswith("/api/"):
            return self._send(404, {"error": "not found"})
        q = parse_qs(u.query)
        route = u.path[5:]
        try:
            if route.split("/")[0] == "auth":
                return self._auth_route(verb, route)
            if not self._authed():
                return self._send(401, {"error": "locked"})
            if route.split("/")[0] == "profiles":
                return self._profiles_write(verb, route)
            with db.session(self._profile(q)) as con:
                self._api_write(con, verb, route, q)
        except ValueError as e:
            self._send(400, {"error": str(e)})
        except Exception as e:
            self._send(500, {"error": friendly(e)})

    def _profiles_write(self, verb, route):
        parts = route.split("/")
        body = self._body()
        if verb == "POST":
            pid = db.create_profile(body.get("name"), body.get("color"))
            return self._send(200, {"id": pid, "profiles": db.list_profiles()})
        pid = int(parts[1])
        if verb == "PUT":
            fields = {k: body[k] for k in ("name", "color", "sort", "archived")
                      if k in body}
            if not fields:
                return self._send(400, {"error": "nothing to update"})
            db.rename_profile(pid, fields)
            return self._send(200, {"ok": True, "profiles": db.list_profiles()})
        if verb == "DELETE":
            db.delete_profile(pid)
            return self._send(200, {"ok": True, "profiles": db.list_profiles()})
        return self._send(405, {"error": "method not allowed"})

    # ---------- GET endpoints ----------

    def _api_get(self, con, route, q):
        get1 = lambda k, d=None: (q.get(k) or [d])[0]

        if route == "dashboard":
            return self._send(200, api.dashboard(con, get1("ym", db.ym_now())))

        if route == "month":
            return self._send(200, api.month_view(con, get1("ym", db.ym_now())))

        if route == "months":
            return self._send(200, api.rows(con.execute(
                "SELECT * FROM months ORDER BY ym DESC")))

        if route == "recurring":
            return self._send(200, api.rows(con.execute(
                "SELECT r.*, s.id AS sub_id, s.period AS sub_period,"
                " s.next_date AS sub_next, s.active AS sub_active"
                " FROM recurring r LEFT JOIN subs s ON s.recurring_id = r.id"
                " ORDER BY r.active DESC, r.sort, r.id")))

        if route == "subs":
            out = api.rows(con.execute(
                "SELECT s.*, r.label AS plan_label, r.kind AS plan_kind,"
                " r.amount AS plan_amount, r.active AS plan_active"
                " FROM subs s LEFT JOIN recurring r ON r.id = s.recurring_id"
                " ORDER BY s.active DESC, s.next_date, s.label"))
            for s in out:
                s["per_month"] = api.monthly_cost(s["amount"], s["period"])
                s["per_year"] = round(s["per_month"] * 12, 2)
            return self._send(200, out)

        if route == "debts":
            return self._send(200, api.debt_summary(con))

        if route == "debt_payments":
            return self._send(200, api.rows(con.execute(
                "SELECT * FROM debt_payments WHERE debt_id=? ORDER BY date",
                (get1("debt_id"),))))

        if route == "balances":
            return self._send(200, api.rows(con.execute(
                "SELECT * FROM balances ORDER BY ym DESC, account")))

        if route == "settings":
            return self._send(200, {r["key"]: r["value"] for r in api.rows(
                con.execute("SELECT * FROM settings"))})

        if route == "categories":
            return self._send(200, api.rows(con.execute(
                "SELECT c.*,"
                " (SELECT COUNT(*) FROM tx t WHERE t.category=c.name) AS n_tx,"
                " (SELECT COALESCE(SUM(t.amount),0) FROM tx t"
                "   WHERE t.category=c.name AND t.kind='expense') AS spent"
                " FROM categories c ORDER BY c.archived, c.sort, c.name")))

        if route == "kinds":
            return self._send(200, api.rows(con.execute(
                "SELECT k.*,"
                " (SELECT COUNT(*) FROM envelopes e WHERE e.kind=k.name) AS n_env,"
                " (SELECT COUNT(*) FROM recurring r WHERE r.kind=k.name) AS n_rec"
                " FROM kinds k ORDER BY k.archived, k.sort, k.name")))

        if route == "report":
            p = filter_params(q)
            p.setdefault("start", "2000-01-01")
            p.setdefault("end", "2999-12-31")
            return self._send(200, api.report(con, p))

        if route == "tx":
            return self._send(200, self._query_tx(con, q))

        if route == "tx/export":
            data = self._query_tx(con, q)["items"]
            buf = io.StringIO()
            w = csv.writer(buf, lineterminator="\n")
            w.writerow(["date", "label", "amount", "kind", "category",
                        "account", "envelope", "payee", "oneoff", "note"])
            for t in data:
                w.writerow([t["date"], t["label"], t["amount"], t["kind"], t["category"],
                            t["account"], t.get("envelope") or "", t["payee"],
                            t["oneoff"], t["note"]])
            return self._send(200, "﻿" + buf.getvalue(), "text/csv; charset=utf-8")

        if route == "suggest":
            term = "%" + (get1("q", "")) + "%"
            return self._send(200, api.rows(con.execute(
                "SELECT label, category, envelope_id, account, MAX(date) d, COUNT(*) n"
                " FROM tx WHERE label LIKE ? GROUP BY LOWER(label)"
                " ORDER BY n DESC, d DESC LIMIT 8", (term,))))

        if route == "serverinfo":
            pid = self._profile(q)
            path = db.db_path(pid)
            size = os.path.getsize(path) if os.path.exists(path) else 0
            counts = {}
            for t in ("tx", "months", "recurring", "subs", "debts"):
                counts[t] = api.one(con.execute("SELECT COUNT(*) c FROM %s" % t))["c"]
            oldest = api.one(con.execute("SELECT MIN(created_at) c FROM tx"))["c"]
            up = (datetime.datetime.now() - STARTED).total_seconds()
            return self._send(200, {
                "started_at": STARTED.isoformat(timespec="seconds"),
                "uptime_seconds": int(up),
                "data_dir": db.DATA,
                "db_file": os.path.basename(path),
                "db_bytes": size,
                "counts": counts,
                "oldest_record": oldest,
                "profiles": len(db.list_profiles()),
                "persistent": bool(counts["tx"] or counts["recurring"]) and up < 3600,
            })

        if route == "backup":
            os.makedirs(os.path.join(HERE, "data", "backups"), exist_ok=True)
            stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
            prof = next((p for p in db.list_profiles()
                         if p["id"] == self._profile(q)), {"name": "profile"})
            safe = re.sub(r"[^A-Za-z0-9_-]+", "-", prof["name"]).strip("-") or "profile"
            dest = os.path.join(HERE, "data", "backups", "%s-%s.db" % (safe, stamp))
            # sqlite's own backup API copies a live database safely; a plain file
            # copy can catch it mid-write.
            out = sqlite3.connect(dest)
            with out:
                con.backup(out)
            out.close()
            return self._send(200, {"ok": True, "file": dest})

        self._send(404, {"error": "unknown route " + route})

    def _query_tx(self, con, q):
        get1 = lambda k, d=None: (q.get(k) or [d])[0]
        p = filter_params(q)
        # a single ?category= still works, it just folds into the list
        if get1("category"):
            p["cats"] = p.get("cats", []) + [get1("category")]
        where, args = api.tx_where(p)
        limit = int(get1("limit", "500"))
        offset = int(get1("offset", "0"))

        items = api.rows(con.execute(
            "SELECT t.*, e.label AS envelope, " + api.TKIND_SQL + " AS tkind" +
            api.TX_FROM + "WHERE " + where +
            " ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?",
            args + [limit, offset]))
        agg = api.one(con.execute(
            "SELECT COUNT(*) n,"
            " COALESCE(SUM(CASE WHEN t.kind='expense' THEN t.amount END),0) spent,"
            " COALESCE(SUM(CASE WHEN t.kind='income'  THEN t.amount END),0) earned" +
            api.TX_FROM + "WHERE " + where, args))
        return {"items": items, "total": agg["n"],
                "spent": round(agg["spent"], 2), "earned": round(agg["earned"], 2)}

    # ---------- write endpoints ----------

    def _api_write(self, con, verb, route, q):
        body = self._body()
        parts = route.split("/")
        table = parts[0]

        # --- special actions ---
        if route == "month/sync":
            return self._send(200, api.sync_month(con, body.get("ym", db.ym_now())))

        if route == "month/apply-template":
            # push this month's envelope amounts back into the recurring master list
            ym = body.get("ym", db.ym_now())
            m = api.ensure_month(con, ym)
            n = 0
            for e in api.rows(con.execute(
                    "SELECT * FROM envelopes WHERE month_id=? AND recurring_id IS NOT NULL",
                    (m["id"],))):
                con.execute("UPDATE recurring SET amount=?, category=?, kind=? WHERE id=?",
                            (e["planned"], e["category"], e["kind"], e["recurring_id"]))
                n += 1
            con.commit()
            return self._send(200, {"updated": n})

        # --- keep a subscription and its monthly-plan line in step ---
        if route.startswith("subs/") and parts[-1] in ("link", "unlink"):
            sid = int(parts[1])
            if parts[-1] == "link":
                r = api.link_sub_to_plan(con, sid, body.get("kind"))
            else:
                r = api.unlink_sub_from_plan(con, sid)
            return self._send(200, r or {"error": "not found"})

        if route.startswith("envelopes/") and parts[-1] == "make-regular":
            r = api.promote_envelope(con, int(parts[1]))
            return self._send(200, r or {"error": "not found"})

        if route.startswith("recurring/") and parts[-1] == "stop-repeating":
            r = api.demote_recurring(con, int(parts[1]),
                                     body.get("ym") or db.ym_now())
            return self._send(200, r)

        if route.startswith("recurring/") and parts[-1] == "make-sub":
            r = api.make_recurring_a_sub(con, int(parts[1]),
                                         body.get("next_date"),
                                         body.get("period", "monthly"))
            return self._send(200, r or {"error": "not found"})

        if route == "settings":
            for k, v in body.items():
                con.execute("INSERT INTO settings(key,value) VALUES(?,?)"
                            " ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                            (k, str(v)))
            con.commit()
            return self._send(200, {"ok": True})

        if route == "envelopes" and verb == "POST":
            # ad-hoc envelope for one month only
            ym = body.get("ym", db.ym_now())
            m = api.ensure_month(con, ym)
            d = clean("envelopes", body)
            d["month_id"] = m["id"]
            cols = ",".join(d)
            cur = con.execute("INSERT INTO envelopes(%s) VALUES(%s)"
                              % (cols, ",".join("?" * len(d))), list(d.values()))
            con.commit()
            return self._send(200, {"id": cur.lastrowid})

        if route == "balances" and verb == "POST":
            d = clean("balances", body)
            con.execute("INSERT INTO balances(account,ym,amount) VALUES(?,?,?)"
                        " ON CONFLICT(account,ym) DO UPDATE SET amount=excluded.amount",
                        (d["account"], d["ym"], d["amount"]))
            con.commit()
            return self._send(200, {"ok": True})

        # --- categories / budget types: renames cascade, deletes reassign ---
        if table in ("categories", "kinds") and verb in ("PUT", "DELETE"):
            refs = CAT_REFS if table == "categories" else KIND_REFS
            rid = int(parts[1])
            row = api.one(con.execute(
                "SELECT * FROM %s WHERE id=?" % table, (rid,)))
            if not row:
                return self._send(404, {"error": "not found"})

            if verb == "PUT":
                d = clean(table, body)
                new = (d.get("name") or "").strip()
                if "name" in d:
                    if not new:
                        return self._send(400, {"error": "The name cannot be empty."})
                    d["name"] = new
                    if new != row["name"]:
                        clash = api.one(con.execute(
                            "SELECT 1 FROM %s WHERE name=? AND id<>?" % table, (new, rid)))
                        if clash:
                            return self._send(400, {
                                "error": "There is already something called '%s'." % new})
                        # carry every existing record over to the new name
                        for t, col in refs:
                            con.execute("UPDATE %s SET %s=? WHERE %s=?" % (t, col, col),
                                        (new, row["name"]))
                sets = ",".join("%s=?" % k for k in d)
                con.execute("UPDATE %s SET %s WHERE id=?" % (table, sets),
                            list(d.values()) + [rid])
                con.commit()
                return self._send(200, {"ok": True, "renamed_to": d.get("name")})

            # DELETE - never orphan records; move them somewhere first
            used = sum(api.one(con.execute(
                "SELECT COUNT(*) c FROM %s WHERE %s=?" % (t, col),
                (row["name"],)))["c"] for t, col in refs)
            move_to = (body.get("reassign") or "").strip()
            if used and not move_to:
                return self._send(400, {
                    "error": "'%s' is still used by %d record(s). Choose what to "
                             "move them to first." % (row["name"], used),
                    "in_use": used})
            if used:
                dest = api.one(con.execute(
                    "SELECT name FROM %s WHERE name=?" % table, (move_to,)))
                if not dest:
                    return self._send(400, {"error": "'%s' does not exist." % move_to})
                for t, col in refs:
                    con.execute("UPDATE %s SET %s=? WHERE %s=?" % (t, col, col),
                                (move_to, row["name"]))
            con.execute("DELETE FROM %s WHERE id=?" % table, (rid,))
            con.commit()
            return self._send(200, {"ok": True, "moved": used})

        if table not in TABLES:
            return self._send(404, {"error": "unknown table " + table})

        # --- generic CRUD ---
        if verb == "POST":
            d = clean(table, body)
            if table == "tx":
                d.setdefault("date", datetime.date.today().isoformat())
                d.setdefault("kind", "expense")
                if d.get("envelope_id") and not d.get("category"):
                    e = api.one(con.execute("SELECT category FROM envelopes WHERE id=?",
                                            (d["envelope_id"],)))
                    if e:
                        d["category"] = e["category"]
            if table == "recurring":
                mx = api.one(con.execute("SELECT COALESCE(MAX(sort),0) s FROM recurring"))
                d.setdefault("sort", mx["s"] + 10)
            if table in ("categories", "kinds"):
                d["name"] = (d.get("name") or "").strip()
                if not d["name"]:
                    return self._send(400, {"error": "The name cannot be empty."})
                if api.one(con.execute(
                        "SELECT 1 FROM %s WHERE name=?" % table, (d["name"],))):
                    return self._send(400, {
                        "error": "'%s' already exists." % d["name"]})
                mx = api.one(con.execute(
                    "SELECT COALESCE(MAX(sort),0) s FROM %s" % table))
                d.setdefault("sort", mx["s"] + 10)
                if not d.get("color"):
                    n = api.one(con.execute(
                        "SELECT COUNT(*) c FROM %s" % table))["c"]
                    d["color"] = db.PALETTE[n % len(db.PALETTE)]
            cols = ",".join(d)
            cur = con.execute("INSERT INTO %s(%s) VALUES(%s)"
                              % (table, cols, ",".join("?" * len(d))), list(d.values()))
            con.commit()
            new_id = cur.lastrowid
            extra = {}
            # a new recurring item joins this month and every open month after it,
            # including ones already generated by looking ahead
            if table == "recurring" and d.get("active", 1):
                extra["added_to"] = api.sync_months_from(
                    con, body.get("ym") or db.ym_now())
                if body.get("is_sub"):
                    extra["sub"] = api.make_recurring_a_sub(
                        con, new_id, body.get("next_date"),
                        body.get("period", "monthly"))
            # a new subscription earns its place in the monthly plan
            if table == "subs" and body.get("in_plan", 1) and d.get("active", 1):
                extra["plan"] = api.link_sub_to_plan(
                    con, new_id, body.get("plan_kind"))
            return self._send(200, dict({"id": new_id}, **extra))

        if verb == "PUT":
            rid = int(parts[1])
            d = clean(table, body)
            if not d:
                return self._send(400, {"error": "nothing to update"})

            # Salary is not a per-month fact you retype twelve times: setting it
            # carries to every upcoming month as well.
            if table == "months" and "income" in d:
                row = api.one(con.execute("SELECT ym FROM months WHERE id=?", (rid,)))
                if row:
                    res = api.set_income(con, row["ym"], d["income"],
                                         force=bool(body.get("force_all")))
                    rest = {k: v for k, v in d.items() if k != "income"}
                    if rest:
                        con.execute(
                            "UPDATE months SET %s WHERE id=?"
                            % ",".join("%s=?" % k for k in rest),
                            list(rest.values()) + [rid])
                        con.commit()
                    return self._send(200, dict({"ok": True}, **res))
            sets = ",".join("%s=?" % k for k in d)
            con.execute("UPDATE %s SET %s WHERE id=?" % (table, sets),
                        list(d.values()) + [rid])
            con.commit()
            # Renaming an envelope can also rename the master item it came from,
            # otherwise next month would go back to the old name.
            if table == "envelopes" and body.get("rename_template"):
                env = api.one(con.execute(
                    "SELECT recurring_id FROM envelopes WHERE id=?", (rid,)))
                if env and env["recurring_id"]:
                    fields = {k: d[k] for k in ("label", "category", "kind") if k in d}
                    if "planned" in d:
                        fields["amount"] = d["planned"]
                    if fields:
                        sets2 = ",".join("%s=?" % k for k in fields)
                        con.execute("UPDATE recurring SET %s WHERE id=?" % sets2,
                                    list(fields.values()) + [env["recurring_id"]])
                        con.commit()
            # switching a fixed line back on puts it into the open months again
            if table == "recurring" and d.get("active"):
                api.sync_months_from(con, body.get("ym") or db.ym_now())

            # a subscription's amount, name or category flows to its plan line
            if table == "subs":
                s = api.one(con.execute("SELECT * FROM subs WHERE id=?", (rid,)))
                if s and s["in_plan"] and s["active"] and \
                        ({"label", "amount", "period", "category"} & set(d)):
                    api.link_sub_to_plan(con, rid)
                if s and "active" in d and not s["active"] and s["recurring_id"]:
                    con.execute("UPDATE recurring SET active=0 WHERE id=?",
                                (s["recurring_id"],))
                    con.commit()
                elif s and "active" in d and s["active"] and s["in_plan"]:
                    api.link_sub_to_plan(con, rid)

            # ... and the other way round, for a plan line that is a subscription
            if table == "recurring" and ({"label", "amount", "category"} & set(d)):
                sub = api.sub_for_recurring(con, rid)
                if sub and sub["period"] == "monthly":
                    upd = {k: d[k] for k in ("label", "category") if k in d}
                    if "amount" in d:
                        upd["amount"] = d["amount"]
                    if upd:
                        con.execute(
                            "UPDATE subs SET %s WHERE id=?"
                            % ",".join("%s=?" % k for k in upd),
                            list(upd.values()) + [sub["id"]])
                        con.commit()

            # A master-list change always reaches later months (that is what the
            # master list is for); `propagate` decides whether it also rewrites
            # the month you are looking at.
            if table == "recurring" and ({"label", "amount", "category", "kind"} & set(d)):
                ym = body.get("ym") or db.ym_now()
                res = api.propagate_recurring(con, rid, ym,
                                              bool(body.get("propagate")))
                return self._send(200, dict({"ok": True}, **res))
            return self._send(200, {"ok": True})

        if verb == "DELETE":
            rid = int(parts[1])
            con.execute("DELETE FROM %s WHERE id=?" % table, (rid,))
            con.commit()
            return self._send(200, {"ok": True})

        self._send(405, {"error": "method not allowed"})


def already_running():
    """True if something is already listening on our port."""
    s = socket.socket()
    s.settimeout(0.6)
    try:
        s.connect(("127.0.0.1", PORT))
        return True
    except OSError:
        return False
    finally:
        s.close()


def main():
    # Two servers on one database is exactly what causes 'database is locked',
    # so refuse to start a second one rather than fight over the file.
    if already_running():
        print("=" * 60)
        print("  GestionMoney is ALREADY running on port %d." % PORT)
        print("  Open  http://127.0.0.1:%d/  in your browser." % PORT)
        print()
        print("  If it is not responding, close every GestionMoney console")
        print("  window (or run  Stop GestionMoney.bat ) and start it again.")
        print("=" * 60)
        if "--no-browser" not in sys.argv:
            webbrowser.open("http://127.0.0.1:%d/" % PORT)
        return

    db.init_all()
    profs = db.list_profiles()
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    url = "http://127.0.0.1:%d/" % PORT
    print("=" * 58)
    print("  GestionMoney is running")
    print("  " + url)
    print("  Profiles: " + ", ".join(p["name"] for p in profs))
    print("  Data:     %s" % db.DATA)
    locked = auth.is_enabled()
    print("  Lock:     %s" % ("password set" if locked else "OFF - no password"))
    if HOST != "127.0.0.1":
        print()
        print("  Listening on %s - reachable from other machines." % HOST)
        if not locked:
            print("  *** WARNING: no password is set. Anyone who can reach this")
            print("  *** address can see and change your money. Open the app and")
            print("  *** set one, or keep it behind Tailscale / Cloudflare Access.")
    print("  Press Ctrl+C to stop")
    print("=" * 58)
    if "--no-browser" not in sys.argv:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
