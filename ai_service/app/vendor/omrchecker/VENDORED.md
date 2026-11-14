# Vendored OMRChecker

- Upstream: https://github.com/Udayraj123/OMRChecker (MIT, see `LICENSE`)
- Commit: `5cf44a5a9c7a49e2e541c6e19aefd09a41a4d494` (2026-09-04)
- Copied: `src/` without `src/tests/`

Used only by `app/services/omr/` to read the OMR sheets that assessment_service
generates. It is imported inside a spawned worker process with this folder on
`sys.path`, because upstream uses absolute `src.*` imports and keeps module-level
state (`ImageInstanceOps.save_img_list`, the processor registry, a `logging.basicConfig`
call). Nothing here is imported by the main ai_service process.

## Local patches

Keep this list complete. Re-apply it when bumping the commit.

1. `src/utils/interaction.py`: `screeninfo.get_monitors()[0]` at import time raises
   on a headless server, so it is wrapped in a try/except with a fixed 1920x1080
   fallback. Image windows are never opened (`show_image_level` is 0).

Nothing else is changed. The reader's thresholds are not patched. The per-bubble
confidence that assessment_service needs is computed in `app/services/omr/reader.py`
by calling the same `get_global_threshold` / `get_local_threshold` methods on the
same image.
