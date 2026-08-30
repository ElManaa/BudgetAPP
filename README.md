# GestionMoney

A small money dashboard that runs on your own PC. It replaces
`Gestion Salaire .xlsx` — same way of thinking, but you never type a total again.

## Profiles — two people, two budgets

You and your wife each get a **profile**, and they are completely separate.
Not filtered, not tagged — **each profile is its own database file**
(`data/profile-1.db`, `data/profile-2.db`). Nothing is shared or added together,
so there is no way one budget can leak into the other.

Every feature exists per profile: months, envelopes, transactions,
subscriptions, debts, categories, budget types, accounts, balances and settings.

Switch with the picker at the top left. Your choice is remembered on that device,
so you each stay in your own profile.

- **+ New profile** — creates an empty budget, ready to use.
- **Manage profiles…** — rename, recolour, delete. The last profile cannot be
  deleted; there is always at least one.
- Deleting a profile deletes its file and everything in it. Back it up from
  Settings first if you might want it back.

Importing the spreadsheet into a particular profile:

```bash
python tools/import_xlsx.py --list-profiles
```

then pass the id you want, e.g. `python tools/import_xlsx.py "book.xlsx" --profile 1`

## Start it

Double-click **`Start GestionMoney.bat`**.

Your browser opens at <http://127.0.0.1:8765>. To stop it, close the black
console window — or run **`Stop GestionMoney.bat`**, which closes every server
including any that got orphaned. Nothing is sent anywhere: no account, no
internet, no cloud.

Only one server can run at a time. Launching a second one tells you it is
already running and just opens the browser.

## The one idea that makes this better than the sheet

In the spreadsheet, `Payer` was a number you typed by hand. When *Repas Dehors*
said `215.50` there was no record of what, where or when — which is exactly why
the money became impossible to trace.

Here it is the other way round:

```
you log each spend  ->  the envelope total adds itself up
```

Every figure on the dashboard is derived from itemised transactions. Click any
envelope and you see the individual spends behind it.

## The five things you asked for

| You wanted | Where it lives |
|---|---|
| Fixed monthly bills | **Fixed & budgets** → type `bill` |
| Regular allocations (medics, free money, épargne) | **Fixed & budgets** → type `budget` / `saving` |
| Exceptional spends, this month only | **Month plan** → *Exceptional spends* |
| Subscriptions | **Subscriptions** — shows true yearly cost |
| Who owes me / what I owe | **Debts** — one row per loan, partial repayments supported |

## Daily use

Press **A** anywhere, or click *+ Add expense*. Type what you bought, the amount,
pick the envelope, Enter. That is the whole routine.

The label field autocompletes from your history and pre-fills the category, so
the second time you type "Carrefour" everything else fills itself.

### Keyboard

| Key | Action |
|---|---|
| `A` | quick add expense |
| `1`…`9` | jump to a tab |
| `←` `→` | previous / next month |

## Month plan vs Fixed & budgets

They are the same list seen from two sides, and you only ever need one of them.

- **Month plan** is where you work. It shows one month, and it is where you add
  things.
- **Fixed & budgets** is the master list that every new month is built from.
  Adding something in Month plan and choosing *every month* puts it there for
  you — you rarely need to open it.

When you add a line in Month plan you say whether it **repeats**:

| Choice | What happens |
|---|---|
| **every month** | joins the master list, so this month *and every future one* has it |
| **only \<this month\>** | stays in this month alone; next month will not have it |

Each row shows which it is, in the **Repeats** column. A one-month line has a
**make regular** button if you change your mind — it joins the master list and
back-fills any later months that already exist. Nothing has to be retyped.

Note the difference between a **line in the plan** and a **spend**:

- an envelope is *money you set aside* — planned, with spending tracked against it
- an exceptional spend is *money already gone* — a purchase, a gift, a repair

Both live on the Month plan screen, in that order.

## How a month works

1. A new month is created automatically from the master list, the first time you
   look at it. You never rebuild the layout by hand.
1. **Salary is not retyped every month.** Setting it in Month plan applies to
   that month and every upcoming one, and becomes the figure new months start
   from. A month you deliberately gave its own salary keeps it — you are asked
   before those are overwritten. Past months never change.
   *Extra income* is the opposite: a bonus or refund, that month only.
2. Adjust anything for that month only in **Month plan** — the master list is
   untouched.
3. If a change is permanent, hit *Save amounts as template* and future months
   pick it up.
4. Imported months are marked **closed**, so history can never shift under you.

### What happens to months you have already looked at

