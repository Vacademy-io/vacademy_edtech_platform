"""Keeps a fetcher on the public web.

Pages are untrusted: a link or script could point the browser at this machine, the local
network or a cloud metadata endpoint. Every request the browser makes is checked here, and
anything that is not http(s) to a public address is refused.

Platform port: kept for the server fetcher and its browser pool (the engine checked every request
of its research browser). is_public_web_url / host_is_public resolve the host name (a DNS lookup,
the only lookup in the engine); literal_host_is_public never does. ai_service's safe_http.safe_fetch
does its own SSRF checks.
"""

from __future__ import annotations

import ipaddress
import socket
from functools import lru_cache
from urllib.parse import urlparse

_BLOCKED_SUFFIXES = (".local", ".localhost", ".internal", ".lan", ".home", ".corp", ".intranet")
# Embedded resources the browser may load without a network request.
_LOCAL_SCHEMES = ("data", "blob", "about")


def _ip_is_public(value: str) -> bool:
    try:
        return ipaddress.ip_address(value).is_global
    except ValueError:
        return False


@lru_cache(maxsize=2048)
def host_is_public(host: str) -> bool:
    host = host.strip("[]").lower().rstrip(".")
    if not host or host == "localhost" or host.endswith(_BLOCKED_SUFFIXES):
        return False
    try:
        ipaddress.ip_address(host)
        return _ip_is_public(host)
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except (socket.gaierror, UnicodeError, OSError):
        return False
    addresses = {info[4][0] for info in infos}
    return bool(addresses) and all(_ip_is_public(a.split("%")[0]) for a in addresses)


def is_public_web_url(url: str) -> bool:
    """True for http(s) URLs whose host resolves only to public addresses."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    return host_is_public(parsed.hostname)


def literal_host_is_public(host: str) -> bool:
    """Checks without a DNS lookup: refuses local names and private or reserved IP literals."""
    host = host.strip("[]").lower().rstrip(".")
    if not host or host == "localhost" or host.endswith(_BLOCKED_SUFFIXES):
        return False
    try:
        return ipaddress.ip_address(host).is_global
    except ValueError:
        return True  # a name; resolved and checked when it is navigated to


def browser_request_allowed(url: str, *, navigation: bool = True) -> bool:
    """Used for every browser request. Pages and frames get the full check, including a DNS lookup;
    resources inside a page (scripts, styles, data requests) get the fast literal check, and the
    browser's own Private Network Access rules additionally stop public pages reaching private ones."""
    parsed = urlparse(url)
    if parsed.scheme in _LOCAL_SCHEMES:
        return True
    if navigation:
        return is_public_web_url(url)
    return parsed.scheme in ("http", "https", "ws", "wss") and bool(parsed.hostname) and literal_host_is_public(parsed.hostname)
