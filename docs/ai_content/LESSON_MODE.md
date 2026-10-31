# Lesson mode — education videos taught by a teacher at a board

Lesson mode turns an AI video into a class: the board builds up while a teacher
explains it, and (optionally) a Spatius avatar teacher stands beside the board.

```jsonc
// POST /external/video/v1/generate — request body excerpt
"lesson": {
  "teacher": { "avatar_id": "<Spatius avatar id>", "title": "Maths teacher" }, // omit = board-only lesson
  "layout": "corner",          // corner | bubble | side | presenter | board | auto
  "subject": "Mathematics",
  "include_worked_example": true,
  "include_recap": true
}
```

`lesson` and `host` cannot be combined (the request is rejected with a clear message).

## What changes in the pipeline

| Stage | Without lesson | With lesson |
|---|---|---|
| ShotPlanner | reel rhythm: body shots 2.5-4 s, max 12 shots | lesson pacing: 6-20 s sections, ~target/11 sections, no cap; hook → prerequisite → concepts → worked example → common mistake → recap |
| Shot fields | — | `teacher_layout` per shot (planner picks on `auto`; user-fixed layout wins; garbage repaired deterministically) |
| NarrationWriter | narrator / ad voice | teacher voice (step by step, points at the board, reads numbers out) |
| Per-shot HTML | — | "lesson board" rules (build up, dim don't remove, KaTeX, learner text sizes) + the teacher's safe area for that layout |
| Templates | may bypass the LLM | never for a section with the teacher on screen |
| Timeline | — | `snippet-teacher-N` overlay entries (z=500), one per run of sections sharing a layout |

Code: `ai-video-gen-main/lesson_mode.py` (pure rules), `lesson_teacher.py` (Spatius + ffmpeg),
`app/services/lesson_plan_service.py` (request validation).

## The teacher track (Spatius Video API)

1. Right before per-shot HTML generation (the voice track is final; music is mixed later) a
   background thread uploads the voice WAV and submits ONE Spatius job for the whole narration
   (`POST https://console.spatius.ai/v1/open/videos`, green `#00B140` background, 1920×1080 contain).
2. It polls `GET /v1/open/video-jobs/{id}`, downloads the MP4 at once (the signed link lives ~15 min),
   measures where our voice sits in it (envelope cross-correlation; measured +0.20 s) and the
   teacher's bounding box.
3. Still in the background, it pre-cuts one transparent VP9 WebM per layout run (crop → scale →
   chromakey → despill), using the TTS-reconciled shot times.
4. At timeline time the final runs reuse those clips (same layout, start within 80 ms; only the last
   section can stretch, covered by a 1 s tail) and become overlay entries. The renderer seeks
   `<video>` elements inside `snippet-*` hosts frame by frame, so no renderer change was needed.

Measured: a 160 s lesson rendered in 172 s at Spatius. Only one Spatius job runs at a time per
app — a second POST gets 429, so `submit_video` waits for the slot (up to 25 min).
Render worker: its "seekable" re-encode of sparse-keyframe stock clips used CRF 18 (a 37 MB Pexels
clip became 80-110 MB) and Chrome crashed mounting it — found while testing the first lesson. It now
encodes at CRF 23 capped at 6 Mbit/s.

If anything fails, the lesson ships board-only and the run gets a warning
("Lesson teacher unavailable…") instead of failing.

## Layouts (landscape 1920×1080; portrait maps side/presenter to a bottom band)

| layout | teacher box | board area |
|---|---|---|
| corner (UI default) | bottom-right 422×454 cut-out, no panel | whole frame except that corner |
| bubble | bottom-right 270 px circle, accent ring | whole frame except that corner |
| side | right 480 px panel, bust 480×640 | left 1440 px |
| presenter | right 690 px panel, bust 690×842 | left 1230 px (title + one key line; hook only) |
| board | none | whole frame |

Sizes were cut after the first production lesson (side was 640 px, presenter 960 px): the teacher
crowded the board and was drawn larger than the Spatius render, so the face looked soft. Every layout
now scales the avatar down (crop ≥ clip size, asserted in tests).

The panel colour is derived from the run's board palette.

**Board canvas.** For `side` / `presenter` runs the shot's timeline box is resized to the board area
(`lesson_mode.fit_shots_to_board`) and the per-shot prompt says the canvas is that size, so
`#shot-root` (100% × 100%, overflow hidden) lays out beside the teacher instead of running under the
panel. `corner` keeps the full frame. The QA screenshots (bbox lint, vision review, best-of-N judge)
use the same board canvas (`_lesson_canvas`), so they judge the layout the viewer gets. `presenter`
is for the hook / short "why it matters" moments only — a 960 px board is too narrow for lists.

**Caption band.** Every lesson has a band under the board (22% of the height landscape, 12% portrait,
above a portrait teacher band) in the panel colour; captions are centred in it (`caption_box.cy`,
left of a corner/bubble teacher). Every lesson shot's canvas is the board area ABOVE the band
(`fit_shots_to_board` + `_lesson_canvas`), so nothing a shot draws can reach the captions — the earlier
prompt-only "keep the bottom strip clear" was ignored by hook shots.

**Board checks (every tier, lesson only).** The bbox lint gets keep-out zones — the teacher's
corner/bubble (+16 px) — plus a squeezed-text check (multi-line text narrower than ~2.5 characters), and the render worker reports any visible
text/media inside one (`zone`), which drives the usual single corrective regen. After it, a notation
lint (Unicode subscript digits while the teacher says "squared") plus one model fact-check of the
board's formulas / numbers against the narration (`lesson_mode.FACT_CHECK_SYSTEM`, vision_review stage
model) trigger one corrective regen on a definite error. The vision review's severity-3 regen (off on ultra) is always on for lessons.

**Captions.** Each teacher entry carries `entry_meta.caption_box`; while it is on screen
`generate_video.py` re-centres the caption pill on the board side (landscape) or lifts it above the
teacher band (portrait). The editor's live preview still shows captions full-width.

## Cost

* Vendor: 50 Spatius credits per generated minute ≈ $0.045/min.
* Institute: **8 credits per started minute** of narration (1 credit = $0.01), charged once per video
  after the HTML stage (`request_type=avatar_video`, `model=spatius/video`, idempotency key
  `{video_id}:lesson-teacher`). The cost preview shows the same row.
* For comparison, the fal Kling host costs ≈ $3.37 per on-screen minute.

## Teachers

The avatar must be a ready Spatius row in `tutor_asset_registry` visible to the institute — platform
stock or its own — i.e. the same list `GET /tutor/options` gives the AI tutor. Custom teachers are
created from one photo there (≈ $25 one-time at the vendor).
