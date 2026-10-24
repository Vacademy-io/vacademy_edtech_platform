"""
Vacademy MCP server.

Exposes a narrow, read-only slice of the Vacademy Assistant tool registry over
the Model Context Protocol, so institute staff can use their own AI clients
(Claude, ChatGPT, Cursor, ...) against their institute's data.

Three gates apply to every request, all deny-by-default:
  1. OAuth 2.1 — the caller holds a token this server issued to a specific
     Vacademy user for a specific institute (see oauth_provider.py);
  2. institute + role — the institute enabled the server and allow-listed the
     user's role; learners are refused unconditionally (see access.py);
  3. per-tool — the institute enabled that specific tool (registry gate, applied
     in adapter.py).
"""
from __future__ import annotations

from .constants import MCP_EXPOSED_TOOLS, MCP_SERVER_SETTING_KEY

__all__ = ["MCP_EXPOSED_TOOLS", "MCP_SERVER_SETTING_KEY"]
