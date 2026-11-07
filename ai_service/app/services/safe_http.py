"""
SSRF-safe outbound GET for URLs a caller (an AI client, an admin) hands us.

`safe_fetch(url)` is the one way the website tools download something from an
address they did not choose themselves (import_image, inlining a reference
image). The older pattern — check the host with getaddrinfo, then let httpx
resolve it AGAIN and follow redirects on its own — had two holes:

  * a public URL that 302s to http://169.254.169.254/ (cloud metadata) or a
    cluster service was fetched anyway, because only the FIRST hop was checked;
  * the check and the fetch resolved DNS separately, so a rebinding resolver
    could answer "public" to the check and "10.0.0.5" to the fetch.

Here every hop is validated before any byte is sent:

  1. scheme https (http only when the caller opts in), no userinfo, default
     port unless the caller allows others, optional host allow-list;
  2. the host is resolved ONCE and EVERY address must be public — private,
     loopback, link-local, CGNAT (100.64/10), ULA (fc00::/7), multicast,
     reserved, NAT64 and v4-mapped/6to4/Teredo-embedded private addresses are
     refused;
  3. the connection is PINNED to those resolved addresses — tried in order,
     like a normal connect, so a v6 answer on a v4-only pod falls through to
     the v4 one (TLS SNI and certificate checks still use the hostname) — so
     there is no second lookup to rebind;
  4. redirects are followed by hand (at most `max_redirects`), each Location
     going through 1-3 again; an https → http downgrade is refused;
  5. the body is streamed with a byte cap (Content-Length is checked first),
     inside an overall deadline.

Env proxies are ignored (trust_env=False): a proxy would do its own lookup and
undo the pinning.
"""
from __future__ import annotations

import asyncio
import ipaddress
import socket
import ssl
from dataclasses import dataclass, field
from typing import Iterable, List, Optional, Sequence
from urllib.parse import urljoin, urlsplit

import httpcore
import httpx

DEFAULT_USER_AGENT = "VacademyFetch/1.0"
_REDIRECT_STATUSES = {301, 302, 303, 307, 308}
_DEFAULT_PORTS = {"http": 80, "https": 443}
#: The common web ports, for callers that fetched any port before safe_fetch
#: existed (a reference image on :8443). Non-web ports on a public address
#: (a cluster API, a database) stay refused.
WEB_PORTS = frozenset({80, 443, 8080, 8443})
_BLOCKED_HOST_SUFFIXES = (".local", ".localhost", ".internal", ".localdomain", ".home.arpa")

# Prefixes `is_global` does not catch (NAT64 maps any IPv4 address, including
# private ones, into these) or that are never a legitimate image host.
_EXTRA_BLOCKED_NETS = tuple(
    ipaddress.ip_network(n)
    for n in ("64:ff9b::/96", "64:ff9b:1::/48", "100.64.0.0/10", "0.0.0.0/8", "fc00::/7", "fe80::/10")
)