Because months are created lazily, you can be several months ahead by the time
you add something. Those months are **not** left behind:

| You do this | Months affected |
|---|---|
| add a fixed line or a subscription | this month and **every open month after it**, including ones already generated |
| add one starting in a future month | that month onward — never an earlier one |
| change an amount in **Fixed & budgets** | **every open month after this one**, always; this month too if you say yes |
| press **make regular** on a one-month line | its month, plus every open month after |

Two rules hold everywhere:

- **Closed months are never touched.** Your imported history cannot move.
- **A month where the line is already paid keeps what you paid.** A price rise
  updates the months you have not spent in yet, and leaves settled ones alone.

### Renaming an envelope

In **Month plan** the name, category and type are all editable in place — click
and type. Never delete and re-add an envelope to rename it: transactions are
linked to the envelope itself, so a rename keeps every spend attached, whereas
deleting orphans them.

When the envelope comes from the master list you are asked whether the change
should apply to future months too:

- **OK** — renames it in **Fixed & budgets** as well, so every future month uses
  the new name.
- **Cancel** — changes this month only; next month goes back to the old name.

Two envelopes in the same month cannot share a name; you get a plain message
saying so rather than an error.

## If you ever see "database is locked"

It means two copies of the server were running at once. The app now refuses to
start a second one, so this should not happen again — but if it does:

1. Run **`Stop GestionMoney.bat`** (closes every server, even orphaned ones).
2. Start the app again.

Your data is safe either way: an interrupted edit is rolled back whole, never
half-written.

## The tabs

- **Dashboard** — income, spent, left to spend, envelope progress, 12-month
  trend, category split, biggest spends, alerts when a budget goes over.
- **Month plan** — salary, the month's envelopes, and this month's exceptional
  spends.
- **Transactions** — every movement. Filter by month / year / all time,
  category, account, or free-text search. Export to CSV.
- **Subscriptions** — what you pay per month *and per year*, each linked to its
  line in the monthly plan.
- **Debts** — per person and per item, with partial settlement.
- **Fixed & budgets** — the master list every month is built from.
- **Reports** — by category, by budget type, month by month, the category ×
  type cross-tab, and top 25 payees over any range.
- **Categories & types** — add, rename, recolour and retire both lists.
- **Settings** — currency, accounts, account balances, the password lock, a
  server & storage panel (proves your hosted volume is persisting), backups.

## Subscriptions are part of the plan

A subscription and the plan line that pays for it are **one thing shown in two
places**, not two things you keep in step by hand.

**Adding a subscription** — you give it a *starts from* date and leave
*add it to the monthly plan* ticked. It becomes a **bill** line in your plan from
that month onward, exactly like Loyer or Engie: it has an envelope, you pay it,
you track it.

- It never appears in a month **before** it starts.
- Closed months are left alone.

**The other way round** — tick *this is a subscription* when adding a line in
Month plan or Fixed & budgets, or press **make one** on any existing line. It
starts appearing under Subscriptions with its renewal date and yearly cost,
without changing your plan at all.

**They stay in step.** Change the price on either side and the other follows.
Pause a subscription and its plan line switches off. A price rise also updates
the current month if you have not paid it yet; if the charge is already logged,
that month keeps what you actually paid.

**Not billed monthly?** A yearly or weekly subscription is carried in the plan at
its **monthly equivalent** (€69.90/year → €5.83/month), so the plan total is
still what a typical month costs you. The Subscriptions table marks these
*spread*.

The tab separates **per month** from **in the monthly plan**, so you can see at a
glance how much of your subscription spending you have actually budgeted for.
Nothing is double-counted: *Log payment* books the charge into the linked
envelope rather than as a separate one-off.

## Categories and budget types

Both lists are yours to edit, on the **Categories & types** tab.

- **Add** — name it, pick a colour, done. It appears everywhere immediately.
- **Rename** — every existing record comes with it. Renaming *Medics* to
  *Health & Medics* moves all its transactions, envelopes, recurring items and
  subscriptions across; nothing is orphaned.
- **Hide** — takes it out of the dropdowns but keeps the history intact. Use
  this for something you no longer use but still want in old reports.
- **Delete** — if it is still used, you are asked which one to move those
  records to first. A delete can never strand data.

A budget type also carries **counts as**:

| Counts as | Effect |
|---|---|
| spending | normal — money going out |
| money put aside | added to the dashboard's **Saved** figure instead |

So a new *investment* type marked *money put aside* is treated exactly like
Livret A, with no code change.

