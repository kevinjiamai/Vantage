"""Account creation, sign-in and session tokens.

Identity lives in this service's own database. Deploying Vantage needs a
database URL and a secret key, and no third-party identity provider.
"""
from __future__ import annotations

import os
import re
import secrets
from datetime import timedelta

import bcrypt
import jwt
from sqlalchemy import select

from db import User, UserState, session, utcnow

# Generated when unset so local development works out of the box. Sessions then
# do not survive a restart, which is the right failure for a missing secret.
# 32 bytes is the floor for HS256; PyJWT only warns below it, which would let a
# weak secret sign every session in production unnoticed.
MIN_SECRET_BYTES = 32

_configured_secret = os.environ.get("SECRET_KEY", "").strip()
if _configured_secret and len(_configured_secret.encode()) < MIN_SECRET_BYTES:
    raise RuntimeError(
        f"SECRET_KEY must be at least {MIN_SECRET_BYTES} bytes; "
        "generate one with: openssl rand -base64 48"
    )
SECRET_KEY = _configured_secret or secrets.token_urlsafe(48)
SESSION_DAYS = int(os.environ.get("SESSION_DAYS", "30") or 30)

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD = 8
# bcrypt silently truncates beyond 72 bytes, which would make a long password
# weaker than it looks. Reject instead.
MAX_PASSWORD = 72


class AccountError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def normalize_email(email: str) -> str:
    value = (email or "").strip().lower()
    if not _EMAIL_RE.match(value) or len(value) > 320:
        raise AccountError("that doesn't look like an email address")
    return value


def _check_password(password: str) -> bytes:
    raw = (password or "").encode("utf-8")
    if len(raw) < MIN_PASSWORD:
        raise AccountError(f"password must be at least {MIN_PASSWORD} characters")
    if len(raw) > MAX_PASSWORD:
        raise AccountError(f"password must be at most {MAX_PASSWORD} bytes")
    return raw


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_check_password(password), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw((password or "").encode("utf-8"), hashed.encode())
    except (ValueError, TypeError):
        return False


def issue_token(user: User) -> str:
    now = utcnow()
    return jwt.encode(
        {
            "sub": user.id,
            "epoch": user.token_epoch,
            "iat": now,
            "exp": now + timedelta(days=SESSION_DAYS),
        },
        SECRET_KEY,
        algorithm="HS256",
    )


def user_from_token(token: str) -> User | None:
    """Resolve a session token, or None if it is invalid, expired or superseded."""
    try:
        claims = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
    except Exception:
        return None
    uid = claims.get("sub")
    if not uid:
        return None
    with session() as s:
        user = s.get(User, uid)
    # A password change or account deletion bumps the epoch, retiring old tokens.
    if user is None or claims.get("epoch") != user.token_epoch:
        return None
    return user


def create_user(email: str, password: str, name: str = "") -> User:
    address = normalize_email(email)
    hashed = hash_password(password)
    with session() as s:
        if s.scalar(select(User).where(User.email == address)):
            raise AccountError("an account with that email already exists", 409)
        user = User(email=address, password_hash=hashed, name=(name or "").strip()[:120])
        s.add(user)
        s.commit()
        s.refresh(user)
        return user


def authenticate(email: str, password: str) -> User:
    address = (email or "").strip().lower()
    with session() as s:
        user = s.scalar(select(User).where(User.email == address))
    # Same message either way: distinguishing them tells an attacker which
    # addresses have accounts.
    if user is None or not verify_password(password, user.password_hash):
        raise AccountError("email or password is incorrect", 401)
    return user


def change_password(user_id: str, current: str, new: str) -> None:
    with session() as s:
        user = s.get(User, user_id)
        if user is None:
            raise AccountError("account not found", 404)
        if not verify_password(current, user.password_hash):
            raise AccountError("current password is incorrect", 401)
        user.password_hash = hash_password(new)
        user.token_epoch += 1     # sign other sessions out
        s.commit()


def update_name(user_id: str, name: str) -> User:
    with session() as s:
        user = s.get(User, user_id)
        if user is None:
            raise AccountError("account not found", 404)
        user.name = (name or "").strip()[:120]
        s.commit()
        s.refresh(user)
        return user


def delete_user(user_id: str) -> None:
    with session() as s:
        user = s.get(User, user_id)
        if user is None:
            return
        user.token_epoch += 1
        # Explicit, so the state row goes regardless of the backend's cascade support.
        state = s.get(UserState, user_id)
        if state is not None:
            s.delete(state)
        s.delete(user)
        s.commit()


def public_user(user: User) -> dict[str, object]:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "tier": user.tier,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }
