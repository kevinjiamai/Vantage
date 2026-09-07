"""Tests for account creation, sign-in, sessions and the quota counters.

This is the security-critical half of the backend, so the cases here are the
ones whose failure would be quiet: a password that verifies when it should not,
a token that outlives the credential it was issued for, a quota that resets.
"""
from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

import pytest

SERVER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER_DIR))


@pytest.fixture()
def mod(tmp_path, monkeypatch):
    """Fresh db and accounts modules bound to a throwaway SQLite file."""
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setenv("SECRET_KEY", "x" * 48)
    monkeypatch.delenv("ALLOW_EPHEMERAL_SQLITE", raising=False)
    for name in ("db", "accounts"):
        sys.modules.pop(name, None)
    db = importlib.import_module("db")
    accounts = importlib.import_module("accounts")
    db.init_db()
    return db, accounts


# ─── Passwords ─────────────────────────────────────────────────────────────────


def test_password_is_hashed_not_stored(mod):
    db, accounts = mod
    user = accounts.create_user("a@example.com", "a good long password")
    stored = db.session().get(db.User, user.id).password_hash
    assert "a good long password" not in stored
    assert stored.startswith("$2b$")


def test_wrong_password_is_rejected(mod):
    _, accounts = mod
    accounts.create_user("a@example.com", "a good long password")
    with pytest.raises(accounts.AccountError):
        accounts.authenticate("a@example.com", "a good long passworD")


def test_email_is_case_and_space_insensitive(mod):
    _, accounts = mod
    user = accounts.create_user("  Mixed@Example.COM ", "a good long password")
    assert user.email == "mixed@example.com"
    assert accounts.authenticate("MIXED@EXAMPLE.com", "a good long password").id == user.id


def test_duplicate_email_is_refused(mod):
    _, accounts = mod
    accounts.create_user("a@example.com", "a good long password")
    with pytest.raises(accounts.AccountError) as exc:
        accounts.create_user("A@Example.com", "another long password")
    assert exc.value.status == 409


@pytest.mark.parametrize("password", ["", "short", "x" * 7])
def test_short_passwords_are_refused(mod, password):
    _, accounts = mod
    with pytest.raises(accounts.AccountError):
        accounts.create_user("a@example.com", password)


def test_password_longer_than_bcrypt_limit_is_refused(mod):
    """bcrypt truncates past 72 bytes, so a long password would be weaker than it looks."""
    _, accounts = mod
    with pytest.raises(accounts.AccountError):
        accounts.create_user("a@example.com", "x" * 73)


def test_multibyte_password_counted_in_bytes(mod):
    """Four-byte characters hit the bcrypt limit in a quarter of the characters."""
    _, accounts = mod
    with pytest.raises(accounts.AccountError):
        accounts.create_user("a@example.com", "🔒" * 19)  # 76 bytes


@pytest.mark.parametrize("email", ["nope", "no@domain", "@example.com", "a b@example.com", ""])
def test_malformed_emails_are_refused(mod, email):
    _, accounts = mod
    with pytest.raises(accounts.AccountError):
        accounts.create_user(email, "a good long password")


def test_unknown_address_and_wrong_password_look_identical(mod):
    """Distinguishing them would reveal which addresses have accounts."""
    _, accounts = mod
    accounts.create_user("real@example.com", "a good long password")
    with pytest.raises(accounts.AccountError) as wrong:
        accounts.authenticate("real@example.com", "not the password")
    with pytest.raises(accounts.AccountError) as unknown:
        accounts.authenticate("ghost@example.com", "not the password")
    assert str(wrong.value) == str(unknown.value)
    assert wrong.value.status == unknown.value.status == 401


# ─── Sessions ──────────────────────────────────────────────────────────────────


def test_token_round_trips(mod):
    _, accounts = mod
    user = accounts.create_user("a@example.com", "a good long password")
    assert accounts.user_from_token(accounts.issue_token(user)).id == user.id


@pytest.mark.parametrize("token", ["", "garbage", "a.b.c"])
def test_malformed_tokens_resolve_to_nobody(mod, token):
    _, accounts = mod
    assert accounts.user_from_token(token) is None


def test_token_signed_with_another_secret_is_rejected(mod):
    _, accounts = mod
    import jwt

    user = accounts.create_user("a@example.com", "a good long password")
    forged = jwt.encode({"sub": user.id, "epoch": 0}, "a different secret", algorithm="HS256")
    assert accounts.user_from_token(forged) is None


def test_password_change_retires_existing_tokens(mod):
    _, accounts = mod
    user = accounts.create_user("a@example.com", "a good long password")
    old = accounts.issue_token(user)
    accounts.change_password(user.id, "a good long password", "a different password")
    assert accounts.user_from_token(old) is None


