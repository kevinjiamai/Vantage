"""OpenAI-compatible chat client.

The provider is a base URL, a key and a model name, so Gemini's compatibility
endpoint, Groq, Together, DeepInfra, OpenRouter and DashScope are all the same
code path. Users may supply their own instead of spending the service's budget.
"""
from __future__ import annotations

import ipaddress
import json
import os
import socket
from typing import Any, AsyncIterator
from urllib.parse import urlparse

import httpx

LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai").rstrip("/")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "").strip()
LLM_MODEL = os.environ.get("LLM_MODEL", "gemini-flash-latest").strip()

# Hosts a user-supplied base URL may point at. A URL the server fetches on the
# user's behalf is an SSRF primitive, so this is an allowlist, not a blocklist.
_DEFAULT_BYO_HOSTS = {
    "api.openai.com",
    "api.groq.com",
    "api.together.xyz",
    "api.fireworks.ai",
    "api.deepinfra.com",
    "openrouter.ai",
    "dashscope.aliyuncs.com",
    "dashscope-intl.aliyuncs.com",
    "generativelanguage.googleapis.com",
    "api.mistral.ai",
    "api.cerebras.ai",
}
BYO_HOSTS = _DEFAULT_BYO_HOSTS | {
    h.strip().lower() for h in os.environ.get("LLM_BYO_EXTRA_HOSTS", "").split(",") if h.strip()
}


class LLMError(Exception):
    """Carries the upstream status so the caller can report the real failure."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


def _resolves_to_public_ip(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False
    for info in infos:
        addr = ipaddress.ip_address(info[4][0])
        if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
            return False
    return bool(infos)


def validate_byo(base_url: str) -> str:
    parsed = urlparse(base_url)
    if parsed.scheme != "https":
        raise LLMError("custom endpoints must use https", 400)
    host = (parsed.hostname or "").lower()
    if host not in BYO_HOSTS:
        raise LLMError(
            f"host {host!r} is not an allowed inference endpoint; "
            f"allowed: {', '.join(sorted(BYO_HOSTS))}",
            400,
        )
    if not _resolves_to_public_ip(host):
        raise LLMError("endpoint does not resolve to a public address", 400)
    return base_url.rstrip("/")


class Provider:
    def __init__(self, base_url: str, api_key: str, model: str, byo: bool = False):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.byo = byo

    @classmethod
    def from_request(cls, byo: dict[str, Any] | None) -> "Provider":
        if byo:
            base = str(byo.get("base_url") or "").strip()
            key = str(byo.get("api_key") or "").strip()
            model = str(byo.get("model") or "").strip()
            if not (base and key and model):
                raise LLMError("custom model needs base_url, api_key and model", 400)
            return cls(validate_byo(base), key, model, byo=True)
        if not LLM_API_KEY:
            raise LLMError("this deployment has no model configured; add your own to chat", 503)
        return cls(LLM_BASE_URL, LLM_API_KEY, LLM_MODEL)


async def stream_chat(
    provider: Provider,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Yield {'text': str} deltas and finally {'tool_calls': [...]} if any."""
    payload: dict[str, Any] = {
        "model": provider.model,
        "messages": messages,
        "stream": True,
        "temperature": 0.7,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    headers = {"Authorization": f"Bearer {provider.api_key}", "Content-Type": "application/json"}
    partial: dict[int, dict[str, Any]] = {}

    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=15.0)) as client:
        try:
            async with client.stream(
                "POST", f"{provider.base_url}/chat/completions", json=payload, headers=headers
            ) as resp:
                if resp.status_code >= 400:
                    body = (await resp.aread()).decode("utf-8", "replace")[:400]
                    raise LLMError(body or f"upstream error {resp.status_code}", resp.status_code)
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if not data or data == "[DONE]":
                        continue
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    for choice in chunk.get("choices") or []:
                        delta = choice.get("delta") or {}
                        text = delta.get("content")
                        if text:
                            yield {"text": text}
                        for tc in delta.get("tool_calls") or []:
                            idx = tc.get("index", 0)
                            slot = partial.setdefault(
                                idx, {"id": "", "type": "function",
                                      "function": {"name": "", "arguments": ""}}
                            )
                            if tc.get("id"):
                                slot["id"] = tc["id"]
                            fn = tc.get("function") or {}
                            if fn.get("name"):
                                slot["function"]["name"] = fn["name"]
                            if fn.get("arguments"):
                                slot["function"]["arguments"] += fn["arguments"]
        except httpx.HTTPError as exc:
            raise LLMError(f"could not reach the model provider: {exc}", 502) from exc

    if partial:
        yield {"tool_calls": [partial[i] for i in sorted(partial)]}
