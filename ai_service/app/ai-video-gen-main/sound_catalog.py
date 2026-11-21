"""
Sound Catalog — loads sounds_metadata.json and classifies the library into
semantic role buckets the Sound Planner can query.

Design goals:
- The pipeline never speaks in file IDs. It asks for ROLES ("ui_chime",
  "transition_whoosh", ...) and the catalog resolves to a concrete file.
- Classification is pure rules — category match + description keyword match
  + duration gate. No ML, no LLM, deterministic.
- A single sound may live in multiple role buckets (a "Whoosh" file is both
  transition_whoosh AND impact when it's short and punchy enough). That's
  fine — variety is a feature.
- Resolution is dedup-aware: the caller passes a `used_set` of file IDs
  already chosen for this video and the catalog picks the least-used option.

Adding a new role = edit ROLE_RULES and restart. Adding a new sound to the
library = drop it into sounds_metadata.json and restart.
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

# Mask credentials in any string we might log (httpx exceptions include
# the full URL with `?key=...`, and we don't want that ending up in
# pod logs / chat transcripts / bug reports).
_REDACT_RE = re.compile(
    r"(?i)(\bkey=|\bauthorization:\s*(?:bearer|key)\s+)[^\s&\"']+",
)


def _redact(s: Any) -> str:
    try:
        return _REDACT_RE.sub(r"\1***", str(s))
    except Exception:
        return "<unprintable>"

_CATALOG_CACHE: Optional["SoundCatalog"] = None

# Semantic search config — provider/model/dim are read from the
# sidecar index JSON at load time, so the runtime stays in sync with
# whatever embed_sounds_catalog.py was run with.
_OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings"
_GEMINI_EMBED_URL_TMPL = (
    "https://generativelanguage.googleapis.com/v1beta/"
    "models/{model}:embedContent?key={key}"
)


# ---------------------------------------------------------------------------
# Role classification rules
# ---------------------------------------------------------------------------
# Each rule defines:
#   categories    — exact matches against the `category` field in metadata
#   keywords      — case-insensitive substrings checked against `description`
#   min_duration  — sound must be at least this long (seconds)
#   max_duration  — sound must be at most this long (seconds)
# A sound matches a role if it satisfies (categories OR keywords) AND the
# duration gate. A sound can match multiple roles.
ROLE_RULES: Dict[str, Dict[str, Any]] = {
    "transition_whoosh": {
        # Category-only — "transition" as a keyword is too loose (matches
        # musical stings tagged as "transition elements").
        "categories": {"Whoosh", "Whooshes", "Film Burn"},
        "keywords": [],
        "min_duration": 0.15,
        "max_duration": 3.0,
    },
    "transition_riser": {
        "categories": {"Cinematic Riser", "Risers", "Riser", "CORPORATE RISER", "Rise"},
        "keywords": [],
        "min_duration": 0.8,
        "max_duration": 8.0,
    },
    "ui_chime": {
        # Not the whole "Musical" category: it is stings, stabs and horror
        # accents; musical chimes still match on the keywords below.
        "categories": {"Chime", "Notifications", "Musical Chime", "Bell",
                       "Alarm & Chime"},
        "keywords": ["chime", "bell", "ding", "notification", "twinkle", "sparkle"],
        "min_duration": 0.2,
        "max_duration": 4.0,
    },
    "ui_positive": {
        "categories": {"Positive", "PowerUp"},
        "keywords": ["positive", "success", "power up", "powerup", "win", "complete",
                     "achievement", "unlock"],
        "min_duration": 0.2,
        "max_duration": 3.0,
    },
    "ui_negative": {
        "categories": {"Negative", "Error", "Alarm", "PowerDown"},
        "keywords": ["negative", "error", "fail", "wrong", "power down", "powerdown",
                     "denied", "buzzer"],
        "min_duration": 0.2,
        "max_duration": 3.0,
    },
    "ui_click": {
        "categories": {"Button", "Click", "Switch", "Pop", "Keyboard & Mouse", "PC Mouse"},
        "keywords": ["click", "button", "switch", "pop", "tap", "tick"],
        "min_duration": 0.02,
        "max_duration": 1.5,
    },
    "data_reveal": {
        "categories": {"Counter", "DATA", "Beep", "Digital"},
        "keywords": ["counter", "data", "beep", "tick", "digital", "readout"],
        "min_duration": 0.1,
        "max_duration": 3.0,
    },
    "impact": {
        "categories": {"Hits", "Percussion", "Metal", "Explosions", "Metal Slices"},
        "keywords": ["hit", "impact", "slam", "punch", "boom", "thud", "smash"],
        "min_duration": 0.1,
        "max_duration": 3.0,
    },
    "ambient_loop": {
        # Category-only by design — keyword matches like "loop" pull in
        # vehicle-engine-loop files that don't work as background.
        # Duration gate is off because Ambience files in our metadata
        # file all have duration_seconds=0 (metadata generation gap).
        "categories": {"Ambience"},
        "keywords": [],
        "min_duration": 0.0,
        "max_duration": 999.0,
    },
}


# Never in a learning video, whatever role a file would otherwise fill. A
# "HORROR, MUSICAL, ACCENT, CATHEDRAL, ORGAN, STAB, DISSONANT" file sat in the
# Musical category, counted as a ui_chime, and played on every reveal of a
# parenting lesson (video feadce4b, 2026-10-27). Whole words of `description`.
EXCLUDE_KEYWORDS: frozenset = frozenset({
    "horror", "dissonant", "scary", "creepy", "sinister", "evil", "scream",
    "screams", "ominous", "terror", "haunted", "zombie", "gore", "demonic",
    "spooky", "nightmare",
})

# Words that say nothing about a sound; dropped before keyword scoring so a
# query's "a" / "the" / "with" can't match (as substrings) almost every file.
_STOPWORDS: frozenset = frozenset({
    "this", "that", "with", "from", "into", "your", "their", "they", "them",
    "what", "when", "where", "which", "while", "will", "would", "could", "should",
    "have", "been", "were", "about", "over", "under", "more", "most", "some",
    "than", "then", "there", "these", "those", "each", "every", "just", "only",
    "also", "very", "context", "brief", "soft", "gentle",
})


def _words(text: str) -> Set[str]:
    return set(re.findall(r"[a-z0-9]+", (text or "").lower()))


def topic_terms(words: List[str]) -> List[str]:
    """Distinct lower-case terms worth matching: 4+ letters, not stopwords."""
    out: List[str] = []
    for w in words:
        for t in re.findall(r"[a-z0-9]+", str(w or "").lower()):
            if len(t) >= 4 and t not in _STOPWORDS and t not in out:
                out.append(t)
    return out


# Volume hints per role (0.0 – 1.0). The Sound Planner can override per-cue
# but these are the sane defaults a non-domain-expert would pick.
ROLE_VOLUME_DEFAULTS: Dict[str, float] = {
    "transition_whoosh": 0.45,
    "transition_riser":  0.50,
    "ui_chime":          0.55,
    "ui_positive":       0.60,
    "ui_negative":       0.55,
    "ui_click":          0.50,
    "data_reveal":       0.55,
    "impact":            0.70,
    "ambient_loop":      0.25,
}


def _default_metadata_path() -> Path:
    """The ai_service root holds sounds_metadata.json.

    This module lives at app/ai-video-gen-main/sound_catalog.py, so the
    metadata file is two levels up.
    """
    here = Path(__file__).resolve().parent
    candidates = [
        here.parent.parent / "sounds_metadata.json",  # ai_service/sounds_metadata.json
        here / "sounds_metadata.json",                # colocated fallback
        here.parent / "sounds_metadata.json",
    ]
    for c in candidates:
        if c.exists():
            return c
    return candidates[0]  # return first even if missing; loader reports error


class SoundCatalog:
    """Classified, indexed view of sounds_metadata.json."""

    def __init__(self, sounds: List[Dict[str, Any]]):
        self.sounds: List[Dict[str, Any]] = sounds
        # role -> list of indices into self.sounds
        self._by_role: Dict[str, List[int]] = {role: [] for role in ROLE_RULES}
        self._by_id: Dict[str, int] = {}
        # Semantic search state (populated lazily by _load_embeddings).
        self._embeddings = None  # type: ignore[var-annotated]  # np.ndarray | None
        self._embedding_row_by_id: Dict[str, int] = {}
        self._embeddings_loaded: bool = False
        self._embedding_provider: str = ""  # "openai" | "gemini"
        self._embedding_model: str = ""
        self._embedding_dim: int = 0
        self._query_cache: Dict[str, Any] = {}  # query_text -> np.ndarray
        self._classify()

    def _classify(self) -> None:
        for idx, entry in enumerate(self.sounds):
            fid = entry.get("file_id")
            if fid:
                self._by_id[fid] = idx
            category = str(entry.get("category", "") or "")
            description = str(entry.get("description", "") or "").lower()
            if _words(description) & EXCLUDE_KEYWORDS:
                continue
            try:
                duration = float(entry.get("duration_seconds", 0) or 0)
            except (TypeError, ValueError):
                duration = 0.0

            for role, rule in ROLE_RULES.items():
                # Duration gate first — fastest reject
                if duration < rule.get("min_duration", 0.0):
                    continue
                if duration > rule.get("max_duration", 9999.0):
                    continue
                # Match by category OR by keyword
                cat_match = category in rule.get("categories", set())
                kw_match = False
                if not cat_match:
                    for kw in rule.get("keywords", []):
                        if kw.lower() in description:
                            kw_match = True
                            break
                if cat_match or kw_match:
                    self._by_role[role].append(idx)

    # ----- inspection ------------------------------------------------------

    def stats(self) -> Dict[str, int]:
        """Count of sounds per role — useful for debugging classification."""
        return {role: len(idxs) for role, idxs in self._by_role.items()}

    def roles_available(self) -> List[str]:
        """Roles with at least one classified sound."""
        return [r for r, idxs in self._by_role.items() if idxs]

    def has_role(self, role: str) -> bool:
        return role in self._by_role and bool(self._by_role[role])

    def get_by_id(self, file_id: str) -> Optional[Dict[str, Any]]:
        idx = self._by_id.get(file_id)
        if idx is None:
            return None
        return self.sounds[idx]

    # ----- resolution ------------------------------------------------------

    def resolve(
        self,
        role: str,
        used_ids: Optional[Set[str]] = None,
        seed_key: Optional[str] = None,
        exclude_urls: Optional[Set[str]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Pick a concrete sound file for a role.

        Args:
            role: role bucket to sample from
            used_ids: set of file_ids already chosen in the current video —
                      the resolver will avoid repeats within the same video.
                      The caller is responsible for adding the returned id
                      to this set.
            seed_key: optional stable key (e.g. "{video_id}:{shot_idx}:{role}")
                      — if provided, picks are deterministic for the same key.
                      If None, picks are random.
            exclude_urls: files (by public_url) never to return — None when
                      every file in the bucket is excluded.

        Returns:
            dict with {file_id, url, duration, category, description, role,
                       volume_hint} or None if the role bucket is empty.
        """
        indices = self._by_role.get(role, [])
        if exclude_urls:
            indices = [i for i in indices if self.sounds[i].get("public_url") not in exclude_urls]
        if not indices:
            return None

        used_ids = used_ids or set()

        # Prefer unused files from this bucket; fall back to any file if all
        # have been used.
        unused = [i for i in indices if self.sounds[i].get("file_id") not in used_ids]
        pool = unused if unused else indices

        if seed_key:
            # Deterministic pick — same key always resolves to the same file
            # so regenerating a video gives identical sound effects.
            h = hashlib.md5(seed_key.encode("utf-8")).hexdigest()
            pick = pool[int(h, 16) % len(pool)]
        else:
            pick = random.choice(pool)

        entry = self.sounds[pick]
        return {
            "file_id": entry.get("file_id"),
            "url": entry.get("public_url"),
            "duration": float(entry.get("duration_seconds", 0) or 0),
            "category": entry.get("category", ""),
            "description": entry.get("description", ""),
            "role": role,
            "volume_hint": ROLE_VOLUME_DEFAULTS.get(role, 0.5),
        }


    def resolve_for_topic(
        self,
        role: str,
        topic_keywords: List[str],
        seed_key: Optional[str] = None,
        exclude_urls: Optional[Set[str]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Pick a sound file biased toward topic keywords.

        Scores every file in the role bucket by how many topic keywords
        appear in its description. The top-scoring files form a shortlist;
        the deterministic seed picks from the shortlist so the same video
        always gets the same palette entry.

        If no keywords match any file (topic is unrelated to the library),
        falls back to a plain deterministic pick from the full bucket —
        identical to resolve().
        """
        indices = self._by_role.get(role, [])
        if exclude_urls:
            indices = [i for i in indices if self.sounds[i].get("public_url") not in exclude_urls]
        if not indices:
            return None

        # Whole words of 4+ letters: substring matching let "a" / "the" hit
        # nearly every description, so the longest one won every pick.
        terms = topic_terms(topic_keywords)
        if not terms:
            return self.resolve(role, seed_key=seed_key, exclude_urls=exclude_urls)

        scored: List[tuple] = []  # (score, idx)
        for idx in indices:
            desc = _words(str(self.sounds[idx].get("description", "") or ""))
            score = sum(1 for t in terms if t in desc)
            scored.append((score, idx))

        # Sort by score descending, then by index for stability.
        scored.sort(key=lambda x: (-x[0], x[1]))

        best_score = scored[0][0]
        if best_score == 0:
            # No topic overlap — fall back to generic pick.
            return self.resolve(role, seed_key=seed_key, exclude_urls=exclude_urls)

        # Shortlist = all files sharing the top score (usually 1-5 files).
        shortlist = [idx for sc, idx in scored if sc == best_score]

        if seed_key:
            h = hashlib.md5(seed_key.encode("utf-8")).hexdigest()
            pick = shortlist[int(h, 16) % len(shortlist)]
        else:
            pick = shortlist[0]

        entry = self.sounds[pick]
        return {
            "file_id": entry.get("file_id"),
            "url": entry.get("public_url"),
            "duration": float(entry.get("duration_seconds", 0) or 0),
            "category": entry.get("category", ""),
            "description": entry.get("description", ""),
            "role": role,
            "volume_hint": ROLE_VOLUME_DEFAULTS.get(role, 0.5),
        }


# ---------------------------------------------------------------------------
# Semantic search — extension of SoundCatalog
# ---------------------------------------------------------------------------
# The methods below are bound to SoundCatalog at module load. Kept as
# free functions to keep the diff readable next to the rules above.

def _embeddings_paths(metadata_path: Path) -> Tuple[Path, Path]:
    base = metadata_path.parent
    return base / "sound_embeddings.npz", base / "sound_embeddings_index.json"


def _load_embeddings(self: "SoundCatalog", metadata_path: Path) -> None:
    """Load the npz + index sidecar files generated by embed_sounds_catalog.py.

    No-op (and silent) if the files don't exist — semantic search is then
    unavailable and `find_by_intent` falls back to the keyword resolver.
    """
    if self._embeddings_loaded:
        return
    self._embeddings_loaded = True  # set first so failure paths don't retry

    npz_path, index_path = _embeddings_paths(metadata_path)
    if not npz_path.exists() or not index_path.exists():
        return
    try:
        import numpy as np  # local import — numpy is a heavy dep
        data = np.load(npz_path)
        mat = data["embeddings"]
        with open(index_path, "r", encoding="utf-8") as f:
            index = json.load(f)
    except (OSError, ValueError, KeyError, ImportError) as e:
        print(f"[sound_catalog] embeddings load failed ({e}) — semantic search disabled")
        return

    provider = index.get("provider") or ""
    model = index.get("model") or ""
    dim = index.get("dim") or mat.shape[1]
    if provider not in ("openai", "gemini"):
        print(f"[sound_catalog] unknown embeddings provider {provider!r} — disabled")
        return
    if mat.shape[1] != dim:
        print(f"[sound_catalog] embeddings dim mismatch ({mat.shape[1]} vs {dim}) — disabled")
        return

    file_ids = index.get("file_ids", [])
    if len(file_ids) != mat.shape[0]:
        print("[sound_catalog] embeddings count mismatch — disabled")
        return

    self._embeddings = mat
    self._embedding_row_by_id = {fid: i for i, fid in enumerate(file_ids)}
    self._embedding_provider = provider
    self._embedding_model = model
    self._embedding_dim = mat.shape[1]
    print(
        f"[sound_catalog] loaded {mat.shape[0]} embeddings "
        f"(provider={provider} model={model} dim={mat.shape[1]})"
    )


SoundCatalog._load_embeddings = _load_embeddings  # type: ignore[attr-defined]


def _embed_query(self: "SoundCatalog", text: str) -> Optional[Any]:
    """Embed a query string via the same provider used offline.

    Reads provider/model from the catalog's loaded index. Returns the
    L2-normalized vector as np.ndarray or None if the API call fails or
    the provider's key is missing. Cached per-process by text.
    """
    text = (text or "").strip()
    if not text:
        return None
    if text in self._query_cache:
        return self._query_cache[text]

    provider = self._embedding_provider
    model = self._embedding_model
    if not provider or not model:
        return None

    try:
        import httpx
        import numpy as np

        if provider == "openai":
            api_key = os.environ.get("OPENAI_API_KEY")
            if not api_key:
                return None
            resp = httpx.post(
                _OPENAI_EMBEDDINGS_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={"model": model, "input": text[:600]},
                timeout=15.0,
            )
            resp.raise_for_status()
            raw = resp.json()["data"][0]["embedding"]
        elif provider == "gemini":
            api_key = os.environ.get("GEMINI_API_KEY")
            if not api_key:
                return None
            url = _GEMINI_EMBED_URL_TMPL.format(model=model, key=api_key)
            resp = httpx.post(
                url,
                headers={"Content-Type": "application/json"},
                json={
                    "model": f"models/{model}",
                    "content": {"parts": [{"text": text[:600]}]},
                    # Must match the offline embedder's dim so vectors are comparable.
                    "outputDimensionality": self._embedding_dim,
                },
                timeout=15.0,
            )
            resp.raise_for_status()
            raw = resp.json()["embedding"]["values"]
        else:
            return None

        vec = np.array(raw, dtype=np.float32)
        n = np.linalg.norm(vec)
        if n > 0:
            vec = vec / n
        self._query_cache[text] = vec
        return vec
    except Exception as e:
        print(f"[sound_catalog] query embed failed ({_redact(e)}) — falling back to keywords")
        # Negative-cache so subsequent cues with the same text don't
        # re-hit the (failing) API. Cleared only on process restart.
        self._query_cache[text] = None
        return None


SoundCatalog._embed_query = _embed_query  # type: ignore[attr-defined]


def find_by_intent(
    self: "SoundCatalog",
    query: str,
    role: Optional[str] = None,
    used_ids: Optional[Set[str]] = None,
    top_k: int = 1,
    fallback_seed_salt: str = "",
    exclude_urls: Optional[Set[str]] = None,
) -> Optional[Dict[str, Any]]:
    """Semantic-search for a sound matching `query`, optionally within `role`.

    - Role-prefilters to the role bucket (avoids ui_positive picking a door).
    - Cosine-ranks candidates against the query embedding.
    - Prefers unused candidates among the top-K.

    Falls back to `resolve_for_topic` (keyword overlap) if embeddings or
    the embedding API are unavailable, so behavior degrades gracefully.
    `fallback_seed_salt` lets the caller vary the deterministic seed
    across repeated calls (so the legacy resolver doesn't collapse a
    4-variation palette into 1 entry).

    Returns the same dict shape as `resolve()`, plus `score` (cosine sim).
    """
    used_ids = used_ids or set()

    def _keyword_fallback() -> Optional[Dict[str, Any]]:
        if not role:
            return None
        seed = f"{query}|{fallback_seed_salt}" if fallback_seed_salt else query
        return self.resolve_for_topic(role, query.split(), seed_key=seed, exclude_urls=exclude_urls)

    # Role pre-filter — empty role means search across the whole library.
    if role:
        candidate_indices = self._by_role.get(role, [])
    else:
        candidate_indices = list(range(len(self.sounds)))
    if exclude_urls:
        candidate_indices = [ci for ci in candidate_indices
                             if self.sounds[ci].get("public_url") not in exclude_urls]
    if not candidate_indices:
        return None

    # If embeddings unavailable, fall through to the keyword resolver.
    if self._embeddings is None:
        return _keyword_fallback()

    qvec = self._embed_query(query)
    if qvec is None:
        return _keyword_fallback()

    import numpy as np
    # Map candidate catalog-indices to embedding rows; drop any with no embedding.
    cand_rows: List[Tuple[int, int]] = []  # (catalog_idx, embedding_row)
    for ci in candidate_indices:
        fid = self.sounds[ci].get("file_id")
        if not fid:
            continue
        row = self._embedding_row_by_id.get(fid)
        if row is None:
            continue
        cand_rows.append((ci, row))
    if not cand_rows:
        # Bucket has entries but none are embedded (e.g. metadata added
        # after the offline embed run). Fall back to keyword resolver
        # rather than silently dropping the cue.
        return _keyword_fallback()

    sub = self._embeddings[[r for _, r in cand_rows]]  # (N, DIM)
    sims = sub @ qvec  # (N,) cosine since both sides are L2-normalized

    # Sort by score descending; keep top_k * 3 for unused-preference.
    order = np.argsort(-sims)[: max(top_k * 3, top_k)]
    ranked = [(float(sims[i]), cand_rows[i][0]) for i in order]
    # Prefer unused; otherwise take the top.
    unused = [(s, ci) for s, ci in ranked
              if self.sounds[ci].get("file_id") not in used_ids]
    pool = unused if unused else ranked
    score, pick_idx = pool[0]

    entry = self.sounds[pick_idx]
    return {
        "file_id": entry.get("file_id"),
        "url": entry.get("public_url"),
        "duration": float(entry.get("duration_seconds", 0) or 0),
        "category": entry.get("category", ""),
        "description": entry.get("description", ""),
        "role": role or "",
        "volume_hint": ROLE_VOLUME_DEFAULTS.get(role or "", 0.5),
        "score": round(score, 4),
    }


SoundCatalog.find_by_intent = find_by_intent  # type: ignore[attr-defined]


def load_catalog(metadata_path: Optional[Path] = None) -> Optional[SoundCatalog]:
    """Load and classify sounds_metadata.json once per process."""
    global _CATALOG_CACHE
    if _CATALOG_CACHE is not None:
        return _CATALOG_CACHE

    path = metadata_path or _default_metadata_path()
    if not path.exists():
        print(f"[sound_catalog] metadata file not found at {path} — sound effects disabled")
        return None

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print(f"[sound_catalog] failed to load {path}: {e}")
        return None

    if not isinstance(data, list):
        print(f"[sound_catalog] expected a list at root of {path}, got {type(data).__name__}")
        return None

    catalog = SoundCatalog(data)
    stats = catalog.stats()
    total = len(data)
    classified_roles = sum(1 for n in stats.values() if n > 0)
    print(
        f"[sound_catalog] loaded {total} sounds, {classified_roles}/{len(ROLE_RULES)} roles populated: "
        + ", ".join(f"{r}={n}" for r, n in stats.items() if n > 0)
    )
    # Load semantic search sidecar if present — no-op when files are missing.
    catalog._load_embeddings(path)
    _CATALOG_CACHE = catalog
    return catalog


def reset_cache() -> None:
    """Test helper — reset the module-level cache so tests can reload."""
    global _CATALOG_CACHE
    _CATALOG_CACHE = None
