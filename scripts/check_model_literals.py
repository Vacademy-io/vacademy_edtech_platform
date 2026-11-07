#!/usr/bin/env python3
"""CI guard: no NEW hard-coded AI model ids in application code.

Which model a feature uses belongs in the model registry (ai_model_defaults /
ai_models, edited from the super-admin portal), not in a string literal that
silently overrides it. This scans the services and front ends for quoted model
ids — vendor ids such as "google/gemini-2.5-flash" or 'z-ai/glm-5.3-flash' and
bare ids such as "claude-sonnet-4-5", "gemini-2.5-flash", "gpt-5.4" — and
compares them with the committed baseline (scripts/model_literals_baseline.txt).

The baseline is a sorted list of `path<TAB>literal` pairs, so moving a literal
within a file (or adding lines above it) never trips the check; only a literal
that file did not already have does. Exit 1 lists the new ones.

    python scripts/check_model_literals.py            # check (CI)
    python scripts/check_model_literals.py --update   # rewrite the baseline

When a new literal is genuinely right (a hard fallback, a test fixture outside
the excluded paths), add it with --update and say why in the review.
Tests, migrations, voice_bot_service and node_modules are not scanned.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from typing import Dict, Iterable, List, Optional, Set, Tuple

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASELINE = os.path.join("scripts", "model_literals_baseline.txt")

SCAN_ROOTS = (
    "ai_service/app",
    "admin_core_service/src/main/java",
    "assessment_service/src/main/java",
    "community_service",
    "notification_service/src/main/java",
    "frontend-admin-dashboard/src",
    "frontend-learner-dashboard-app/src",
)

EXTENSIONS = (".py", ".java", ".kt", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")

# Directory names never descended into.
SKIP_DIRS = frozenset({
    "node_modules", "voice_bot_service", "tests", "test", "__tests__", "__mocks__",
    "migrations", "migration", "alembic", "__pycache__", ".venv", "venv",
    "dist", "build", "target", "coverage", ".turbo",
})

# File names that are tests even outside a tests/ directory.
TEST_FILE = re.compile(
    r"(^test_.*\.py$|_test\.py$|^conftest\.py$|\.(test|spec)\.[cm]?[jt]sx?$|^Test.*\.java$|Tests?\.java$)"
)

VENDORS = (
    "google", "anthropic", "openai", "z-ai", "qwen", "x-ai", "deepseek", "minimax",
    "bytedance-seed", "recraft", "perplexity", "mistralai", "meta-llama",
)
_ID = r"[A-Za-z0-9][A-Za-z0-9._:+@-]*"
MODEL_ID = re.compile(
    r"^(?:(?:" + "|".join(re.escape(v) for v in VENDORS) + r")/" + _ID
    + r"|(?:claude|gemini|gpt)-[A-Za-z0-9]" + r"[A-Za-z0-9._:+@-]*)$"
)
# A quoted literal whose whole content could be an id: no quotes, spaces or
# template holes inside.
QUOTED = re.compile(r"""(["'`])([A-Za-z][A-Za-z0-9._:+@/-]{2,120})\1""")


def _is_model_id(text: str) -> bool:
    if not MODEL_ID.match(text):
        return False
    # "google/" alone, a trailing-slash path or a URL path piece is not an id.
    return not text.endswith(("/", "-", ".")) and "//" not in text


def iter_files(root: str, scan_roots: Iterable[str] = SCAN_ROOTS) -> Iterable[str]:
    for rel_root in scan_roots:
        base = os.path.join(root, rel_root)
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not d.startswith("."))
            for name in sorted(filenames):
                if not name.endswith(EXTENSIONS) or TEST_FILE.search(name):
                    continue
                yield os.path.join(dirpath, name)


def literals_in(text: str) -> List[Tuple[int, str]]:
    found: List[Tuple[int, str]] = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        for m in QUOTED.finditer(line):
            value = m.group(2)
            if _is_model_id(value):
                found.append((lineno, value))
    return found


def scan(root: str, scan_roots: Iterable[str] = SCAN_ROOTS) -> Dict[Tuple[str, str], List[int]]:
    """{(repo-relative path, literal): [line numbers]}"""
    hits: Dict[Tuple[str, str], List[int]] = {}
    for path in iter_files(root, scan_roots):
        try:
            with open(path, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except OSError:
            continue
        rel = os.path.relpath(path, root).replace(os.sep, "/")
        for lineno, literal in literals_in(text):
            hits.setdefault((rel, literal), []).append(lineno)
    return hits


def read_baseline(path: str) -> Set[Tuple[str, str]]:
    pairs: Set[Tuple[str, str]] = set()
    if not os.path.exists(path):
        return pairs
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if not line or line.startswith("#") or "\t" not in line:
                continue
            file_part, literal = line.split("\t", 1)
            pairs.add((file_part, literal))
    return pairs


def write_baseline(path: str, pairs: Iterable[Tuple[str, str]]) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("# Model-id literals allowed in application code (path<TAB>literal).\n")
        fh.write("# Generated by: python scripts/check_model_literals.py --update\n")
        for file_part, literal in sorted(set(pairs)):
            fh.write(f"{file_part}\t{literal}\n")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--root", default=REPO_ROOT, help="repository root (default: this script's repo)")
    parser.add_argument("--baseline", default=None, help=f"baseline file (default: <root>/{BASELINE})")
    parser.add_argument("--update", action="store_true", help="rewrite the baseline from the current tree")
    args = parser.parse_args(argv)

    root = os.path.abspath(args.root)
    baseline_path = args.baseline or os.path.join(root, BASELINE)
    hits = scan(root)

    if args.update:
        write_baseline(baseline_path, hits.keys())
        print(f"check_model_literals: baseline written with {len(hits)} entries -> {baseline_path}")
        return 0

    allowed = read_baseline(baseline_path)
    new = sorted(k for k in hits if k not in allowed)
    stale = len(allowed - set(hits))
    if new:
        print(f"check_model_literals: {len(new)} NEW hard-coded model id literal(s):")
        for rel, literal in new:
            lines = ",".join(str(n) for n in hits[(rel, literal)])
            print(f"  {rel}:{lines}  {literal}")
        print(
            "Read the model from the registry (model_selection.resolve_models / ai_model_defaults) "
            "instead. If the literal is intended, run `python scripts/check_model_literals.py --update` "
            "and explain it in the review."
        )
        return 1
    print(f"check_model_literals: OK ({len(hits)} known literal(s), no new ones"
          + (f"; {stale} baseline entr{'y' if stale == 1 else 'ies'} no longer present" if stale else "") + ")")
    return 0


if __name__ == "__main__":
    sys.exit(main())
