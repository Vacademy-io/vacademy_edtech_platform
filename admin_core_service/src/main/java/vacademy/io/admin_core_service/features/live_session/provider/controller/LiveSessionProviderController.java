package vacademy.io.admin_core_service.features.live_session.provider.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSessionLogs;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.enums.SessionLog;
import vacademy.io.admin_core_service.features.live_session.provider.dto.ProviderMeetingCreateRequestDTO;
import vacademy.io.admin_core_service.features.live_session.provider.dto.ProviderConnectRequestDTO;
import vacademy.io.admin_core_service.features.live_session.provider.dto.RecordingSyncResultDTO;
import vacademy.io.admin_core_service.features.live_session.provider.entity.LiveSessionProviderConfig;
import vacademy.io.admin_core_service.features.live_session.provider.manager.BbbMeetingManager;
import vacademy.io.admin_core_service.features.live_session.provider.service.BbbActivenessTokenService;
import vacademy.io.admin_core_service.features.live_session.provider.service.BbbServerRouter;
import vacademy.io.admin_core_service.features.live_session.provider.service.LiveSessionProviderService;
import vacademy.io.admin_core_service.features.live_session.provider.service.ProviderMeetingBatchService;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionLogsRepository;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.meeting.dto.CreateMeetingResponseDTO;
import vacademy.io.common.meeting.dto.MeetingAttendeeDTO;
import vacademy.io.common.meeting.dto.MeetingRecordingDTO;
import vacademy.io.common.meeting.dto.ParticipantJoinLinkDTO;
import vacademy.io.common.meeting.dto.UserScheduleAvailabilityDTO;
import vacademy.io.common.meeting.enums.MeetingProvider;

import vacademy.io.admin_core_service.features.live_session.dto.BbbAnalyticsCallbackDTO;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Live Session Provider REST API.
 * All endpoints require a valid JWT (enforced by the security filter chain).
 */
@RestController
@RequestMapping("/admin-core-service/live-sessions/provider")
@RequiredArgsConstructor
@Slf4j
public class LiveSessionProviderController {

    /**
     * How long a freshly created meeting is protected from a moderator recreate.
     * BBB reports a new room as "not running" until its first participant fully
     * connects, so within this window "the meeting has ended" is never true — it
     * just hasn't been joined yet.
     */
    private static final long RECREATE_GRACE_MS = 90_000L;

    private final LiveSessionProviderService providerService;
    private final BbbMeetingManager bbbMeetingManager;
    private final BbbServerRouter serverRouter;
    private final SessionScheduleRepository scheduleRepository;
    private final LiveSessionLogsRepository liveSessionLogsRepository;
    private final vacademy.io.admin_core_service.features.live_session.repository.LiveSessionRepository liveSessionRepository;
    private final com.fasterxml.jackson.databind.ObjectMapper objectMapper;
    private final vacademy.io.admin_core_service.features.institute.repository.InstituteRepository instituteRepository;
    private final vacademy.io.common.media.service.FileService fileService;
    private final vacademy.io.common.auth.repository.UserRepository userRepository;
    private final vacademy.io.admin_core_service.features.youtube.service.YoutubeUploadJobService youtubeUploadJobService;
    private final ProviderMeetingBatchService providerMeetingBatchService;
    private final vacademy.io.admin_core_service.features.live_session.service.RecordingAutoLinkService recordingAutoLinkService;
    private final vacademy.io.admin_core_service.core.security.InstituteAccessValidator instituteAccessValidator;
    private final vacademy.io.admin_core_service.features.live_session.service.AttendanceCriteriaEvaluator attendanceCriteriaEvaluator;
    private final BbbActivenessTokenService activenessTokenService;

    /** Largest activeness report accepted — the real payload is ~200 bytes. */
    private static final int ACTIVENESS_MAX_BODY_CHARS = 4096;
    /** Longest class an activeness report may claim (12h). */
    private static final int ACTIVENESS_MAX_SECONDS = 43_200;
    /**
     * At most one stored report per learner per class in this window (the plugin
     * reports once a minute); a final report gets a shorter one. Per pod — with four
     * replicas a replaying client still gets only a handful of writes a minute.
     */
    private static final long ACTIVENESS_MIN_WRITE_GAP_MS = 20_000;
    private static final long ACTIVENESS_MIN_FINAL_GAP_MS = 2_000;
    private static final long ACTIVENESS_MIN_STATE_GAP_MS = 1_000;
    /**
     * Why a learner has no (or no current) activeness score, sent by the plugin as
     * `status` and stored as engagement_data.activenessState. Codes are stable —
     * the admin UI maps them to labels.
     */
    static final Map<String, Integer> ACTIVENESS_STATES = Map.of(
            "on", 1,
            "turned_off", 2,
            "unsupported_device", 3,
            "camera_blocked", 4,
            "no_camera", 5,
            "camera_busy", 6,
            "too_slow", 7,
            "load_failed", 8,
            "camera_stopped", 9,
            "awaiting_permission", 10);
    private final java.util.concurrent.ConcurrentHashMap<String, Long> activenessLastWriteAt =
            new java.util.concurrent.ConcurrentHashMap<>();

    // -----------------------------------------------------------------------
    // OAuth connect / status
    // -----------------------------------------------------------------------

    /**
     * One-time Zoho OAuth setup for an institute.
     * Admin generates the auth code from Zoho API Console → Self Client → Generate
     * Code.
     *
     * POST /admin-core/live-session/provider/connect/{providerName}
     */
    @PostMapping("/connect/{providerName}")
    public ResponseEntity<LiveSessionProviderConfig> connectProvider(
            @PathVariable String providerName,
            @RequestBody ProviderConnectRequestDTO request) {
        LiveSessionProviderConfig config = providerService.connectProvider(providerName, request);
        // Mask secrets before responding — configJson is not exposed in the entity
        // response
        config.setConfigJson(null);
        return ResponseEntity.ok(config);
    }

    /**
     * One-time Zoho SDK OAuth setup for an institute (Server-based Application).
     * Merges SDK credentials into the existing provider config — regular meeting
     * credentials are preserved.
     *
     * POST /admin-core/live-session/provider/connect/{providerName}/sdk
     *
     * Body fields used: clientId (sdkClientId), clientSecret (sdkClientSecret),
     * authorizationCode, redirectUri, domain, presenterZuid
     */
    @PostMapping("/connect/{providerName}/sdk")
    public ResponseEntity<LiveSessionProviderConfig> connectSdkProvider(
            @PathVariable String providerName,
            @RequestBody ProviderConnectRequestDTO request) {
        LiveSessionProviderConfig config = providerService.connectSdkProvider(providerName, request);
        config.setConfigJson(null); // mask secrets
        return ResponseEntity.ok(config);
    }

    /**
     * GET /admin-core/live-session/provider/status?instituteId=xxx
     */
    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> getProviderStatus(
            @RequestParam String instituteId,
            @RequestParam(required = false, defaultValue = "ZOHO_MEETING") String provider) {
        boolean isConnected = providerService.isProviderConnected(instituteId, provider);
        return ResponseEntity.ok(Map.of(
                "instituteId", instituteId,
                "provider", provider,
                "isConnected", isConnected,
                "zohoMeetingConnected", isConnected)); // legacy frontend backward compatibility
    }

