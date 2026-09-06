"""Persistence for accounts, saved state and chat usage.

SQLAlchemy so the same code runs on SQLite locally with no setup and on
Postgres in production by changing DATABASE_URL. Nothing here is specific to
either.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, create_engine, select,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

_DEFAULT_SQLITE = "sqlite:///" + os.path.join(os.path.dirname(os.path.abspath(__file__)), "vantage.db")
DATABASE_URL = os.environ.get("DATABASE_URL", _DEFAULT_SQLITE).strip() or _DEFAULT_SQLITE
# Render and Heroku hand out the old postgres:// prefix, which SQLAlchemy 2 rejects.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=_connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


if DATABASE_URL.startswith("sqlite"):
    from sqlalchemy import event

    @event.listens_for(engine, "connect")
    def _sqlite_fk(dbapi_connection, _record):  # pragma: no cover - driver hook
        """SQLite ignores ON DELETE CASCADE unless foreign keys are enabled."""
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return uuid.uuid4().hex


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    # Stored lowercased; sign-in is case-insensitive on the address.
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(120), default="")
    tier: Mapped[str] = mapped_column(String(32), default="free")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # Bumped on password change and account deletion so old tokens stop working.
    token_epoch: Mapped[int] = mapped_column(Integer, default=0)


class UserState(Base):
    """The user's app state, opaque to the server apart from its size."""

    __tablename__ = "user_state"

    user_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    data: Mapped[str] = mapped_column(Text, default="{}")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Usage(Base):
    """Chat questions per subject per UTC day. Survives restarts, unlike a dict."""

    __tablename__ = "usage"
    __table_args__ = (UniqueConstraint("subject", "day", name="uq_usage_subject_day"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    subject: Mapped[str] = mapped_column(String(128), index=True)
    day: Mapped[str] = mapped_column(String(10), index=True)
    count: Mapped[int] = mapped_column(Integer, default=0)


def init_db() -> None:
    Base.metadata.create_all(engine)


def session() -> Session:
    return SessionLocal()


# ─── State ─────────────────────────────────────────────────────────────────────

def load_state(user_id: str) -> dict[str, Any] | None:
    with session() as s:
        row = s.get(UserState, user_id)
        if row is None:
            return None
        try:
            return json.loads(row.data)
        except json.JSONDecodeError:
            return None


def save_state(user_id: str, data: dict[str, Any]) -> None:
    payload = json.dumps(data, default=str)
    with session() as s:
        row = s.get(UserState, user_id)
        if row is None:
            s.add(UserState(user_id=user_id, data=payload, updated_at=utcnow()))
        else:
            row.data = payload
            row.updated_at = utcnow()
        s.commit()


# ─── Usage ─────────────────────────────────────────────────────────────────────

def _today() -> str:
    return utcnow().strftime("%Y-%m-%d")


def peek_usage(subject: str) -> int:
    with session() as s:
        row = s.scalar(select(Usage).where(Usage.subject == subject, Usage.day == _today()))
        return row.count if row else 0


def consume_usage(subject: str, limit: int) -> tuple[bool, int, int]:
    """Consume one question. Returns (allowed, used_after, limit)."""
    day = _today()
    with session() as s:
        row = s.scalar(select(Usage).where(Usage.subject == subject, Usage.day == day))
        if row is None:
            row = Usage(subject=subject, day=day, count=0)
            s.add(row)
        if row.count >= limit:
            s.commit()
            return False, row.count, limit
        row.count += 1
        used = row.count
        s.commit()
        return True, used, limit


def refund_usage(subject: str) -> None:
    day = _today()
    with session() as s:
        row = s.scalar(select(Usage).where(Usage.subject == subject, Usage.day == day))
        if row and row.count > 0:
            row.count -= 1
            s.commit()
