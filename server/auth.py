"""Firebase ID token verification and per-user daily quota.

Tokens are checked against Google's published signing certificates rather than
through the Admin SDK, so deploying needs only the project id — no service
account file.
"""
from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timezone
from typing import Any

import httpx
import jwt
from jwt import PyJWKClient

FIREBASE_PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID", "").strip()
_CERT_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
_ISSUER_PREFIX = "https://securetoken.google.com/"

# tier -> questions per calendar day (UTC). Overridable per deployment.
DEFAULT_LIMITS = {"anonymous": 3, "free": 20, "plus": 200}


def _int_env(name: str, fallback: int) -> int:
    try:
        return int(os.environ.get(name, "").strip() or fallback)
    except ValueError:
        return fallback


LIMITS = {
    "anonymous": _int_env("CHAT_LIMIT_ANONYMOUS", DEFAULT_LIMITS["anonymous"]),
    "free": _int_env("CHAT_LIMIT_FREE", DEFAULT_LIMITS["free"]),
    "plus": _int_env("CHAT_LIMIT_PLUS", DEFAULT_LIMITS["plus"]),
}

# Entitlement is server-owned: the Firestore user document is client-writable,
# so a tier stored there could be granted by the user to themselves.
_TIER_UIDS = {
    "plus": {u.strip() for u in os.environ.get("CHAT_PLUS_UIDS", "").split(",") if u.strip()},
}

_certs_lock = threading.Lock()
_jwk_client: PyJWKClient | None = None
_cert_cache: tuple[float, dict[str, str]] | None = None


class AuthError(Exception):
    pass


def _google_certs() -> dict[str, str]:
    """PEM certs keyed by kid, cached for an hour (Google rotates roughly daily)."""
    global _cert_cache
    with _certs_lock:
        if _cert_cache and time.time() - _cert_cache[0] < 3600:
            return _cert_cache[1]
    try:
        resp = httpx.get(_CERT_URL, timeout=10.0)
        resp.raise_for_status()
        certs = resp.json()
    except Exception as exc:
        if _cert_cache:
            return _cert_cache[1]  # keep serving on a transient fetch failure
        raise AuthError(f"could not fetch signing certificates: {exc}") from exc
    with _certs_lock:
        _cert_cache = (time.time(), certs)
    return certs


def verify_id_token(token: str) -> dict[str, Any]:
    """Return the token's claims, or raise AuthError."""
    if not FIREBASE_PROJECT_ID:
        raise AuthError("server is not configured with FIREBASE_PROJECT_ID")
    try:
        header = jwt.get_unverified_header(token)
    except Exception as exc:
        raise AuthError("malformed token") from exc

    kid = header.get("kid")
    cert_pem = _google_certs().get(kid or "")
    if not cert_pem:
        raise AuthError("unknown signing key")

    from cryptography.x509 import load_pem_x509_certificate

    public_key = load_pem_x509_certificate(cert_pem.encode()).public_key()
    try:
        claims = jwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
            audience=FIREBASE_PROJECT_ID,
            issuer=_ISSUER_PREFIX + FIREBASE_PROJECT_ID,
        )
    except jwt.ExpiredSignatureError as exc:
        raise AuthError("token expired") from exc
    except Exception as exc:
        raise AuthError("token rejected") from exc

    if not claims.get("sub"):
        raise AuthError("token has no subject")
    return claims


def tier_for(uid: str | None) -> str:
    if not uid:
        return "anonymous"
    for tier, uids in _TIER_UIDS.items():
        if uid in uids:
            return tier
    return "free"


# ─── Daily usage ───────────────────────────────────────────────────────────────
# Counts questions, not model calls: one question can take several tool
# round-trips and users should not be billed for our own loop.

_usage_lock = threading.Lock()
_usage: dict[str, tuple[str, int]] = {}  # key -> (utc day, count)


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def usage_key(uid: str | None, client_ip: str) -> str:
    return f"uid:{uid}" if uid else f"ip:{client_ip}"


def peek_usage(key: str) -> int:
    day = _today()
    with _usage_lock:
        stored_day, count = _usage.get(key, (day, 0))
    return count if stored_day == day else 0


def check_and_consume(key: str, limit: int) -> tuple[bool, int, int]:
    """Consume one question. Returns (allowed, used_after, limit)."""
    day = _today()
    with _usage_lock:
        stored_day, count = _usage.get(key, (day, 0))
        if stored_day != day:
            count = 0
        if count >= limit:
            return False, count, limit
        _usage[key] = (day, count + 1)
        return True, count + 1, limit


def refund(key: str) -> None:
    """Give a question back when the request failed before producing an answer."""
    day = _today()
    with _usage_lock:
        stored_day, count = _usage.get(key, (day, 0))
        if stored_day == day and count > 0:
            _usage[key] = (day, count - 1)
