"""Incremental resume checkpoints for AI-video generation.

The pipeline hands finished files to ``checkpoint_callback(kind, paths)``
(VideoGenerationPipeline.run); the callback maps each file onto the S3 layout
the resume download reads and enqueues it on a per-leg ``CheckpointUploader``:

    run_dir/shot_cache/<name>        → ai-videos/{vid}/checkpoints/shot_cache/<name>
    run_dir/tts/<name>               → ai-videos/{vid}/per_shot_tts/<name>
    narration.mp3 / narration_raw.json / narration_unmixed.mp3
                                     → ai-videos/{vid}/audio/<name>
    narration.words.json / .csv      → ai-videos/{vid}/words/<name>
    run_dir/lesson/teacher_raw.mp4   → ai-videos/{vid}/lesson/teacher_raw.mp4
    anything else                    → ai-videos/{vid}/checkpoints/<name>

The uploader is one background thread per leg fed by a queue. Entries are
keyed by S3 key, so when a file is re-enqueued before its upload ran only the
latest version is uploaded. It never blocks the pipeline thread or the event
loop; ``flush(timeout)`` waits for the queue to drain (end of leg / pause).

After each confirmed upload it records progress in
``extra_metadata.checkpoint`` ({v, tts_persisted, shots_persisted,
teacher_state, updated_at}) with an atomic jsonb merge
(AiVideoRepository.update_checkpoint).
"""
from __future__ import annotations

import json
import logging
import threading
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)

CHECKPOINT_VERSION = 1
AUDIO_FILES = frozenset({"narration.mp3", "narration_raw.json", "narration_unmixed.mp3"})
WORDS_FILES = frozenset({"narration.words.json", "narration.words.csv"})
# Plain checkpoint files restored into run_dir on resume (checkpoints/<name>).
PREAMBLE_FILES = ("routing_plan.json", "video_type.json", "host_plan.json", "visual_preferences.json")
RESUME_CHECKPOINT_FILES = PREAMBLE_FILES + (
    "reference_context.json",
    "host_outputs.json",
    "lesson_teacher.json",
    "director_plan.json",
    "style_guide.json",
    "cost_breakdown_by_stage.json",
)
TEACHER_RAW_REL = "lesson/teacher_raw.mp4"


def s3_key_for(video_id: str, run_dir: Path, path: Path) -> Optional[str]:
    """The S3 key a checkpoint file is stored under (None for a path outside
    run_dir that is not a known artifact)."""
    path = Path(path)
    run_dir = Path(run_dir)
    base = f"ai-videos/{video_id}"
    try:
        rel = path.resolve().relative_to(run_dir.resolve())
    except Exception:  # noqa: BLE001 — not under run_dir: use the bare name
        rel = Path(path.name)
    parts = rel.parts
    name = path.name
    if len(parts) >= 2 and parts[0] == "shot_cache":
        return f"{base}/checkpoints/shot_cache/{name}"
    if len(parts) >= 2 and parts[0] == "tts":
        return f"{base}/per_shot_tts/{name}"
    if rel.as_posix() == TEACHER_RAW_REL:
        return f"{base}/{TEACHER_RAW_REL}"
    if name in AUDIO_FILES:
        return f"{base}/audio/{name}"
    if name in WORDS_FILES:
        return f"{base}/words/{name}"
    return f"{base}/checkpoints/{name}"


def _content_type(path: Path) -> Optional[str]:
    suf = path.suffix.lower()
    return {
        ".json": "application/json",
        ".csv": "text/csv",
        ".txt": "text/plain; charset=utf-8",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".mp4": "video/mp4",
    }.get(suf)


