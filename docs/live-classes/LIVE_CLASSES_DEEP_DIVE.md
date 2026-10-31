# Live Classes — Architecture Deep Dive

**Scope:** Everything the Vacademy platform does around *live classes* (admin-scheduled broadcast classes) and the closely related *1:1 booking / mentorship meeting* subsystem: data model, scheduling, recurrence, provider integrations (Zoom, Google Meet, BBB / "Vacademy Meet", Zoho Meeting, YouTube), join flows, attendance, recordings, past sessions, content linking, notifications, payments, settings, and both frontends.

**Status:** This is a *verified technical inventory* — every file path, table, column, endpoint and cron referenced below was read from the codebase on 2026-09-19. Where a feature is still a plan (not yet implemented) it is marked ⚠️ PLAN with a pointer to the source plan doc.

**Companion docs (same repo):**

- `docs/live-classes/LIVE_CLASS_PAST_SESSIONS_AND_CONTENT_LINKING_PLAN.md` — Track A (learner Past sessions) + Track B (teacher content linking). **Both tracks are now IMPLEMENTED** (the heading still says "PLAN" but the code exists — see §10 and §11 below).
- `admin_core_service/LIVE_SESSION_ADMIN_INTEGRATION.md`, `LIVE_SESSION_FRONTEND_INTEGRATION_GUIDE.md`, `LIVE_SESSION_LEARNER_INTEGRATION.md`, `LIVE_SESSION_SEARCH_API_DOCUMENTATION.md`, `LIVE_SESSION_SCHEDULE_UPDATE_FIX.md`
- `docs/live-classes/LIVE_SESSION_RECORDING_AUTO_LINK_PLAN.md` (referenced from code; auto-link is implemented).

---

## 1. Where the code lives

| Concern | Path |
|---|---|
| Backend (single source of truth) | `vacademy_platform/admin_core_service/.../features/live_session/` |
| Shared meeting DTOs (provider-agnostic) | `vacademy_platform/common_service/.../common/meeting/dto|enums/` |
| Admin dashboard | `vacademy_platform/frontend-admin-dashboard/src/routes/study-library/live-session/` |
| Admin settings service | `vacademy_platform/frontend-admin-dashboard/src/services/live-session-settings.ts` |
| Learner dashboard | `vacademy_platform/frontend-learner-dashboard-app/src/routes/study-library/live-class/` |
| Public/guest registration | `vacademy_platform/frontend-learner-dashboard-app/src/routes/register/live-class/` |
| Flyway migrations | `admin_core_service/src/main/resources/db/migration/V*.sql` |

### Backend package layout (`features/live_session/`)

```
constants/        — email bodies, notification constants
controller/       — admin CRUD, lists, attendance, bookings, content-link, payment, guest
disclaimer/       — per-session learner disclaimer (video) controller/service/dto
dto/              — ~60 request/response DTOs (incl. Learner* DTOs for past sessions)
entity/           — 10 JPA entities (see §3)
enums/            — LinkType, LiveSessionStatus, RecurringTypeEnum, SessionLog, etc.
provider/         — the provider-abstraction layer (see §5) — MANAGERS, services, controllers,
                    schedulers, security, entities (configs + BBB server pool)
repository/       — Spring Data + custom native-query repos
scheduler/        — Quartz-backed notification jobs
service/          — orchestration (~25 services incl. Step1/Step2, past-session, content-link)
util/             — TimezoneNormalizer, GuestFormFieldResolver
```

---

## 2. Two distinct product surfaces (don't conflate them)

The code models **two different things** that both use provider meetings:

1. **Live classes (`live_session` + `session_schedules`)**
   - Admin/teacher broadcasts to a **batch** (`source_type='BATCH'` → `source_id` = *package_session_id*) or to **individual users** (`source_type='USER'`).
   - Can be **ONE-TIME** or **RECURRING** (weekly/monthly).
   - Public (guest registration + optional paid) or private (enrolled only).
   - This is what this document mostly covers.

2. **1:1 bookings / mentorship meetings (`booking_page`, `booking_types`, `meeting_bookings`)**
   - Mentor/booking-page based, per-attendee meeting slots with availability checks, reschedule/cancel.
   - Separate entities (`BookingPage`, `BookingType`), services (`BookingManagementService`, `MeetingBookingService`), controllers (`BookingController`).
   - Often runs on **Google Meet** (`location_type='GOOGLE_MEET'`) with `allocate_google_meet` minting a fresh space per booking.
   - Covered briefly in §12.

The `live_session.source` / `source_id` columns are **booking-type** linkage, *not* how batches/learners are attached to live classes — see §3 note.

---

## 3. Data model

### 3.1 `live_session` — the session template (one per class/series)

Entity: `entity/LiveSession.java` · status `DRAFT | LIVE | DELETED` (`enums/LiveSessionStatus.java`)

Key fields:

| Column | Notes |
|---|---|
| `id` | UUID (Hibernate `@UuidGenerator`) |
| `institute_id` | owner |
| `title`, `description_html`, `subject`, `cover_file_id`, `thumbnail_file_id` | content |
| `status` | DRAFT / LIVE / DELETED |
| `access_level` | `private` (default) / `public` (`V21`, `LiveSessionAccessEnum`) |
| `meeting_type`, `link_type`, `default_meet_link`, `waiting_room_link` | platform/join metadata |
| `start_time`, `last_entry_time` | template-level times (schedules are authoritative per-occurrence) |
| `waiting_room_time`, `waiting_room_type` | `WAITING_ROOM | PRE_JOINING` (`V326`, `WaitingRoomTypeEnum`) |
| `learner_button_config` (TEXT) | single object **or** array of `{text,url,background_color,text_color,visible}` action buttons under the player |
| `registration_form_link_for_public_sessions` | public signup URL |
| `notification_email_message`, `attendance_email_message` | copy |
| `allow_play_pause` | boolean |
| `timezone` | session timezone (authoritative for is-past calc) |
| `source`, `source_id` | **booking-type** linkage (NOT batch/learner link) |
| `require_email_verification`, `require_phone_verification`, `whatsapp_otp_template_name` | public-signup contact verification (`V402`, `V403`) |
| `bbb_config_json` (TEXT) | BBB settings (record, muteOnStart, webcamsOnlyForModerator, guestPolicy) (`V160`) |
| `feedback_config_json` (TEXT) | post-session learner feedback (`V216`) |
| `zoom_account_id`, `zoom_config_json` (TEXT) | pinned Zoom account + meeting settings for provisioning retry (`V317`) |
| `recording_auto_link_json` (TEXT) | auto-link new recordings → chapters (`V398`) |
| `audience_push_config_json` (TEXT) | push public registrants → audience lists (`V414`) |
| `attendance_criteria_json` (TEXT) | min-attendance rule stamped at create (`AttendanceCriteriaService`) |

**JsonConfig pattern:** live-session feature flags use TEXT-JSON columns on `live_session` (`bbb_config_json`, `feedback_config_json`, `zoom_config_json`, `recording_auto_link_json`, `audience_push_config_json`, `attendance_criteria_json`) rather than separate tables — the `CreateMeetingRequestDTO.providerConfig` map is the provider-neutral evolution of the earlier `bbbConfig`/`zoomConfig` maps (deprecated but still honored).

### 3.2 `session_schedules` — one row per occurrence

Entity: `entity/SessionSchedule.java` (migration `V125` + `V316`)

| Column | Notes |
|---|---|
| `id` | UUID — **the stable key for everything** (recordings, attendance, past-session cards) |
| `session_id` | → `live_session.id` |
| `recurrence_type` | `ONCE | RECURRING | WEEKLY | MONTHLY` (`RecurringTypeEnum`) |
| `recurrence_key` | day-of-week (`MONDAY`…) / week-of-month — ties the row to a day pattern |
| `meeting_date` (DATE, nullable at step1), `start_time` (TIME), `last_entry_time` (TIME) | wall-clock occurrence window |
| `link_type` | `zoom` / `google meet` / `zoho` / `youtube` / `bbb` / `other` (lowercased for FE matching — see §13) |
| `custom_meeting_link` | join URL |
| `default_class_link` / `default_class_name` / `default_class_link_type` | hosted-class passthrough (`V110`,`V112`) |
| `custom_waiting_room_media_id`, `thumbnail_file_id`, `daily_attendance` | misc |
| `status` | occurrence lifecycle (`DELETED` excludes it) |
| `provider_meeting_id` | provider meeting key (Zoom meeting ID, BBB meetingID, GMeet `spaces/{id}`, Zoho meetingKey) |
| `provider_host_url` (TEXT) | presenter-only URL (kept separate from join URL) |
| `provider_recordings_json` (TEXT) | **cached JSON array of `MeetingRecordingDTO`** — the recordings source of truth |
| `last_attendance_sync_at`, `last_recording_sync_at` | provider pull timestamps |
| `bbb_server_id` | BBB pool server this meeting lives on |
| `provider_account_id` | → `institute_live_session_provider_mapping.id` — pins which provider-account created/owns it |
| `provider_passcode` | plain meeting passcode (for SDK `client.join({password})`) |

> **Invariant:** `provider_meeting_id` changes whenever a provider meeting is recreated; **`schedule_id` is stable**. Key every external reference (recordings, attendance, past cards, content-link idempotency) on `schedule_id`.

### 3.3 `live_session_participants` — who the class is for

Entity: `entity/LiveSessionParticipants.java` · enum `LiveSessionParticipantsEnum` = `USER | BATCH`

| Column | Notes |
|---|---|
| `session_id` | → `live_session.id` |
| `source_type` | `BATCH` or `USER` |
| `source_id` | **for `BATCH`: the package_session_id**; for `USER`: the user id |

> ⚠️ The plan doc (section 0) flags this explicitly: *"Batch/user linkage is via `live_session_participants` (NOT `live_session.source/source_id`)."* `live_session.source/source_id` are reused for booking-type linkage.

Performance indexes in `V86__Add_live_session_performance_indexes.sql` (70–85% query win for `/learner/live-and-upcoming`): composite + partial indexes on `(source_type, source_id, session_id)`, `meeting_date/start_time/session_id where status != 'DELETED'`, etc.

### 3.4 `live_session_logs` — attendance + engagement

Entity: `entity/LiveSessionLogs.java` · `log_type` from `enums/SessionLog.java` (`ATTENDANCE_RECORDED`, `ON_CREATE_REMAINDER`, `BEFORE_REMAINDER`, `ON_LIVE_REMAINDER`, `FEEDBACK_SUBMITTED`, …)

| Column | Notes |
|---|---|
| `session_id`, `schedule_id` | occurrence |
| `user_source_type` / `user_source_id` | `USER`(+userId) / `GUEST`(+guestId) |
| `log_type`, `status` (`PRESENT`/`ABSENT`), `details` | |
| `status_type` | `ONLINE` (joined via app/BBB) vs `OFFLINE` (admin manual mark) |
| `engagement_data` (TEXT) | flat JSON of integers `{chats,talks,talkTime,raisehand,emojis,pollVotes}` + optional `activeness*` keys (§8b) |
| `provider_meeting_id` | the specific meeting instance (changes on recreate) |
| `provider_join_time` (ISO-8601), `provider_total_duration_minutes`, `provider_total_duration_seconds` | provider-reported presence (`V125`, `V471`) |
| `attendance_evaluation_json` (TEXT) | audit of the min-attendance criteria verdict (verdict, reason, attendedMinutes, scheduledMinutes, requiredMinutes, thresholdPercent, previousStatus, evaluatedAt) |

### 3.5 Provider config + BBB pool (`provider/entity/`)

- **`LiveSessionProviderConfig`** → table `institute_live_session_provider_mapping` (`V125`): `institute_id`, `provider` (`ZOHO_MEETING | ZOOM | MS_TEAMS | GOOGLE_MEET | BBB_MEETING`), `vendor_user_id` (per-organizer), `config_json` (JSON blob of credentials), `status` (`ACTIVE`). Unique `(institute_id, provider)`; per-organizer rows carry `vendor_user_id`. OAuth refresh tokens are **AES-encrypted** inside `config_json` (Google/Zoom).
- **`BbbServerPool`** → `bbb_server_pool` (`V192`): multi-server BBB pool with `api_url`, `secret`, priority. `BbbServerRouter` does sequential-fill routing; per-institute custom domain (`institutes.live_session_base_url`, `V470`) rewrites **join URLs only**, never control-plane calls, and only for the **primary** server.
- **`AppConfig`** → generic app config values.

### 3.6 `live_session_content_links` — Track B (content linking)

Entity `entity/LiveSessionContentLink.java` · migration `V367__Create_live_session_content_links.sql`:

```
id, session_id NOT NULL, schedule_id?, recording_id?,
content_type NOT NULL (RECORDING|MATERIAL_PDF|MATERIAL_VIDEO),
slide_id NOT NULL, chapter_id NOT NULL, package_session_id NOT NULL,
created_by_user_id?, status (ACTIVE default), created_at, updated_at
UNIQUE (schedule_id, recording_id, chapter_id) WHERE recording_id IS NOT NULL
```

- One row per **created slide** per **package_session destination**. One recording added to N chapters → N rows; a chapter **shared** across package sessions → one slide, still one row per destination.
- Doubles as: idempotency guard ("already added"), UI state source (`GET /links`), and material history.
- `DELETE /link/{id}` soft-deletes the row and sets the slide's `chapter_to_slides.status=DELETED`.

