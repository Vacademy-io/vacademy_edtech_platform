"""Copy-check pipeline — orchestrates render_worker layout OCR, rubric
resolution, LLM grading, selective Mathpix fallback, and webhook callbacks
into Java assessment_service. Java owns the persistent process state; this
module owns the AI portion only.

Import-light on purpose: the Scan Station's spawned worker processes import
this package on the way to scan/ and scan_build/, and loading the orchestrator
stack here would cost each worker ~90 MB. `grade_copy` and every submodule are
still reachable as attributes; they load on first use (PEP 562)."""
from __future__ import annotations

import importlib
import pkgutil
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover
    from .orchestrator import grade_copy

__all__ = ["grade_copy"]

_SUBMODULES = frozenset(m.name for m in pkgutil.iter_modules(__path__))


def __getattr__(name: str) -> Any:
    if name == "grade_copy":
        from .orchestrator import grade_copy
        return grade_copy
    if name in _SUBMODULES:
        return importlib.import_module(f"{__name__}.{name}")
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def __dir__() -> list[str]:
    return sorted(set(globals()) | set(__all__) | _SUBMODULES)
