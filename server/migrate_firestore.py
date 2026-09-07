#!/usr/bin/env python
"""One-time import of a Firestore users/{uid} document into this service.

Runs entirely server-side with a Firebase service account, so no account
password is involved and nothing has to be exported by hand.

    # list what is there
    python migrate_firestore.py --key ../serviceAccount.json --list

    # import one document into an existing Vantage account
    python migrate_firestore.py --key ../serviceAccount.json \
        --uid <firestore-uid> --email you@example.com

The service account key is a powerful credential: generate it, use it, then
delete it from the Firebase console. It is never printed by this script.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

import httpx
import jwt
from sqlalchemy import select

from accounts import User
from db import init_db, load_state, save_state, session

TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPE = "https://www.googleapis.com/auth/datastore"


def access_token(key: dict[str, Any]) -> str:
    """Exchange a service-account JWT assertion for an OAuth access token."""
    now = int(time.time())
    assertion = jwt.encode(
        {
            "iss": key["client_email"],
            "scope": SCOPE,
            "aud": TOKEN_URL,
            "iat": now,
            "exp": now + 3600,
        },
        key["private_key"],
        algorithm="RS256",
    )
    resp = httpx.post(
        TOKEN_URL,
        data={
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": assertion,
        },
        timeout=30.0,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def decode(value: Any) -> Any:
    """Unwrap one Firestore REST value into plain JSON."""
    if not isinstance(value, dict):
        return None
    if "nullValue" in value:
        return None
    for field in ("stringValue", "booleanValue", "timestampValue",
                  "bytesValue", "referenceValue", "geoPointValue"):
        if field in value:
            return value[field]
    # Integers arrive as strings so they survive past 2^53.
    if "integerValue" in value:
        return int(value["integerValue"])
    if "doubleValue" in value:
        return float(value["doubleValue"])
    if "arrayValue" in value:
        return [decode(v) for v in value["arrayValue"].get("values", [])]
    if "mapValue" in value:
        return decode_fields(value["mapValue"].get("fields", {}))
    return None


def decode_fields(fields: dict[str, Any]) -> dict[str, Any]:
    return {k: decode(v) for k, v in fields.items()}


def fetch_documents(project: str, token: str) -> list[tuple[str, dict[str, Any]]]:
    """Every document in the users collection, as (uid, decoded fields)."""
    base = (f"https://firestore.googleapis.com/v1/projects/{project}"
            f"/databases/(default)/documents/users")
    out: list[tuple[str, dict[str, Any]]] = []
    page: str | None = None
    with httpx.Client(timeout=60.0, headers={"Authorization": f"Bearer {token}"}) as client:
        while True:
            params = {"pageSize": 100}
            if page:
                params["pageToken"] = page
            resp = client.get(base, params=params)
            resp.raise_for_status()
            body = resp.json()
            for doc in body.get("documents", []):
                uid = doc["name"].rsplit("/", 1)[-1]
                out.append((uid, decode_fields(doc.get("fields", {}))))
            page = body.get("nextPageToken")
            if not page:
                break
    return out


def summarise(uid: str, doc: dict[str, Any]) -> str:
    lists = doc.get("watchlists") or []
    total = sum(len(w.get("symbols") or []) for w in lists if isinstance(w, dict))
    return (
        f"{uid}\n"
        f"    profile      {(doc.get('profile') or {}).get('name') or '(none)'}"
        f"  <{(doc.get('profile') or {}).get('email') or '?'}>\n"
        f"    watchlists   {len(lists)} ({total} symbols total)\n"
        f"    holdings     {len(doc.get('holdings') or [])}\n"
        f"    transactions {len(doc.get('transactions') or [])}\n"
        f"    balance      {doc.get('balance', 0)}"
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--key", required=True, help="path to the service account JSON")
    ap.add_argument("--list", action="store_true", help="show documents and exit")
    ap.add_argument("--uid", help="Firestore document id to import")
    ap.add_argument("--email", help="existing Vantage account to import into")
    ap.add_argument("--force", action="store_true",
                    help="overwrite state the target account already has")
    args = ap.parse_args()

    key_path = Path(args.key)
    if not key_path.exists():
        print(f"No service account key at {key_path}", file=sys.stderr)
        return 1
    key = json.loads(key_path.read_text())
    project = key.get("project_id")
    if not project or "private_key" not in key:
        print("That file does not look like a service account key.", file=sys.stderr)
        return 1

    print(f"Project: {project}")
    docs = fetch_documents(project, access_token(key))
    if not docs:
        print("No documents in the users collection.")
        return 1

    if args.list or not (args.uid and args.email):
        print(f"\n{len(docs)} document(s):\n")
        for uid, doc in docs:
            print("  " + summarise(uid, doc) + "\n")
        if not args.list:
            print("Re-run with --uid <id> --email <account> to import one.", file=sys.stderr)
            return 1
        return 0

    match = next((d for u, d in docs if u == args.uid), None)
    if match is None:
        print(f"No document with uid {args.uid}", file=sys.stderr)
        return 1

    init_db()
    address = args.email.strip().lower()
    with session() as s:
        user = s.scalar(select(User).where(User.email == address))
    if user is None:
        print(f"No Vantage account for {address}. Sign up in the app first, "
              "then re-run this.", file=sys.stderr)
        return 1

    if load_state(user.id) is not None and not args.force:
        print(f"{address} already has saved state. Re-run with --force to replace it.",
              file=sys.stderr)
        return 1

    # Keep only the fields the app reads; anything else in the document is
    # Firestore bookkeeping (updatedAt and friends) and would just be noise.
    keep = ("balance", "holdings", "transactions", "profile",
            "setupComplete", "watchlists", "prefs")
    state = {k: match[k] for k in keep if k in match}
    state["setupComplete"] = True
    save_state(user.id, state)

    print(f"\nImported into {address}:")
    print("  " + summarise(args.uid, state))
    print("\nSign in to the app to confirm, then delete the service account key.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
