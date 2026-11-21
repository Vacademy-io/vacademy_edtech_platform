"""safe_fetch: every hop validated, connection pinned to the checked address,
redirects re-checked, body capped. A local HTTP server stands in for "a public
host" by teaching the resolver that `img.test` is 127.0.0.1 and letting ONLY
that address through the public-address check — every other rule is real."""
import socketserver
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402
import pytest  # noqa: E402
from app.services import safe_http  # noqa: E402
from app.services.safe_http import SafeFetchError, is_public_address, safe_fetch  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


class _Handler(BaseHTTPRequestHandler):
    routes: dict = {}
    seen: list = []

    def do_GET(self):  # noqa: N802
        type(self).seen.append((self.path, self.headers.get("Host")))
        status, headers, body = type(self).routes.get(self.path, (404, {}, b"nope"))
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        if "Content-Length" not in headers and body is not None and headers.get("X-No-Length") != "1":
            self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def log_message(self, *a):  # silence
        pass


class _Server(ThreadingHTTPServer):
    daemon_threads = True

    def server_bind(self):
        # HTTPServer.server_bind does a reverse lookup (getfqdn) that can take
        # half a minute on a laptop; this server only needs its port.
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


@pytest.fixture
def server(monkeypatch):
    _Handler.routes = {}
    _Handler.seen = []
    httpd = _Server(("127.0.0.1", 0), _Handler)
    port = httpd.server_address[1]
    t = threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
    t.start()

    lookups = []

    async def _resolve(host, port_):
        lookups.append(host)
        if host == "img.test":
            return ["127.0.0.1"]
        if host == "rebind.test":
            return ["93.184.216.34", "10.0.0.5"]
        if host == "other.test":
            return ["127.0.0.1"]
        if host == "dual.test":
            return ["::1", "127.0.0.1"]  # nothing listens on ::1 — like a v6 answer on a v4-only pod
        if host == "xn--bcher-kva.test":
            return ["127.0.0.1"]
        raise OSError("no such host")

    real = safe_http.is_public_address
    monkeypatch.setattr(safe_http, "_resolve_host", _resolve)
    monkeypatch.setattr(safe_http, "is_public_address", lambda ip: ip in ("127.0.0.1", "::1") or real(ip))
    yield {"port": port, "base": f"http://img.test:{port}", "lookups": lookups}
    httpd.shutdown()


def _kw(server, **extra):
    return {"max_bytes": 10_000, "allow_http": True, "allowed_ports": {server["port"]}, **extra}


@pytest.mark.asyncio
async def test_connection_is_pinned_to_the_validated_address(server):
    # img.test does not exist in real DNS: the fetch only works because the
    # connection goes to the address the validator resolved, with the Host header kept.
    _Handler.routes["/a.png"] = (200, {"Content-Type": "image/png"}, PNG)
    res = await safe_fetch(server["base"] + "/a.png", **_kw(server))
    assert res.status_code == 200 and res.content == PNG and res.content_type == "image/png"
    assert _Handler.seen == [("/a.png", f"img.test:{server['port']}")]
    assert server["lookups"] == ["img.test"]  # one lookup per hop, nothing to rebind


@pytest.mark.asyncio
async def test_redirect_to_metadata_address_is_refused_before_any_request(server):
    _Handler.routes["/r"] = (302, {"Location": "http://169.254.169.254/latest/meta-data/"}, b"")
    with pytest.raises(SafeFetchError) as exc:
        await safe_fetch(server["base"] + "/r", **_kw(server, allowed_ports=None))
    # allowed_ports=None means default ports only — the first hop is refused on its port…
    assert exc.value.code == "blocked_host"
    with pytest.raises(SafeFetchError) as exc:
        await safe_fetch(server["base"] + "/r", **_kw(server, allowed_ports={server["port"], 80}))
    # …and with the port allowed, the redirect target fails the address check.
    assert exc.value.code == "blocked_address"
    assert [p for p, _ in _Handler.seen] == ["/r"]


@pytest.mark.asyncio
async def test_redirect_to_a_private_name_and_to_localhost_are_refused(server):
    _Handler.routes["/r1"] = (301, {"Location": "http://localhost/"}, b"")
    _Handler.routes["/r2"] = (307, {"Location": f"http://rebind.test:{server['port']}/x"}, b"")
    for path, code in (("/r1", "blocked_host"), ("/r2", "blocked_address")):
        with pytest.raises(SafeFetchError) as exc:
            await safe_fetch(server["base"] + path, **_kw(server, allowed_ports={server["port"], 80}))
        assert exc.value.code == code


@pytest.mark.asyncio
async def test_dns_answer_with_any_private_address_is_refused(server):
    with pytest.raises(SafeFetchError) as exc:
        await safe_fetch(f"http://rebind.test:{server['port']}/a.png", **_kw(server))
    assert exc.value.code == "blocked_address"
    assert _Handler.seen == []


@pytest.mark.asyncio
async def test_public_redirect_is_followed_and_recorded(server):
    _Handler.routes["/start"] = (302, {"Location": "/final.png"}, b"")
    _Handler.routes["/final.png"] = (200, {"Content-Type": "image/png"}, PNG)
    res = await safe_fetch(server["base"] + "/start", **_kw(server))
    assert res.content == PNG and res.url.endswith("/final.png") and res.redirects == [server["base"] + "/start"]