### 3.7 Bookings (separate subsystem)

- `booking_page` (`features/booking/entity/BookingPage.java`): timezone, `location_type` (`GOOGLE_MEET | CUSTOM_LINK | IN_PERSON | PHONE`), `allocate_google_meet`, single `duration_minutes` or `session_types_json` list (`V418`).
- `booking_types` (`entity/BookingType.java`): `type`, unique `code` (e.g. `SCHOOL_VISIT`, `ENQUIRY_MEETING`), institute-scoped or global.
- `meeting_bookings` + availability/reschedule/cancel handled by `BookingManagementService` / `MeetingBookingService`.

### 3.8 Course-content hierarchy (Track B destination)

`PackageSession → Subject → Module → Chapter → Slide` via mapping tables: `subject_session`, `subject_module_mapping`, `module_chapter_mapping`, `chapter_package_session_mapping` (chapter can be **shared/reference-copied** across package sessions), `chapter_to_slides` (slide order + status). `Slide` = generic row (`source_type`/`source_id`) → `video` (`VideoSlide`), `document_slide`, etc. Track B creates slides through the canonical `SlideService` path.

---

## 4. Scheduling & recurrence

### enum `RecurringTypeEnum` = `ONCE | RECURRING | WEEKLY | MONTHLY`

Admin FE (`-constants/enums.ts`) uses `RecurringType` = `once | weekly | monthly` and composes schedules by **weekday** (`WEEK_DAYS`). The backend (`Step1Service`) fans a recurring spec out into **N `session_schedules` rows** — one per concrete occurrence date/time — between a start date and a session end date.

Key behaviours (all in `service/Step1Service.java`):

- **Create mode:** `handleAddedSchedules` generates the occurrence rows; each carries `recurrence_key` = its weekday so later edits can address rows by day.
- **Edit mode (`session_id` present):** `handleScheduleUpdatesForExistingSession` is deliberately careful —
  1. explicit deletions first (`handleDeletedSchedules`),
  2. separate **past vs future** schedules (`meetingDate > today`),
  3. **day-pattern changes** → delete future rows for removed days,
  4. **end-date / start-date changes** → delete future rows before/after the new bounds,
  5. per-day loop creates/updates occurrences, keyed by (`recurrence_key`, `start_time`) to support **multiple time slots on one day**.
- `wouldStealProviderMeeting()` guard: refuses to re-point a provider-managed occurrence at a *different* meeting of the *same* provider during edit (the recurring-edit foot-gun where host and learners ended up in different rooms).
- `fireWorkflow=false` overload lets `BulkLiveSessionService` defer the `LIVE_SESSION_CREATE` workflow trigger (async after return).

**Last-entry time** is derived: `start_time + durationMinutes`.

### Two-step admin schedule flow

- `POST /live-sessions/v1/create/step1` (`LiveSessionController` → `Step1Service`) — session core + occurrence fan-out.
- `POST /live-sessions/v1/create/step2` (`Step2Service`) — registration custom fields, batch/user participant linkage, notification config, feedback config, **attendance-criteria stamping** (copies the institute default into `attendance_criteria_json`, only on create, never on edit), `recording_auto_link_json`, `audience_push_config_json`, and fires notifications.
- `POST /live-sessions/v1/create/bulk` (`BulkLiveSessionService`) — CSV-driven batch creation (`bulkSchema.ts`, `BulkCsvImportDialog.tsx`).

---

## 5. Provider integrations (the strategy layer)

### 5.1 Abstraction

`provider/LiveSessionProviderStrategy.java` defines the contract every vendor implements:

```java
CreateMeetingResponseDTO createMeeting(CreateMeetingRequestDTO, instituteId);
List<MeetingRecordingDTO> getRecordings(providerMeetingId, instituteId);
List<MeetingAttendeeDTO>  getAttendance(providerMeetingId, instituteId);
UserScheduleAvailabilityDTO checkUserAvailability(...);
LiveSessionProviderConfig   connectProvider(...);       // OAuth / API-key
default LiveSessionProviderConfig connectSdkProvider(...)  // SDK join providers
default ParticipantJoinLinkDTO getParticipantJoinLink(...)  // URL-join providers
default boolean supportsSdkJoin();        // embedded SDK signature join
default boolean supportsMultiAccount();   // multiple per-institute accounts
default boolean supportsWebhooks();       // provider pushes events
String getProviderName();
```

`LiveSessionProviderFactory` auto-discovers every `LiveSessionProviderStrategy` Spring bean and keys it by `MeetingProvider` (`common_service .../common/meeting/enums/MeetingProvider.java` = `ZOHO_MEETING | BBB_MEETING | ZOOM_MEETING | GOOGLE_MEET`). `MeetingProvider.fromString()` normalizes `zoom`, `google`, `gmeet`, `google_meet`, `google meet`, `bbb`, `zoho` (the wizard persists `link_type="google meet"`).

### 5.2 Provider matrix

| Provider | Manager | Join model | Accounts | Webhook | Recording sync | Notes |
|---|---|---|---|---|---|---|
| **Zoom** | `ZoomMeetingManager` (604 L) | **embedded Meeting SDK** (signature) — `supportsSdkJoin()` | multi (`ZoomAccount`) | ✅ `recording.completed` + URL-validation challenge, HMAC `x-zm-signature` | webhook + hourly poll + S3 rescue | create-upfront; `zoom-sdk-signature` issues signed JWT + passcode |
| **Google Meet** | `GoogleMeetManager` (369 L) | **URL-join** (no SDK) — `getParticipantJoinLink` | multi (`GoogleAccount`, per-mentor supported) | ✅ Workspace Events API → Pub/Sub push (`recording.v2.fileGenerated`, `conference.v2.ended`) | push (optional) + hourly poll (source of truth) | meeting = REST `spaces`; one durable space per occurrence |
| **BBB ("Vacademy Meet")** | `BbbMeetingManager` (1238 L) | **URL-join** | platform-wide / per-institute `configJson` | callbacks (analytics/attendance) | self-hosted; post-publish S3 mirror | lazily created on first join (unlike Zoom/Zoho); server pool + custom domain |
| **Zoho Meeting** | `ZohoMeetingManager` (509 L) | **SDK or URL-join** (SDK credentials variant) | institute + per-organizer (`zohoUserId`) | — | hourly pull | legacy first provider; `provider_meeting_id`=meetingKey |
| **YouTube** | (no manager — link/embed passthrough) | embed `YouTubePlayerWrapper` / `isLiveYouTubeSession` | n/a | n/a | n/a | `LinkType.YOUTUBE`; public/private preview |

