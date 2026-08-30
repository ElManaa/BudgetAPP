"""Seed the debt ledger from the September 2025 sheet.

Every figure below was read out of the workbook, not invented. The reasoning is
printed when you run it so you can check each line before trusting it.

The Hakim / Manel balances come from the sheet's own formulas:
    Hakim  P18 = P2 - U2 - U5 - U9 + P4 - U11 - U10
                = 580 - 240 - 34.56 - 156 + 700 - 120 - 119.99 = 609.45
    Manel  P19 = P3 - U3 - U4 - U6 - U7 - U8
                = 620 - 116 - 61 - 59.35 - 99 - 26.87        = 257.78
i.e. money they handed you, minus what you already spent on their behalf.
Whatever is left you are still holding for them -> you owe it.

The Baby / Ghofrane rows are colour-coded against the legend in column M:
    M3 "Ena Sallaft" (I lent)  = theme colour 4  -> Baby 120 and Baby 400 match
    Ghofrane 300 uses theme colour 6, which matches no legend entry, so it is
    imported as "they owe" but flagged in its note for you to confirm.

Run:  python tools/seed_debts.py [--reset]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import db

AS_OF = "2025-09-01"

SEED = [
    # direction,  person,     amount, reason, note
    ("i_owe", "Hakim", 609.45,
     "Money of his I am still holding",
     "From Sept 2025 sheet: gave 580 + 700, spent 670.55 on his behalf "
     "(Nintendo 240, Website 34.56, Sbedri 156, Sbedri NB 120, Sbedri Nike 119.99)."),
    ("i_owe", "Manel", 257.78,
     "Money of hers I am still holding",
     "From Sept 2025 sheet: gave 620 (pour aspirateur), spent 362.22 on her behalf "
     "(Sponso 116 + 61 + 59.35 + 99 + 26.87)."),
    ("they_owe", "Baby", 120.00,
     "Lent (Ena Sallaft)",
     "Sept 2025 sheet K1/L1, colour-matched to the 'Ena Sallaft' legend."),
    ("they_owe", "Baby", 400.00,
     "Lent (Ena Sallaft)",
     "Sept 2025 sheet K2/L2, colour-matched to the 'Ena Sallaft' legend."),
    ("they_owe", "Ghofrane", 300.00,
     "Lent - CONFIRM DIRECTION",
     "Sept 2025 sheet K3/L3. Its colour matches no legend entry, so the direction "
     "is a guess. Check it and flip or delete this row if wrong."),
]


def main(reset=False, profile=None):
    profile = profile if profile is not None else db.list_profiles()[0]['id']
    con = db.init(profile)
    if reset:
        con.execute("DELETE FROM debt_payments")
        con.execute("DELETE FROM debts")
        con.commit()
        print("Cleared the existing debt ledger.\n")

    added = 0
    for direction, person, amount, reason, note in SEED:
        dup = con.execute(
            "SELECT id FROM debts WHERE person=? AND amount=? AND date=?",
            (person, amount, AS_OF)).fetchone()
        if dup:
            print("  skip (already there)  %-9s %8.2f" % (person, amount))
            continue
        con.execute(
            "INSERT INTO debts(direction,person,amount,reason,date,status,note)"
            " VALUES(?,?,?,?,?,'open',?)",
            (direction, person, amount, reason, AS_OF, note))
        arrow = "you owe  ->" if direction == "i_owe" else "owes you <-"
        print("  %s %-9s %8.2f   %s" % (arrow, person, amount, reason))
        added += 1
    con.commit()

    they = con.execute(
        "SELECT COALESCE(SUM(amount),0) FROM debts"
        " WHERE status='open' AND direction='they_owe'").fetchone()[0]
    mine = con.execute(
        "SELECT COALESCE(SUM(amount),0) FROM debts"
        " WHERE status='open' AND direction='i_owe'").fetchone()[0]
    print("\n%d debt(s) added." % added)
    print("Owed to you: %.2f   You owe: %.2f   Net: %+.2f" % (they, mine, they - mine))
    print("\nOpen the Debts tab and check every line before you rely on it.")


if __name__ == "__main__":
    prof = int(sys.argv[sys.argv.index("--profile") + 1]) if "--profile" in sys.argv else None
    main(reset="--reset" in sys.argv, profile=prof)