Two types are automatic and cannot be edited: **one-off** (an exceptional spend
outside any envelope) and **unassigned** (not linked to an envelope yet). They
still appear in filters and reports.

## Slicing your spending — X AND/OR Y

**Transactions** and **Reports** share the same filter bar:

```
Categories   [Housing] [Food] [Personal] …      pick any number
Budget type  [bill] [budget] [saving] [one-off] [unassigned]
Match        ( both — category AND type )  ( either — category OR type )
```

- Several chips **in the same row** mean *any of these* — `Food` + `Groceries`
  finds either.
- The two rows are then combined with **Match**:
  - **both** → `(Food or Groceries) AND (budget)` — food money you had budgeted
  - **either** → `(Food) OR (one-off)` — everything food, plus everything
    exceptional

The exact query you built is spelled out above the results, e.g.
*matching (Food or Personal) OR (oneoff)*, so you always know what you are
looking at. Export CSV respects the filter.

### The cross-tab

**Reports → Category × budget type** shows every combination at once, shaded by
size, with row and column totals. Click any amount to jump to the transactions
behind it.

This is the fastest way to find where money escapes. On your imported history it
shows **Other + one-off = €21,911 across 164 transactions** — a fifth of
everything you have spent, in the one cell that means "unplanned and
uncategorised". Clicking it lists them so you can recategorise in place.

## Your data

One SQLite file per profile, all under **`data/`**:

```
data/profiles.db      the list of profiles
data/profile-1.db     everything belonging to profile 1
data/profile-2.db     everything belonging to profile 2
data/backups/         copies you have made
```

Copy `data/` anywhere to back it up or move to another PC. *Settings → Make a
backup copy now* drops a timestamped copy of **the profile you are in**.

`data/` is in `.gitignore`, so **no financial data is ever committed**.

## Password lock

The app can ask for a password before it shows anything.

**Set it in Settings → Password lock**, before you host it anywhere. On your own
PC you can leave it off; the app then just opens.

- One password unlocks the app. Profiles are separate *budgets*, not separate
  logins — either of you can switch between them once inside.
- You stay signed in on that device for 30 days. **Lock now** ends it
  immediately; changing the password signs out every device.
- Five wrong tries locks that address out for a minute, doubling each further
  try, so the password cannot be guessed by a script.
- What is stored is a PBKDF2-SHA256 hash (240,000 iterations) with a random
  salt — never the password. Session tokens are stored hashed too, so a copy of
  the database yields neither.

### If you forget it

On the machine holding the data:

```bash
python tools/reset_password.py
```

That removes the lock and signs every device out. **Your budgets are untouched**
— they live in separate files the tool never opens. Add `--set NEWPASSWORD` to
put a new one in place at the same time.

### It is a lock, not a fortress

A password stops someone who finds the URL. It does not make the app safe to
leave open on the public internet: there is no HTTPS of its own, no 2FA, and no
per-profile separation of logins. **Keep it behind Tailscale or Cloudflare
Access as well** — the password is the second lock, not the only one.

## Hosting it — read this first

**Set a password first** (Settings → Password lock), *then* pick one of the
options below. The password stops a stranger who finds the address; the network
layer below stops them reaching it at all. Use both.

### Option 1 — keep it on your PC, reach it from anywhere (free, recommended)

Nothing is uploaded; your data stays on your machine.