**Provider onboarding (OAuth):**
- `ZoomOAuthController` (`/zoom/oauth/initiate` → `/callback`): authorization-code, CSRF `state` in `oauth_connect_state`, `InstituteAccessValidator` + admin-role gate; callback is PUBLIC.
- `GoogleOAuthController`: mirror flow; can be **per-mentor** (`st.getMentorId()` → link to `mentor.google_account_id`).
- `ZoomAccountController` / `GoogleMeetAccountController`: CRUD for the multi-account stores; `ZoomTestConnectionResponse` / `GoogleTestConnectionResponse` for connectivity checks.
- `GoogleEventsSubscriptionService` manages the Pub/Sub subscription for the Events API.

### 5.3 Provisioning (meetings are created up-front, per occurrence)

`ProviderMeetingBatchService` (an `@Async` bean, separate so each occurrence gets its own transaction):

- Fans out to **one provider meeting per `session_schedules` row** — never one native recurring meeting — so each occurrence is independently addressable for attendance/recordings with no occurrence-cap or date-alignment coupling.
- **Idempotent:** skips rows that already have `provider_meeting_id`, so a re-call fills only gaps.
- Derives each occurrence's ISO start time (`toIsoStartTime`, in the session timezone) and duration (`deriveDurationMinutes`: start→last-entry window, fallback request, then 60m).
- `rememberProvisioningConfig()` persists `zoom_account_id` + `zoom_config_json` onto `live_session` so the retry job can recover without re-asking the UI.
- **Recovery:** `ZoomMeetingProvisionRetryProcessor` runs every 5 min, re-runs the idempotent batch for sessions with un-provisioned occurrences (stale > 10 min, within 7-day lookback).
- BBB differs: meetings are **lazily created on first join**; `LiveSessionProviderController` protects fresh rooms with a `RECREATE_GRACE_MS = 90s` window so "not running yet" never reads as "ended".

### 5.4 Join authorization (server-side, role derived)

`provider/security/LiveSessionJoinAuthorizer` + `JoinAuthorization`:

- Enrolment + institute isolation enforced server-side.
- **Role is DERIVED** (creator/admin → `HOST`) — a client cannot request `role=1`.
- `ZoomSdkController` (`/zoom-sdk-signature`) and `GoogleMeetJoinController` (`/google-meet-join`) both go through it, return 409 while a meeting is still provisioning, and mark attendance at the authenticated join touchpoint.

---

## 6. Learner join experiences (frontend)

Learner embed route: `frontend-learner-dashboard-app/.../live-class/embed/index.tsx` + `embed/-components/`.

| Payload / provider | Component | Join path |
|---|---|---|
| Zoom SDK | `ZoomMeetingSdkPlayer.tsx` | `zoom-sdk-signature` → Meeting SDK; native fallback via `zoommtg://` deep link (`ZoomEmbedPlayer` for web client) |
| Google Meet | `GoogleMeetLauncher.tsx` | `google-meet-join` (authz + attendance) → open `meetingUri` (web new-tab / Capacitor Browser native) |
| BBB | `bbb-join` util (`lib/live-class/bbb-join.ts`) | URL-join as VIEWER/host; open in new tab/app |
| Zoho | `ZohoEmbedPlayer.tsx` | embed player |
| YouTube | `YouTubePlayerWrapper` + `isLiveYouTubeSession()` | live/recorded embed |

**Waiting room** (`live-class/waiting-room/index.tsx` + countdown/background-music): shown when `waiting_room_type=WAITING_ROOM`; `PRE_JOINING` skips it and joins directly during the pre-start window.

**Guest/public flow** (`register/live-class/`): public registration form (custom fields, OTP verification via `OtpVerificationDialog`, phone-as-identity `V402`), session login, then join. Paid sessions gate join on `payment_status=PAID` (see §9). Guest BBB join is `GuestController` `/guest/join` (VIEWER role, random guest id, host-must-start-first gate).

**Past-session playback** (§11) reuses `RecordingPlayerDialog` and the provider sanitization matrix (S3 → in-app `CustomVideoPlayer`, YOUTUBE → `YouTubePlayerWrapper`, ZOOM_CLOUD/BBB → new-tab + copyable passcode).

---

## 7. Recordings

**Source of truth:** `session_schedules.provider_recordings_json` — a cached JSON array of shared `MeetingRecordingDTO` (`common_service .../common/meeting/dto/MeetingRecordingDTO.java`):

```
recordingId, downloadUrl, playbackUrl, durationSeconds, startTime,
providerMeetingId, fileId (=> S3-mirrored), type (content|webcams|full),
bbbInternalId, youtubeVideoId, youtubeVideoUrl,
expiresAt (Zoom 30-day cloud auto-delete), passcode,
recordingStorage (ZOOM_CLOUD | S3)
```

**Sync strategy per provider** (webhook is primary, hourly poll is the backstop — never lose a recording):

| Job | Cron | Purpose |
|---|---|---|
| `ZoomRecordingSyncProcessor` | hourly `:17` | poll Zoom cloud recordings for ended meetings the webhook missed |
| `GoogleMeetRecordingSyncProcessor` | hourly `:27` | poll Meet `conferenceRecords` (source of truth when Events API offline) |
| `ZoomRecordingS3SyncProcessor` | every 6h `:37` | **near-expiry rescue** — mirror Zoom cloud → S3 within `zoom.recording.s3.rescue-within-days` (default 5) |
| `RecordingCleanupProcessor` (Quartz) | daily | delete BBB recordings older than 14 days **from BBB only**; S3 copies stay |
| `ZoomMeetingProvisionRetryProcessor` | every 5 min `:02` | recover interrupted async meeting provisioning |

Webhooks:

- `ZoomWebhookController` `/zoom-callback/{accountId}` — tenant-scoped; raw-body HMAC via `x-zm-signature` + `x-zm-request-timestamp`; URL-validation challenge encrypted per-account; 500 → Zoom retries.
- `GoogleMeetWebhookController` `/google-meet-callback` — Cloud Pub/Sub PUSH; optional `?token=` shared secret; keys the space from `ce-subject` (`//meet.googleapis.com/spaces/{id}`); always 200 (poll is the backstop).

**Recording ↔ S3 mirroring:** `ZoomRecordingS3Service.mirrorToS3()` and the manual "Sync to S3" admin affordance set `fileId`, switch `recordingStorage=S3`, and clear `expiresAt` (permanent).

**Auto-link (⚠️ implemented, referenced as `LIVE_SESSION_RECORDING_AUTO_LINK_PLAN.md`):** `RecordingAutoLinkService.processSchedule()` runs after every recording sync; if the session's `recording_auto_link_json` is enabled with destinations, it reuses `LiveSessionContentLinkService` to drop each new recording into the configured chapters (idempotent via the `(schedule_id, recording_id, chapter_id)` unique index). Notify-learner is governed solely by the institute-level "Notify on auto-upload" setting.

