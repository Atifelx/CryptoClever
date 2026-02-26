"""
PostgreSQL database: user_settings and trade_history.
Uses async SQLAlchemy with asyncpg.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from sqlalchemy import JSON, Column, DateTime, Float, String, Text, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base

from app.config import DATABASE_URL

logger = logging.getLogger(__name__)

# Use async engine (asyncpg)
_async_url = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)
engine = create_async_engine(_async_url, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

Base = declarative_base()


class UserSettings(Base):
    __tablename__ = "user_settings"
    user_id = Column(String(128), primary_key=True)
    key = Column(String(128), primary_key=True)
    value = Column(Text, nullable=True)


class TradeHistory(Base):
    __tablename__ = "trade_history"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(128), nullable=False, index=True)
    symbol = Column(String(32), nullable=False)
    side = Column(String(8), nullable=False)  # BUY | SELL
    amount = Column(Float, nullable=False)
    price = Column(Float, nullable=False)
    time = Column(DateTime(timezone=True), nullable=False)
    extra = Column(JSON, nullable=True)


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_settings(user_id: str) -> dict[str, Any]:
    async with async_session() as session:
        result = await session.execute(
            select(UserSettings).where(UserSettings.user_id == user_id)
        )
        rows = result.scalars().all()
        return {r.key: r.value for r in rows}


async def set_setting(user_id: str, key: str, value: str) -> None:
    from sqlalchemy.dialects.postgresql import insert

    async with async_session() as session:
        stmt = insert(UserSettings).values(
            user_id=user_id,
            key=key,
            value=value,
        ).on_conflict_do_update(
            index_elements=["user_id", "key"],
            set_={"value": value},
        )
        await session.execute(stmt)
        await session.commit()


async def get_trades(user_id: str, limit: int = 100) -> list[dict[str, Any]]:
    async with async_session() as session:
        result = await session.execute(
            select(TradeHistory)
            .where(TradeHistory.user_id == user_id)
            .order_by(TradeHistory.time.desc())
            .limit(limit)
        )
        rows = result.scalars().all()
        return [
            {
                "id": r.id,
                "symbol": r.symbol,
                "side": r.side,
                "amount": r.amount,
                "price": r.price,
                "time": r.time.isoformat() if r.time else None,
            }
            for r in rows
        ]


async def add_trade(
    user_id: str,
    symbol: str,
    side: str,
    amount: float,
    price: float,
    time_iso: Optional[str] = None,
    id_: Optional[str] = None,
) -> dict[str, Any]:
    import uuid
    from datetime import datetime, timezone

    tid = id_ or str(uuid.uuid4())
    t = (
        datetime.fromisoformat(time_iso.replace("Z", "+00:00"))
        if time_iso
        else datetime.now(timezone.utc)
    )
    async with async_session() as session:
        row = TradeHistory(
            id=tid,
            user_id=user_id,
            symbol=symbol,
            side=side,
            amount=amount,
            price=price,
            time=t,
        )
        session.add(row)
        await session.commit()
    return {"id": tid, "symbol": symbol, "side": side, "amount": amount, "price": price}