@pytest.mark.asyncio
async def test_redirect_loop_stops(server):
    _Handler.routes["/loop"] = (302, {"Location": "/loop"}, b"")
    with pytest.raises(SafeFetchError) as exc:
        await safe_fetch(server["base"] + "/loop", **_kw(server, max_redirects=2))
    assert exc.value.code == "too_many_redirects"
    assert len(_Handler.seen) == 3


@pytest.mark.asyncio
async def test_allowed_hosts_apply_to_every_hop(server):
    _Handler.routes["/hop"] = (302, {"Location": f"http://other.test:{server['port']}/a.png"}, b"")
    with pytest.raises(SafeFetchError) as exc:
        await safe_fetch(server["base"] + "/hop", **_kw(server, allowed_hosts=[".img.test"]))
    assert exc.value.code == "blocked_host"


@pytest.mark.asyncio
async def test_body_is_capped_with_and_without_content_length(server):
    _Handler.routes["/big"] = (200, {"Content-Type": "image/png"}, b"x" * 5000)
    _Handler.routes["/big-stream"] = (200, {"Content-Type": "image/png", "X-No-Length": "1", "Connection": "close"}, b"x" * 5000)
    for path in ("/big", "/big-stream"):
        with pytest.raises(SafeFetchError) as exc:
            await safe_fetch(server["base"] + path, **_kw(server, max_bytes=1000))
        assert exc.value.code == "too_large"


@pytest.mark.asyncio
async def test_https_to_http_downgrade_is_refused(monkeypatch):
    async def _resolve(host, port):
        return ["93.184.216.34"]

    async def _hop(target, headers, max_bytes, timeout):
        return 302, httpx.Headers({"location": "http://cdn.example.com/a.png"}), None
    monkeypatch.setattr(safe_http, "_resolve_host", _resolve)
    monkeypatch.setattr(safe_http, "_fetch_one", _hop)
    with pytest.raises(SafeFetchError) as exc:
        await safe_fetch("https://example.com/a.png", max_bytes=1000)
    assert exc.value.code == "blocked_host" and "https to http" in exc.value.message


@pytest.mark.asyncio
@pytest.mark.parametrize("url,code", [
    ("http://example.com/a.png", "bad_url"),           # http only when allowed
    ("ftp://example.com/a.png", "bad_url"),
    ("https://user:pw@example.com/a.png", "bad_url"),
    ("https://localhost/a.png", "blocked_host"),
    ("https://metadata.google.internal/", "blocked_host"),
    ("https://printer.local/", "blocked_host"),
    ("https://example.com:8443/a.png", "blocked_host"),  # default port only unless allowed
])
async def test_url_shape_rules(url, code, monkeypatch):
    async def _resolve(host, port):
        return ["93.184.216.34"]
    monkeypatch.setattr(safe_http, "_resolve_host", _resolve)
    with pytest.raises(SafeFetchError) as exc:
        await safe_fetch(url, max_bytes=1000)
    assert exc.value.code == code


@pytest.mark.parametrize("ip,public", [
    ("8.8.8.8", True), ("93.184.216.34", True), ("2606:4700::1111", True),
    ("127.0.0.1", False), ("10.1.2.3", False), ("172.16.0.1", False), ("192.168.1.1", False),
    ("169.254.169.254", False), ("100.64.0.1", False), ("0.0.0.0", False), ("224.0.0.1", False),
    ("::1", False), ("fc00::1", False), ("fd12:3456::1", False), ("fe80::1", False),
    ("::ffff:10.0.0.1", False), ("::ffff:127.0.0.1", False),
    ("64:ff9b::a9fe:a9fe", False),        # NAT64 of 169.254.169.254
    ("2002:c0a8:0101::1", False),         # 6to4 of 192.168.1.1
    ("not-an-ip", False),
])
def test_public_address_rules(ip, public):
    assert is_public_address(ip) is public


@pytest.mark.asyncio
async def test_every_validated_address_is_tried_in_turn(server):
    _Handler.routes["/a.png"] = (200, {"Content-Type": "image/png"}, PNG)
    res = await safe_fetch(f"http://dual.test:{server['port']}/a.png", **_kw(server))
    assert res.status_code == 200 and res.content == PNG
    assert server["lookups"] == ["dual.test"]


@pytest.mark.asyncio
async def test_an_internationalised_host_is_fetched_by_its_idna_name(server):
    _Handler.routes["/a.png"] = (200, {"Content-Type": "image/png"}, PNG)
    res = await safe_fetch(f"http://bücher.test:{server['port']}/a.png", **_kw(server))
    assert res.status_code == 200 and res.content == PNG
    assert server["lookups"] == ["xn--bcher-kva.test"]
    assert _Handler.seen[-1][1] == f"xn--bcher-kva.test:{server['port']}"


@pytest.mark.asyncio
async def test_web_ports_are_an_opt_in_for_the_legacy_callers(monkeypatch):
    async def _resolve(host, port):
        return ["93.184.216.34"]

    async def _hop(target, headers, max_bytes, timeout):
        return 200, httpx.Headers({"content-type": "image/png"}), PNG
    monkeypatch.setattr(safe_http, "_resolve_host", _resolve)
    monkeypatch.setattr(safe_http, "_fetch_one", _hop)
    ok = await safe_fetch("https://example.com:8443/a.png", max_bytes=1000, allowed_ports=safe_http.WEB_PORTS)
    assert ok.content == PNG
    with pytest.raises(SafeFetchError) as exc:
        await safe_fetch("https://example.com:6443/a.png", max_bytes=1000, allowed_ports=safe_http.WEB_PORTS)
    assert exc.value.code == "blocked_host"
