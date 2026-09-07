"""Tests for the HTTP contract: status codes, auth gates and CORS preflight.

The preflight cases exist because CORS allowing only GET and POST silently
broke every PUT, PATCH and DELETE in the browser while passing every curl
test, since curl ignores CORS entirely.
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

SERVER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER_DIR))

ORIGIN = "http://localhost:5173"
GOOD_PASSWORD = "a good long password"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'api.db'}")
    monkeypatch.setenv("SECRET_KEY", "y" * 48)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    for name in ("db", "accounts", "llm", "main"):
        sys.modules.pop(name, None)
    main = importlib.import_module("main")
    with TestClient(main.app) as c:
        yield c


def signup(client, email="a@example.com", password=GOOD_PASSWORD, name="A"):
    res = client.post("/api/auth/signup",
                      json={"email": email, "password": password, "name": name})
    assert res.status_code == 200, res.text
    return res.json()["token"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


# ─── Signup and login ──────────────────────────────────────────────────────────


def test_signup_returns_a_session_and_public_user(client):
    body = client.post("/api/auth/signup", json={
        "email": "New@Example.com", "password": GOOD_PASSWORD, "name": "New",
    }).json()
    assert body["token"]
    assert body["user"]["email"] == "new@example.com"
    assert body["user"]["tier"] == "free"
    # A password hash must never cross the wire in any form.
    assert "password" not in str(body).lower()


def test_duplicate_signup_is_409(client):
    signup(client)
    res = client.post("/api/auth/signup",
                      json={"email": "a@example.com", "password": GOOD_PASSWORD})
    assert res.status_code == 409


def test_login_wrong_password_is_401(client):
    signup(client)
    res = client.post("/api/auth/login",
                      json={"email": "a@example.com", "password": "not the password"})
    assert res.status_code == 401


def test_signup_missing_fields_is_422(client):
    assert client.post("/api/auth/signup", json={"email": "a@example.com"}).status_code == 422


# ─── Auth gates ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("method,path,body", [
    ("get", "/api/auth/me", None),
    ("get", "/api/state", None),
    ("put", "/api/state", {"balance": 1}),
    ("patch", "/api/auth/me", {"name": "X"}),
])
def test_protected_routes_reject_guests(client, method, path, body):
    call = getattr(client, method)
    res = call(path) if body is None else call(path, json=body)
    assert res.status_code == 401


def test_body_validation_runs_before_the_auth_check(client):
    """A guest sending a malformed body gets 422, not 401.

    FastAPI validates parameters before the handler runs, so the schema is
    discoverable without a session. Recorded rather than fixed: it leaks only
    the field names, which the client bundle already contains.
    """
    assert client.patch("/api/auth/me", json={}).status_code == 422


def test_protected_routes_reject_a_garbage_token(client):
    assert client.get("/api/auth/me", headers=auth("not.a.real.token")).status_code == 401


def test_me_returns_the_signed_in_account(client):
    token = signup(client)
    assert client.get("/api/auth/me", headers=auth(token)).json()["user"]["email"] == "a@example.com"


def test_rename_updates_the_account(client):
    token = signup(client)
    res = client.patch("/api/auth/me", json={"name": "Renamed"}, headers=auth(token))
    assert res.json()["user"]["name"] == "Renamed"


# ─── State ─────────────────────────────────────────────────────────────────────


def test_state_starts_empty_then_round_trips(client):
    token = signup(client)
    assert client.get("/api/state", headers=auth(token)).json()["state"] is None
    payload = {"balance": 7, "watchlists": [{"id": "w", "symbols": ["AAPL"]}]}
    assert client.put("/api/state", json=payload, headers=auth(token)).status_code == 200
    assert client.get("/api/state", headers=auth(token)).json()["state"] == payload


def test_state_is_private_to_its_account(client):
    first = signup(client, "one@example.com")
    second = signup(client, "two@example.com")
    client.put("/api/state", json={"balance": 999}, headers=auth(first))
    assert client.get("/api/state", headers=auth(second)).json()["state"] is None


def test_oversized_state_is_413(client):
    token = signup(client)
    res = client.put("/api/state", json={"blob": "x" * 600_000}, headers=auth(token))
    assert res.status_code == 413


def test_non_object_state_is_400(client):
    token = signup(client)
    assert client.put("/api/state", json=[1, 2, 3], headers=auth(token)).status_code == 400


# ─── Account deletion ──────────────────────────────────────────────────────────


def test_delete_needs_the_password(client):
    token = signup(client)
    res = client.request("DELETE", "/api/auth/account",
                         json={"password": "wrong"}, headers=auth(token))
    assert res.status_code == 401
    # The account must still be usable after a refused deletion.
    assert client.get("/api/auth/me", headers=auth(token)).status_code == 200


def test_delete_invalidates_the_session(client):
    token = signup(client)
    res = client.request("DELETE", "/api/auth/account",
                         json={"password": GOOD_PASSWORD}, headers=auth(token))
    assert res.status_code == 200
    assert client.get("/api/auth/me", headers=auth(token)).status_code == 401


def test_password_change_returns_a_working_token_and_kills_the_old(client):
    token = signup(client)
    res = client.post("/api/auth/password", headers=auth(token), json={
        "current_password": GOOD_PASSWORD, "new_password": "a different password",
    })
    assert res.status_code == 200
    fresh = res.json()["token"]
    assert client.get("/api/auth/me", headers=auth(fresh)).status_code == 200
    assert client.get("/api/auth/me", headers=auth(token)).status_code == 401


# ─── Chat gating ───────────────────────────────────────────────────────────────


def test_chat_status_reports_guest_tier(client):
    body = client.get("/api/chat/status").json()
    assert body["tier"] == "anonymous"
    assert body["signed_in"] is False
    assert body["service_model_available"] is False


def test_chat_status_reports_the_signed_in_tier(client):
    token = signup(client)
    body = client.get("/api/chat/status", headers=auth(token)).json()
    assert (body["tier"], body["signed_in"]) == ("free", True)
    assert body["limit"] > client.get("/api/chat/status").json()["limit"]


def test_chat_without_a_configured_model_is_503(client):
    """No shared model and no BYO: the user is told, not left guessing."""
    res = client.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert res.status_code == 503


def test_chat_rejects_an_empty_conversation(client):
    assert client.post("/api/chat", json={"messages": []}).status_code == 400


# ─── BYO endpoint validation ───────────────────────────────────────────────────


@pytest.mark.parametrize("base_url", [
    "http://api.groq.com/openai/v1",          # not https
    "https://localhost/v1",                   # loopback
    "https://169.254.169.254/v1",             # cloud metadata endpoint
    "https://evil.example.com/v1",            # not an allowed provider
])
def test_byo_endpoints_outside_the_allowlist_are_refused(client, base_url):
    res = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": "hi"}],
        "byo": {"base_url": base_url, "api_key": "k", "model": "m"},
    })
    assert res.status_code == 400


def test_byo_needs_all_three_fields(client):
    res = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": "hi"}],
        "byo": {"base_url": "https://api.groq.com/openai/v1", "api_key": "k"},
    })
    assert res.status_code == 400


# ─── CORS preflight ────────────────────────────────────────────────────────────


@pytest.mark.parametrize("method", ["GET", "POST", "PUT", "PATCH", "DELETE"])
def test_preflight_allows_every_method_the_api_uses(client, method):
    res = client.options("/api/state", headers={
        "Origin": ORIGIN,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": "authorization,content-type",
    })
    assert res.status_code == 200, f"{method} preflight rejected"
    assert method in res.headers["access-control-allow-methods"]


def test_preflight_allows_the_authorization_header(client):
    res = client.options("/api/state", headers={
        "Origin": ORIGIN,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "authorization",
    })
    assert "authorization" in res.headers["access-control-allow-headers"].lower()


# ─── Health ────────────────────────────────────────────────────────────────────


def test_health_reports_the_storage_backend(client):
    """Durability is visible so a deploy on ephemeral SQLite is obvious."""
    body = client.get("/api/health").json()
    assert body["ok"] is True
    assert body["storage"] == "sqlite"
    assert body["chat_model_configured"] is False
