"""
Tier-1 eval: ``design_import`` plan on the Brahm Varchas Figma inputs, scored
against the published site fixture. Deterministic, no network unless --s3.

The inputs are CLIENT MATERIAL and are never committed. Point the runner at a
directory holding them:

    page1.xml     get_metadata of the Figma page (all frames)
    courses.tsx   get_design_context of the Courses frame (node 1:36)
    paths.tsx     get_design_context of the Learning Paths frame (node 73:324)

    FIGMA_BV_INPUTS=/path/to/dir python -m evals.figma_bv.run          (from ai_service/)
    python -m evals.figma_bv.run --inputs /path/to/dir --json card.json
    python -m evals.figma_bv.run --s3 s3://<private-bucket>/<prefix>    (AWS credentials from the environment)

Exit code 0 when every tier-1 check passes (--check), else 1; 2 when there are no inputs.
What goes in the private bucket, how to upload it and how CI runs this: README.md.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, Optional

HERE = Path(__file__).resolve().parent
AI_SERVICE = HERE.parents[1]
REPO = AI_SERVICE.parent
if str(AI_SERVICE) not in sys.path:
    sys.path.insert(0, str(AI_SERVICE))

from app.services.figma_design_import import delta_e, plan_design  # noqa: E402

from evals.figma_bv.scorers import scorecard, summary_line  # noqa: E402

INPUTS_ENV = "FIGMA_BV_INPUTS"
S3_ENV = "FIGMA_BV_S3_URI"


def load_spec() -> Dict[str, Any]:
    return json.loads((HERE / "expected.json").read_text(encoding="utf-8"))


def inputs_dir(explicit: Optional[str] = None) -> Optional[Path]:
    """The inputs directory if it holds every file the spec names, else None."""
    spec = load_spec()
    raw = explicit or os.environ.get(INPUTS_ENV)
    if not raw:
        return None
    d = Path(raw).expanduser()
    needed = [spec["metadata"], *spec["design_code"].values()]
    return d if all((d / f).is_file() for f in needed) else None


def fetch_from_s3(uri: str, dest: Path) -> Path:
    """Copy the inputs from a PRIVATE bucket prefix (credentials: the normal AWS chain, nothing stored here)."""
    import boto3  # already an ai_service dependency
    if not uri.startswith("s3://"):
        raise SystemExit("--s3 expects s3://bucket/prefix")
    bucket, _, prefix = uri[5:].partition("/")
    spec = load_spec()
    client = boto3.client("s3")
    for name in [spec["metadata"], *spec["design_code"].values()]:
        client.download_file(bucket, f"{prefix.rstrip('/')}/{name}", str(dest / name))
    return dest


_LAYER_NAME_RE = re.compile(r'^(\s+)<(?!text\b)([\w-]+) id="([^"]+)" name="[^"]*"', re.M)
_DATA_NAME_RE = re.compile(r'data-name="[^"]*"')


def names_blind(xml: str, codes: Dict[str, str]) -> tuple:
    """The same design with every layer below the top-level frames renamed 'Frame' (as most files are)."""
    blind = _LAYER_NAME_RE.sub(lambda m: m.group(0) if len(m.group(1)) <= 2 else
                               f'{m.group(1)}<{m.group(2)} id="{m.group(3)}" name="Frame"', xml)
    return blind, {k: _DATA_NAME_RE.sub('data-name="Frame"', v) for k, v in codes.items()}


def run(inputs: Path, fixture_path: Optional[Path] = None) -> Dict[str, Any]:
    from app.services.assistant_tools_website_edit import FONT_STACKS
    spec = load_spec()
    catalog = json.loads((AI_SERVICE / "app" / "data" / "catalogue_schema_catalog.json").read_text(encoding="utf-8"))
    fixture = json.loads((fixture_path or REPO / spec["fixture"]).read_text(encoding="utf-8"))
    patterns = catalog.get("patterns") or []
    xml = (inputs / spec["metadata"]).read_text(encoding="utf-8")
    codes = {node: (inputs / name).read_text(encoding="utf-8") for node, name in spec["design_code"].items()}

    def plan_for(xml_text: str, code_map: Dict[str, str]) -> Dict[str, Any]:
        return plan_design(metadata_xml=[xml_text], design_code=[{"node_id": k, "code": v} for k, v in code_map.items()],
                           variables=None, frame_ids=None, patterns=patterns, font_stacks=FONT_STACKS)

    started = time.monotonic()
    plan = plan_for(xml, codes)
    elapsed = time.monotonic() - started
    card = scorecard(plan, fixture, patterns, spec, delta_e)
    card["plan_seconds"] = round(elapsed, 2)
    card["plan_stats"] = plan.get("stats")
    card["plan_warnings"] = plan.get("warnings")
    # Robustness, reported only: generic layer names; no design code at all.
    blind = scorecard(plan_for(*names_blind(xml, codes)), fixture, patterns, spec, delta_e)
    bare = scorecard(plan_for(xml, {}), fixture, patterns, spec, delta_e)
    card["variants"] = {"names_blind": summary_line(blind), "metadata_only": summary_line(bare)}
    return card


def main(argv: Optional[list] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--inputs", help=f"directory with the inputs (default: ${INPUTS_ENV})")
    ap.add_argument("--s3", help=f"s3://bucket/prefix to fetch the inputs from (default: ${S3_ENV})")
    ap.add_argument("--fixture", help="expected site JSON (default: the committed Brahm Varchas fixture)")
    ap.add_argument("--json", help="write the full scorecard here")
    ap.add_argument("--check", action="store_true", help="exit 1 unless every tier-1 check passes")
    args = ap.parse_args(argv)
    tmp = None
    d = inputs_dir(args.inputs)
    s3 = args.s3 or os.environ.get(S3_ENV)
    if d is None and s3:
        tmp = tempfile.TemporaryDirectory(prefix="figma-bv-")
        d = fetch_from_s3(s3, Path(tmp.name))
    if d is None:
        print(f"No inputs: set ${INPUTS_ENV} (or --inputs / --s3). They are client files and are not in the repo.",
              file=sys.stderr)
        return 2
    try:
        card = run(d, Path(args.fixture) if args.fixture else None)
    finally:
        if tmp is not None:
            tmp.cleanup()
    print(summary_line(card))
    for name, line in card["variants"].items():
        print(f"  [{name}] {line}")
    if args.json:
        Path(args.json).write_text(json.dumps(card, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        print(json.dumps({k: card[k] for k in ("checks", "data_needs")}, ensure_ascii=False, indent=2))
    return 0 if (card["passed"] or not args.check) else 1


if __name__ == "__main__":
    raise SystemExit(main())