---

## 8. Attendance

**Two marks:** `ONLINE` (learner joined via app/BBB — auto-tracked at the join touchpoint) vs `OFFLINE` (admin manually marked). Stored in `live_session_logs` with `status` `PRESENT`/`ABSENT`.

**Endpoints** (`controller/LiveSessionAttendance.java`, `/admin-core-service/live-session`):
- `POST /mark-attendance` — learner self-mark (authenticated).
- `POST /mark-guest-attendance` — open endpoint.
- `POST /admin-mark-attendance` — admin batch mark → `OFFLINE`.

**Provider-sourced attendance (post-hoc sync):**
- BBB: `LiveSessionProviderController` ingests `BbbAnalyticsCallbackDTO` (join/leave/engagement) and merges engagement JSON by summing counters; grows `provider_total_duration_minutes` and sets `PRESENT`+`ONLINE` when the provider observed presence.
- Zoom: `ZoomAttendanceService`; Google: `GoogleAttendanceService` (join-touchpoint marking + hourly reporting pulls).
- Institute Pulse treats `ZOOM`, `GOOGLE`, `GOOGLE_MEET` as `SYNCED_PROVIDERS` — attendance lands only post-hoc via sync, not at join time.

**Minimum-attendance criteria** (`AttendanceCriteriaService` + `AttendanceCriteriaEvaluator`):
- Institute default `LIVE_SESSION_SETTING.defaultAttendanceCriteria` (`{enabled, minDurationPercent}`) is **stamped onto the session at create** into `attendance_criteria_json` — a class is judged by the rule in force when scheduled, never re-decided later.
- Disabled/null → the join click alone decides attendance.
- `live_session_logs.attendance_evaluation_json` persists the verdict + reason (attendance is disputed data — an absence must stay explainable).

**Reports** (`controller/AttendanceReport.java`, `/admin-core-service/live-session-report`): `/by-session-id`, `/by-batch-session`, `/all-attendance` (paged), `/public-registration`, `/student-report` (`userId&batchId&startDate&endDate`, honors `daily_attendance`), `/feedback/search`, `/feedback/subjects`.

---

## 8b. Activeness score (BBB, opt-in)

An **on-device camera attention score** for BBB learners, computed in the browser by the `vacademy-activeness` BBB HTML5 plugin (MediaPipe) — no video leaves the device; only a per-session summary is POSTed back.

- **Setting:** `bbb_config.activeness_score` (boolean, default `false`) → `BbbConfigDTO.activenessScore`. The DTO is typed, so the key must stay declared there or it never reaches `live_session.bbb_config_json`.
- **Plugin load (meeting create):** `BbbMeetingManager.createMeeting` adds `<bbb host>/plugins/vacademy-activeness/manifest.json` to `pluginManifests` (alongside PiP, or alone) when the setting is on **and** a token secret exists **and** the kill-switch `bbb.plugins.activeness.enabled` (default `true`) is on. Host = the institute's live-class domain, like PiP.
- **Token (join):** `/meeting/join` mints a token only for **VIEWER** joins on an opted-in session (never MODERATOR; guest joins and `participant-join-link` get none). `BbbActivenessTokenService`: `v1.<b64url(scheduleId:userId:exp)>.<b64url(HMAC-SHA256)>`, 24 h TTL. Secret `bbb.activeness.token-secret` → falls back to `internal.service.token` / `ai.service.internal.token`; blank = feature off. Sent as BBB user metadata `userdata-vacademy_activeness` + `userdata-vacademy_activeness_url` (= `bbb.callback.base-url` + the report path), added outside the theme branch so it applies to every institute.
- **Report:** `POST /admin-core-service/live-sessions/provider/meeting/bbb-activeness` (permitAll, no JWT — authenticated by the token in the body, which fixes schedule + learner). Any content type (plugin uses `text/plain` + `sendBeacon` to avoid CORS preflight). Body `{token, avg, on_screen, attention, seconds, away_count, away_seconds, final}`; values clamped (scores 0–100, seconds ≤ 43 200, away_seconds ≤ seconds). `401` bad/expired token · `400` malformed / missing `avg`/`seconds` · `413` > 4 KB · `204` otherwise (also when nothing was updated).
- **Storage:** one atomic native UPDATE (`LiveSessionLogsRepository.mergeActivenessReport`) jsonb-merges **flat integer** keys `activeness`, `activenessOnScreen`, `activenessAttention` (both omitted when not measured), `activenessSeconds`, `activenessAwayCount`, `activenessAwaySeconds` into the learner's `ATTENDANCE_RECORDED` row's `engagement_data` (row created at join by `upsertBbbJoinAttendance`). Invalid/blank JSON is treated as `{}`. **Monotonic:** a report only lands if its `seconds` ≥ the stored `activenessSeconds`, so a stale beacon can't overwrite a newer one. Flat integers are deliberate — the analytics callback's `mergeEngagementJson` parses `Map<String,Integer>` and keeps keys it doesn't receive.
- **Admin read:** class-learners API (`LiveClassDashboardDetailService` → `ClassLearner`) returns `activeness`, `activeness_on_screen`, `activeness_attention`, `activeness_seconds`, `activeness_away_count` (null when absent). BBB counters (`talks`, `chats`, …) are null when a row carries only activeness keys (report landed before the analytics callback).

---

## 9. Payments (paid public live classes)

- Guest path: register + pay → `session_guest_registrations` gains `user_id`, `payment_status` (`NULL`/`PENDING`/`PAID`), `payment_amount`, `payment_currency`, `invoice_id`, `payment_log_id` (`V401`). Webhook confirmation resolves invoice → registration; join gating resolves `(session, user)`.
- Authenticated learner path: `LiveSessionPaymentController` `/live-sessions/v1/payment/status` + `/register-and-pay` (same `/pay/invoice` flow as guest).
- Join gating: `GuestController.ensurePaidAccess()` (403 unless `payment_status=PAID`); learner FE `-services/livePayment.ts` (`fetchLiveSessionPaymentStatus`, `registerAndPayForLiveSession`).
- Phone-as-identity + contact verification (`V402`): optional `mobile_number`, nullable email, unique `(session_id, mobile_number)`; email/WhatsApp OTP for `require_email_verification` / `require_phone_verification`.

---

## 10. Settings & governance

**Institute setting keys** (`institute/enums/SettingKeyEnums.java`): `LIVE_SESSION_SETTING` is defined (typed blob), `STUDENT_DISPLAY_SETTINGS` carries the learner-facing display flags.