class SafeFetchError(Exception):
    """A fetch refused or failed. `code` is stable for callers/tests:
    bad_url, blocked_host, blocked_address, dns_failed, too_many_redirects,
    too_large, timeout, fetch_failed."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class FetchResult:
    url: str                     # final URL (after redirects)
    status_code: int
    headers: httpx.Headers
    content: bytes
    redirects: List[str] = field(default_factory=list)

    @property
    def content_type(self) -> str:
        return (self.headers.get("content-type") or "").split(";")[0].strip().lower()


def is_public_address(ip_text: str) -> bool:
    """True only for a globally routable unicast address (v4 or v6)."""
    try:
        ip = ipaddress.ip_address(ip_text.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address):
        embedded = ip.ipv4_mapped or (ip.sixtofour if ip.sixtofour else None)
        if embedded is None and ip.teredo:
            embedded = ip.teredo[1]
        if embedded is not None and not is_public_address(str(embedded)):
            return False
    if ip.is_multicast or ip.is_unspecified or ip.is_reserved or ip.is_loopback or ip.is_link_local:
        return False
    if any(ip in net for net in _EXTRA_BLOCKED_NETS if net.version == ip.version):
        return False
    return bool(ip.is_global)


def host_is_blocked_name(host: str) -> bool:
    h = (host or "").lower().rstrip(".")
    return not h or h == "localhost" or h.endswith(_BLOCKED_HOST_SUFFIXES)


def _host_allowed(host: str, allowed_hosts: Optional[Sequence[str]]) -> bool:
    """`allowed_hosts`: exact names, or '.example.com' for the domain and its subdomains."""
    if allowed_hosts is None:
        return True
    h = host.lower().rstrip(".")
    for pattern in allowed_hosts:
        p = pattern.lower()
        if p.startswith("."):
            if h == p[1:] or h.endswith(p):
                return True
        elif h == p:
            return True
    return False


def _is_ip_literal(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


async def _resolve_host(host: str, port: int) -> List[str]:
    """Every address the host resolves to (one lookup; the fetch pins to these)."""
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    seen: List[str] = []
    for info in infos:
        addr = info[4][0]
        if addr not in seen:
            seen.append(addr)
    return seen


@dataclass
class _Target:
    url: str
    scheme: str
    host: str                    # ASCII (IDNA) form — what httpcore connects to
    port: int
    ips: List[str]


def _ascii_host(url: str, host: str) -> str:
    """The host as httpx sends it (IDNA/punycode for an internationalised name)."""
    if host.isascii():
        return host
    try:
        return httpx.URL(url).raw_host.decode("ascii").lower().rstrip(".")
    except (httpx.InvalidURL, UnicodeError, ValueError) as exc:
        raise SafeFetchError("bad_url", f"Not a valid host name ({type(exc).__name__}).") from None


async def _validate(
    url: str,
    *,
    allow_http: bool,
    allowed_hosts: Optional[Sequence[str]],
    allowed_ports: Optional[Iterable[int]],
) -> _Target:
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError as exc:
        raise SafeFetchError("bad_url", f"Not a valid URL ({exc}).") from None
    scheme = (parts.scheme or "").lower()
    if scheme not in (("https", "http") if allow_http else ("https",)):
        raise SafeFetchError("bad_url", "Only https URLs can be fetched." if not allow_http else "Only http(s) URLs can be fetched.")
    if parts.username is not None or parts.password is not None:
        raise SafeFetchError("bad_url", "URLs with embedded credentials are not fetched.")
    host = (parts.hostname or "").lower().rstrip(".")
    if host_is_blocked_name(host):
        raise SafeFetchError("blocked_host", "That address is not a public website.")
    host = _ascii_host(url, host)
    if host_is_blocked_name(host):
        raise SafeFetchError("blocked_host", "That address is not a public website.")
    if not _host_allowed(host, allowed_hosts):
        raise SafeFetchError("blocked_host", f"Fetching from '{host}' is not allowed here.")
    port = port or _DEFAULT_PORTS[scheme]
    ports = set(allowed_ports) if allowed_ports is not None else {_DEFAULT_PORTS[scheme]}
    if port not in ports:
        raise SafeFetchError("blocked_host", f"Port {port} is not allowed.")
    try:
        # An IP literal is its own answer (no lookup to fake or rebind).
        addresses = [str(ipaddress.ip_address(host))] if _is_ip_literal(host) else await _resolve_host(host, port)
    except (OSError, UnicodeError) as exc:
        raise SafeFetchError("dns_failed", f"Could not resolve '{host}' ({type(exc).__name__}).") from None
    if not addresses:
        raise SafeFetchError("dns_failed", f"Could not resolve '{host}'.")
    # EVERY address must be public: a resolver that mixes in one private
    # answer is exactly what a rebinding attack looks like.
    if not all(is_public_address(a) for a in addresses):
        raise SafeFetchError("blocked_address", "That address is not a public website.")
    return _Target(url=url, scheme=scheme, host=host, port=port, ips=addresses)


class _PinnedBackend(httpcore.AsyncNetworkBackend):
    """Connects to the pre-validated addresses whatever host httpcore asks for.

    Each address is tried in turn (the first answer may be IPv6 on a pod with
    no v6 route). TLS still runs start_tls with server_hostname=<the URL host>,
    so SNI and certificate verification are against the real name."""

    def __init__(self, host: str, ips: Sequence[str]):
        self._host = host
        self._ips = list(ips)
        self._inner = httpcore.AnyIOBackend()

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        asked = host.decode("ascii") if isinstance(host, bytes) else str(host)
        if asked.lower().rstrip(".") != self._host:
            raise httpcore.ConnectError("refusing an unexpected host on a pinned connection")
        last: Optional[Exception] = None
        for ip in self._ips:
            try:
                return await self._inner.connect_tcp(
                    ip, port, timeout=timeout, local_address=local_address, socket_options=socket_options,
                )
            except (httpcore.ConnectError, httpcore.ConnectTimeout, OSError) as exc:
                last = exc
        raise last if last is not None else httpcore.ConnectError("no address to connect to")

    async def connect_unix_socket(self, path, timeout=None, socket_options=None):  # pragma: no cover
        raise httpcore.ConnectError("unix sockets are not allowed")

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


_SSL_CONTEXT: Optional[ssl.SSLContext] = None


def _ssl_context() -> ssl.SSLContext:
    global _SSL_CONTEXT
    if _SSL_CONTEXT is None:
        _SSL_CONTEXT = httpx.create_ssl_context(verify=True, trust_env=False)
    return _SSL_CONTEXT


class _PinnedTransport(httpx.AsyncHTTPTransport):
    """httpx's own transport with the connection pool swapped for one whose
    network backend is pinned to a single validated address."""

    def __init__(self, host: str, ips: Sequence[str]):
        super().__init__(trust_env=False, retries=0)
        self._pool = httpcore.AsyncConnectionPool(
            ssl_context=_ssl_context(),
            max_connections=1,
            http1=True,
            http2=False,
            retries=0,
            network_backend=_PinnedBackend(host, ips),
        )


async def _fetch_one(target: _Target, headers: dict, max_bytes: int, timeout: float):
    """One hop. Returns (status, headers, body-or-None-for-redirects)."""
    transport = _PinnedTransport(target.host, target.ips)
    async with httpx.AsyncClient(
        transport=transport, follow_redirects=False, trust_env=False, timeout=timeout,
    ) as client:
        async with client.stream("GET", target.url, headers=headers) as resp:
            if resp.status_code in _REDIRECT_STATUSES and resp.headers.get("location"):
                return resp.status_code, resp.headers, None
            declared = resp.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > max_bytes:
                raise SafeFetchError("too_large", f"The file is larger than {max_bytes // 1_000_000} MB.")
            buf = bytearray()
            async for chunk in resp.aiter_bytes():
                buf.extend(chunk)
                if len(buf) > max_bytes:
                    raise SafeFetchError("too_large", f"The file is larger than {max_bytes // 1_000_000} MB.")
            return resp.status_code, resp.headers, bytes(buf)


async def safe_fetch(
    url: str,
    *,
    max_bytes: int,
    max_redirects: int = 3,
    timeout: float = 20.0,
    total_timeout: float = 45.0,
    allow_http: bool = False,
    allowed_hosts: Optional[Sequence[str]] = None,
    allowed_ports: Optional[Iterable[int]] = None,
    headers: Optional[dict] = None,
) -> FetchResult:
    """GET `url` safely (see the module docstring). Raises SafeFetchError.

    A non-redirect response is returned whatever its status — the caller
    decides what a 404 means. `allowed_hosts` applies to EVERY hop."""
    if not isinstance(url, str) or not url.strip():
        raise SafeFetchError("bad_url", "No URL given.")
    req_headers = {"User-Agent": DEFAULT_USER_AGENT, **(headers or {})}

    async def _run() -> FetchResult:
        current = url.strip()
        hops: List[str] = []
        while True:
            target = await _validate(
                current, allow_http=allow_http, allowed_hosts=allowed_hosts, allowed_ports=allowed_ports,
            )
            try:
                status, resp_headers, body = await _fetch_one(target, req_headers, max_bytes, timeout)
            except SafeFetchError:
                raise
            except httpx.TimeoutException:
                raise SafeFetchError("timeout", "The download timed out.") from None
            except (httpx.HTTPError, httpcore.NetworkError, httpcore.ProtocolError, OSError, ssl.SSLError) as exc:
                raise SafeFetchError("fetch_failed", f"The download failed ({type(exc).__name__}).") from None
            if body is not None:
                return FetchResult(url=current, status_code=status, headers=resp_headers, content=body, redirects=hops)
            if len(hops) >= max_redirects:
                raise SafeFetchError("too_many_redirects", f"More than {max_redirects} redirects.")
            nxt = urljoin(current, resp_headers.get("location", "").strip())
            if urlsplit(current).scheme == "https" and urlsplit(nxt).scheme.lower() == "http":
                raise SafeFetchError("blocked_host", "Refusing a redirect from https to http.")
            hops.append(current)
            current = nxt

    try:
        return await asyncio.wait_for(_run(), timeout=total_timeout)
    except asyncio.TimeoutError:
        raise SafeFetchError("timeout", "The download timed out.") from None
