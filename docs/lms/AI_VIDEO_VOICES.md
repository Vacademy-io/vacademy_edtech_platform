# LMS AI Video — narration voices

The AI Video dialog lets staff pick the narration engine and voice, hear a
preview, and see what a minute of narration costs. Institute admins can save a
default voice that new videos use when the dialog picks nothing.

Code: `ai_service/app/routers/lms_video.py` (routes),
`ai_service/app/services/lms_voice_catalog.py` (catalogue, default, preview cache),
`ai_service/app/services/rest_tts.py` (Smallest / Navana / Sarvam / Edge REST → MP3),
`automation_pipeline._synthesize_voice_rest` (narration for a video).

## Engines

| id | Shown as | Key on ai-service | Billed (USD / 1K chars) |
|---|---|---|---|
| `edge` | Free | none | 0 (recorded, not charged) |
| `sarvam` | Sarvam | `SARVAM_API_KEY` | 0.036 (₹30 / 10K) |
| `smallest` | Smallest | `SMALLEST_API_KEY` | 0.025 |
| `navana` | Navana | `NAVANA_API_KEY` (comma-separated keys allowed) | 0.0144 (₹12 / 10K) |

Google is not offered: billing is off on its GCP project.
`credits_per_minute` = USD per 1K chars × 600 chars a minute (the estimator's
TTS baseline) × the live USD→credits ratio, to one decimal.

## API (`/lms-video/v1`, staff JWT + clientId)

- `GET /voices?language=English` →
  `{language, providers: [{id, label, description, available, unavailable_reason, credits_per_minute, voices: [{id, name, gender, accent, sample_url}]}], default, can_set_default}`.
  Providers are always in the order edge, sarvam, smallest, navana. An engine
  with no key, or with no voice for the language, has `available: false` and a
  reason. Bare "English" lists Indian, US and UK Edge voices.
- `POST /voices/preview {tts_provider, voice_id, language, text?}` → `audio/mpeg`.
  Without `text`, it plays a fixed sentence in that language; `text` can be up
  to 200 characters. Each preview is stored in the public bucket under
  `ai-videos/voice-previews/<sha256>.mp3` and served from there after that.
  Previews are not billed. Each institute can make 30 uncached previews per
  10 minutes on each pod, then gets `429 RATE_LIMITED`.
- `PUT /voices/default {tts_provider, voice_id, voice_gender?}`: admins only
  (ADMIN, ADMIN_NON_ROOT, SUPER_ADMIN); everyone else gets 403. Saved in
  `institutes.setting_json → setting.AI_VIDEO_DEFAULTS`.
- `DELETE /voices/default` clears it.
- `POST /estimate` and `POST /generate` accept `tts_provider`.
  - A `tts_provider` in the request always wins.
  - With neither `tts_provider` nor `voice_id`, the institute default applies.
  - Otherwise the old inference stays: a `…Neural` voice means free, any other
    voice means premium.
  - The estimate row reads `Narration (<engine>)`.
  - A voice that can't be used returns `422 INVALID_VOICE` or `422 VOICE_UNAVAILABLE`.

If Smallest or Navana fails during a video, that video's narration falls back
to Edge, as Sarvam's does, and billing records the engine that actually spoke.

## Deploy: `NAVANA_API_KEY` on ai-service

The ai-service deploy job sets `NAVANA_API_KEY` from the GitHub organization
secret of the same name, which holds the keys the voice bot uses. The repo is
public, so it can read organization secrets. If that secret is empty, the job
falls back to a k8s secret named `ai-navana-tts` when one exists. With neither,
the picker lists Navana as unavailable.

Each Navana key allows 2 concurrent streams, and the voice bot shares the
same keys. ai-service keeps itself to 2 streams per key on each pod and
retries when Navana refuses for concurrency. A busy calling campaign can still
slow Navana narration down, and in the worst case push it to the Edge fallback.