class CheckpointUploader:
    """Per-leg background uploader (latest version wins per S3 key)."""

    def __init__(
        self,
        s3_service: Any,
        video_id: str,
        *,
        repository: Any = None,
        known_shots: Iterable[str] = (),
        name: Optional[str] = None,
    ) -> None:
        self.s3_service = s3_service
        self.video_id = video_id
        self.repository = repository
        self._cv = threading.Condition()
        self._pending: "OrderedDict[str, Tuple[Path, Optional[str]]]" = OrderedDict()
        self._inflight = 0
        self._closed = False
        self.uploaded: List[str] = []
        self.failed: List[str] = []
        self.bytes_uploaded = 0
        self._shots: Set[str] = set(known_shots or ())
        self._tts_persisted = False
        self._teacher_state: Optional[str] = None
        self._thread = threading.Thread(
            target=self._loop, name=name or f"ckpt-{video_id[:16]}", daemon=True
        )
        self._thread.start()

    # ── producer side ───────────────────────────────────────────────────
    def enqueue(self, path: Path, key: str, content_type: Optional[str] = None) -> bool:
        """Queue ``path`` for upload to ``key``. Never blocks or raises."""
        try:
            path = Path(path)
            with self._cv:
                if self._closed:
                    return False
                self._pending.pop(key, None)  # re-queued → the latest version wins
                self._pending[key] = (path, content_type or _content_type(path))
                self._cv.notify_all()
            return True
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Checkpoint] enqueue failed for %s: %s", key, exc)
            return False

    def flush(self, timeout: float = 25.0) -> bool:
        """Wait until every queued upload has been attempted. True when the
        queue drained within ``timeout``."""
        import time

        deadline = time.monotonic() + max(0.0, float(timeout))
        with self._cv:
            while self._pending or self._inflight:
                left = deadline - time.monotonic()
                if left <= 0:
                    return False
                self._cv.wait(timeout=min(left, 0.5))
        return True

    def close(self, timeout: float = 25.0) -> bool:
        """Flush, then stop the thread."""
        ok = self.flush(timeout)
        with self._cv:
            self._closed = True
            self._cv.notify_all()
        self._thread.join(timeout=1.0)
        return ok

    # ── worker side ─────────────────────────────────────────────────────
    def _loop(self) -> None:
        while True:
            with self._cv:
                while not self._pending and not self._closed:
                    self._cv.wait(timeout=1.0)
                if not self._pending and self._closed:
                    return
                key, (path, ctype) = self._pending.popitem(last=False)
                self._inflight += 1
            try:
                self._upload(path, key, ctype)
            finally:
                with self._cv:
                    self._inflight -= 1
                    self._cv.notify_all()

    def _upload(self, path: Path, key: str, ctype: Optional[str]) -> None:
        try:
            if is_temp_file(path) or not path.exists() or not path.is_file():
                return
            size = path.stat().st_size
            self.s3_service.upload_file(path, s3_key=key, content_type=ctype)
            self.uploaded.append(key)
            self.bytes_uploaded += size
            logger.info("[Checkpoint] %s uploaded %s (%d bytes)", self.video_id, key, size)
        except Exception as exc:  # noqa: BLE001 — checkpointing is best-effort
            self.failed.append(key)
            logger.warning("[Checkpoint] %s upload failed for %s: %s", self.video_id, key, exc)
            return
        self._record(path, key)

    def _record(self, path: Path, key: str) -> None:
        """Update extra_metadata.checkpoint after a confirmed upload."""
        if self.repository is None:
            return
        fields: Dict[str, Any] = {}
        if "/checkpoints/shot_cache/" in key:
            self._shots.add(path.name)
            fields["shots_persisted"] = sorted(self._shots)
        elif "/per_shot_tts/" in key or key.endswith("/audio/narration_raw.json"):
            if not self._tts_persisted:
                self._tts_persisted = True
                fields["tts_persisted"] = True
        elif key.endswith("/checkpoints/lesson_teacher.json"):
            try:
                self._teacher_state = str(json.loads(path.read_text(encoding="utf-8")).get("status") or "unknown")
            except Exception:  # noqa: BLE001
                self._teacher_state = "unknown"
            fields["teacher_state"] = self._teacher_state
        elif key.endswith("/" + TEACHER_RAW_REL):
            fields["teacher_raw_persisted"] = True
        if not fields:
            return
        fields["v"] = CHECKPOINT_VERSION
        fields["updated_at"] = datetime.now(timezone.utc).isoformat()
        try:
            self.repository.update_checkpoint(self.video_id, fields)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Checkpoint] manifest update failed for %s: %s", self.video_id, exc)


def is_temp_file(path: Any) -> bool:
    """The pipeline's atomic-write temporaries (``.<name>.<uuid>.tmp``) —
    never uploaded, never restored."""
    name = Path(str(path)).name
    return name.startswith(".") or name.endswith(".tmp")


def _expand(paths: Any) -> List[Path]:
    if paths is None:
        return []
    if isinstance(paths, (str, Path)):
        paths = [paths]
    out: List[Path] = []
    for p in paths:
        try:
            p = Path(p)
        except TypeError:
            continue
        if p.is_dir():
            out.extend(sorted(f for f in p.rglob("*") if f.is_file() and not is_temp_file(f)))
        elif p.is_file() and not is_temp_file(p):
            out.append(p)
    return out


def make_checkpoint_callback(
    uploader: CheckpointUploader,
    video_id: str,
    run_dir: Path,
    on_kind: Optional[Callable[[str, List[Path]], None]] = None,
) -> Callable[[str, Any], None]:
    """The ``checkpoint_callback(kind, paths)`` passed to pipeline.run.
    Swallows every error; enqueue only, never uploads inline."""

    def _cb(kind: str, paths: Any) -> None:
        try:
            files = _expand(paths)
            for f in files:
                key = s3_key_for(video_id, run_dir, f)
                if key:
                    uploader.enqueue(f, key)
            if on_kind is not None:
                on_kind(kind, files)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Checkpoint] callback failed (%s) for %s: %s", kind, video_id, exc)

    return _cb


def enqueue_existing(
    uploader: CheckpointUploader,
    video_id: str,
    run_dir: Path,
    names: Iterable[str],
) -> int:
    """Enqueue the named run_dir files that exist (service-side checkpoints,
    e.g. the preamble at SCRIPT end). Returns how many were queued."""
    n = 0
    for name in names:
        f = Path(run_dir) / name
        if f.is_file():
            key = s3_key_for(video_id, run_dir, f)
            if key and uploader.enqueue(f, key):
                n += 1
    return n


__all__ = [
    "AUDIO_FILES", "CHECKPOINT_VERSION", "CheckpointUploader", "PREAMBLE_FILES",
    "RESUME_CHECKPOINT_FILES", "TEACHER_RAW_REL", "WORDS_FILES", "enqueue_existing", "is_temp_file",
    "make_checkpoint_callback", "s3_key_for",
]