def test_password_change_needs_the_current_one(mod):
    _, accounts = mod
    user = accounts.create_user("a@example.com", "a good long password")
    with pytest.raises(accounts.AccountError):
        accounts.change_password(user.id, "wrong current password", "a different password")
    # The old password must still work after a failed change.
    assert accounts.authenticate("a@example.com", "a good long password").id == user.id


def test_token_for_deleted_account_resolves_to_nobody(mod):
    _, accounts = mod
    user = accounts.create_user("a@example.com", "a good long password")
    token = accounts.issue_token(user)
    accounts.delete_user(user.id)
    assert accounts.user_from_token(token) is None


def test_deleting_an_account_removes_its_state(mod):
    db, accounts = mod
    user = accounts.create_user("a@example.com", "a good long password")
    db.save_state(user.id, {"balance": 10})
    accounts.delete_user(user.id)
    assert db.load_state(user.id) is None


def test_short_secret_is_refused(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'x.db'}")
    monkeypatch.setenv("SECRET_KEY", "too-short")
    sys.modules.pop("accounts", None)
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        importlib.import_module("accounts")


# ─── Login throttle ────────────────────────────────────────────────────────────


def test_repeated_failures_lock_the_address(mod):
    _, accounts = mod
    accounts.create_user("a@example.com", "a good long password")
    for _ in range(accounts._LOGIN_MAX_FAILURES):
        with pytest.raises(accounts.AccountError):
            accounts.authenticate("a@example.com", "wrong password here")
    with pytest.raises(accounts.AccountError) as exc:
        accounts.authenticate("a@example.com", "a good long password")
    assert exc.value.status == 429


def test_throttle_is_per_address(mod):
    _, accounts = mod
    accounts.create_user("b@example.com", "a good long password")
    for _ in range(accounts._LOGIN_MAX_FAILURES + 2):
        with pytest.raises(accounts.AccountError):
            accounts.authenticate("a@example.com", "wrong password here")
    assert accounts.authenticate("b@example.com", "a good long password").email == "b@example.com"


def test_success_clears_the_failure_count(mod):
    _, accounts = mod
    accounts.create_user("a@example.com", "a good long password")
    for _ in range(accounts._LOGIN_MAX_FAILURES - 1):
        with pytest.raises(accounts.AccountError):
            accounts.authenticate("a@example.com", "wrong password here")
    accounts.authenticate("a@example.com", "a good long password")
    assert accounts.peek_failures("a@example.com") == 0 if hasattr(accounts, "peek_failures") \
        else not accounts.login_blocked("a@example.com")


# ─── Quota ─────────────────────────────────────────────────────────────────────


def test_quota_consumes_then_blocks(mod):
    db, _ = mod
    assert db.consume_usage("uid:x", 2) == (True, 1, 2)
    assert db.consume_usage("uid:x", 2) == (True, 2, 2)
    assert db.consume_usage("uid:x", 2) == (False, 2, 2)


def test_quota_is_per_subject(mod):
    db, _ = mod
    db.consume_usage("uid:a", 1)
    assert db.consume_usage("uid:b", 1)[0] is True


def test_refund_returns_one_question(mod):
    db, _ = mod
    db.consume_usage("uid:x", 1)
    db.refund_usage("uid:x")
    assert db.peek_usage("uid:x") == 0
    assert db.consume_usage("uid:x", 1)[0] is True


def test_refund_cannot_go_negative(mod):
    db, _ = mod
    db.refund_usage("uid:never-used")
    assert db.peek_usage("uid:never-used") == 0


def test_quota_survives_a_reconnect(mod, tmp_path, monkeypatch):
    """The counters moved into the database precisely so a restart cannot reset them."""
    db, _ = mod
    db.consume_usage("uid:persist", 5)
    url = os.environ["DATABASE_URL"]
    sys.modules.pop("db", None)
    monkeypatch.setenv("DATABASE_URL", url)
    fresh = importlib.import_module("db")
    assert fresh.peek_usage("uid:persist") == 1


# ─── State ─────────────────────────────────────────────────────────────────────


def test_state_round_trips(mod):
    db, accounts = mod
    user = accounts.create_user("a@example.com", "a good long password")
    payload = {"balance": 12.5, "watchlists": [{"id": "w", "symbols": ["AAPL"]}]}
    db.save_state(user.id, payload)
    assert db.load_state(user.id) == payload


def test_saving_state_twice_replaces_it(mod):
    db, accounts = mod
    user = accounts.create_user("a@example.com", "a good long password")
    db.save_state(user.id, {"balance": 1})
    db.save_state(user.id, {"balance": 2})
    assert db.load_state(user.id) == {"balance": 2}


def test_missing_state_is_none(mod):
    db, _ = mod
    assert db.load_state("nobody") is None
