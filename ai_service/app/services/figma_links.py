"""
Figma links: how to spot one, and what to tell the admin when one is given to
a part of the product that cannot open it.

Product decision 1 (2026-10-10): NO server-side Figma — no stored Figma tokens
and no REST fetch. A figma.com file link opened without the owner's session
renders Figma's login wall, so the in-product wizard used to "capture the
reference site" as a picture of a sign-in form and design from that. Every
surface that receives a Figma link (the wizard's reference / rebuild URL, the
intake chat, design_import(source='figma_url'), the playbook) now refuses it
the same way and points at the two routes that work.

A published Figma Sites page (``*.figma.site``) is a normal public website and
is NOT matched here.
"""
from __future__ import annotations

import re
from typing import Any, Optional
from urllib.parse import urlparse

#: The one message every surface shows (admin UI copy: frontend-admin-dashboard
#: managePagesAiPageWizard.json → figmaLink.message; keep the two in step).
FIGMA_LINK_GUIDANCE = (
    "Figma links can't be opened here. Either upload screenshots of your frames, or use Claude with the Figma "
    "connector and the Vacademy MCP (it follows our design playbook)."
)

#: The same message for an AI client connected over MCP to relay to the admin.
#: The institute may be white-label, so it names the connection, not the
#: platform, and says MCP access may need turning on (it is opt-in per institute).
FIGMA_LINK_GUIDANCE_FOR_AI = (
    "Figma links can't be opened here. Either upload screenshots of your frames, or use an AI app that has both "
    "the Figma connector and this institute's MCP connection (an admin can turn MCP on in Settings → MCP Server)."
)

_FIGMA_HOST = r"(?:[a-z0-9-]+\.)*figma\.com(?![a-z0-9-]|\.[a-z0-9])(?::\d+)?"
_URL_TAIL = r"[^\s<>\"')\]]*"

#: A figma.com link in free text (chat turns): either with a scheme, or
#: scheme-less with a Figma file path (figma.com/design/…). A bare "figma.com"
#: in prose ("our designer uses figma.com") is not a shared design. The host
#: must be figma.com or a subdomain of it (www., embed. …), and the link must
#: not sit inside another URL (path or query string) or an email address.
_FIGMA_IN_TEXT_RE = re.compile(
    r"(?<![\w./@=&?%#+-])(?:"
    r"https?://" + _FIGMA_HOST + r"(?:[/?#]" + _URL_TAIL + r")?"
    r"|" + _FIGMA_HOST + r"/(?:design|file|proto|board|make|slides)/" + _URL_TAIL
    + r")",
    re.IGNORECASE,
)


def _host(raw: str) -> str:
    target = raw.strip()
    if not re.match(r"^[a-z][a-z0-9+.-]*://", target, re.IGNORECASE):
        target = "https://" + target
    try:
        return (urlparse(target).hostname or "").lower().rstrip(".")
    except ValueError:
        return ""


def is_figma_url(raw: Any) -> bool:
    """True when ``raw`` is a link to figma.com (or one of its subdomains),
    with or without a scheme. Lookalikes (figma.com.evil.io, notfigma.com) and
    published Figma Sites (*.figma.site) are not Figma links."""
    if not isinstance(raw, str) or not raw.strip():
        return False
    host = _host(raw)
    return host == "figma.com" or host.endswith(".figma.com")


def find_figma_url(text: Any) -> Optional[str]:
    """The first figma.com link in free text, or None."""
    if not isinstance(text, str) or "figma" not in text.lower():
        return None
    for m in _FIGMA_IN_TEXT_RE.finditer(text):
        candidate = m.group(0)
        if is_figma_url(candidate):
            return candidate
    return None


__all__ = ["FIGMA_LINK_GUIDANCE", "FIGMA_LINK_GUIDANCE_FOR_AI", "find_figma_url", "is_figma_url"]
