"""Local end-to-end check of Scan Station on the real 2026-11-18 Brother scans
(not a pytest test; nothing here reaches a remote service or a model).

Two steps, with assessment_service's planner in between:

  1. analyse  The REAL /ai-service/copy-check/scan/analyse-load route (FastAPI
              TestClient, the flag on, the internal token) reads the two passes
              from a local HTTP server. Only the vision-model header read is
              stubbed: it answers with what is really written in the name boxes
              (HEADER_TRUTH below). The response body is written verbatim; it is
              the fixture ScanStationRealScanE2ETest feeds through the Java
              planner, which writes the build request (contract C2) it sends.
  2. build    That C2 request goes to the REAL /ai-service/copy-check/scan/build
              route. Sources come from the same local server and media-service
              is a local stand-in (get-signed-url + PUT into a folder). Every
              built PDF is then checked page by page against the print manifest
              without any model: each page must embed exactly the source JPEG
              (same SHA-256), upright, in the printed order, with the blank backs
              left out and every written (also faint) page kept.

The scans are private and never committed:
  SCAN_FIXTURES_DIR  folder with 1-fronts/ and 2-backs/ (Image Capture names
                     "Scan.jpeg", "Scan 1.jpeg", ...), the two passes as the
                     clerk dropped them (pass 1 = 1-fronts, pass 2 = 2-backs)
  SCAN_MANIFEST      the print set's manifest.json (build step only)
Without them the script prints SKIP and exits 0.

    python scripts/scan_station_e2e.py analyse --out /tmp/c1.json
    python scripts/scan_station_e2e.py build --request /tmp/c2.json --out-dir /tmp/pdfs --report /tmp/report.json
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Optional
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

PASS_FOLDERS = {1: "1-fronts", 2: "2-backs"}
TOKEN = "e2e-internal-token"
INSTITUTE = "inst-e2e"
SESSION = "sess-e2e"

# What is really printed and handwritten at the top of each scan, read by eye
# from the 11-18 scans: three fronts carry the printed "Name / Roll No." box.
# Every other strip (the other fronts, every back, any page read upside down)
# has no printed field; the backs show the boxes only as mirrored show-through.
# Key: (pass folder, file name, rotation of the strip).
HEADER_TRUTH = {
    ("2-backs", "Scan.jpeg", 0): ("Aarav Sharma", "12"),
    ("2-backs", "Scan 2.jpeg", 0): ("Priya Verma", "27"),
    ("2-backs", "Scan 5.jpeg", 0): ("Rohan Gupta", "5"),
}

# Where each printed side physically landed, established without the analyser:
# the fronts are the 2-backs folder in pile order (its Scan, Scan 2, Scan 5 carry
# the name boxes of copies 1, 2 and 3), the backs are the 1-fronts folder in
# reverse pile order (the pile was turned over: 1-fronts/Scan 5 shows Aarav's
# box through the paper, Scan 3 Priya's, Scan Rohan's). The hand-assembled
# 3-assembled/*.pdf of the same test embed exactly these files in this order.
FRONTS_FOLDER, BACKS_FOLDER = "2-backs", "1-fronts"


def image_capture_order(folder: Path) -> list[str]:
    """Image Capture numbering: 'Scan' is 0, 'Scan N' is N."""
    def index(name: str) -> int:
        m = re.fullmatch(r"Scan(?: (\d+))?\.jpe?g", name, re.IGNORECASE)
        if not m:
            raise SystemExit(f"unexpected file in {folder}: {name}")
        return int(m.group(1) or 0)
    return sorted((p.name for p in folder.iterdir() if not p.name.startswith(".")), key=index)


def file_table(scans: Path) -> dict[str, Path]:
    """file_id -> local path; file ids are p{pass}-{index in clerk order}."""
    out = {}
    for pass_no, folder in PASS_FOLDERS.items():
        for i, name in enumerate(image_capture_order(scans / folder)):
            out[f"p{pass_no}-{i}"] = scans / folder / name
    return out


# ── the local stand-ins: file host + media-service ────────────────────────────

class Local:
    """One HTTP server on 127.0.0.1: GET /files/<id>, the media-service
    get-signed-url, and PUT /put/<id> into `upload_dir`."""

    def __init__(self, files: dict[str, Path], upload_dir: Optional[Path] = None):
        self.files = files
        self.upload_dir = upload_dir
        self.signed: list[dict[str, Any]] = []
        self.puts: list[dict[str, Any]] = []
        self.gets: list[str] = []
        local = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a: Any) -> None:
                pass

            def _send(self, code: int, body: bytes, ctype: str = "application/json") -> None:
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self) -> None:
                fid = urlparse(self.path).path.rsplit("/", 1)[-1]
                path = local.files.get(fid)
                local.gets.append(fid)
                if not self.path.startswith("/files/") or path is None:
                    return self._send(404, b"{}")
                self._send(200, path.read_bytes(), "image/jpeg")

            def do_POST(self) -> None:
                u = urlparse(self.path)
                if u.path != "/media-service/internal/get-signed-url":
                    return self._send(404, b"{}")
                q = {k: v[0] for k, v in parse_qs(u.query).items()}
                q["clientName"] = self.headers.get("clientName")
                q["has_signature"] = bool(self.headers.get("Signature"))
                fid = f"media-{len(local.signed) + 1}"
                local.signed.append({**q, "id": fid})
                port = self.server.server_address[1]
                self._send(200, json.dumps({"id": fid, "url": f"http://127.0.0.1:{port}/put/{fid}?sig=x"}).encode())

            def do_PUT(self) -> None:
                fid = urlparse(self.path).path.rsplit("/", 1)[-1]
                body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                local.puts.append({"id": fid, "content_type": self.headers.get("Content-Type"), "bytes": len(body)})
                if local.upload_dir is not None:
                    (local.upload_dir / f"{fid}.pdf").write_bytes(body)
                self._send(200, b"")

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def url(self, file_id: str) -> str:
        return f"http://127.0.0.1:{self.port}/files/{file_id}"


def app_client():
    """The real ai_service app with the scan station on; no lifespan (no DB, no network)."""
    os.environ["COPY_CHECK_SCAN_STATION"] = "1"
    os.environ["INTERNAL_SERVICE_TOKEN"] = TOKEN
    os.environ.setdefault("CLIENT_NAME", "ai_service")
    os.environ.setdefault("CLIENT_SECRET", "e2e-secret")
    from fastapi.testclient import TestClient

    from app.app_factory import create_app
    from app.db import db_dependency

    app = create_app()
    app.dependency_overrides[db_dependency] = lambda: SimpleNamespace(close=lambda: None)
    return TestClient(app)


# ── the stubbed header read ───────────────────────────────────────────────────

class TruthLLM:
    """Stands in for the vision model. Each strip the analyser sends is matched
    back to its scan (same bytes; else the nearest strip by pixels) and
    answered from HEADER_TRUTH. An unknown strip stops the run."""

    def __init__(self, files: dict[str, Path]):
        from PIL import Image
        import numpy as np

        from app.services.copy_check.scan import pages

        self.np, self.Image = np, Image
        self.by_bytes: dict[bytes, tuple[str, str, int]] = {}
        self.thumbs: list[tuple[Any, tuple[str, str, int]]] = []
        for fid, path in files.items():
            feat = pages.extract_file(str(path), "IMAGE", 100).pages[0]
            for rot, strip in ((0, feat.strip_up), (180, feat.strip_down)):
                key = (path.parent.name, path.name, rot)
                self.by_bytes[strip] = key
                self.thumbs.append((self._thumb(strip), key))
        self.calls = 0
        self.images = 0
        self.fuzzy = 0
        self.answered: list[dict[str, Any]] = []

    def _thumb(self, data: bytes):
        im = self.Image.open(io.BytesIO(data)).convert("L").resize((96, 40))
        return self.np.asarray(im, dtype=self.np.float32)

    def _which(self, data: bytes) -> tuple[str, str, int]:
        key = self.by_bytes.get(data)
        if key is not None:
            return key
        t = self._thumb(data)
        best = min(self.thumbs, key=lambda kv: float(self.np.abs(kv[0] - t).mean()))
        if float(self.np.abs(best[0] - t).mean()) > 3.0:
            raise RuntimeError("the analyser sent a header strip that matches no scan")
        self.fuzzy += 1
        return best[1]

    async def chat_completion(self, messages: list[dict[str, Any]], **_kw: Any) -> dict[str, Any]:
        self.calls += 1
        parts = [p for p in messages[1]["content"] if p.get("type") == "image_url"]
        out = []
        for k, p in enumerate(parts, start=1):
            self.images += 1
            key = self._which(base64.b64decode(p["image_url"]["url"].split(",", 1)[1]))
            truth = HEADER_TRUTH.get(key)
            if truth:
                ans = {"i": k, "label_kind": "PRINTED_FIELD", "name_value": truth[0], "name_legible": True,
                       "roll_value": truth[1], "confidence": 0.95}
            else:
                ans = {"i": k, "label_kind": "NONE", "name_value": None, "name_legible": False,
                       "roll_value": None, "confidence": 0.9}
            self.answered.append({"scan": f"{key[0]}/{key[1]}", "rotation": key[2], "label_kind": ans["label_kind"]})
            out.append(ans)
        return {"content": json.dumps(out), "usage": {"prompt_tokens": 0, "completion_tokens": 0}}


def analyse(scans: Path, out: Path) -> int:
    files = file_table(scans)
    local = Local(files)
    client = app_client()
    from app.services.copy_check.scan import header_read

    llm = TruthLLM(files)
    header_read.make_llm = lambda db, institute_id=None: llm
    header_read.header_model = lambda db, preferred=None: "stub-header-truth"

    req = {"institute_id": INSTITUTE, "session_id": SESSION, "load_no": 1, "preferred_model": None,
           "passes": [{"pass_no": pn, "files": [
               {"file_id": f"p{pn}-{i}", "url": local.url(f"p{pn}-{i}"), "kind": "IMAGE", "name": name}
               for i, name in enumerate(image_capture_order(scans / folder))]}
               for pn, folder in PASS_FOLDERS.items()]}
    resp = client.post("/ai-service/copy-check/scan/analyse-load", json=req,
                       headers={"X-Internal-Service-Token": TOKEN})
    print(f"analyse-load -> HTTP {resp.status_code}; model stub: {llm.calls} calls, {llm.images} strips"
          f" ({llm.fuzzy} matched by pixels)")
    if resp.status_code != 200:
        print(resp.text[:2000])
        return 1
    out.write_text(resp.text)
    body = resp.json()
    print("status", body["status"], "layout", json.dumps(body["layout"]))
    for p in body["pages"]:
        print(f"  {p['ref']:5s} {p['file_id']:5s} {files[p['file_id']].parent.name}/{files[p['file_id']].name:12s}"
              f" dpi {p['dpi']} ({p['dpi_source']}) ink {p['ink_per_10k']:8.3f} {p['blank_class']}")
    for s in body["sheets"]:
        print(f"  sheet {s['sheet_no']}: front {s['front']} back {s['back']} pair {s['pair_score']}"
              f" (runner-up {s['pair_runner_up']}, row max {s['pair_is_row_max']}) label {s['label_kind']}"
              f" name {s['name_text']!r} back {s['back_blank_class']} back_label_like {s['back_label_like']}")
    for f in body["flags"]:
        print(f"  flag {f['severity']:6s} {f['code']} sheet={f['sheet_no']} {f['detail']}")
    print("wrote", out)
    return 0


# ── build + page-by-page check ────────────────────────────────────────────────

def expected_copies(manifest: list[dict[str, Any]], scans: Path) -> dict[int, dict[str, Any]]:
    """copy number -> {student, kept: [scan path], left_out: [scan path], faint: [scan path]}."""
    fronts = image_capture_order(scans / FRONTS_FOLDER)
    backs = image_capture_order(scans / BACKS_FOLDER)
    n = len(fronts)
    sheets = sorted({(e["copy"], e["sheet_in_copy"]) for e in manifest})
    pile_no = {cs: i for i, cs in enumerate(sheets)}            # 0-based sheet in the printed pile
    out: dict[int, dict[str, Any]] = {}
    for e in sorted(manifest, key=lambda e: (e["copy"], e["side_in_copy"])):
        g = pile_no[(e["copy"], e["sheet_in_copy"])]
        path = scans / FRONTS_FOLDER / fronts[g] if e["face"] == "front" else scans / BACKS_FOLDER / backs[n - 1 - g]
        c = out.setdefault(e["copy"], {"student": e["student"], "kept": [], "left_out": [], "faint": []})
        (c["left_out"] if e["blank"] else c["kept"]).append(path)
        if e.get("pencil_like"):
            c["faint"].append(path)
    return out


def pdf_pages(pdf: Path) -> list[dict[str, Any]]:
    import fitz

    doc = fitz.open(str(pdf))
    try:
        pages = []
        for page in doc:
            imgs = page.get_images(full=True)
            info = page.get_image_info(xrefs=True)
            pages.append({
                "rotation": page.rotation,
                "size_pt": [round(page.rect.width, 1), round(page.rect.height, 1)],
                "images": [hashlib.sha256(doc.xref_stream_raw(x[0])).hexdigest() for x in imgs],
                "transform": [round(v, 3) for v in info[0]["transform"]] if info else None,
                "bbox": [round(v, 1) for v in info[0]["bbox"]] if info else None,
            })
        return pages
    finally:
        doc.close()


def build(scans: Path, manifest_path: Path, request_path: Path, out_dir: Path, report_path: Optional[Path]) -> int:
    files = file_table(scans)
    out_dir.mkdir(parents=True, exist_ok=True)
    local = Local(files, upload_dir=out_dir)
    os.environ["MEDIA_SERVER_BASE_URL"] = f"http://127.0.0.1:{local.port}"
    client = app_client()

    req = json.loads(request_path.read_text())
    url_fid: dict[str, str] = {}
    for c in req["copies"]:
        for p in c["pages"]:
            m = re.search(r"/(p[12]-\d+)(?:\?|$)", p["url"])
            if not m or m.group(1) not in files:
                raise SystemExit(f"build request page url names no scan file: {p['url']}")
            url_fid[local.url(m.group(1))] = m.group(1)
            p["url"] = local.url(m.group(1))
    resp = client.post("/ai-service/copy-check/scan/build", json=req, headers={"X-Internal-Service-Token": TOKEN})
    print(f"build -> HTTP {resp.status_code}")
    if resp.status_code != 200:
        print(resp.text[:2000])
        return 1
    result = resp.json()

    sha_of = {hashlib.sha256(p.read_bytes()).hexdigest(): p for p in files.values()}
    expect = expected_copies(json.loads(manifest_path.read_text()), scans)
    problems: list[str] = []
    passed: list[str] = []
    report: dict[str, Any] = {"build_response": result, "media_signed": local.signed, "media_puts": local.puts,
                              "copies": []}

    def check(ok: bool, what: str) -> None:
        (passed if ok else problems).append(what)

    check(len(result["copies"]) == len(expect),
          f"{len(result['copies'])} copies built, print set has {len(expect)}")
    for s in local.signed:
        check(s.get("source") == req["institute_id"] and s.get("sourceId") == req["source_id"]
              and s.get("fileType") == "application/pdf" and s.get("has_signature") and s.get("clientName"),
              f"upload {s['id']}: get-signed-url source={s.get('source')} sourceId={s.get('sourceId')}"
              f" fileType={s.get('fileType')} fileName={s.get('fileName')} internal headers"
              f" {'present' if s.get('has_signature') else 'MISSING'}")
    for p in local.puts:
        check(p["content_type"] == "application/pdf", f"PUT {p['id']}: Content-Type {p['content_type']}")

    for n, (built, sent) in enumerate(zip(result["copies"], req["copies"]), start=1):
        exp = expect.get(n)
        rep: dict[str, Any] = {"copy_key": built["copy_key"], "file_name": sent["file_name"], "error": built["error"]}
        report["copies"].append(rep)
        if exp is None:
            problems.append(f"copy {n} ({built['copy_key']}) is not in the print set")
            continue
        rep["student"] = exp["student"]
        label = f"copy {n} {exp['student']} ({built['copy_key']}, '{sent['file_name']}')"
        if built["error"] or not built["file_id"]:
            problems.append(f"{label}: build error {built['error']}")
            continue
        pdf = out_dir / f"{built['file_id']}.pdf"
        pages = pdf_pages(pdf)
        got = [sha_of.get(pg["images"][0]) if len(pg["images"]) == 1 else None for pg in pages]
        rep["pages"] = [{"source": f"{p.parent.name}/{p.name}" if p else None, **pg} for p, pg in zip(got, pages)]
        rep["expected"] = [f"{p.parent.name}/{p.name}" for p in exp["kept"]]
        rep["left_out_expected"] = [f"{p.parent.name}/{p.name}" for p in exp["left_out"]]
        check(built["page_count"] == len(pages) == len(exp["kept"]),
              f"{label}: {len(pages)} pages in the PDF (response page_count {built['page_count']}),"
              f" print set has {len(exp['kept'])} written sides")
        for i, want in enumerate(exp["kept"]):
            have = got[i] if i < len(got) else None
            pg = pages[i] if i < len(pages) else None
            name = f"{want.parent.name}/{want.name}"
            check(have == want, f"{label} page {i + 1}: embeds {have.parent.name + '/' + have.name if have else 'no source JPEG'}"
                                f" (expected {name}, byte-identical)")
            if pg:
                w_pt, h_pt = pg["size_pt"]
                upright = (pg["rotation"] == 0 and h_pt > w_pt and pg["transform"] is not None
                           and abs(pg["transform"][1]) < 1e-3 and abs(pg["transform"][2]) < 1e-3
                           and pg["transform"][0] > 0 and pg["transform"][3] > 0)
                check(upright, f"{label} page {i + 1}: upright (rotation {pg['rotation']}, {w_pt}x{h_pt} pt,"
                               f" image matrix {pg['transform']})")
        for lo in exp["left_out"]:
            check(lo not in got, f"{label}: blank {lo.parent.name}/{lo.name} left out")
        for f in exp["faint"]:
            check(f in got, f"{label}: faint pencil page {f.parent.name}/{f.name} kept")

    print(f"\nPASSED {len(passed)} checks")
    for p in passed:
        print("  ok  ", p)
    print(f"MISMATCHES {len(problems)}")
    for p in problems:
        print("  FAIL", p)
    report["passed"], report["mismatches"] = passed, problems
    if report_path:
        report_path.write_text(json.dumps(report, indent=1, default=str))
    return 1 if problems else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("analyse")
    a.add_argument("--out", required=True, type=Path)
    b = sub.add_parser("build")
    b.add_argument("--request", required=True, type=Path, help="the C2 request ScanStationRealScanE2ETest wrote")
    b.add_argument("--out-dir", required=True, type=Path)
    b.add_argument("--report", type=Path)
    args = ap.parse_args()

    scans = Path(os.environ.get("SCAN_FIXTURES_DIR") or "/nonexistent")
    if not all((scans / f).is_dir() for f in PASS_FOLDERS.values()):
        print("SKIP: set SCAN_FIXTURES_DIR to the folder holding 1-fronts/ and 2-backs/")
        return 0
    if args.cmd == "analyse":
        return analyse(scans, args.out)
    manifest = Path(os.environ.get("SCAN_MANIFEST") or "/nonexistent")
    if not manifest.is_file():
        print("SKIP: set SCAN_MANIFEST to the print set's manifest.json")
        return 0
    return build(scans, manifest, args.request, args.out_dir, args.report)


if __name__ == "__main__":
    sys.exit(main())
