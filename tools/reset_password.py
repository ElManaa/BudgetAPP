"""Forgot the password? Run this on the machine that holds the data.

It removes the lock and signs every device out. Your budgets are not touched -
they live in separate files this script never opens.

    python tools/reset_password.py            # remove the lock
    python tools/reset_password.py --set NEW  # remove it and set a new one

Anyone able to run this already has the database file, so it is no weaker than
the data itself. That is also why hosting it needs the password AND something
like Tailscale or Cloudflare Access in front.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import auth


def main():
    # Check the replacement before removing anything, or a typo would take the
    # lock off and leave nothing in its place.
    new = None
    if "--set" in sys.argv:
        i = sys.argv.index("--set") + 1
        if i >= len(sys.argv):
            sys.exit("--set needs the new password after it.")
        new = sys.argv[i]
        if len(new.strip()) < auth.MIN_LENGTH:
            sys.exit("The password needs at least %d characters. "
                     "Nothing was changed." % auth.MIN_LENGTH)

    was_set = auth.is_enabled()
    if was_set:
        con = auth._con()
        try:
            con.execute("DELETE FROM app_auth")
            con.execute("DELETE FROM sessions")
            con.commit()
        finally:
            con.close()
        print("Password removed. Every device has been signed out.")
    else:
        print("No password was set.")

    if new is not None:
        auth.set_password(new)
        print("New password set (%d characters)." % len(new))
    elif was_set:
        print("Open the app and set a new one in Settings -> Password lock.")


if __name__ == "__main__":
    main()