    /**
     * Returns the masked config (no secrets) for display on the admin dashboard.
     * GET
     * /admin-core/live-session/provider/config?instituteId=xxx&provider=ZOHO_MEETING
     */
    @GetMapping("/config")
    public ResponseEntity<Map<String, Object>> getProviderConfig(
            @RequestParam String instituteId,
            @RequestParam String provider) {
        return providerService.getProviderConfigDisplay(instituteId, provider)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    // -----------------------------------------------------------------------
    // Meeting operations
    // -----------------------------------------------------------------------

    /**
     * Create a meeting via the institute's connected provider.
     * Join URL is automatically written back to
     * session_schedule.custom_meeting_link.
     *
     * POST /admin-core/live-session/provider/meeting/create
     */
    @PostMapping("/meeting/create")
    public ResponseEntity<CreateMeetingResponseDTO> createMeeting(
            @RequestBody ProviderMeetingCreateRequestDTO request) {
        return ResponseEntity.ok(providerService.createMeeting(request));
    }

    /**
     * POST /admin-core-service/live-sessions/provider/meeting/create-for-session
     *
     * Provisions a provider meeting for EVERY schedule row of a session in one call,
     * server-side and in the background — replacing the admin browser looping a
     * create call per occurrence. Used for recurring sessions (one meeting per
     * occurrence). Idempotent: rows that already have a meeting are skipped, so this
     * can be re-called safely to fill gaps. Returns 202 with the count still pending.
     *
     * Body: same {@link ProviderMeetingCreateRequestDTO} as /meeting/create but
     * {@code scheduleId} is ignored — every not-yet-provisioned schedule of
     * {@code sessionId} is processed, each occurrence's start time + duration derived
     * from its own row.
     */
    @PostMapping("/meeting/create-for-session")
    public ResponseEntity<Map<String, Object>> createMeetingsForSession(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestBody ProviderMeetingCreateRequestDTO request) {
        // Authorize against the SESSION's real institute (not the client-supplied
        // instituteId) so a caller can't provision billable meetings on another tenant.
        instituteAccessValidator.validateUserAccess(user, resolveSessionInstituteId(request.getSessionId()));
        int pending = providerMeetingBatchService.countPending(request.getSessionId());
        providerMeetingBatchService.rememberProvisioningConfig(request);
        providerMeetingBatchService.createMeetingsForSessionAsync(request);
        return ResponseEntity.accepted().body(Map.of(
                "status", "PROCESSING",
                "sessionId", request.getSessionId() != null ? request.getSessionId() : "",
                "pendingCount", pending));
    }

    /**
     * GET /admin-core-service/live-sessions/provider/meeting/provision-status?sessionId=xxx
     *
     * Reports how many of a session's occurrences have a provider meeting yet. The admin
     * session view uses this to show a "Zoom / Google Meet: ready / N not set up" badge —
     * surfacing the otherwise-silent async provisioning failures. {@code managed} is false
     * when no provider account is stored (e.g. a pasted link), so there is nothing to set up.
     */
    @GetMapping("/meeting/provision-status")
    public ResponseEntity<Map<String, Object>> provisionStatus(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam String sessionId) {
        instituteAccessValidator.validateUserAccess(user, resolveSessionInstituteId(sessionId));
        int total = providerMeetingBatchService.countTotal(sessionId);
        int pending = providerMeetingBatchService.countPending(sessionId);
        return ResponseEntity.ok(Map.of(
                "sessionId", sessionId,
                "total", total,
                "pending", pending,
                "provisioned", total - pending,
                "managed", providerMeetingBatchService.isManaged(sessionId)));
    }

    /**
     * POST /admin-core-service/live-sessions/provider/meeting/provision-now?sessionId=xxx
     *
     * Admin "Provision now": synchronously (re)creates meetings for any still-pending
     * occurrence from the session's stored Zoom / Google Meet config, so a failed/lagging
     * provision can be fixed in one click instead of waiting on the 5-minute retry job.
     * Returns the updated counts.
     */
    @PostMapping("/meeting/provision-now")
    public ResponseEntity<Map<String, Object>> provisionNow(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam String sessionId) {
        instituteAccessValidator.validateUserAccess(user, resolveSessionInstituteId(sessionId));
        int created = providerMeetingBatchService.reprovisionSession(sessionId);
        int total = providerMeetingBatchService.countTotal(sessionId);
        int pending = providerMeetingBatchService.countPending(sessionId);
        return ResponseEntity.ok(Map.of(
                "sessionId", sessionId,
                "created", created,
                "total", total,
                "pending", pending,
                "provisioned", total - pending,
                "managed", providerMeetingBatchService.isManaged(sessionId)));
    }

    /**
     * GET /admin-core/live-session/provider/meeting/recordings
     * ?scheduleId=xxx&instituteId=yyy
     */
    @GetMapping("/meeting/recordings")
    public ResponseEntity<List<MeetingRecordingDTO>> getRecordings(
            @RequestParam String scheduleId,
            @RequestParam String instituteId) {
        return ResponseEntity.ok(providerService.getRecordings(scheduleId, instituteId));
    }

    /**
     * POST /admin-core/live-session/provider/meeting/recordings/sync
     * Admin escape hatch: fetches recordings directly from BBB, downloads any
     * missing, uploads to S3, and persists fileIds.
     * Returns status=BBB_OFFLINE when BBB is unreachable (it's often down).
     * Only call this after 2 hours from session start — enforced on the frontend.
     */
    @PostMapping("/meeting/recordings/sync")
    public ResponseEntity<RecordingSyncResultDTO> syncRecordings(
            @RequestParam String scheduleId,
            @RequestParam String instituteId) {
        return ResponseEntity.ok(providerService.syncRecordingsFromBbb(scheduleId, instituteId));
    }

    /**
     * POST /admin-core-service/live-sessions/provider/meeting/recordings/sync-to-s3
     * ?scheduleId=xxx&instituteId=yyy
     *
     * Admin "Sync to S3" for Zoom recordings: mirrors not-yet-mirrored cloud
     * recordings to Vacademy storage so they survive Zoom's ~30-day auto-delete.
     * Idempotent. Returns the updated recording list + count mirrored.
     */
    @PostMapping("/meeting/recordings/sync-to-s3")
    public ResponseEntity<RecordingSyncResultDTO> syncRecordingsToS3(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam String scheduleId,
            @RequestParam String instituteId) {
        SessionSchedule schedule = scheduleRepository.findById(scheduleId)
                .orElseThrow(() -> new vacademy.io.common.exceptions.VacademyException("Schedule not found: " + scheduleId));
        instituteAccessValidator.validateUserAccess(user, resolveInstituteId(schedule));
        return ResponseEntity.ok(providerService.syncRecordingsToS3(scheduleId, instituteId));
    }

    /**
     * GET /admin-core/live-session/provider/meeting/attendance
     * ?scheduleId=xxx&instituteId=yyy
     */
    @GetMapping("/meeting/attendance")
    public ResponseEntity<List<MeetingAttendeeDTO>> getAttendance(
            @RequestParam String scheduleId,
            @RequestParam String instituteId) {
        return ResponseEntity.ok(providerService.getAttendance(scheduleId, instituteId));
    }

    /**
     * GET /admin-core/live-session/provider/meeting/session-links?scheduleId=
     *
     * Returns the stored joinUrl (participants) and hostUrl (organizer) for a
     * schedule. The hostUrl is a pre-signed Zoho startLink — opens directly
     * without a name/email form. Open either URL in a new browser tab.
     */
    @GetMapping("/meeting/session-links")
    public ResponseEntity<Map<String, String>> getSessionLinks(
            @RequestParam String scheduleId) {
        return ResponseEntity.ok(providerService.getSessionLinks(scheduleId));
    }

    /**
     * POST /admin-core/live-session/provider/meeting/participant-join-link
     * ?scheduleId=&instituteId=&participantName=&participantEmail=
     *
     * Registers the participant with the provider and returns a join link
     * pre-filled with their name/email.
     */
    @PostMapping("/meeting/participant-join-link")
    public ResponseEntity<ParticipantJoinLinkDTO> getParticipantJoinLink(
            @RequestParam String scheduleId,
            @RequestParam String instituteId,
            @RequestParam String participantName,
            @RequestParam String participantEmail) {
        return ResponseEntity.ok(providerService.getParticipantJoinLink(
                scheduleId, participantName, participantEmail, instituteId));
    }

    /**
     * GET /admin-core/live-session/provider/meeting/availability
     * ?instituteId=&vendorUserId=&startTime=&durationMinutes=
     *
     * Checks whether the organizer has any conflicting sessions in the requested
     * time window. Call this before creating a meeting to alert the user.
     */
    @GetMapping("/meeting/availability")
    public ResponseEntity<UserScheduleAvailabilityDTO> checkUserAvailability(
            @RequestParam String instituteId,
            @RequestParam(required = false) String vendorUserId,
            @RequestParam String startTime,
            @RequestParam int durationMinutes) {
        return ResponseEntity.ok(providerService.checkUserAvailability(
                startTime, durationMinutes, instituteId, vendorUserId));
    }

    /**
     * GET /admin-core-service/live-sessions/provider/meeting/availability-for-session
     * ?sessionId=&providerAccountId=
     *
     * Double-booking check for a whole (recurring) session: returns other meetings
     * already booked on the same provider account that overlap ANY of the session's
     * occurrences. Advisory — the wizard surfaces a warning; it does not block.
     */
    @GetMapping("/meeting/availability-for-session")
    public ResponseEntity<UserScheduleAvailabilityDTO> checkAvailabilityForSession(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam String sessionId,
            @RequestParam String providerAccountId) {
        instituteAccessValidator.validateUserAccess(user, resolveSessionInstituteId(sessionId));
        return ResponseEntity.ok(
                providerService.checkAvailabilityForSession(sessionId, providerAccountId));
    }

    // -----------------------------------------------------------------------
    // BBB Join — generates per-user join URL, auto-creates room if needed
    // -----------------------------------------------------------------------

    /**
     * GET /admin-core-service/live-sessions/provider/meeting/join
     * ?scheduleId=xxx&role=MODERATOR|VIEWER
     *
     * Flow:
     * 1. If no BBB meeting exists for this schedule → auto-create it
     * 2. Generate a personalized BBB join URL for the current user
     * 3. Mark attendance immediately
     * 4. Return the join URL (frontend loads it in iframe)
     */
    @GetMapping("/meeting/join")
    public ResponseEntity<Map<String, String>> joinBbbMeeting(
            @RequestParam String scheduleId,
            @RequestParam(defaultValue = "VIEWER") String role,
            @RequestParam(defaultValue = "false") boolean recreate,
            @RequestAttribute("user") CustomUserDetails user) {

        // NOTE: BBB join intentionally keeps its original (pre-Zoom) behaviour —
        // client-supplied role, no enrolment gate — to avoid regressing the live
        // BBB feature for institutes not using Zoom. The server-derived-role +
        // enrolment guard (LiveSessionJoinAuthorizer) is applied to the Zoom
        // SDK-join endpoints only. Hardening the BBB path is tracked separately
        // and must be validated against real BBB usage first.

        SessionSchedule schedule = scheduleRepository.findById(scheduleId)
                .orElseThrow(() -> new vacademy.io.common.exceptions.VacademyException("Schedule not found: " + scheduleId));

        // Only the host starts the class. A viewer arriving before the meeting
        // exists is told to wait rather than creating one — mirroring the rule
        // GuestController has always enforced ("Guest cannot create meetings").
        //
        // Why this matters: creation is the one path that calls BBB and takes the
        // schedule row lock. When a class opens, hundreds of learners hit this
        // endpoint within the same second; letting any of them win that race is
        // what produces duplicate BBB rooms (students stranded in a room the
        // teacher is not in) and what puts every joiner behind a single lock.
        // With this gate the meeting is created exactly once, by the host, before
        // anyone else can ask for it.
        //
        // NOTE: `role` is client-supplied (see the note above), so this is a
        // correctness guard against the accidental stampede, not an authorisation
        // control. Server-derived roles are tracked with the wider BBB hardening.
        if (!"MODERATOR".equalsIgnoreCase(role)
                && (schedule.getProviderMeetingId() == null || schedule.getProviderMeetingId().isBlank())) {
            log.info("[BBB] Viewer join before host started; scheduleId={}, userId={}",
                    scheduleId, user != null ? user.getUserId() : null);
            return ResponseEntity.ok(Map.of(
                    "status", "NOT_STARTED",
                    "message", "Your teacher hasn't started this class yet. Please wait a moment and try again."));
        }

        // Recreate is the one action that can strand a class: it clears the
        // meeting id and builds a fresh room, leaving anyone already inside the
        // old one behind. Refuse it while the current room is still viable.
        //
        // Two cases, both seen in production:
        //   1. People are already in the room — obvious, but worth blocking.
        //   2. The room is seconds old and still empty. BBB reports a meeting as
        //      "not running" until the first participant actually connects, so a
        //      moderator arriving during someone else's join sees "this meeting
        //      has ended" and is offered a recreate. Accepting it strands the
        //      learner who was mid-join. This is what produced the duplicate
        //      rooms on 2026-08-23.
        //
        // Deliberately fails OPEN: if BBB doesn't know the meeting or the lookup
        // fails, the recreate proceeds. A class that really has ended must always
        // be restartable — blocking that would be worse than the bug.
        if (recreate && "MODERATOR".equalsIgnoreCase(role)
                && schedule.getProviderMeetingId() != null && !schedule.getProviderMeetingId().isBlank()) {
            var liveState = bbbMeetingManager.getMeetingLiveState(
                    schedule.getProviderMeetingId(), schedule.getBbbServerId());
            if (liveState.isPresent()) {
                int participants = liveState.get().participantCount();
                long ageMs = System.currentTimeMillis() - liveState.get().createTimeMillis();
                if (participants > 0) {
                    log.info("[BBB] Blocked recreate: {} participant(s) still in meeting {} (scheduleId={})",
                            participants, schedule.getProviderMeetingId(), scheduleId);
                    return ResponseEntity.ok(Map.of(
                            "status", "RECREATE_BLOCKED",
                            "message", participants + (participants == 1 ? " person is" : " people are")
                                    + " already in this class. Join them instead — starting a new meeting"
                                    + " would leave them behind in the old room."));
                }
                if (liveState.get().createTimeMillis() > 0 && ageMs >= 0 && ageMs < RECREATE_GRACE_MS) {
                    log.info("[BBB] Blocked recreate: meeting {} is only {}ms old (scheduleId={})",
                            schedule.getProviderMeetingId(), ageMs, scheduleId);
                    return ResponseEntity.ok(Map.of(
                            "status", "RECREATE_BLOCKED",
                            "message", "This class was started moments ago and has not ended. A new room always"
                                    + " reports as 'not running' until the first person connects. Please join the"
                                    + " existing class instead."));
                }
            }
        }

        // Ensure the BBB meeting exists for this schedule. The service holds a
        // pessimistic row lock across the read-meetingId → maybe-call-BBB →
        // persist-meetingId critical section so concurrent first-join requests
        // can't create two separate BBB rooms (the bug that caused
        // "faculty can't see learners until they leave and rejoin").
        //
        // Steady-state fast path: once the meeting exists, there is nothing to
        // create, so skip ensureMeetingForSchedule entirely rather than take its
        // row lock just to read the id back. Every joiner used to serialise on
        // that one schedule row — when a class started together the queue behind
        // the first (BBB-calling) holder reached 14-15s per join and pinned a
        // pooled connection for the whole wait, which is what dragged the rest of
        // the platform down on 2026-08-22. `schedule` was loaded above, outside
        // any transaction, so this costs no extra query.
        //
        // Guarded on !recreate: a moderator recreate must still take the lock so
        // it is the one that clears and replaces the id. A viewer racing that
        // recreate can read the pre-recreate id here, but the isMeetingRunning
        // check below then returns "Meeting has ended" — the same answer it gives
        // today, because BBB reports a freshly recreated meeting as not-running
        // until its first participant joins.
        CreateMeetingResponseDTO ensured;
        if (!recreate && schedule.getProviderMeetingId() != null
                && !schedule.getProviderMeetingId().isBlank()) {
            ensured = CreateMeetingResponseDTO.builder()
                    .providerMeetingId(schedule.getProviderMeetingId())
                    .joinUrl(schedule.getCustomMeetingLink())
                    .hostUrl(schedule.getProviderHostUrl())
                    .justCreated(false)
                    .build();
        } else {
            try {
                ensured = providerService.ensureMeetingForSchedule(
                        scheduleId,
                        () -> buildBbbCreateRequest(scheduleId),
                        recreate, role);
            } catch (org.springframework.dao.PessimisticLockingFailureException e) {
                log.warn("[BBB] Lock timeout waiting for in-flight meeting creation on scheduleId={}: {}",
                        scheduleId, e.getMessage());
                return ResponseEntity.status(503).body(Map.of(
                        "error", "Meeting is being created, please retry"));
            }
        }
        String providerMeetingId = ensured.getProviderMeetingId();
        boolean justCreated = ensured.isJustCreated();

        // Re-fetch to pick up any fields the service mutated (linkType,
        // bbbServerId), then resolve the institute for per-institute branding.
        schedule = scheduleRepository.findById(scheduleId).orElse(schedule);
        String instituteId = resolveInstituteId(schedule);

        // Check if the meeting is still running (prevents joining ended meetings).
        // Skip this check if we just created the meeting — BBB reports it as "not running"
        // until the first participant joins, which would cause an infinite recreate loop.
        if (!justCreated) {
            boolean isRunning = bbbMeetingManager.isMeetingRunning(providerMeetingId, null, schedule.getBbbServerId());
            if (!isRunning && "MODERATOR".equalsIgnoreCase(role)) {
                // Meeting ended — tell the moderator so they can choose to recreate
                return ResponseEntity.ok(Map.of(
                        "status", "MEETING_ENDED",
                        "message", "This meeting has ended. Would you like to start a new meeting for this session?",
                        "meetingId", providerMeetingId));
            }
            if (!isRunning) {
                // For viewers, the meeting must be running
                return ResponseEntity.badRequest().body(Map.of(
                        "error", "Meeting has ended",
                        "meetingId", providerMeetingId));
            }
        }

        // Generate personalized join URL — resolve real name from DB if JWT doesn't have it
        String fullName = user.getFullName();
        if (fullName == null || fullName.isBlank()) {
            try {
                var dbUser = userRepository.findById(user.getUserId());
                if (dbUser.isPresent() && dbUser.get().getFullName() != null && !dbUser.get().getFullName().isBlank()) {
                    fullName = dbUser.get().getFullName();
                }
            } catch (Exception e) {
                log.warn("[BBB] Failed to fetch user full name from DB: {}", e.getMessage());
            }
        }
        if (fullName == null || fullName.isBlank()) {
            fullName = user.getUsername();
        }
        // The session's admin-set BBB options, parsed once for both join-time decisions.
        Map<String, Object> sessionBbbConfig = resolveSessionBbbConfig(schedule);
        // Activeness plugin token: learners (VIEWER) only, and only when the session
        // opted in. A moderator never gets one, so teachers are never scored. Null when
        // no token secret is configured — the plugin then has nothing to report with.
        String activenessToken = !"MODERATOR".equalsIgnoreCase(role)
                && Boolean.TRUE.equals(sessionBbbConfig.get("activeness_score"))
                ? activenessTokenService.mint(scheduleId, user.getUserId())
                : null;
        String joinUrl = bbbMeetingManager.buildJoinUrlForUser(
                providerMeetingId, fullName, user.getUserId(), role, instituteId, schedule.getBbbServerId(),
                Boolean.TRUE.equals(sessionBbbConfig.get("disable_mic")), activenessToken);

        // Mark attendance with join timestamp.
        // Note: LIVE_SESSION_START is NOT emitted from here. It's dispatched
        // by LiveSessionNotificationProcessor's periodic scan when the
        // schedule's start_time falls in the look-back window — same pattern
        // as LIVE_SESSION_END. That avoids the join-time race (multiple
        // concurrent first-joins all seeing count=0) and keeps lifecycle
        // emissions in one place.
        markBbbAttendance(schedule.getSessionId(), scheduleId, user.getUserId(), fullName, role, providerMeetingId);

        return ResponseEntity.ok(Map.of(
                "joinUrl", joinUrl,
                "meetingId", providerMeetingId,
                "role", role));
    }

    // -----------------------------------------------------------------------
    // BBB End callback — called by BBB server when meeting ends
    // -----------------------------------------------------------------------

    /**
     * GET /admin-core-service/live-sessions/provider/meeting/bbb-callback
     * ?scheduleId=xxx
     *
     * Called by BBB when a meeting ends (via meta_endCallbackUrl).
     * No auth required — called server-to-server from BBB.
     *
     * Note: We do NOT call getMeetingInfo here because BBB destroys meeting
     * data once the meeting ends, so attendee info would be empty.
     * Attendance is already tracked at join time in the /meeting/join endpoint.
     */
    @GetMapping("/meeting/bbb-callback")
    public ResponseEntity<String> bbbMeetingEndCallback(
            @RequestParam String scheduleId) {
        log.info("[BBB Callback] Meeting ended for scheduleId={}", scheduleId);

        try {
            SessionSchedule schedule = scheduleRepository.findById(scheduleId).orElse(null);
            if (schedule != null) {
                // Mark the sync timestamp — attendance was already recorded at join time
                schedule.setLastAttendanceSyncAt(new java.util.Date());
                scheduleRepository.save(schedule);

                // Decrement active meetings on the server (pool support)
                if (schedule.getBbbServerId() != null) {
                    serverRouter.onMeetingEnded(schedule.getBbbServerId());
                    log.info("[BBB Callback] Decremented active meetings for server {}", schedule.getBbbServerId());
                }

                log.info("[BBB Callback] Updated sync timestamp for scheduleId={}", scheduleId);
            }
        } catch (Exception e) {
            log.warn("[BBB Callback] Failed to update schedule for scheduleId={}: {}", scheduleId, e.getMessage());
        }

        return ResponseEntity.ok("OK");
    }

    // -----------------------------------------------------------------------
    // BBB Analytics callback — called by BBB after meeting ends
    // -----------------------------------------------------------------------

    /**
     * POST /admin-core-service/live-sessions/provider/meeting/bbb-analytics-callback
     * ?scheduleId=xxx
     *
     * Called by BBB after meeting ends (via meta_analytics-callback-url).
     * No auth required — server-to-server from BBB.
     * Receives per-attendee duration and engagement data.
     * For schedule retry: merges (sums) data with existing attendance logs.
     */
    @PostMapping("/meeting/bbb-analytics-callback")
    public ResponseEntity<String> bbbAnalyticsCallback(
            @RequestParam String scheduleId,
            @RequestBody BbbAnalyticsCallbackDTO callback) {
        log.info("[BBB Analytics] Received callback for scheduleId={}, meetingId={}, attendees={}",
                scheduleId, callback.getMeetingId(),
                callback.getAttendees() != null ? callback.getAttendees().size() : 0);

        try {
            SessionSchedule schedule = scheduleRepository.findById(scheduleId).orElse(null);
            if (schedule == null) {
                log.warn("[BBB Analytics] Schedule not found: {}", scheduleId);
                return ResponseEntity.ok("OK");
            }

            String sessionId = schedule.getSessionId();

            // Attendance criteria are opt-in per session, so everything here is
            // skipped for a class that never enabled them. The admin snapshot
            // must be read before the loop: processAnalyticsAttendee resets
            // statusType to ONLINE when it upgrades a row, which would otherwise
            // erase the evidence that an admin had marked this learner by hand.
            vacademy.io.admin_core_service.features.live_session.entity.LiveSession criteriaSession =
                    liveSessionRepository.findById(sessionId).orElse(null);
            boolean criteriaActive = attendanceCriteriaEvaluator.isActiveFor(criteriaSession);
            java.util.Set<String> adminMarked = criteriaActive
                    ? attendanceCriteriaEvaluator.snapshotAdminMarked(scheduleId)
                    : null;

            if (callback.getAttendees() != null) {
                for (BbbAnalyticsCallbackDTO.Attendee attendee : callback.getAttendees()) {
                    if (attendee.getExtUserId() == null || attendee.getExtUserId().isBlank()) {
                        continue;
                    }

                    try {
                        processAnalyticsAttendee(sessionId, scheduleId, callback.getMeetingId(), attendee);
                    } catch (Exception e) {
                        log.warn("[BBB Analytics] Failed to process attendee {}: {}",
                                attendee.getExtUserId(), e.getMessage());
                    }
                }
            }

            // The roster is the only authoritative statement of who was actually
            // in the room — our own attendance rows only record that someone
            // opened the join link. Apply the class's rule now that durations
            // have been merged.
            if (criteriaActive) {
                java.util.Map<String, Boolean> roster = new java.util.HashMap<>();
                if (callback.getAttendees() != null) {
                    for (BbbAnalyticsCallbackDTO.Attendee a : callback.getAttendees()) {
                        if (a.getExtUserId() != null && !a.getExtUserId().isBlank()) {
                            roster.merge(a.getExtUserId(), Boolean.TRUE.equals(a.getModerator()),
                                    (x, y) -> x || y);
                        }
                    }
                }
                // callback.getDuration() is how long the meeting really ran, in
                // seconds — the threshold is capped to it so an early finish
                // cannot fail learners who stayed for the whole class.
                attendanceCriteriaEvaluator.evaluate(criteriaSession, schedule, roster, adminMarked,
                        callback.getDuration());
            }

            schedule.setLastAttendanceSyncAt(new java.util.Date());
            scheduleRepository.save(schedule);
            log.info("[BBB Analytics] Processed callback for scheduleId={}", scheduleId);

        } catch (Exception e) {
            log.error("[BBB Analytics] Failed for scheduleId={}: {}", scheduleId, e.getMessage());
        }

        return ResponseEntity.ok("OK");
    }

    /**
     * Process a single attendee from the BBB analytics callback.
     * Merges duration/engagement with any existing log (sums values for retry scenario).
     */
    private void processAnalyticsAttendee(String sessionId, String scheduleId,
                                           String providerMeetingId,
                                           BbbAnalyticsCallbackDTO.Attendee attendee) {
        Optional<LiveSessionLogs> existing = liveSessionLogsRepository
                .findExistingAttendanceRecord(scheduleId, attendee.getExtUserId());

        // Floored, as it always has been. Rounding would have shifted the minutes
        // reported for every BBB class on the platform — including institutes
        // that never enabled the attendance rule — and those figures are read by
        // reports, CSV exports and the workflow query layer. Precision now lives
        // in provider_total_duration_seconds, which is what the rule compares and
        // what the learner's mail renders, so this column has no need to change.
        int durationMinutes = attendee.getDuration() != null
                ? (int) (attendee.getDuration() / 60) : 0;
        // Keep the exact seconds too — the minutes value above floors away up to
        // 59 seconds, which decides borderline minimum-attendance verdicts.
        int durationSeconds = attendee.getDuration() != null
                ? attendee.getDuration().intValue() : 0;

        String engagementJson = buildEngagementJson(attendee.getEngagement());

        if (existing.isPresent()) {
            LiveSessionLogs log = existing.get();

            // Sum duration with existing (for retry/recreate scenario)
            int existingDuration = log.getProviderTotalDurationMinutes() != null
                    ? log.getProviderTotalDurationMinutes() : 0;
            int existingSeconds = log.getProviderTotalDurationSeconds() != null
                    ? log.getProviderTotalDurationSeconds() : 0;
            int totalSeconds = existingSeconds + durationSeconds;
            log.setProviderTotalDurationSeconds(totalSeconds);
            // Derive minutes from the seconds total rather than summing a second,
            // independent series. Two columns holding one fact will drift the
            // moment a future edit touches only one of them — and summing
            // per-callback floors compounded the loss: floor(90s)+floor(90s) = 2
            // minutes for 3 minutes of attendance. floor(total) is both correct
            // and impossible to disagree with the seconds column.
            // floor(total) rather than sum-of-floors: identical for the single
            // callback that virtually every meeting produces, and it stops a
            // retry from compounding the truncation (floor(90s) + floor(90s)
            // reported 2 minutes for 3 minutes of attendance). Still a floor, so
            // no institute sees its existing figures move.
            log.setProviderTotalDurationMinutes(
                    totalSeconds > 0 ? totalSeconds / 60
                                     : existingDuration + durationMinutes);

            // Merge engagement data (sum counts)
            log.setEngagementData(mergeEngagementJson(log.getEngagementData(), engagementJson));

            // Update provider meeting ID to latest
            log.setProviderMeetingId(providerMeetingId);

            // If user was absent (e.g. admin marked offline) but BBB says present, mark present
            if (!"PRESENT".equals(log.getStatus())) {
                log.setStatus("PRESENT");
                log.setStatusType("ONLINE");
            }

            log.setUpdatedAt(new Timestamp(System.currentTimeMillis()));
            liveSessionLogsRepository.save(log);
        } else {
            // User joined BBB directly without going through Vacademy join endpoint
            LiveSessionLogs logEntry = LiveSessionLogs.builder()
                    .sessionId(sessionId)
                    .scheduleId(scheduleId)
                    .userSourceType("USER")
                    .userSourceId(attendee.getExtUserId())
                    .logType(SessionLog.ATTENDANCE_RECORDED.name())
                    .status("PRESENT")
                    .statusType("ONLINE")
                    .details(attendee.getName() + " | role=" + (Boolean.TRUE.equals(attendee.getModerator()) ? "MODERATOR" : "VIEWER"))
                    .providerMeetingId(providerMeetingId)
                    .providerTotalDurationMinutes(durationMinutes)
                    .providerTotalDurationSeconds(durationSeconds)
                    .engagementData(engagementJson)
                    .createdAt(new Timestamp(System.currentTimeMillis()))
                    .updatedAt(new Timestamp(System.currentTimeMillis()))
                    .build();
            liveSessionLogsRepository.save(logEntry);
        }
    }

    private String buildEngagementJson(BbbAnalyticsCallbackDTO.Engagement engagement) {
        if (engagement == null) return null;
        try {
            Map<String, Integer> data = new java.util.LinkedHashMap<>();
            data.put("chats", engagement.getChats() != null ? engagement.getChats() : 0);
            data.put("talks", engagement.getTalks() != null ? engagement.getTalks() : 0);
            data.put("talkTime", engagement.getTalkTime() != null ? engagement.getTalkTime() : 0);
            data.put("raisehand", engagement.getRaisehand() != null ? engagement.getRaisehand() : 0);
            data.put("emojis", engagement.getEmojis() != null ? engagement.getEmojis() : 0);
            data.put("pollVotes", engagement.getPollVotes() != null ? engagement.getPollVotes() : 0);
            return objectMapper.writeValueAsString(data);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Merge two engagement JSON strings by summing each field.
     * Used when a meeting is recreated on the same schedule (retry scenario).
     */
    private String mergeEngagementJson(String existingJson, String newJson) {
        if (existingJson == null || existingJson.isBlank()) return newJson;
        if (newJson == null || newJson.isBlank()) return existingJson;
        try {
            Map<String, Integer> existingMap = objectMapper.readValue(existingJson,
                    new com.fasterxml.jackson.core.type.TypeReference<Map<String, Integer>>() {});
            Map<String, Integer> newMap = objectMapper.readValue(newJson,
                    new com.fasterxml.jackson.core.type.TypeReference<Map<String, Integer>>() {});

            Map<String, Integer> merged = new java.util.LinkedHashMap<>(existingMap);
            for (Map.Entry<String, Integer> entry : newMap.entrySet()) {
                merged.merge(entry.getKey(), entry.getValue(), Integer::sum);
            }
            return objectMapper.writeValueAsString(merged);
        } catch (Exception e) {
            return newJson; // fallback: use latest
        }
    }

    // -----------------------------------------------------------------------
    // BBB activeness plugin report — POSTed from the learner's browser
    // -----------------------------------------------------------------------

    /**
     * POST /admin-core-service/live-sessions/provider/meeting/bbb-activeness
     *
     * Report from the vacademy-activeness BBB plugin (opt-in per session via
     * bbb_config.activeness_score): an on-device camera attention summary for one
     * learner in one class. No JWT — the plugin runs inside the BBB client — so the
     * request is authenticated by the HMAC token minted into that learner's join URL
     * (BbbActivenessTokenService), which fixes the schedule and learner; nothing in
     * the body can redirect the write.
     *
     * Accepts any content type: the plugin sends text/plain (no CORS preflight) and
     * navigator.sendBeacon for the final report on leave.
     *
     * Body: {"token","avg","on_screen","attention","seconds","away_count","away_seconds","final"}.
     * 204 stored (or stale/throttled/no attendance row, or the feature is switched
     * off), 400 malformed, 401 bad/expired token, 413 oversized.
     *
     * The body is read by hand with a hard cap: this endpoint is unauthenticated, and
     * @RequestBody String would buffer whatever the ingress lets through (hundreds of
     * MB) before any size check could run.
     */
    @PostMapping(value = "/meeting/bbb-activeness", consumes = MediaType.ALL_VALUE)
    public ResponseEntity<Void> bbbActivenessReport(jakarta.servlet.http.HttpServletRequest request) {
        if (!activenessTokenService.isConfigured()) {
            return ResponseEntity.noContent().build();
        }
        if (request.getContentLengthLong() > ACTIVENESS_MAX_BODY_CHARS) {
            return ResponseEntity.status(413).build();
        }
        String body;
        try {
            byte[] bytes = request.getInputStream().readNBytes(ACTIVENESS_MAX_BODY_CHARS + 1);
            if (bytes.length > ACTIVENESS_MAX_BODY_CHARS) {
                return ResponseEntity.status(413).build();
            }
            body = new String(bytes, java.nio.charset.StandardCharsets.UTF_8);
        } catch (java.io.IOException e) {
            return ResponseEntity.badRequest().build();
        }
        if (body.isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        com.fasterxml.jackson.databind.JsonNode root;
        try {
            root = objectMapper.readTree(body);
        } catch (Exception e) {
            return ResponseEntity.badRequest().build();
        }
        if (root == null || !root.isObject()) {
            return ResponseEntity.badRequest().build();
        }

        // Token first: an unauthenticated caller learns nothing about the body rules.
        com.fasterxml.jackson.databind.JsonNode tokenNode = root.get("token");
        Optional<BbbActivenessTokenService.Claims> claims = tokenNode != null && tokenNode.isTextual()
                ? activenessTokenService.verify(tokenNode.asText())
                : Optional.empty();
        if (claims.isEmpty()) {
            return ResponseEntity.status(401).build();
        }

        Integer avg = activenessInt(root, "avg");
        Integer seconds = activenessInt(root, "seconds");
        if (avg == null && seconds == null && root.path("status").isTextual()) {
            return storeActivenessState(claims.get(), root.path("status").asText());
        }
        if (avg == null || seconds == null) {
            return ResponseEntity.badRequest().build();
        }
        Integer onScreen = activenessInt(root, "on_screen");
        Integer attention = activenessInt(root, "attention");
        Integer awayCount = activenessInt(root, "away_count");
        Integer awaySeconds = activenessInt(root, "away_seconds");

        int secs = clamp(seconds, 0, ACTIVENESS_MAX_SECONDS);
        String scheduleId = claims.get().scheduleId();
        String userId = claims.get().userId();
        boolean isFinal = root.path("final").asBoolean(false);
        if (!activenessWriteAllowed(scheduleId + ":" + userId, isFinal)) {
            return ResponseEntity.noContent().build();
        }
        try {
            int updated = liveSessionLogsRepository.mergeActivenessReport(
                    scheduleId, userId,
                    clamp(avg, 0, 100),
                    // -1 = not measured: the repository leaves that key out
                    onScreen != null ? clamp(onScreen, 0, 100) : -1,
                    attention != null ? clamp(attention, 0, 100) : -1,
                    secs,
                    awayCount != null ? clamp(awayCount, 0, 10_000) : 0,
                    awaySeconds != null ? clamp(awaySeconds, 0, secs) : 0);
            if (updated == 0) {
                // No attendance row yet, or an older/out-of-order report than the stored one.
                log.debug("[BBB] Activeness report not stored (stale or no attendance row); scheduleId={}, userId={}",
                        scheduleId, userId);
            } else if (isFinal) {
                log.info("[BBB] Activeness final report stored; scheduleId={}, userId={}, avg={}, seconds={}",
                        scheduleId, userId, clamp(avg, 0, 100), secs);
            }
        } catch (Exception e) {
            log.warn("[BBB] Failed to store activeness report; scheduleId={}, userId={}: {}",
                    scheduleId, userId, e.getMessage());
            return ResponseEntity.status(500).build();
        }
        return ResponseEntity.noContent().build();
    }

    /** A status-only report: why this learner is not being measured (phone, turned off, camera blocked, …). */
    private ResponseEntity<Void> storeActivenessState(BbbActivenessTokenService.Claims claims, String status) {
        Integer state = ACTIVENESS_STATES.get(status);
        if (state == null) {
            return ResponseEntity.badRequest().build();
        }
        String key = claims.scheduleId() + ":" + claims.userId() + ":state";
        if (!activenessWriteAllowed(key, ACTIVENESS_MIN_STATE_GAP_MS)) {
            return ResponseEntity.noContent().build();
        }
        try {
            liveSessionLogsRepository.mergeActivenessState(claims.scheduleId(), claims.userId(), state);
        } catch (Exception e) {
            log.warn("[BBB] Failed to store activeness status; scheduleId={}, userId={}: {}",
                    claims.scheduleId(), claims.userId(), e.getMessage());
            return ResponseEntity.status(500).build();
        }
        return ResponseEntity.noContent().build();
    }

    /** Per-learner write throttle for activeness reports (see ACTIVENESS_MIN_WRITE_GAP_MS). */
    private boolean activenessWriteAllowed(String key, boolean isFinal) {
        return activenessWriteAllowed(key, isFinal ? ACTIVENESS_MIN_FINAL_GAP_MS : ACTIVENESS_MIN_WRITE_GAP_MS);
    }

    private boolean activenessWriteAllowed(String key, long gap) {
        long now = System.currentTimeMillis();
        boolean[] allowed = {false};
        activenessLastWriteAt.compute(key, (k, last) -> {
            if (last == null || now - last >= gap) {
                allowed[0] = true;
                return now;
            }
            return last;
        });
        // Bounded memory: a 400-learner class is 400 keys; drop anything idle 30+ minutes.
        if (activenessLastWriteAt.size() > 20_000) {
            activenessLastWriteAt.values().removeIf(t -> now - t > 30 * 60_000L);
        }
        return allowed[0];
    }

    /** A whole number from the report; null when absent, null or non-numeric. Fractions are rounded. */
    private static Integer activenessInt(com.fasterxml.jackson.databind.JsonNode root, String field) {
        com.fasterxml.jackson.databind.JsonNode n = root.get(field);
        if (n == null || !n.isNumber()) {
            return null;
        }
        double d = n.asDouble();
        if (Double.isNaN(d) || Double.isInfinite(d)) {
            return null;
        }
        // Clamp before the cast so a huge value can't wrap to a negative int.
        return (int) Math.round(Math.max(Integer.MIN_VALUE, Math.min(Integer.MAX_VALUE, d)));
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    // -----------------------------------------------------------------------
    // BBB Recording upload — called by BBB post-publish script
    // -----------------------------------------------------------------------

    /**
     * POST /admin-core-service/live-sessions/provider/meeting/recording/init-upload
     * ?meetingId=xxx&fileName=recording.mp4&fileType=video/mp4
     *
     * Called by the BBB post-publish script to get a presigned S3 upload URL.
     * No auth required — server-to-server from BBB.
     * Simple secret check via X-BBB-Secret header.
     */
    @PostMapping("/meeting/recording/init-upload")
    public ResponseEntity<Map<String, String>> initRecordingUpload(
            @RequestParam String meetingId,
            @RequestParam String fileName,
            @RequestParam(defaultValue = "video/mp4") String fileType,
            @RequestHeader(value = "X-BBB-Secret", required = false) String bbbSecret) {

        // Validate BBB secret
        if (!bbbMeetingManager.validateBbbSecret(bbbSecret)) {
            log.warn("[BBB Recording] Invalid secret for meetingId={}", meetingId);
            return ResponseEntity.status(403).body(Map.of("error", "Invalid BBB secret"));
        }

        log.info("[BBB Recording] Init upload for meetingId={}, fileName={}", meetingId, fileName);

        Map<String, String> presigned = fileService.getPresignedUploadUrl(
                fileName, fileType, "BBB_RECORDING", meetingId);

        return ResponseEntity.ok(Map.of(
                "fileId", presigned.get("id"),
                "uploadUrl", presigned.get("url")));
    }

    /**
     * POST /admin-core-service/live-sessions/provider/meeting/recording/complete
     * Body: { "meetingId": "...", "fileId": "...", "recordingId": "...",
     *         "durationSeconds": 3600, "startTime": "2026-03-15T10:00:00Z" }
     *
     * Called by the BBB post-publish script after the recording MP4 has been
     * uploaded to S3 via the presigned URL. Saves the fileId and metadata
     * into session_schedule.provider_recordings_json.
     */
    @PostMapping("/meeting/recording/complete")
    public ResponseEntity<String> completeRecordingUpload(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = "X-BBB-Secret", required = false) String bbbSecret) {

        if (!bbbMeetingManager.validateBbbSecret(bbbSecret)) {
            log.warn("[BBB Recording] Invalid secret for complete request");
            return ResponseEntity.status(403).body("Invalid BBB secret");
        }

        String meetingId = (String) body.get("meetingId");
        String internalMeetingId = (String) body.get("internalMeetingId");
        String fileId = (String) body.get("fileId");
        String recordingId = (String) body.getOrDefault("recordingId", meetingId);
        long durationSeconds = body.containsKey("durationSeconds")
                ? ((Number) body.get("durationSeconds")).longValue() : 0;
        String startTime = (String) body.getOrDefault("startTime", java.time.Instant.now().toString());
        String recordingType = (String) body.getOrDefault("type", "full");

        log.info("[BBB Recording] Complete upload: meetingId={}, fileId={}, type={}, duration={}s",
                meetingId, fileId, recordingType, durationSeconds);

        // Find schedule by providerMeetingId
        List<SessionSchedule> schedules = scheduleRepository.findByProviderMeetingId(meetingId);
        if (schedules.isEmpty()) {
            log.warn("[BBB Recording] No schedule found for meetingId={}", meetingId);
            return ResponseEntity.ok("No schedule found — recording registered but not linked");
        }

        // Build recording entry. bbbInternalId is what the sync service uses to
        // decide whether a recording has already been uploaded (and therefore
        // whether to ask the heal service to re-run the post-publish hook).
        MeetingRecordingDTO recording = MeetingRecordingDTO.builder()
                .recordingId(recordingId)
                .bbbInternalId(internalMeetingId)
                .fileId(fileId)
                .durationSeconds(durationSeconds)
                .startTime(startTime)
                .providerMeetingId(meetingId)
                .type(recordingType)
                .build();

        for (SessionSchedule schedule : schedules) {
            try {
                // Merge with existing recordings (if any)
                List<MeetingRecordingDTO> recordings = new java.util.ArrayList<>();
                if (schedule.getProviderRecordingsJson() != null
                        && !schedule.getProviderRecordingsJson().isBlank()) {
                    recordings = objectMapper.readValue(schedule.getProviderRecordingsJson(),
                            new com.fasterxml.jackson.core.type.TypeReference<List<MeetingRecordingDTO>>() {});
                    recordings = new java.util.ArrayList<>(recordings);
                }
                // Deduplicate: skip if a recording with the same recordingId already exists
                String finalRecordingId = recordingId;
                boolean alreadyExists = recordings.stream()
                        .anyMatch(r -> finalRecordingId.equals(r.getRecordingId()));
                if (alreadyExists) {
                    log.info("[BBB Recording] Recording {} already exists for scheduleId={}, skipping",
                            recordingId, schedule.getId());
                    continue;
                }
                recordings.add(recording);
                schedule.setProviderRecordingsJson(objectMapper.writeValueAsString(recordings));
                schedule.setLastRecordingSyncAt(new java.util.Date());
                scheduleRepository.save(schedule);
                log.info("[BBB Recording] Saved recording (type={}) for scheduleId={}", recordingType, schedule.getId());

                // Auto-link to chapter slides if the session/institute has an
                // auto-upload destination configured (never throws).
                recordingAutoLinkService.processSchedule(schedule);

                // Kick off YouTube auto-upload if the institute has connected
                // their channel and not disabled auto-upload. Silent skip
                // otherwise — we don't want post-publish to fail because
                // YouTube isn't set up.
                try {
                    youtubeUploadJobService.autoEnqueueIfEnabled(
                            schedule.getId(), recordingId, fileId);
                } catch (Exception ytEx) {
                    log.warn("[YouTube] Auto-enqueue failed for scheduleId={}: {}",
                            schedule.getId(), ytEx.getMessage());
                }
            } catch (Exception e) {
                log.error("[BBB Recording] Failed to save for scheduleId={}: {}",
                        schedule.getId(), e.getMessage());
            }
        }

        return ResponseEntity.ok("OK");
    }

    private void markBbbAttendance(String sessionId, String scheduleId, String userId,
                                    String fullName, String role, String providerMeetingId) {
        // Atomic upsert (V415 unique index) — the join endpoint takes the whole
        // class concurrently at start time, so no check-then-save here.
        liveSessionLogsRepository.upsertBbbJoinAttendance(
                java.util.UUID.randomUUID().toString(),
                sessionId,
                scheduleId,
                "USER",
                userId,
                fullName + " | role=" + role,
                java.time.Instant.now().toString(),
                providerMeetingId);
    }

    // ───────────────────────────── Feedback endpoints ─────────────────────────────

    /**
     * Returns the feedback configuration for a schedule.
     * Learner feedback page calls this on mount to decide whether to show the form.
     */
    @GetMapping("meeting/feedback-config")
    public ResponseEntity<?> getFeedbackConfig(
            @RequestParam String scheduleId,
            @org.springframework.security.core.annotation.AuthenticationPrincipal CustomUserDetails user) {
        try {
            // Look up schedule → session
            SessionSchedule schedule = scheduleRepository.findById(scheduleId).orElse(null);
            if (schedule == null) {
                return ResponseEntity.notFound().build();
            }

            var session = liveSessionRepository.findById(schedule.getSessionId()).orElse(null);
            if (session == null) {
                return ResponseEntity.notFound().build();
            }

            // Parse feedback config
            Object feedbackConfig = null;
            if (session.getFeedbackConfigJson() != null && !session.getFeedbackConfigJson().isBlank()) {
                feedbackConfig = objectMapper.readValue(session.getFeedbackConfigJson(), Object.class);
            }

            // Check if user already submitted
            boolean alreadySubmitted = liveSessionLogsRepository.hasFeedbackBeenSubmitted(
                    scheduleId, user.getUserId());

            // Get institute branding
            String instituteName = null;
            String instituteLogo = null;
            if (session.getInstituteId() != null) {
                var institute = instituteRepository.findById(session.getInstituteId()).orElse(null);
                if (institute != null) {
                    instituteName = institute.getInstituteName();
                    if (institute.getLogoFileId() != null && !institute.getLogoFileId().isBlank()) {
                        instituteLogo = institute.getLogoFileId();
                    }
                }
            }

            var response = vacademy.io.admin_core_service.features.live_session.dto.FeedbackConfigResponseDTO.builder()
                    .feedbackConfig(feedbackConfig)
                    .alreadySubmitted(alreadySubmitted)
                    .sessionTitle(session.getTitle())
                    .instituteName(instituteName)
                    .instituteLogo(instituteLogo)
                    .build();

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("[Feedback] Failed to get feedback config for schedule {}", scheduleId, e);
            return ResponseEntity.internalServerError().body("Failed to get feedback config");
        }
    }

    /**
     * Submits learner feedback for a session.
     * Creates a FEEDBACK_SUBMITTED entry in live_session_logs.
     * Prevents duplicate submissions.
     */
    @PostMapping("meeting/feedback")
    public ResponseEntity<?> submitFeedback(
            @RequestBody vacademy.io.admin_core_service.features.live_session.dto.FeedbackSubmitRequestDTO request,
            @org.springframework.security.core.annotation.AuthenticationPrincipal CustomUserDetails user) {
        try {
            String scheduleId = request.getScheduleId();
            if (scheduleId == null || scheduleId.isBlank()) {
                return ResponseEntity.badRequest().body("scheduleId is required");
            }

            // Look up schedule → session
            SessionSchedule schedule = scheduleRepository.findById(scheduleId).orElse(null);
            if (schedule == null) {
                return ResponseEntity.notFound().build();
            }

            String sessionId = schedule.getSessionId();

            // Prevent duplicate submissions
            if (liveSessionLogsRepository.hasFeedbackBeenSubmitted(scheduleId, user.getUserId())) {
                return ResponseEntity.ok(Map.of("status", "already_submitted",
                        "message", "Feedback already submitted for this session"));
            }

            // Enforce compulsory feedback: when allow_skip is explicitly false, every
            // enabled+mandatory question must have a non-empty answer. The frontend
            // hides the skip button using the same flag — this is the server backstop.
            var sessionForValidation = liveSessionRepository.findById(sessionId).orElse(null);
            if (sessionForValidation != null
                    && sessionForValidation.getFeedbackConfigJson() != null
                    && !sessionForValidation.getFeedbackConfigJson().isBlank()) {
                try {
                    var feedbackConfig = objectMapper.readValue(
                            sessionForValidation.getFeedbackConfigJson(),
                            vacademy.io.admin_core_service.features.live_session.dto.LiveSessionStep1RequestDTO.FeedbackConfigDTO.class);
                    if (feedbackConfig != null
                            && Boolean.FALSE.equals(feedbackConfig.getAllowSkip())
                            && feedbackConfig.getQuestions() != null) {
                        Map<String, Object> responses = request.getResponses() != null
                                ? request.getResponses()
                                : Map.of();
                        for (var question : feedbackConfig.getQuestions()) {
                            if (!Boolean.TRUE.equals(question.getEnabled())) continue;
                            if (!Boolean.TRUE.equals(question.getMandatory())) continue;
                            Object answer = responses.get(question.getId());
                            boolean missing = answer == null
                                    || (answer instanceof String s && s.isBlank());
                            if (missing) {
                                return ResponseEntity.badRequest().body(Map.of(
                                        "status", "validation_failed",
                                        "message", "Mandatory feedback question must be answered: " + question.getLabel(),
                                        "questionId", question.getId()));
                            }
                        }
                    }
                } catch (Exception e) {
                    // Don't block submission on a parse failure — log and accept.
                    log.warn("[Feedback] Could not parse feedback config for validation on schedule {}: {}",
                            scheduleId, e.getMessage());
                }
            }

            // Serialize responses to JSON
            String responsesJson = objectMapper.writeValueAsString(request.getResponses());

            // Create the feedback log entry
            LiveSessionLogs feedbackLog = LiveSessionLogs.builder()
                    .sessionId(sessionId)
                    .scheduleId(scheduleId)
                    .userSourceType("USER")
                    .userSourceId(user.getUserId())
                    .logType(SessionLog.FEEDBACK_SUBMITTED.name())
                    .status("SUBMITTED")
                    .statusType("ONLINE")
                    .details(responsesJson)
                    .createdAt(new Timestamp(System.currentTimeMillis()))
                    .updatedAt(new Timestamp(System.currentTimeMillis()))
                    .build();

            liveSessionLogsRepository.save(feedbackLog);

            return ResponseEntity.ok(Map.of("status", "success",
                    "message", "Feedback submitted successfully"));
        } catch (Exception e) {
            log.error("[Feedback] Failed to submit feedback", e);
            return ResponseEntity.internalServerError().body("Failed to submit feedback");
        }
    }

    // -----------------------------------------------------------------------
    // Helpers for /meeting/join
    // -----------------------------------------------------------------------

    /**
     * Builds the BBB create-meeting request for a given schedule, pulling
     * sessionTitle/instituteId/bbbConfig from the parent live_session row and
     * falling back to the schedule's defaultClassName for the topic. Invoked
     * lazily by {@link LiveSessionProviderService#ensureMeetingForSchedule} —
     * only on the race-winner path where a fresh BBB /create is needed.
     */
    private ProviderMeetingCreateRequestDTO buildBbbCreateRequest(String scheduleId) {
        SessionSchedule schedule = scheduleRepository.findById(scheduleId)
                .orElseThrow(() -> new vacademy.io.common.exceptions.VacademyException("Schedule not found: " + scheduleId));

        String sessionTitle = "Live Class";
        String instituteId = null;
        java.util.Map<String, Object> bbbConfig = null;

        if (schedule.getSessionId() != null) {
            var sessionOpt = liveSessionRepository.findById(schedule.getSessionId());
            if (sessionOpt.isPresent()) {
                var session = sessionOpt.get();
                if (session.getTitle() != null && !session.getTitle().isBlank()) {
                    sessionTitle = session.getTitle();
                }
                instituteId = session.getInstituteId();
                if (session.getBbbConfigJson() != null && !session.getBbbConfigJson().isBlank()) {
                    try {
                        bbbConfig = objectMapper.readValue(session.getBbbConfigJson(),
                                new com.fasterxml.jackson.core.type.TypeReference<java.util.Map<String, Object>>() {});
                    } catch (Exception e) {
                        log.warn("[BBB] Failed to parse bbbConfigJson: {}", e.getMessage());
                    }
                }
            }
        }
        if ("Live Class".equals(sessionTitle)
                && schedule.getDefaultClassName() != null && !schedule.getDefaultClassName().isBlank()) {
            sessionTitle = schedule.getDefaultClassName();
        }

        // Derive the meeting length from the schedule's start -> last-entry window.
        // last_entry_time is the schedule's END boundary (SessionScheduleRepository
        // aliases it AS endTime; reschedule writes the new end time into it), so
        // start->last_entry == the chosen class length. This mirrors
        // ProviderMeetingBatchService.deriveDurationMinutes. BbbMeetingManager adds a
        // +30 min buffer on top so a class is never cut short; fall back to 120 only
        // when the window is missing/zero.
        int durationMinutes = 120;
        if (schedule.getStartTime() != null && schedule.getLastEntryTime() != null) {
            long windowMinutes = java.time.Duration.between(
                    schedule.getStartTime().toLocalTime(),
                    schedule.getLastEntryTime().toLocalTime()).toMinutes();
            if (windowMinutes > 0) {
                durationMinutes = (int) windowMinutes;
            }
        }

        return ProviderMeetingCreateRequestDTO.builder()
                .instituteId(instituteId)
                .sessionId(schedule.getSessionId())
                .scheduleId(scheduleId)
                .topic(sessionTitle)
                .provider(MeetingProvider.BBB_MEETING.name())
                .durationMinutes(durationMinutes)
                .bbbConfig(bbbConfig)
                .build();
    }

    /**
     * Resolves the instituteId for a schedule by walking through its parent
     * live_session row. Used to apply per-institute branding (theme color, etc.)
     * to the generated join URL.
     */
    /**
     * The session's bbb_config_json as a map (snake_case keys, see BbbConfigDTO);
     * empty when missing or unparseable. Read at join time for:
     * - disable_mic: the meeting was created with the participant mic lock on, so the
     *   join URL must not also tell the client a microphone is required — a viewer
     *   would then have no audio at all. Missing/unparseable = false, which preserves
     *   the historical join behaviour.
     * - activeness_score: whether viewers get a vacademy-activeness plugin token.
     */
    private Map<String, Object> resolveSessionBbbConfig(SessionSchedule schedule) {
        if (schedule == null || schedule.getSessionId() == null) {
            return Map.of();
        }
        try {
            return liveSessionRepository.findById(schedule.getSessionId())
                    .map(s -> s.getBbbConfigJson())
                    .filter(json -> json != null && !json.isBlank())
                    .map(json -> {
                        try {
                            java.util.Map<String, Object> cfg = objectMapper.readValue(json,
                                    new com.fasterxml.jackson.core.type.TypeReference<java.util.Map<String, Object>>() {});
                            return cfg != null ? cfg : Map.<String, Object>of();
                        } catch (Exception e) {
                            log.warn("[BBB] Failed to parse bbbConfigJson for join: {}", e.getMessage());
                            return Map.<String, Object>of();
                        }
                    })
                    .orElse(Map.of());
        } catch (Exception e) {
            log.warn("[BBB] Failed to resolve bbb config for schedule {}: {}", schedule.getId(), e.getMessage());
            return Map.of();
        }
    }

    private String resolveInstituteId(SessionSchedule schedule) {
        if (schedule == null || schedule.getSessionId() == null) {
            return null;
        }
        return liveSessionRepository.findById(schedule.getSessionId())
                .map(s -> s.getInstituteId())
                .orElse(null);
    }

    /** Resolves the owning institute for a live_session id (for cross-tenant authz). */
    private String resolveSessionInstituteId(String sessionId) {
        if (sessionId == null || sessionId.isBlank()) {
            return null;
        }
        return liveSessionRepository.findById(sessionId)
                .map(s -> s.getInstituteId())
                .orElse(null);
    }
}
