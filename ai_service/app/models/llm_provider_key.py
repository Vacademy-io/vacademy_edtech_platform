"""
Vendor API keys for direct gateways (today: Anthropic) and their monthly spend.

Both tables are created by the admin_core Flyway migration that adds
`llm_provider_keys` / `llm_key_spend` (keep these models identical to it;
test_key_pool checks the parity). ai_service runs no DDL for them. Only
services/llm_providers/key_pool.py (selection, metering) and
routers/llm_keys_admin.py (super-admin CRUD) touch them, with plain SQL; these
models document the schema and serve the parity test.

`key_ciphertext` is a Fernet token (key_pool.cipher()); no API ever returns
it or the plaintext — only `key_hint` (the last four characters).
"""
from __future__ import annotations

from sqlalchemy import (
    BigInteger, Column, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, text,
)
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class LlmProviderKey(Base):
    __tablename__ = "llm_provider_keys"

    id = Column(String(64), primary_key=True)
    #: 'anthropic' (generic for future gateways)
    provider = Column(String(32), nullable=False)
    label = Column(String(120), nullable=False)
    #: Vendor org/account the key belongs to (Anthropic rate limits are per org).
    org_label = Column(String(120), nullable=True)
    key_ciphertext = Column(Text, nullable=False)
    key_hint = Column(String(16), nullable=False)
    monthly_budget_usd = Column(Numeric(12, 4), nullable=False, server_default=text("200"))
    soft_limit_pct = Column(Integer, nullable=False, server_default=text("95"))
    weight = Column(Integer, nullable=False, server_default=text("1"))
    #: active | disabled | auth_failed
    status = Column(String(16), nullable=False, server_default=text("'active'"))
    cooldown_until = Column(DateTime(timezone=True), nullable=True)
    exhausted_until = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    last_error_at = Column(DateTime(timezone=True), nullable=True)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (Index("idx_llm_provider_keys_provider", "provider", "status"),)


class LlmKeySpend(Base):
    __tablename__ = "llm_key_spend"

    key_id = Column(String(64), ForeignKey("llm_provider_keys.id", ondelete="CASCADE"), primary_key=True)
    #: First day of the month, UTC.
    period_month = Column(Date, primary_key=True)
    metered_usd = Column(Numeric(14, 6), nullable=False, server_default=text("0"))
    calls = Column(BigInteger, nullable=False, server_default=text("0"))
    errors = Column(BigInteger, nullable=False, server_default=text("0"))
    input_tokens = Column(BigInteger, nullable=False, server_default=text("0"))
    output_tokens = Column(BigInteger, nullable=False, server_default=text("0"))
    cache_read_tokens = Column(BigInteger, nullable=False, server_default=text("0"))
    cache_write_tokens = Column(BigInteger, nullable=False, server_default=text("0"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))


__all__ = ["Base", "LlmProviderKey", "LlmKeySpend"]