**Admin FE** (`services/live-session-settings.ts`, `SETTING_KEY_LIVE_SESSION`): a rich typed document — `allowedPlatforms` (per-platform allow-list: youtube/google meet/zoom/zoho/bbb/other), `defaultPlatform`, feedback defaults, waiting-room + Zoom defaults, notification defaults, LMS connection, `defaultAttendanceCriteria`, disclaimer-video. Wired to `GET_INSTITUTE_SETTING_DATA`/`SAVE_INSTITUTE_SETTING` (snake_case wire format).

**Learner past-session display flags** (`showPastSessions`, `showRecordings`, `showAttendance`, `showActivityStats`, `showClassMaterials`) live under **`STUDENT_DISPLAY_SETTINGS.liveClasses`** — read by `LiveSessionLearnerDisplaySettingsService.getFlags()` which **never throws** and defaults everything `false` (opt-in). All **enforced server-side** in `LearnerPastSessionService`, not just hidden in the UI.

> ⚠️ Plan-doc A1 had named the blob `LIVE_SESSION_SETTING.learnerDisplay`; the shipped code settled on `STUDENT_DISPLAY_SETTINGS.liveClasses` (see `LiveSessionLearnerDisplaySettingsService` Javadoc). This is the kind of "verify which settingKey the FE writes" divergence the plan's Key-gotchas worried about.

---

## 10b. Instructors & role-based session visibility (V524) — IMPLEMENTED

Two linked additions, both **strictly additive**: an institute that changes nothing sees identical behaviour.

### Instructors (`live_session_instructors`)

Entity `entity/LiveSessionInstructor.java` · migration `V524`:

```
id, session_id NOT NULL, user_id NOT NULL, status (ACTIVE default), created_at, updated_at
UNIQUE (session_id, user_id)          -- soft delete, so remove-then-re-add reactivates
INDEX (user_id)    WHERE status='ACTIVE'
INDEX (session_id) WHERE status='ACTIVE'
```

- **Deliberately NOT `live_session_participants`.** That table is the *learner audience* and is read by every learner list, the notification fan-out and the guest/paid join gates, all of which filter `source_type='USER'`. Staff added there would leak into all of them.
- **Absence is meaningful — no backfill.** A session with no ACTIVE row falls back to `live_session.created_by_user_id`. This is what lets every pre-V524 session keep working. Read instructors through `LiveSessionInstructorService`, never the repository directly.
- Seeded with the creator at **step 1 create only**; reconciled by `step2.instructor_user_ids` (tri-state: `null` = don't touch, `[]` = clear, list = exact).
- **Fixed en route:** `Step1Service.updateSessionFields` used to re-stamp `created_by_user_id` on *every* call, so editing someone else's class silently transferred ownership. Invisible before V524; now it would move a session out of a teacher's view.

**What an instructor gets:** the session's notification emails (`LiveSessionNotificationProcessor.getInstructorRecipients` appends them as 5-element "individual user" rows, so all five builders pick them up), and a name on the learner live/past cards. **Not** HOST — `LiveSessionJoinAuthorizer` is untouched, join role is still creator-or-admin/teacher-authority.

Instructor contacts come from auth_service (staff have no `student` row), over the **HMAC internal route** `/auth-service/internal/user/user-details-list`, because the notification scheduler runs on a background thread with no JWT to forward.

### Role-based visibility (`LIVE_SESSION_SETTING.roleVisibility`)

`{ "<ROLE_NAME>": { "mode": "ALL|OWN|SPECIFIC_ROLES", "roles": [...] } }`, keyed by role **name** (upper-case) so institute custom roles work with no extra plumbing — role names are what the JWT carries.

| Mode | Means |
|---|---|
| `ALL` | Everything in the institute. The default for any role with no entry — i.e. the pre-V524 behaviour. |
| `OWN` | Sessions the caller created **or** instructs. |
| `SPECIFIC_ROLES` | Own sessions **∪** sessions instructed by a user holding one of the listed roles. |

**Most-permissive-wins across a caller's roles.** This is the safety property: restricting TEACHER cannot accidentally restrict someone who is also an ADMIN, because ADMIN has no rule and therefore means ALL. There is **no `is_root_user` bypass**: on this platform that flag is set for every invited staff account, so it means "admin-portal user", not "owner".

**The predicate** (`LiveSessionVisibilityScope`), applied in SQL rather than by post-filtering so paging counts stay truthful:

```
:restrictVisibility = FALSE
OR s.created_by_user_id = :callerUserId
OR EXISTS (active instructor row with user_id IN :allowedUserIds)
OR (no active instructor rows AND s.created_by_user_id IN :allowedUserIds)   -- creator fallback
```

`allowedUserIds` always contains the caller, which also keeps the `IN` list from ever being empty (a syntax error in a native query).

**Enforced on:** the four admin lists (`/live`, `/upcoming`, `/past`, `/draft`), `POST /search`, `GET /by-session-id`, and the `step1` edit / `step2` / `delete` writes. Deliberately **not** on `/by-schedule-id`, which is the learner + guest join path.

**Failure directions differ on purpose:** an unreadable *setting* resolves to ALL (a parse error must not blank out a schedule), but a failed *role-membership lookup* degrades to OWN (the intent to restrict is already established — show less, not more).

Role membership can't be joined in SQL — admin_core has no `users`/`user_role` table — so `InstituteRoleUserClient` fetches it from auth_service (`users-of-status`, caller's JWT forwarded) behind a 60 s TTL cache; it sits in front of every admin list for a restricted institute.

### Bulk CSV

`teacher_emails` column (also read as `instructors`, the original header, and `teacher` / `teachers` / `teacher_email` / `instructor*`): emails (recommended), usernames or user ids, separated by `|`, `;` or `,`. The bulk grid has a matching **Teacher** column (`RowTeacherPicker.tsx`), a searchable multi-select over the institute's staff, and a "Teacher reference" download listing every staff member's name, email and username.

Resolution happens in the **grid**, not the backend: `-utils/teacherDirectory.ts` matches each entry against the staff directory (`fetchEligibleOrgUsers`, non-students only) as id → email → username, case-insensitive. An email shared by two staff members is reported as ambiguous and not guessed. Matched people are sent as `step2.instructor_user_ids`. Entries that match nobody are flagged on the row before submit, left out of the request, and written to that row's `warnings[]` (the results CSV's remarks column). Rows are never failed over a teacher.

`step2.instructor_identifiers` is sent only when the staff directory could not be loaded. `BulkLiveSessionService` then resolves the whole import against one staff-directory fetch before the row loop. That server-side lookup (`LiveSessionUserDirectoryClient.findInstituteStaff`) sends no role filter and reads only the first 2,000 ACTIVE users, students included. On a large institute it can therefore miss a teacher or match a student. This is why it is only the fallback.

