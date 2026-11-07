package vacademy.io.admin_core_service.features.live_session.provider.service;

import jakarta.persistence.EntityManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientRequestException;
import com.fasterxml.jackson.databind.ObjectMapper;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.provider.LiveSessionProviderFactory;
import vacademy.io.admin_core_service.features.live_session.service.RecordingAutoLinkService;
import vacademy.io.admin_core_service.features.live_session.provider.LiveSessionProviderStrategy;
import vacademy.io.admin_core_service.features.live_session.provider.dto.ProviderMeetingCreateRequestDTO;
import vacademy.io.admin_core_service.features.live_session.provider.dto.ProviderConnectRequestDTO;
import vacademy.io.admin_core_service.features.live_session.provider.dto.RecordingSyncResultDTO;
import vacademy.io.admin_core_service.features.live_session.provider.entity.BbbServerPool;
import vacademy.io.admin_core_service.features.live_session.provider.entity.LiveSessionProviderConfig;
import vacademy.io.admin_core_service.features.live_session.provider.manager.BbbMeetingManager;
import vacademy.io.admin_core_service.features.live_session.provider.repository.LiveSessionProviderConfigRepository;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionRepository;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;
import vacademy.io.admin_core_service.features.live_session.provider.support.ScheduleConflicts;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.common.media.dto.FileDetailsDTO;
import vacademy.io.common.tracing.ExternalCallTimer;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.meeting.dto.CreateMeetingRequestDTO;
import vacademy.io.common.meeting.dto.CreateMeetingResponseDTO;
import vacademy.io.common.meeting.dto.MeetingAttendeeDTO;
import vacademy.io.common.meeting.dto.MeetingRecordingDTO;
import vacademy.io.common.meeting.dto.ParticipantJoinLinkDTO;
import vacademy.io.common.meeting.dto.UserScheduleAvailabilityDTO;
import vacademy.io.common.meeting.enums.MeetingProvider;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.URI;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Supplier;
import java.util.stream.Collectors;
import org.springframework.web.multipart.MultipartFile;

