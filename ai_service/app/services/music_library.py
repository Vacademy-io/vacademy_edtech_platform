"""Built-in background music: CC0 loops laid under the narration without Lyria.

Lyria (Google) needs GCP billing that is off, and the curated-bed fallback
(music_fallback_library.py) reads MUSIC_BED_* env vars nobody set — so videos
ship silent. This library is a request option instead:

    background_music: None (absent) → today's behaviour, unchanged
                      "none"        → no music at all (also skips Lyria)
                      "auto"        → a library track picked by tone
                      "<track id>"  → that library track

Tracks are the WinAAA BGM set on the Internet Archive
(https://archive.org/details/winaaa-bgm-cc0), dedicated CC0 1.0: "free for any
use including commercial work, no credit required". Every file is a seamless
loop made to sit under a speaking voice. The pipeline's audio mix pass
(audio_mixer.build_mix) loops it to length, fades it, and sidechain-ducks it
under the narration; the authors suggest 15–20 dB under the voice, which the
tier default volume (0.10) plus ducking matches.

Files are served from our public bucket (scripts/upload_music_library.py puts
them there); until that upload has run, the archive.org copy is used.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Dict, Optional, Tuple

S3_BUCKET = "vacademy-media-storage-public"
S3_PREFIX = "ai-videos/_library/music/winaaa/"
ARCHIVE_BASE = "https://archive.org/download/winaaa-bgm-cc0/"
LICENSE = "CC0 1.0 — WinAAA BGM (archive.org/details/winaaa-bgm-cc0); no credit required"


@dataclass(frozen=True)
class LibraryTrack:
    id: str
    file: str
    mood: str
    description: str
    bpm: int
    duration_s: float

    @property
    def s3_key(self) -> str:
        return S3_PREFIX + self.file

    @property
    def url(self) -> str:
        return f"https://{S3_BUCKET}.s3.amazonaws.com/{self.s3_key}"

    @property
    def source_url(self) -> str:
        return ARCHIVE_BASE + self.file


# A curated subset — the calmer, piano-led loops that suit teaching and
# product narration. Ids are the archive's own names, so a track is easy to
# trace back to its source.
TRACKS: Dict[str, LibraryTrack] = {t.id: t for t in (
    LibraryTrack("calm_v1", "winaaa_bgm_calm_v1.mp3", "calm",
                 "Calm piano and pad, no drums", 84, 182.88),
    LibraryTrack("calm_v3", "winaaa_bgm_calm_v3.mp3", "calm",
                 "Sparse electric piano sevenths over a sweeping pad, no drums", 88, 174.58),
    LibraryTrack("warm_v2", "winaaa_bgm_warm_v2.mp3", "warm",
                 "Broken piano chords with a gentle lilt", 90, 170.71),
    LibraryTrack("explainer_v2", "winaaa_bgm_explainer_v2.mp3", "explainer",
                 "Steady piano pulse for explainers", 108, 142.26),
    LibraryTrack("explainer_v3", "winaaa_bgm_explainer_v3.mp3", "explainer",
                 "Light swung electric-piano plucks", 98, 156.76),
    LibraryTrack("bright_v1", "winaaa_bgm_bright_v1.mp3", "bright",
                 "Bright electric piano, light four-on-the-floor", 116, 132.44),
)}

NONE = "none"
AUTO = "auto"
CHOICES: Tuple[str, ...] = (NONE, AUTO) + tuple(TRACKS)


def normalize_choice(value: Optional[str]) -> Optional[str]:
    """The request's background_music, validated. None / "" mean "not asked"
    (today's behaviour); anything else must be one of CHOICES."""
    if value is None:
        return None
    v = str(value).strip().lower()
    if not v:
        return None
    if v not in CHOICES:
        raise ValueError(f"background_music must be one of {', '.join(CHOICES)}")
    return v


def is_library_choice(choice: Optional[str]) -> bool:
    """True when the run takes its music from this library (and skips Lyria)."""
    return choice is not None and choice != NONE


def pick_track(choice: Optional[str], *, lesson: bool = False, style_mode: str = "educational") -> Optional[LibraryTrack]:
    """The track for a run. "auto" picks by tone: a calm piano under a taught
    lesson, a bright e-piano for marketing / bold promos, a steady explainer
    pulse for everything else."""
    if not is_library_choice(choice):
        return None
    if choice != AUTO:
        return TRACKS.get(choice)
    if lesson:
        return TRACKS["calm_v1"]
    if style_mode in ("marketing", "bold"):
        return TRACKS["bright_v1"]
    return TRACKS["explainer_v2"]


def playable_url(track: LibraryTrack, probe: Callable[[str], bool]) -> str:
    """Our S3 copy when it is there, else the archive.org original. `probe`
    returns True when a URL answers (a HEAD in production)."""
    try:
        if probe(track.url):
            return track.url
    except Exception:  # noqa: BLE001 — a failed probe just means "use the source"
        pass
    return track.source_url


def head_ok(url: str, timeout: float = 5.0) -> bool:
    """HEAD probe for playable_url."""
    import urllib.request

    req = urllib.request.Request(url, method="HEAD")
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 — fixed public hosts
        return 200 <= resp.status < 300


__all__ = [
    "LibraryTrack", "TRACKS", "CHOICES", "NONE", "AUTO", "LICENSE",
    "normalize_choice", "is_library_choice", "pick_track", "playable_url", "head_ok",
]