### Frontends

- **Admin settings** → `LiveSessionVisibilityCard.tsx`, roles from `/user-roles-count` (custom roles included, STUDENT excluded).
- **Admin scheduling** → an "Instructors" `SectionCard` in step 2 (`InstructorPicker.tsx`), pre-filled with the current user on create and from `sessionDetails.instructors` on edit.
- **Learner** → `InstructorLine.tsx` on the live, upcoming, day-modal and past cards; renders nothing rather than printing a raw user id when a name can't be resolved.

---

## 11. Past sessions (Track A) — IMPLEMENTED

> This was "Track A" in `LIVE_CLASS_PAST_SESSIONS_AND_CONTENT_LINKING_PLAN.md`. The heading still reads PLAN, but the full stack exists.

**Backend**
- `GET /admin-core-service/get-sessions/learner/past` (`GetSessionsListController`) → `LearnerPastSessionService`.
- Params: `batchId`, `userId`, `instituteId`, `page`, `size` (default 20), `startDate`, `endDate`.
- Flags → paged (newest-first) query → batched attendance/engagement → sanitized DTOs. **Deliberately NOT `@ClientCacheable`** (recordings land async; stale "no recording" is a support headache).
- Response envelope `LearnerPastSessionsResponseDTO` (`display_flags` + `content` + paging), snake_case. `LearnerPastSessionDTO` serializes `meeting_date`/`start_time` as plain ISO strings, `@JsonInclude(NON_NULL)` so gated blocks are **omitted, not null**.
- `LearnerRecordingDTO.sanitizeOneRecording()` selectors (priority): **S3 (`fileId`) > YOUTUBE (`youtubeVideoUrl`) > ZOOM_CLOUD (`playbackUrl`+`passcode`, omitted + `expired=true` once `expiresAt` passes) > BBB (`playbackUrl`)**. Never carries `downloadUrl` or provider host URLs.

