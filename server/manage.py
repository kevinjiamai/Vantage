#!/usr/bin/env python
"""Small admin CLI for a service with no admin UI.

    python manage.py users
    python manage.py set-tier you@example.com plus
    python manage.py usage
"""
from __future__ import annotations

import argparse
import sys

from sqlalchemy import select

from accounts import LIMITS, User
from db import Usage, init_db, load_state, session, utcnow


def cmd_users(_args) -> int:
    with session() as s:
        users = list(s.scalars(select(User).order_by(User.created_at)))
    if not users:
        print("No accounts.")
        return 0
    print(f"{'email':34}{'tier':8}{'created':12}{'state':7}id")
    for u in users:
        created = u.created_at.strftime("%Y-%m-%d") if u.created_at else "?"
        has_state = "yes" if load_state(u.id) is not None else "no"
        print(f"{u.email:34}{u.tier:8}{created:12}{has_state:7}{u.id}")
    return 0


def cmd_set_tier(args) -> int:
    tier = args.tier.strip().lower()
    if tier not in LIMITS:
        print(f"Unknown tier {tier!r}. Known: {', '.join(sorted(LIMITS))}", file=sys.stderr)
        return 1
    if tier == "anonymous":
        print("anonymous is for guests; give an account 'free' or 'plus'.", file=sys.stderr)
        return 1
    address = args.email.strip().lower()
    with session() as s:
        user = s.scalar(select(User).where(User.email == address))
        if user is None:
            print(f"No account for {address}", file=sys.stderr)
            return 1
        was = user.tier
        user.tier = tier
        s.commit()
    print(f"{address}: {was} -> {tier} ({LIMITS[tier]} questions/day)")
    return 0


def cmd_usage(_args) -> int:
    today = utcnow().strftime("%Y-%m-%d")
    with session() as s:
        rows = list(s.scalars(
            select(Usage).where(Usage.day == today).order_by(Usage.count.desc())
        ))
        emails = {u.id: u.email for u in s.scalars(select(User))}
    if not rows:
        print(f"No chat usage recorded for {today}.")
        return 0
    print(f"Chat questions on {today} (UTC):\n")
    for row in rows:
        who = row.subject
        if who.startswith("uid:"):
            who = emails.get(who[4:], who)
        print(f"  {who:40}{row.count}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)

    sub.add_parser("users", help="list accounts").set_defaults(fn=cmd_users)

    tier = sub.add_parser("set-tier", help="change an account's service tier")
    tier.add_argument("email")
    tier.add_argument("tier", help=f"one of: {', '.join(t for t in sorted(LIMITS) if t != 'anonymous')}")
    tier.set_defaults(fn=cmd_set_tier)

    sub.add_parser("usage", help="show today's chat usage").set_defaults(fn=cmd_usage)

    args = ap.parse_args()
    init_db()
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