/**
 * Orchestrates all live session provider operations.
 * Uses SessionSchedule directly — no separate provider-meeting table needed.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class LiveSessionProviderService {

    private final EntityManager entityManager;
    private final ObjectMapper objectMapper;
    private final LiveSessionProviderFactory providerFactory;
    private final LiveSessionProviderConfigRepository configRepository;
    private final SessionScheduleRepository scheduleRepository;
    private final LiveSessionRepository sessionRepository;
    private final MediaService mediaService;
    private final WebClient.Builder webClientBuilder;
    private final BbbServerRouter bbbServerRouter;
    private final RecordingAutoLinkService recordingAutoLinkService;
    private final vacademy.io.admin_core_service.features.live_session.provider.service.zoom.ZoomRecordingS3Service zoomRecordingS3Service;
    private final vacademy.io.admin_core_service.features.live_session.provider.manager.ZoomMeetingManager zoomMeetingManager;

    private static final List<String> ACTIVE = List.of("ACTIVE");

    /** How long a caller will queue behind an in-flight BBB /create before giving up. */
    private static final String SCHEDULE_LOCK_TIMEOUT = "10s";

    /**
     * Bound how long the SELECT ... FOR UPDATE below may wait for the row lock.
     *
     * The @QueryHints jakarta.persistence.lock.timeout on
     * SessionScheduleRepository#findByIdForUpdate does NOT do this on PostgreSQL:
     * Postgres only understands NOWAIT / SKIP LOCKED on FOR UPDATE, it has no
     * per-statement lock wait, so Hibernate silently drops the hint and the server
     * default (lock_timeout = 0, i.e. wait forever) applies. That is why joins
     * queued 14-15s -- and once 227s -- behind a slow BBB /create on 2026-08-22,
     * each one pinning a pooled connection for the whole wait.
     *
     * SET LOCAL, not SET: it is scoped to this transaction and reverts on
     * commit/rollback. pgbouncer runs in transaction pooling, so a plain SET would
     * stay on the server connection and silently apply to whatever service picked
     * it up next.
     *
     * On expiry Postgres raises SQLSTATE 55P03, which Hibernate maps to
     * PessimisticLockException and Spring to PessimisticLockingFailureException --
     * the exception LiveSessionProviderController#joinBbbMeeting already catches to
     * return 503 "Meeting is being created, please retry".
     */
    private void boundScheduleLockWait() {
        entityManager.createNativeQuery("SET LOCAL lock_timeout = '" + SCHEDULE_LOCK_TIMEOUT + "'")
                .executeUpdate();
    }

    // -----------------------------------------------------------------------
    // OAuth connect
    // -----------------------------------------------------------------------

    public LiveSessionProviderConfig connectProvider(String providerName, ProviderConnectRequestDTO request) {
        String normalizedProvider = MeetingProvider.fromString(providerName).name();
        return providerFactory.getStrategy(normalizedProvider).connectProvider(request);
    }

    public LiveSessionProviderConfig connectSdkProvider(String providerName, ProviderConnectRequestDTO request) {
        String normalizedProvider = MeetingProvider.fromString(providerName).name();
        return providerFactory.getStrategy(normalizedProvider).connectSdkProvider(request);
    }

    public boolean isProviderConnected(String instituteId, String providerName) {
        String normalizedProvider = MeetingProvider.fromString(providerName).name();
        // For BBB, check Vacademy-level config (instituteId IS NULL)
        if (MeetingProvider.BBB_MEETING.name().equals(normalizedProvider)) {
            return configRepository.findByProviderAndStatusIn(normalizedProvider, ACTIVE).isPresent();
        }
        return configRepository.existsByInstituteIdAndProviderAndStatusIn(instituteId, normalizedProvider, ACTIVE);
    }

    /** Returns config with secrets masked — safe for dashboard display */
    public Optional<Map<String, Object>> getProviderConfigDisplay(String instituteId, String provider) {
        return configRepository
                .findByInstituteIdAndProviderAndStatusIn(instituteId, provider, ACTIVE)
                .map(cfg -> {
                    try {
                        Map<String, Object> map = objectMapper.readValue(cfg.getConfigJson(),
                                new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {
                                });
                        map.remove("clientSecret");
                        map.remove("accessToken");
                        map.remove("refreshToken");
                        return map;
                    } catch (Exception e) {
                        throw new VacademyException("Failed to read provider config");
                    }
                });
    }

    // -----------------------------------------------------------------------
    // Create meeting
    // -----------------------------------------------------------------------

    /**
     * Idempotent, race-free variant of createMeeting for the BBB /meeting/join
     * endpoint. Acquires a pessimistic row lock on the schedule, then either
     * returns the existing meeting (race-loser path) or creates a new one
     * exactly once.
     *
     * <p>Why this exists: the original /meeting/join did a check-then-act on
     * {@code providerMeetingId} without a lock. Two concurrent first-join
     * requests (e.g. faculty + a learner clicking within the same ~1s window)
     * could both see {@code providerMeetingId == null}, both call BBB /create,
     * and end up in two different rooms — symptom: "faculty can't see learners
     * until they leave and rejoin". This method serializes the create on the
     * row's pessimistic lock so exactly one BBB /create ever happens per
     * schedule.
     *
     * @param scheduleId       schedule whose meeting we're ensuring
     * @param requestSupplier  builds the {@link ProviderMeetingCreateRequestDTO}
     *                         lazily — only invoked if a fresh /create is needed,
     *                         so the caller doesn't pay the lookup cost on the
     *                         race-loser path
     * @param recreate         if true and role=MODERATOR, clear the existing
     *                         meeting so a fresh one is created. Caller is
     *                         expected to gate this on the prior MEETING_ENDED
     *                         response — there is no in-process double-click
     *                         protection (BBB reports just-created meetings as
     *                         not-running until first join, so a probe-based
     *                         check would give false positives).
     * @param role             "MODERATOR" or "VIEWER"; recreate is moderator-only
     */
    @Transactional
    public CreateMeetingResponseDTO ensureMeetingForSchedule(
            String scheduleId,
            Supplier<ProviderMeetingCreateRequestDTO> requestSupplier,
            boolean recreate, String role) {

        boundScheduleLockWait();
        SessionSchedule schedule = scheduleRepository.findByIdForUpdate(scheduleId)
                .orElseThrow(() -> new VacademyException("Schedule not found: " + scheduleId));

        // Moderator-only recreate: clear the old IDs so the create branch below
        // runs. Honored unconditionally because BBB reports just-created
        // meetings as running=false until first participant joins — any
        // probe-based "is the existing one really dead?" guard would
        // false-positive in exactly the double-click window it tries to cover.
        if (recreate && "MODERATOR".equalsIgnoreCase(role)
                && schedule.getProviderMeetingId() != null && !schedule.getProviderMeetingId().isBlank()) {
            log.info("[BBB] Moderator requested recreate for scheduleId={}, clearing old meetingId={}",
                    scheduleId, schedule.getProviderMeetingId());
            schedule.setProviderMeetingId(null);
            schedule.setCustomMeetingLink(null);
            schedule.setProviderHostUrl(null);
        }

        // Race-loser path: another concurrent caller created the meeting while
        // we waited on the lock. Return the persisted IDs without calling BBB.
        if (schedule.getProviderMeetingId() != null && !schedule.getProviderMeetingId().isBlank()) {
            return CreateMeetingResponseDTO.builder()
                    .providerMeetingId(schedule.getProviderMeetingId())
                    .joinUrl(schedule.getCustomMeetingLink())
                    .hostUrl(schedule.getProviderHostUrl())
                    .justCreated(false)
                    .build();
        }

        // Race-winner path: we hold the lock and the row has no meeting yet.
        ProviderMeetingCreateRequestDTO request = requestSupplier.get();
        String providerName = resolveProviderName(request);
        LiveSessionProviderStrategy strategy = providerFactory.getStrategy(providerName);

        CreateMeetingRequestDTO meetingRequest = CreateMeetingRequestDTO.builder()
                .topic(request.getTopic())
                .agenda(request.getAgenda())
                .startTime(request.getStartTime())
                .durationMinutes(request.getDurationMinutes())
                .timezone(request.getTimezone())
                .hostEmail(request.getHostEmail())
                .sessionId(request.getSessionId())
                .scheduleId(request.getScheduleId())
                .bbbConfig(request.getBbbConfig())
                .build();

        // BBB /create call — if this throws, the @Transactional rolls back and
        // the row's providerMeetingId stays null. No orphan/partial state.
        // Attributed to `ext`: this is BBB/Zoom creating the room, not our compute.
        // Without the split, the first learner into a live class sees a ~2s request
        // and the speed indicator blames us for the provider's work.
        CreateMeetingResponseDTO response = ExternalCallTimer.time(
                () -> strategy.createMeeting(meetingRequest, request.getInstituteId()));

        // Persist provider IDs onto the locked entity. Same field-set rules as
        // the legacy createMeeting() to preserve frontend-friendly linkType
        // ("bbb") and BBB server pinning for multi-server pools.
        schedule.setCustomMeetingLink(response.getJoinUrl());
        if (schedule.getLinkType() == null || schedule.getLinkType().isBlank()) {
            schedule.setLinkType(providerName);
        }
        schedule.setProviderMeetingId(response.getProviderMeetingId());
        schedule.setProviderHostUrl(response.getHostUrl());
        if (response.getRawResponse() != null && response.getRawResponse().containsKey("bbbServerId")) {
            schedule.setBbbServerId((String) response.getRawResponse().get("bbbServerId"));
        }
        scheduleRepository.save(schedule);

        if (schedule.getSessionId() != null) {
            sessionRepository.findById(schedule.getSessionId()).ifPresent(session -> {
                session.setDefaultMeetLink(response.getJoinUrl());
                if (session.getLinkType() == null || session.getLinkType().isBlank()) {
                    session.setLinkType(providerName);
                }
                sessionRepository.save(session);
            });
        }

        log.info("Schedule {} updated with meetingKey={} for provider={}", scheduleId,
                response.getProviderMeetingId(), providerName);

        response.setJustCreated(true);
        return response;
    }

    @Transactional
    public CreateMeetingResponseDTO createMeeting(ProviderMeetingCreateRequestDTO request) {
        String providerName = resolveProviderName(request);
        LiveSessionProviderStrategy strategy = providerFactory.getStrategy(providerName);

        // Idempotency guard: lock the schedule row and skip the provider call if a meeting
        // already exists. A retry, a concurrent batch run, or a double-click would otherwise
        // create a DUPLICATE Zoom/BBB meeting (the loadPending filter alone is read-then-act,
        // i.e. racy). The lock is held until commit, so a racing caller blocks then observes
        // the persisted id and returns it without hitting the provider again.
        if (request.getScheduleId() != null) {
            boundScheduleLockWait();
            SessionSchedule existing = scheduleRepository.findByIdForUpdate(request.getScheduleId())
                    .orElse(null);
            if (existing != null && existing.getProviderMeetingId() != null
                    && !existing.getProviderMeetingId().isBlank()) {
                return CreateMeetingResponseDTO.builder()
                        .providerMeetingId(existing.getProviderMeetingId())
                        .joinUrl(existing.getCustomMeetingLink())
                        .hostUrl(existing.getProviderHostUrl())
                        .justCreated(false)
                        .build();
            }
        }

        CreateMeetingRequestDTO meetingRequest = CreateMeetingRequestDTO.builder()
                .topic(request.getTopic())
                .agenda(request.getAgenda())
                .startTime(request.getStartTime())
                .durationMinutes(request.getDurationMinutes())
                .timezone(request.getTimezone())
                .hostEmail(request.getHostEmail())
                .sessionId(request.getSessionId())
                .scheduleId(request.getScheduleId())
                // Vendor-neutral fields (preferred); legacy per-vendor fields kept
                // for one transition release.
                .providerConfig(request.resolveProviderConfig())
                .providerAccountId(request.resolveProviderAccountId())
                .bbbConfig(request.getBbbConfig())
                .zoomAccountId(request.getZoomAccountId())
                .zoomConfig(request.getZoomConfig())
                .build();

        // Attributed to `ext`: this is BBB/Zoom creating the room, not our compute.
        // Without the split, the first learner into a live class sees a ~2s request
        // and the speed indicator blames us for the provider's work.
        CreateMeetingResponseDTO response = ExternalCallTimer.time(
                () -> strategy.createMeeting(meetingRequest, request.getInstituteId()));

        // Write everything back to the schedule row — no extra table needed
        if (request.getScheduleId() != null) {
            scheduleRepository.findById(request.getScheduleId()).ifPresent(schedule -> {
                schedule.setCustomMeetingLink(response.getJoinUrl()); // learner join URL
                // Set linkType when the row does not already carry a real one — preserving a
                // frontend-friendly value ("bbb") the wizard already chose, but replacing the
                // "UNKNOWN" placeholder, which is NOT a choice (see isUnsetLinkType).
                if (isUnsetLinkType(schedule.getLinkType())) {
                    schedule.setLinkType(frontendLinkType(providerName));
                }
                schedule.setProviderMeetingId(response.getProviderMeetingId());
                schedule.setProviderHostUrl(response.getHostUrl());

                // Pin the meeting to its BBB server (multi-server pool support)
                if (response.getRawResponse() != null
                        && response.getRawResponse().containsKey("bbbServerId")) {
                    schedule.setBbbServerId((String) response.getRawResponse().get("bbbServerId"));
                }

                // Pin the meeting to the provider-account row it was created under so
                // join/recording/attendance ops resolve the right credentials later.
                // Generic across providers — providers signal this by putting
                // "providerAccountId" into the response's rawResponse map.
                if (response.getRawResponse() != null
                        && response.getRawResponse().containsKey("providerAccountId")) {
                    schedule.setProviderAccountId((String) response.getRawResponse().get("providerAccountId"));
                    // Persist the plain passcode so the embedded SDK can join seamlessly.
                    Object passcode = response.getRawResponse().get("passcode");
                    if (passcode != null) {
                        schedule.setProviderPasscode(passcode.toString());
                    }
                }

                scheduleRepository.save(schedule);

                if (schedule.getSessionId() != null) {
                    sessionRepository.findById(schedule.getSessionId()).ifPresent(session -> {
                        session.setDefaultMeetLink(response.getJoinUrl());
                        if (session.getLinkType() == null || session.getLinkType().isBlank()) {
                            session.setLinkType(providerName);
                        }
                        sessionRepository.save(session);
                    });
                }

                log.info("Schedule {} updated with meetingKey={} for provider={}", request.getScheduleId(),
                        response.getProviderMeetingId(), providerName);
            });
        }

        return response;
    }

    // -----------------------------------------------------------------------
    // Recordings & Attendance (on-demand)
    // -----------------------------------------------------------------------

    public List<MeetingRecordingDTO> getRecordings(String scheduleId, String instituteId) {
        SessionSchedule schedule = scheduleRepository.findById(scheduleId)
                .orElseThrow(() -> new VacademyException("Schedule not found: " + scheduleId));
        return enrichUrls(parseExistingRecordings(schedule));
    }

    /**
     * Admin-triggered "Sync to S3": mirrors every not-yet-mirrored Zoom cloud
     * recording of a schedule to Vacademy storage so it survives Zoom's auto-delete.
     * Idempotent (already-mirrored recordings are skipped). Returns the updated
     * recording list with the count newly mirrored.
     */
    public RecordingSyncResultDTO syncRecordingsToS3(String scheduleId, String instituteId) {
        SessionSchedule schedule = scheduleRepository.findById(scheduleId)
                .orElseThrow(() -> new VacademyException("Schedule not found: " + scheduleId));
        int mirrored = zoomRecordingS3Service.mirrorToS3(schedule, false, 0);
        return RecordingSyncResultDTO.ok(getRecordings(scheduleId, instituteId), mirrored);
    }

    // -----------------------------------------------------------------------
    // Sync recordings from BBB (admin escape hatch)
    // -----------------------------------------------------------------------

    /**
     * Fetches recordings directly from BBB for the given schedule, downloads any
     * that are missing from our DB, uploads them to S3, and persists the fileIds.
     *
     * Designed to be resilient: BBB being offline returns status=BBB_OFFLINE with
     * current DB state. Per-recording failures degrade to status=PARTIAL so other
     * recordings are still processed.
     */
    public RecordingSyncResultDTO syncRecordingsFromBbb(String scheduleId, String instituteId) {
        // BC-1: Schedule not found
        SessionSchedule schedule = scheduleRepository.findById(scheduleId)
                .orElseThrow(() -> new VacademyException("Schedule not found: " + scheduleId));

        // BC-2: No BBB meeting linked
        if (schedule.getProviderMeetingId() == null || schedule.getProviderMeetingId().isBlank()) {
            return RecordingSyncResultDTO.ok(getRecordings(scheduleId, instituteId), 0);
        }

        // Step 1: Ask BBB for recordings (15-second timeout for offline detection)
        List<MeetingRecordingDTO> bbbRecordings;
        try {
            bbbRecordings = ((BbbMeetingManager) providerFactory.getStrategy(
                    MeetingProvider.BBB_MEETING.name()))
                    .getRecordings(schedule.getProviderMeetingId(), instituteId, schedule.getBbbServerId());
        } catch (WebClientRequestException e) {
            // BC-3: Connection refused / network unreachable
            log.warn("[Sync] BBB offline (connection error) for scheduleId={}: {}", scheduleId, e.getMessage());
            return RecordingSyncResultDTO.bbbOffline(getRecordings(scheduleId, instituteId));
        } catch (Exception e) {
            // BC-3: Timeout or other BBB error
            log.warn("[Sync] BBB unreachable for scheduleId={}: {}", scheduleId, e.getMessage());
            return RecordingSyncResultDTO.bbbOffline(getRecordings(scheduleId, instituteId));
        }

        // BC-4: BBB has no recordings at all.
        // This can mean one of two things:
        //   (a) No recording was ever captured (truly empty) — return NOT_FOUND
        //   (b) Raw files exist on the BBB server but the rap-worker pipeline stalled
        //       before publishing — ask the heal service to restart the pipeline.
        if (bbbRecordings.isEmpty()) {
            return tryHealStalledRecording(schedule, instituteId);
        }

        // Step 2: Load existing DB recordings, collect already-synced recordingIds
        List<MeetingRecordingDTO> existing = parseExistingRecordings(schedule);
        Set<String> syncedIds = existing.stream()
                .filter(r -> r.getFileId() != null && !r.getFileId().isBlank())
                .map(MeetingRecordingDTO::getRecordingId)
                .collect(Collectors.toSet());
        Set<String> registeredInternalIds = existing.stream()
                .filter(r -> r.getFileId() != null && !r.getFileId().isBlank())
                .map(MeetingRecordingDTO::getBbbInternalId)
                .filter(id -> id != null && !id.isBlank())
                .collect(Collectors.toSet());

        List<MeetingRecordingDTO> updated = new ArrayList<>(existing);
        int newCount = 0;
        int failCount = 0;
        boolean republishTriggered = false;

        for (MeetingRecordingDTO bbbRec : bbbRecordings) {
            // BC-5: Already in DB with fileId — skip (idempotent)
            if (syncedIds.contains(bbbRec.getRecordingId())) continue;

            // BC-6: BBB has this recording but no downloadable URL. This is the
            // normal case — BBB's getRecordings only advertises the HTML playback
            // page; the actual MP4 upload is handled by the post-publish hook on
            // the BBB server. If we don't yet have an S3 row for this recordId,
            // ask the heal service to re-run the hook on the BBB host.
            //
            // Short-circuit once we've triggered a republish: each /republish
            // call blocks up to 15s, and a meeting may have several formats
            // (content / webcams / presenter) sharing one bbbInternalId.
            // Without this, sync could block for 75s+ → gateway timeout.
            if (bbbRec.getPlaybackUrl() == null || bbbRec.getPlaybackUrl().isBlank()) {
                String bbbInternalId = bbbRec.getBbbInternalId();
                boolean alreadyUploaded = bbbInternalId != null
                        && registeredInternalIds.contains(bbbInternalId);
                if (!alreadyUploaded && !republishTriggered
                        && bbbInternalId != null && !bbbInternalId.isBlank()
                        && triggerRepublish(bbbInternalId, schedule)) {
                    republishTriggered = true;
                    continue;
                }
                if (republishTriggered) continue; // sibling format — same hook will produce all
                log.warn("[Sync] BBB recording {} has no URL, skipping", bbbRec.getRecordingId());
                failCount++;
                continue;
            }

            try {
                // Step 3: Download from BBB (BC-7, BC-8: timeout + 4xx/5xx handled inside)
                byte[] fileBytes = downloadFromUrl(bbbRec.getPlaybackUrl());

                // BC-9: Empty/corrupt download
                if (fileBytes == null || fileBytes.length == 0) {
                    log.warn("[Sync] Empty download for recording {}", bbbRec.getRecordingId());
                    failCount++;
                    continue;
                }

                // Step 4: Upload to S3 via MediaService
                String fileName = schedule.getProviderMeetingId() + "-"
                        + (bbbRec.getType() != null ? bbbRec.getType() : "recording") + ".mp4";
                MultipartFile multipartFile = new ByteArrayMultipartFile(fileBytes, fileName, "video/mp4");
                // Use V2 endpoint: returns FileDetailsDTO with both id and url.
                // (V1 uploadFile returns the S3 URL as a String, not a fileId — passing
                //  that URL back to getFilePublicUrlByIdWithoutExpiry yields 510 File Not Found.)
                FileDetailsDTO uploaded = mediaService.uploadFileV2(multipartFile); // BC-10: upload failure
                String fileId = uploaded.getId();
                String s3Url = uploaded.getUrl();
                MeetingRecordingDTO synced = MeetingRecordingDTO.builder()
                        .recordingId(bbbRec.getRecordingId())
                        .fileId(fileId)
                        .type(bbbRec.getType())
                        .durationSeconds(bbbRec.getDurationSeconds())
                        .startTime(bbbRec.getStartTime())
                        .providerMeetingId(bbbRec.getProviderMeetingId())
                        .downloadUrl(s3Url)
                        .playbackUrl(s3Url)
                        .build();

                updated.add(synced);
                newCount++;
                log.info("[Sync] Synced recording {} (type={}) for scheduleId={}",
                        bbbRec.getRecordingId(), bbbRec.getType(), scheduleId);

            } catch (Exception e) {
                // BC-11: Per-recording failure — log and continue with others
                log.error("[Sync] Failed to sync recording {} for scheduleId={}: {}",
                        bbbRec.getRecordingId(), scheduleId, e.getMessage());
                failCount++;
            }
        }

        // Step 6: Persist only if something new was added
        if (newCount > 0) {
            try {
                schedule.setProviderRecordingsJson(objectMapper.writeValueAsString(updated));
                schedule.setLastRecordingSyncAt(new Date());
                scheduleRepository.save(schedule);
                // Auto-link newly synced recordings to chapter slides when an
                // auto-upload destination is configured (never throws).
                recordingAutoLinkService.processSchedule(schedule);
            } catch (Exception e) {
                // BC-12: DB write failure — return in-memory results, log error
                log.error("[Sync] Failed to persist synced recordings for scheduleId={}: {}",
                        scheduleId, e.getMessage());
            }
        }

        // BC-13: Enrich all URLs before returning
        List<MeetingRecordingDTO> enriched = enrichUrls(updated);

        // If we asked the BBB host to re-run the post-publish hook, surface that
        // state to the UI so it knows to poll again in a few minutes.
        if (republishTriggered && newCount == 0) {
            return RecordingSyncResultDTO.reprocessing(enriched);
        }
        if (failCount > 0 && newCount == 0) {
            return RecordingSyncResultDTO.bbbOffline(enriched); // all failed — treat as offline
        }
        if (failCount > 0) {
            return RecordingSyncResultDTO.partial(enriched, newCount, failCount);
        }
        return RecordingSyncResultDTO.ok(enriched, newCount);
    }

    /**
     * Called when BBB's getRecordings API returns empty for a meeting we believe
     * should have a recording. Asks the BBB heal service to check whether raw
     * files exist on disk and restart the stalled pipeline if so.
     *
     * Returns:
     *   RECOVERING  — pipeline was stalled; rebuild triggered, check back in ~10 min
     *   NOT_FOUND   — heal service confirmed no raw files exist on the BBB server
     *   OK          — heal service unreachable OR returned an unexpected state
     *                 (falls back to the legacy "Already up to date" behavior so
     *                  an outage of the heal service never breaks the sync endpoint)
     */
    private RecordingSyncResultDTO tryHealStalledRecording(SessionSchedule schedule, String instituteId) {
        String scheduleId = schedule.getId();
        List<MeetingRecordingDTO> currentDbState = getRecordings(scheduleId, instituteId);

        // If we don't know which server this meeting ran on, we can't reach the heal service
        if (schedule.getBbbServerId() == null || schedule.getBbbServerId().isBlank()) {
            return RecordingSyncResultDTO.ok(currentDbState, 0);
        }

        BbbServerPool server;
        try {
            server = bbbServerRouter.getServer(schedule.getBbbServerId());
        } catch (Exception e) {
            log.warn("[Heal] Could not resolve BBB server {} for scheduleId={}: {}",
                    schedule.getBbbServerId(), scheduleId, e.getMessage());
            return RecordingSyncResultDTO.ok(currentDbState, 0);
        }

        String healBaseUrl = deriveHealBaseUrl(server.getApiUrl());
        if (healBaseUrl == null) {
            log.warn("[Heal] Could not derive heal URL from apiUrl={}", server.getApiUrl());
            return RecordingSyncResultDTO.ok(currentDbState, 0);
        }

        String externalId = schedule.getProviderMeetingId();
        Map<String, Object> healResponse;
        try {
            healResponse = webClientBuilder.build()
                    .post()
                    .uri(URI.create(healBaseUrl + "/heal?externalMeetingId=" + externalId))
                    .header("X-BBB-Secret", server.getSecret())
                    .retrieve()
                    .bodyToMono(new org.springframework.core.ParameterizedTypeReference<Map<String, Object>>() {})
                    .timeout(Duration.ofSeconds(35))
                    .block();
        } catch (Exception e) {
            log.warn("[Heal] Heal service unreachable at {} for scheduleId={}: {}",
                    healBaseUrl, scheduleId, e.getMessage());
            return RecordingSyncResultDTO.ok(currentDbState, 0);
        }

        if (healResponse == null) {
            return RecordingSyncResultDTO.ok(currentDbState, 0);
        }

        String status = String.valueOf(healResponse.getOrDefault("status", ""));
        String previousState = String.valueOf(healResponse.getOrDefault("previousState", "unknown"));

        log.info("[Heal] scheduleId={} externalId={} healStatus={} previousState={}",
                scheduleId, externalId, status, previousState);

        switch (status) {
            case "REBUILD_TRIGGERED":
            case "RATE_LIMITED":
                // RATE_LIMITED means a rebuild was already triggered recently — still recovering
                return RecordingSyncResultDTO.recovering(currentDbState, previousState);
            case "NOT_FOUND":
                return RecordingSyncResultDTO.notFound(currentDbState);
            case "ALREADY_PUBLISHED":
                // BBB says published but getRecordings returned empty — BBB internal lag.
                // Return OK so the user retries in a moment.
                return RecordingSyncResultDTO.ok(currentDbState, 0);
            default:
                log.warn("[Heal] Unexpected heal service status '{}' for scheduleId={}", status, scheduleId);
                return RecordingSyncResultDTO.ok(currentDbState, 0);
        }
    }

    /**
     * Calls the heal service /republish endpoint to re-run the post-publish hook
     * for a recording that exists on BBB but wasn't uploaded to S3 (e.g. because
     * the original hook run failed to register with the backend).
     *
     * Returns true if the heal service accepted the request (REPUBLISH_TRIGGERED
     * or RATE_LIMITED — both mean a reprocess is in-flight). False on any error
     * or unexpected status; caller falls back to the normal fail path.
     */
    private boolean triggerRepublish(String recordId, SessionSchedule schedule) {
        if (schedule.getBbbServerId() == null || schedule.getBbbServerId().isBlank()) {
            return false;
        }
        BbbServerPool server;
        try {
            server = bbbServerRouter.getServer(schedule.getBbbServerId());
        } catch (Exception e) {
            log.warn("[Republish] Could not resolve server {}: {}", schedule.getBbbServerId(), e.getMessage());
            return false;
        }
        String healBaseUrl = deriveHealBaseUrl(server.getApiUrl());
        if (healBaseUrl == null) {
            log.warn("[Republish] Could not derive heal URL from apiUrl={}", server.getApiUrl());
            return false;
        }
        try {
            Map<String, Object> resp = webClientBuilder.build()
                    .post()
                    .uri(URI.create(healBaseUrl + "/republish?recordId=" + recordId))
                    .header("X-BBB-Secret", server.getSecret())
                    .retrieve()
                    .bodyToMono(new org.springframework.core.ParameterizedTypeReference<Map<String, Object>>() {})
                    .timeout(Duration.ofSeconds(15))
                    .block();
            String status = resp == null ? "" : String.valueOf(resp.getOrDefault("status", ""));
            log.info("[Republish] recordId={} status={}", recordId, status);
            return "REPUBLISH_TRIGGERED".equals(status) || "RATE_LIMITED".equals(status);
        } catch (Exception e) {
            log.warn("[Republish] Heal service unreachable for recordId={}: {}", recordId, e.getMessage());
            return false;
        }
    }

    /**
     * Turns a BBB apiUrl like "https://meet.vacademy.io/bigbluebutton/api"
     * into the heal service base URL "https://meet.vacademy.io/vacademy-heal".
     */
    private String deriveHealBaseUrl(String apiUrl) {
        if (apiUrl == null || apiUrl.isBlank()) return null;
        int idx = apiUrl.indexOf("/bigbluebutton/api");
        if (idx < 0) return null;
        return apiUrl.substring(0, idx) + "/vacademy-heal";
    }

    /** Downloads bytes from a URL with a 10-minute timeout. */
    private byte[] downloadFromUrl(String url) {
        return webClientBuilder.build()
                .get()
                .uri(URI.create(url))
                .retrieve()
                .onStatus(status -> status.is4xxClientError() || status.is5xxServerError(),
                        resp -> resp.bodyToMono(String.class)
                                .map(body -> new VacademyException("BBB download error: " + body)))
                .bodyToMono(byte[].class)
                .timeout(Duration.ofMinutes(10))
                .block();
    }

    /** Parses provider_recordings_json to a mutable list; returns empty list on null/blank/parse error. */
    private List<MeetingRecordingDTO> parseExistingRecordings(SessionSchedule schedule) {
        if (schedule.getProviderRecordingsJson() == null || schedule.getProviderRecordingsJson().isBlank()) {
            return new ArrayList<>();
        }
        try {
            return new ArrayList<>(objectMapper.readValue(
                    schedule.getProviderRecordingsJson(),
                    objectMapper.getTypeFactory().constructCollectionType(List.class, MeetingRecordingDTO.class)));
        } catch (Exception e) {
            log.warn("[Sync] Could not parse existing recordings for schedule {}: {}", schedule.getId(), e.getMessage());
            return new ArrayList<>();
        }
    }

    /**
     * Enriches recordings for display. Keeps any recording that either has an S3
     * fileId (BBB) or already carries a provider playback/download URL (Zoom cloud);
     * drops only empty entries. For fileId-backed recordings missing a URL, resolves
     * the S3 public URL.
     */
    private List<MeetingRecordingDTO> enrichUrls(List<MeetingRecordingDTO> recordings) {
        return recordings.stream()
                .filter(r -> (r.getFileId() != null && !r.getFileId().isBlank())
                        || (r.getPlaybackUrl() != null && !r.getPlaybackUrl().isBlank())
                        || (r.getDownloadUrl() != null && !r.getDownloadUrl().isBlank()))
                .map(r -> {
                    boolean hasUrl = (r.getDownloadUrl() != null && !r.getDownloadUrl().isBlank())
                            || (r.getPlaybackUrl() != null && !r.getPlaybackUrl().isBlank());
                    if (!hasUrl && r.getFileId() != null && !r.getFileId().isBlank()) {
                        try {
                            String url = mediaService.getFilePublicUrlByIdWithoutExpiry(r.getFileId());
                            r.setDownloadUrl(url);
                            r.setPlaybackUrl(url);
                        } catch (Exception e) {
                            log.warn("[Sync] Failed to resolve S3 URL for fileId={}: {}", r.getFileId(), e.getMessage());
                        }
                    }
                    return r;
                })
                .collect(Collectors.toList());
    }

    /** Minimal MultipartFile wrapping a byte array, used for S3 uploads. */
    private static class ByteArrayMultipartFile implements MultipartFile {
        private final byte[] content;
        private final String fileName;
        private final String contentType;

        ByteArrayMultipartFile(byte[] content, String fileName, String contentType) {
            this.content = content;
            this.fileName = fileName;
            this.contentType = contentType;
        }

        @Override public String getName() { return fileName; }
        @Override public String getOriginalFilename() { return fileName; }
        @Override public String getContentType() { return contentType; }
        @Override public boolean isEmpty() { return content == null || content.length == 0; }
        @Override public long getSize() { return content.length; }
        @Override public byte[] getBytes() { return content; }
        @Override public InputStream getInputStream() { return new ByteArrayInputStream(content); }
        @Override public void transferTo(java.io.File dest) throws java.io.IOException {
            try (var out = new java.io.FileOutputStream(dest)) { out.write(content); }
        }
    }

    public List<MeetingAttendeeDTO> getAttendance(String scheduleId, String instituteId) {
        SessionSchedule schedule = getScheduleOrThrow(scheduleId);
        LiveSessionProviderStrategy strategy = getStrategyForSchedule(schedule);

        // Route to the correct BBB server (multi-server pool support)
        if (strategy instanceof BbbMeetingManager bbbManager && schedule.getBbbServerId() != null) {
            return bbbManager.getAttendance(schedule.getProviderMeetingId(), instituteId, schedule.getBbbServerId());
        }
        return strategy.getAttendance(schedule.getProviderMeetingId(), instituteId);
    }

    // -----------------------------------------------------------------------
    // Participant join link
    // -----------------------------------------------------------------------

    public ParticipantJoinLinkDTO getParticipantJoinLink(String scheduleId, String participantName,
            String participantEmail, String instituteId) {
        SessionSchedule schedule = getScheduleOrThrow(scheduleId);
        return providerFactory.getStrategy(schedule.getLinkType())
                .getParticipantJoinLink(schedule.getProviderMeetingId(), participantName, participantEmail, instituteId);
    }

    // -----------------------------------------------------------------------
    // Session links (open in new tab)
    // -----------------------------------------------------------------------

    /**
     * Returns the stored join URL (for participants) and host URL (for the
     * organizer) for a given schedule. The host URL is a pre-signed Zoho startLink
     * that opens the meeting directly without a name/email form. The join URL is
     * the standard Zoho joinLink — Zoho will still prompt participants for their
     * name and email (platform limitation).
     */
    public Map<String, String> getSessionLinks(String scheduleId) {
        SessionSchedule schedule = scheduleRepository.findById(scheduleId)
                .orElseThrow(() -> new VacademyException("Schedule not found: " + scheduleId));
        Map<String, String> links = new java.util.HashMap<>();
        if (schedule.getCustomMeetingLink() != null)
            links.put("joinUrl", schedule.getCustomMeetingLink());
        String hostUrl = freshZoomHostUrlOrStored(schedule);
        if (hostUrl != null)
            links.put("hostUrl", hostUrl);
        if (schedule.getProviderMeetingId() != null)
            links.put("providerMeetingId", schedule.getProviderMeetingId());
        return links;
    }

    /**
     * Returns a host url that actually works.
     *
     * <p>{@code provider_host_url} is a Zoom start url captured once, when the occurrence was
     * provisioned. The ZAK embedded in it lives about two hours, so for every recurring session
     * the stored link is dead long before the class runs — the host cannot claim host role, the
     * meeting is never started, and nothing is ever recorded. (The embedded SDK path never hit
     * this because {@code ZoomSdkController} mints a ZAK per request; only the redirect path
     * handed out the stale value.) Re-mint on read for Zoom; fall back to the stored url if Zoom
     * is unreachable, since a stale link still beats no link.
     */
    private String freshZoomHostUrlOrStored(SessionSchedule schedule) {
        String stored = schedule.getProviderHostUrl();
        String meetingId = schedule.getProviderMeetingId();
        if (meetingId == null || meetingId.isBlank() || !isZoom(schedule.getLinkType())) {
            return stored;
        }
        try {
            String fresh = zoomMeetingManager.fetchStartUrl(
                    zoomMeetingManager.resolveAccountByMeeting(meetingId), meetingId);
            return fresh != null ? fresh : stored;
        } catch (Exception e) {
            log.warn("zoom.host_url.refresh.fail scheduleId={} meetingId={} reason={}",
                    schedule.getId(), meetingId, e.getClass().getSimpleName());
            return stored;
        }
    }


    /**
     * True when a schedule's linkType carries no real provider.
     *
     * <p>{@code "UNKNOWN"} is what URL sniffing returns for a schedule created before its meeting
     * link exists — which is every provider-provisioned occurrence, because the link is minted
     * right here. It is neither null nor blank, so the old guard mistook it for a deliberate
     * choice and left it in place permanently. Rows stuck on it are broken at both ends: the
     * dashboards match linkType against StreamingPlatform literals, so "Start as Host" degrades
     * to a plain participant link and the teacher never claims host role; and on the server
     * {@code MeetingProvider.fromString("UNKNOWN")} throws, so strategy resolution fails outright.
     */
    static boolean isUnsetLinkType(String linkType) {
        return linkType == null || linkType.isBlank() || "UNKNOWN".equalsIgnoreCase(linkType);
    }

    /**
     * The literal the dashboards actually match on, for a given provider.
     *
     * <p>Storing the enum name instead ("GOOGLE_MEET", "ZOOM_MEETING") is the same
     * case-sensitivity trap: some frontend branches accept the enum name, others only the
     * StreamingPlatform literal, so the enum name works in one place and silently fails in
     * another. The backend accepts either — {@code MeetingProvider.fromString} normalises.
     */
    static String frontendLinkType(String providerName) {
        if (providerName == null || providerName.isBlank()) {
            return providerName;
        }
        try {
            switch (MeetingProvider.fromString(providerName)) {
                case ZOOM_MEETING:
                    return "zoom";
                case GOOGLE_MEET:
                    return "google meet";
                case BBB_MEETING:
                    return "bbb";
                case ZOHO_MEETING:
                    return "zoho";
            }
        } catch (Exception e) {
            log.debug("unrecognised provider name {} — storing as-is", providerName);
        }
        return providerName;
    }

    /** True for both the frontend-friendly "zoom"/"ZOOM" and the enum name "ZOOM_MEETING". */
    static boolean isZoom(String linkType) {
        return linkType != null && linkType.toUpperCase().startsWith("ZOOM");
    }

    // -----------------------------------------------------------------------
    // Schedule availability check
    // -----------------------------------------------------------------------

    public UserScheduleAvailabilityDTO checkUserAvailability(
            String requestedStartTimeIso, int durationMinutes, String instituteId, String vendorUserId) {
        List<LiveSessionProviderConfig> configs = configRepository
                .findByInstituteIdAndStatusIn(instituteId, ACTIVE);
        if (configs.isEmpty()) {
            throw new VacademyException("No live session provider connected for institute: " + instituteId);
        }
        String providerName = configs.get(0).getProvider();
        return providerFactory.getStrategy(providerName)
                .checkUserAvailability(requestedStartTimeIso, durationMinutes, instituteId, vendorUserId);
    }

    /**
     * Double-booking check across a whole (recurring) session: for every schedule
     * row, finds OTHER sessions' meetings booked on the same provider account that
     * overlap that occurrence's slot. Runs against the persisted rows (their own
     * meeting_date + start/last-entry time) so it needs no timezone parsing and
     * covers every occurrence. Advisory — the caller decides whether to warn or
     * block; conflicts are de-duplicated by the conflicting schedule id.
     */
    public UserScheduleAvailabilityDTO checkAvailabilityForSession(String sessionId, String providerAccountId) {
        List<UserScheduleAvailabilityDTO.ConflictingSessionDTO> conflicts = new ArrayList<>();
        if (sessionId == null || sessionId.isBlank() || providerAccountId == null || providerAccountId.isBlank()) {
            return UserScheduleAvailabilityDTO.builder().available(true).conflicts(conflicts).build();
        }
        Set<String> seen = new HashSet<>();
        for (SessionSchedule row : scheduleRepository.findBySessionId(sessionId)) {
            if ("DELETED".equalsIgnoreCase(row.getStatus())
                    || row.getMeetingDate() == null || row.getStartTime() == null || row.getLastEntryTime() == null) {
                continue;
            }
            java.sql.Date meetingDate = (row.getMeetingDate() instanceof java.sql.Date sqlDate)
                    ? sqlDate
                    : new java.sql.Date(row.getMeetingDate().getTime());
            List<Object[]> rows = scheduleRepository.findOverlappingSchedulesByProviderAccount(
                    providerAccountId, meetingDate, row.getStartTime(), row.getLastEntryTime(), null, sessionId);
            for (UserScheduleAvailabilityDTO.ConflictingSessionDTO conflict
                    : ScheduleConflicts.map(rows, ScheduleConflicts.DEFAULT_ZONE)) {
                if (conflict.getMeetingKey() == null || seen.add(conflict.getMeetingKey())) {
                    conflicts.add(conflict);
                }
            }
        }
        return UserScheduleAvailabilityDTO.builder()
                .available(conflicts.isEmpty())
                .conflicts(conflicts)
                .build();
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private String resolveProviderName(ProviderMeetingCreateRequestDTO request) {
        if (request.getProvider() != null && !request.getProvider().isBlank()) {
            return MeetingProvider.fromString(request.getProvider()).name();
        }
        List<LiveSessionProviderConfig> configs = configRepository
                .findByInstituteIdAndStatusIn(request.getInstituteId(), ACTIVE);
        if (configs.isEmpty()) {
            throw new VacademyException(
                    "No live session provider connected for institute: " + request.getInstituteId());
        }
        return configs.get(0).getProvider();
    }

    /**
     * Resolve the provider strategy from schedule's linkType.
     * linkType may be a provider alias ("bbb", "zoho") or a non-provider value
     * ("YOUTUBE", "ZOOM", "RECORDED") — the latter throws a clear error.
     */
    private LiveSessionProviderStrategy getStrategyForSchedule(SessionSchedule schedule) {
        try {
            return providerFactory.getStrategy(schedule.getLinkType());
        } catch (IllegalArgumentException e) {
            throw new VacademyException(
                    "Schedule " + schedule.getId() + " has linkType '" + schedule.getLinkType()
                            + "' which is not a managed provider. Recordings/attendance are only available for provider-managed sessions.");
        }
    }

    private SessionSchedule getScheduleOrThrow(String scheduleId) {
        SessionSchedule schedule = scheduleRepository.findById(scheduleId)
                .orElseThrow(() -> new VacademyException("Schedule not found: " + scheduleId));
        if (schedule.getProviderMeetingId() == null || schedule.getProviderMeetingId().isBlank()) {
            throw new VacademyException("No provider meeting linked to schedule: " + scheduleId);
        }
        return schedule;
    }
}