**Learner FE**
- `usePastSessions.ts` / `useCalendarPastSessions.ts`; `fetchPastSessionsForMultipleBatches` merges across batches, dedupes by `schedule_id`, sorts newest-first; `refetchInterval:false` (cold data).
- `PastSessionCard.tsx`: attendance badge (PRESENT/ABSENT/**UNMARKED** — pre-tracking ≠ absent-red), activity chips, recording buttons (Part 1/2; "Recording expired" disabled), materials buttons.
- `index.tsx`: Past tab/section in List view + calendar past-month support; rendered only when `display_flags.show_past_sessions`.

---

## 12. Content linking (Track B) — IMPLEMENTED

> "Track B" in the plan. Teacher flows: link a recording / upload class material to course chapters in ≤3 clicks.

**Backend** (`LiveSessionContentLinkController` `/admin-core-service/live-sessions/content` → `LiveSessionContentLinkService`):
- `POST /link` — body `{ session_id, schedule_id?, source{kind, recording_id?, file_id?, url?}, title, description?, slide_status, notify, position, destinations[{package_session_id, chapter_id, module_id, subject_id}] }`. Dedup by `chapter_id`; per unique chapter creates the slide via `SlideService` (`RECORDING`/`UPLOAD_VIDEO` → `VideoSlide` with `url=fileId` + `source_type=DRIVE`, or YOUTUBE; `UPLOAD_PDF` → `DocumentSlide`). Returns `ContentLinkOutcomeDTO` per destination (`CREATED` / `ALREADY_LINKED` / `SHARED_CHAPTER_DEDUPED`).
- `GET /links?sessionId`, `DELETE /link/{linkId}`.
- `resolveSlideOrder()`: `BOTTOM` = `max+1`; `TOP` = shift existing +1 and insert at 0 (the one server-computed `slide_order`, kept atomic `@Transactional`).
- Published default; Draft for review-first (respects `SlideStatus.PUBLISHED` → `published_url`).

**Admin FE** (`view/$sessionId.tsx`): `AddRecordingToCourseCard.tsx`, `ClassMaterialsCard.tsx`, shared `SessionContentDestinationPicker.tsx`, `UnlinkContentLinkButton.tsx`; service `-services/content-link-service.ts` (snake_case wire), `RecordingAutoLinkConfig` for Step-2 auto-link.

**Learner effect:** zero new learner code — linked items are ordinary VIDEO/PDF slides in the chapter, rendered by the existing dispatcher, tracked/dripped as normal. (A recording linked into a chapter is visible even if `showRecordings=false` — Track A gates the *history page*, Track B is deliberate curriculum placement.)

---

## 13. Bookings / mentorship meetings (the sibling subsystem)

1:1 meetings live in `features/booking/` (not `features/live_session/`) but reuse the same provider abstraction.

- **Entities:** `BookingPage` (timezone, `location_type`, `allocate_google_meet`, `duration_minutes` or `session_types_json`), `BookingType` (`type`, unique `code`, institute-or-global), `meeting_bookings`.
- **Controllers:** `BookingController` (`/booking/v1`) and deprecated `BookingTypeController` (`/booking-types/v1`); `LiveSessionBookingController` (`/live-sessions/v1/booking`).
- **Flow:** create booking / link users → `check-availability` (uses `UserScheduleAvailabilityDTO` via the provider strategy) → `reschedule` / `cancel` / status patch → per-attendee meeting minted (Google Meet allocates a fresh space per booking when `allocate_google_meet=true`).
- Per-mentor Google account: mentor record carries `google_account_id`; booked meetings run under the mentor's own organizer (auto-recording, personal Meet link).

---

## 14. Notifications

`LiveSessionNotificationProcessor` + Quartz (`LiveSessionNotificationQuartzConfig`/`Job`) + `schedule_notifications` (`ScheduleNotification`, `V36` idempotency key):

- Events (`SessionLog`): `ON_CREATE_REMAINDER`, `BEFORE_REMAINDER`, `ON_LIVE_REMAINDER`, `ATTENDANCE_NOTIFIED`, plus `WorkflowTriggerEvent.LIVE_SESSION_CREATE` (fired from Step1).
- Templates: `LiveClassEmailBody` (create/edit/delete bodies), `AttendanceEmailBody`; placeholders include `{{live_class_*}}`, `{{next_live_class_*}}`, `{{OLD_TIME}}`; template resolver `LiveClassTemplateService`.
- `LiveSessionNotificationConfig` holds per-session notification preferences; `AttendanceEmailBody` / config defaults come from `live-session-settings.ts`.
- Fee/lifecycle: edit/delete flows send the corresponding email bodies via `NotificationService` (email/WhatsApp/push/system channels).

---

## 15. Endpoint quick-reference

| Method | Path | Purpose |
|---|---|---|
| POST | `/live-sessions/v1/create/step1` | session core + occurrence fan-out |
| POST | `/live-sessions/v1/create/step2` | participants, **instructors**, fields, configs, notifications |
| POST | `/live-sessions/v1/create/bulk` | CSV bulk schedule |
| POST | `/live-sessions/v1/delete` | delete (type: single/recurring; notifyStudents) |
| GET | `/get-sessions/live` · `/upcoming` · `/past` · `/draft` | admin lists (institute-scoped; `@ClientCacheable`) |
| GET | `/get-sessions/learner/live-and-upcoming` | learner list (batch/user, size param) |
| GET | `/get-sessions/learner/past` | **Track A** past sessions (NOT cached) |
| GET | `/get-sessions/by-user-id` · `/by-session-id` · `/by-schedule-id` | details |
| POST | `/get-sessions/search` | `SessionSearchRequest` (filters incl. `streaming_service_types`: ZOOM/GOOGLE_MEET/MS_TEAMS) |
| POST | `/live-session/mark-attendance` · `/mark-guest-attendance` · `/admin-mark-attendance` | attendance marks |
| GET | `/live-session-report/…` | attendance reports, feedback, per-student |
| POST | `/live-sessions/content/link` · GET `/links` · DELETE `/link/{id}` | **Track B** content linking |
| GET/POST | `/live-sessions/v1/payment/status` · `/register-and-pay` | paid-session checkout |
| GET | `/live-session/guest/…` (`session-id-by-schedule-id`, `get-session-by-schedule-id`, `join`) | guest join (VIEWER) |
| GET | `/live-sessions/provider/meeting/zoom-sdk-signature` | Zoom SDK join credentials |
| GET | `/live-sessions/provider/meeting/google-meet-join` | Meet join URL + attendance |
| POST | `/live-sessions/provider/meeting/zoom-callback/{accountId}` | Zoom webhook (HMAC) |
| POST | `/live-sessions/provider/meeting/google-meet-callback` | Google Events Pub/Sub push |
| POST | `/live-sessions/provider/meeting/bbb-activeness` | BBB activeness plugin report (HMAC token in body, §8b) |
| POST | `/live-sessions/provider/zoom/oauth/initiate` · GET `/callback` | Zoom OAuth |
| POST | `/live-sessions/provider/google/oauth/initiate` · GET `/callback` | Google OAuth |

---

## 16. Key gotchas (verified from code)

1. **`link_type` casing is load-bearing.** The FE matches `"zoom"`, `"google meet"` (with a space) case-sensitively; the backend normalizes via `MeetingProvider.fromString()`. Persisting `ZOOM`/`GMEET` (the enum names) silently broke the teacher's "Start as Host" (see `Step1Service.getLinkTypeFromUrl` Javadoc).
2. **`schedule_id` is the stable key** — never `provider_meeting_id` (changes on recreate).
3. **Timezone-aware "is past"** must use the session's timezone (`CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone,''),'Asia/Kolkata')`), not server date.
4. **`meeting_date`(DATE) + `start_time`(TIME)** are split; `LiveSessionListDTO` has a documented Asia/Kolkata serialization quirk — the new learner DTO ships ISO + `timezone`.
5. **Recordings JSON native queries:** never add SQL comments/apostrophes in those native queries (Spring SpEL `QuotationMap` breakage — `findNeedingRecordingSync`).
6. **Batch/users attach via `live_session_participants`** (`source_id`=package_session_id for BATCH), not `live_session.source/source_id`.
7. **Settings key drift:** plan A1 said `LIVE_SESSION_SETTING.learnerDisplay`, shipped code uses `STUDENT_DISPLAY_SETTINGS.liveClasses`.
8. **Cannot request host role:** join role is server-derived (`LiveSessionJoinAuthorizer`).
9. **Don't link an expiring ZOOM_CLOUD URL** into course content — link S3 `fileId` (or trigger "Save to library & add" first).
10. **`ProviderMeetingBatchService` idempotency** = skip rows with `provider_meeting_id`; recovery = `ZoomMeetingProvisionRetryProcessor` (5-min).
11. **No instructor row ≠ no instructor** — it means *the creator*. Always read instructors via `LiveSessionInstructorService`, which applies that fallback; querying `live_session_instructors` directly makes every pre-V524 session look ownerless.
12. **A role with no `roleVisibility` entry means ALL**, and a caller gets the most permissive of their roles' rules. Restricting someone requires restricting *every* role they hold.

---

## 17. Glossary

| Term | Meaning |
|---|---|
| `live_session` | class/series template |
| `session_schedules` | one row per occurrence (date/time/link/recording cache) |
| `package_session_id` | course/level id used as a `BATCH` participant source |
| `provider_meeting_id` | vendor meeting key (Zoom MN, BBB meetingID, GMeet `spaces/{id}`, Zoho meetingKey) |
| `provider_recordings_json` | cached `MeetingRecordingDTO[]` on the schedule |
| `recordingStorage` | `ZOOM_CLOUD` (ephemeral) vs `S3` (permanent, `fileId` set) |
| `Track A` | learner Past-sessions experience |
| `Track B` | teacher content-linking (recording/material → chapter) |
| instructor | a presenter of a live class (`live_session_instructors`), falling back to `created_by_user_id` |
| `BBB` | BigBlueButton, marketed as "Vacademy Meet" (self-hosted) |
| `PRE_JOINING` | waiting-room type that joins directly during the pre-start window |

---

## 18. Appendix — migration map (live-session related)

| Migration | What |
|---|---|
| `V21` | `access_level` default private |
| `V36` | idempotency key on `schedule_notifications` |
| `V86` | live-session performance indexes |
| `V110/V112/V114` | default class link / name / button |
| `V125` | provider mapping table + provider columns on schedules/logs |
| `V159/V160` | BBB provider + `bbb_config_json` |
| `V164` | `vendor_user_id` on provider mapping |
| `V177` | live-class email templates |
| `V192/V193/V194` | BBB server pool (id type fixes) |
| `V216` | `feedback_config_json` |
| `V316/V317` | Zoom columns (`provider_account_id`, `provider_passcode`) + zoom provisioning config |
| `V326` | `waiting_room_type` |
| `V367` | `live_session_content_links` (Track B) |
| `V398` | `recording_auto_link_json` |
| `V401` | `session_guest_registrations` payment columns |
| `V402/V403/V405` | phone identity, contact verification, WhatsApp OTP template |
| `V414` | `audience_push_config_json` |
| `V418` | booking `session_types_json` |
| `V470` | `institutes.live_session_base_url` (BBB white-label) |
| `V471` | `provider_total_duration_seconds` |
| `V496` | tutor live-minute pricing (AI tutor, not live classes) |
| `V524` | `live_session_instructors` + role-visibility support index |