1. Install [Tailscale](https://tailscale.com/) on the PC and on both phones —
   free for personal use, no card.
2. Sign in with the same account on all three, and invite your wife's device.
3. On the PC, start the app so it accepts connections from your other devices:

```bash
set GM_HOST=0.0.0.0 && python server.py
```

4. On a phone, open `http://<the PC's tailscale name>:8765`.

Only devices on your private Tailscale network can reach it, and the password
guards it even there. Downside: the PC has to be switched on.

### Option 2 — a free always-on server

If you want it up when the PC is off:

| Host | Cost | Notes |
|---|---|---|
| **Oracle Cloud — Always Free** | free forever | a real VM that stays on; needs a card for identity check only |
| **Google Cloud e2-micro free tier** | free | smaller, same idea |
| Fly.io / Railway / Hetzner | ~$3–5/month | simplest, but not free |

A `Dockerfile` is included — Python only, no packages to install:

```bash
docker build -t gestionmoney .
```

```bash
docker run -d --name gestionmoney -p 8765:8765 -v gm-data:/app/data --restart unless-stopped gestionmoney
```

The `-v gm-data:/app/data` is **not optional**. Without it, the first redeploy
wipes every budget *and* your password — the container starts blank. Verified,
not assumed.

The image runs as a non-root user, has a healthcheck, and refuses to build if
any module is missing rather than shipping something that cannot start. Open
`http://<host>:8765`, set a password immediately, and check `docker logs
gestionmoney` — it warns in plain text while no password is set.

Then put a login in front of it with **Cloudflare Tunnel + Cloudflare Access**
(free): you get an HTTPS address, and only the email addresses you list can open
it. That is the cheapest way to have a real URL you can both use safely.

### Deploying to Railway

Railway builds the included `Dockerfile` and reads `railway.json` for its health
check. Two things matter:

**1. Add a Volume, then actually apply it.** In the service, *Settings → Volumes
→ Add Volume* with the mount path exactly:

```
/app/data
```

Railway **stages** config changes. Adding the volume leaves an *"Apply N
changes"* bar at the top with a **Deploy** button, and the service shows
*Edited*. Until you press Deploy the volume is not attached, and deploys keep
starting blank — which looks exactly like a broken volume. Press Deploy.

Without a volume, every redeploy wipes budgets *and* the password. Railway also
rejects a `VOLUME` line in a Dockerfile, which is why there isn't one; the
volume has to be attached on their side.

The app checks this for you. *Settings → Server & storage* says either
**"Persistent volume attached"** or, in red, **"This folder is not a mounted
volume"** — it compares filesystems, so it is telling you what is actually
mounted rather than what was configured. The deploy log says the same thing on
startup:

```
Storage:  persistent volume mounted on /app/data
```

**2. Set a password the moment it is live.** Railway gives the service a public
URL. Open it, set a password in the setup screen that appears, and check the
deploy logs — they say `Lock: OFF - no password` in plain text until you do.

You do not need to set `PORT`; Railway injects it and the app follows it.
`GM_HOST` is already `0.0.0.0` in the image.

Cost, so it is not a surprise: Railway has no free tier any more — a one-off
trial credit, then about $5/month, and volumes need a paid plan. If free really
matters more than always-on, Option 1 above costs nothing.

### What to avoid

**Render's free tier** (and similar free web services) give you a filesystem that
is wiped on every restart and sleep after inactivity. Your budget would vanish.
If you use one, you must pay for a persistent disk.

## Starting from empty

The database ships **empty** — there is no data in this repository, by design.

To load a spreadsheet into a profile:

```bash
pip install openpyxl
python tools/import_xlsx.py --list-profiles
python tools/import_xlsx.py "C:\path	o\Gestion Salaire .xlsx" --profile 1 --wipe
```

The importer reads every monthly sheet and rebuilds the fixed-expense
catalogue, the per-month envelopes with their planned/paid figures, every
one-off spend, the account balance snapshots and the salary line. It reconciles
each month's totals against the ones the sheet calculated itself.

Two things to know about imported history:

1. **Each old fixed line arrives as a single lump transaction**, because that is
   all a spreadsheet cell records — e.g. `Repas Dehors 215.50` for the month. Its
   note says so. Going forward these become real itemised spends. Old one-off
   spends are dated the 15th, since the sheet never stored a day.
2. `tools/seed_debts.py` shows how a debt ledger can be seeded from a sheet by
   decoding its formulas and colour legend. Read it before running it — it
   prints its reasoning, and it is specific to one workbook's layout.

## Re-running the import

Only needed if you want to start over. It wipes budget data first:

```bash
python tools/import_xlsx.py "C:\Users\ELMAN\Downloads\Gestion Salaire .xlsx" --wipe
python tools/seed_debts.py --reset
```

Needs `openpyxl` (`pip install openpyxl`). The app itself needs **nothing** —
Python standard library only.

## Files

```
Start GestionMoney.bat   launch
Stop GestionMoney.bat    close every server, orphans included
server.py                HTTP server + JSON API
api.py                   budget logic (months, envelopes, debts, reports)
db.py                    schema, profiles, connection handling
web/                     the dashboard (plain HTML/CSS/JS, no build step)
tools/import_xlsx.py     spreadsheet importer
tools/seed_debts.py      debt ledger seed, with its reasoning
tools/reset_password.py  forgotten-password reset
auth.py                  password hashing and sessions
Dockerfile               for hosting
data/                    your data — gitignored, never committed
```

Environment variables: `GM_PORT` (default 8765), `GM_HOST` (default 127.0.0.1;
set to `0.0.0.0` only behind a VPN or an authenticating proxy).

Change the port with `set GM_PORT=9000` before starting.
