package vacademy.io.admin_core_service.features.live_session.provider.manager;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import vacademy.io.admin_core_service.features.live_session.provider.LiveSessionProviderStrategy;
import vacademy.io.admin_core_service.features.live_session.provider.dto.ProviderConnectRequestDTO;
import vacademy.io.admin_core_service.features.live_session.provider.entity.LiveSessionProviderConfig;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.provider.dto.zoom.ZoomAccount;
import vacademy.io.admin_core_service.features.live_session.provider.service.zoom.ZoomAccessTokenService;
import vacademy.io.admin_core_service.features.live_session.provider.service.zoom.ZoomEndpoints;
import vacademy.io.admin_core_service.features.live_session.provider.service.zoom.ZoomAccountStore;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.meeting.dto.*;
import vacademy.io.common.meeting.enums.MeetingProvider;

import vacademy.io.admin_core_service.features.live_session.provider.support.ScheduleConflicts;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Zoom implementation of {@link LiveSessionProviderStrategy}.
 *
 * Unlike BBB (lazily created on first join) Zoom meetings are created up-front at
 * scheduling time — same as Zoho. The meeting is created against a specific
 * {@link ZoomAccount}; the account id is echoed back in the response's
 * rawResponse map so {@code LiveSessionProviderService} can pin it onto the schedule
 * (mirrors how BBB pins {@code bbbServerId}).
 *
 * Phase 2 scope: createMeeting only. Recordings, attendance and the SDK-based
 * participant join arrive in later phases and currently throw a clear "not yet
 * supported" error rather than silently returning empty data.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ZoomMeetingManager implements LiveSessionProviderStrategy {

    /** Newest-N past instances fetched per sync; see fetchRecordings for why this is safe. */
    private static final int MAX_INSTANCES_PER_SYNC = 30;

    private static final DateTimeFormatter ZOOM_UTC =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss'Z'");

    private final ZoomAccountStore zoomAccountStore;
    private final ZoomAccessTokenService accessTokenService;
    private final WebClient.Builder webClientBuilder;
    private final SessionScheduleRepository scheduleRepository;


    @Override
    public String getProviderName() {
        return MeetingProvider.ZOOM_MEETING.name();
    }

    // Capabilities — Zoom uses the embedded Meeting SDK (signature-based join),
    // multiple per-institute accounts, and event webhooks.
    @Override
    public boolean supportsSdkJoin() {
        return true;
    }

    @Override
    public boolean supportsMultiAccount() {
        return true;
    }

    @Override
    public boolean supportsWebhooks() {
        return true;
    }

    // -----------------------------------------------------------------------
    // Create meeting — POST /v2/users/me/meetings
    // -----------------------------------------------------------------------

    @Override
    public CreateMeetingResponseDTO createMeeting(CreateMeetingRequestDTO request, String instituteId) {
        ZoomAccount account = resolveAccount(instituteId, request.resolveProviderAccountId());
        String token = accessTokenService.getAccessToken(account);

        Map<String, Object> body = new HashMap<>();
        body.put("topic", request.getTopic() != null ? request.getTopic() : "Live Class");
        body.put("type", 2); // scheduled meeting
        body.put("start_time", toZoomUtc(request.getStartTime()));
        body.put("duration", request.getDurationMinutes() > 0 ? request.getDurationMinutes() : 60);
        if (request.getAgenda() != null) {
            body.put("agenda", request.getAgenda());
        }
        // Zoom interprets start_time as GMT when it ends in 'Z'; sending the
        // timezone too keeps the meeting card readable in the host's Zoom UI.
        if (request.getTimezone() != null && !request.getTimezone().isBlank()) {
            body.put("timezone", request.getTimezone());
        }
        body.put("settings", buildSettings(request.resolveProviderConfig()));

        JsonNode response;
        try {
            response = webClientBuilder.build()
                    .post()
                    .uri(ZoomEndpoints.API_BASE_URL + "/users/me/meetings")
                    .header("Authorization", "Bearer " + token)
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .onStatus(status -> status.is4xxClientError() || status.is5xxServerError(),
                            clientResponse -> clientResponse.bodyToMono(String.class)
                                    .map(b -> {
                                        log.error("zoom.meeting.create.fail accountId={} httpStatus={} body={}",
                                                account.getId(), clientResponse.statusCode().value(), b);
                                        return new VacademyException(
                                                "Zoom create meeting failed: HTTP "
                                                        + clientResponse.statusCode().value());
                                    }))
                    .bodyToMono(JsonNode.class)
                    .block();
        } catch (VacademyException e) {
            // If the token was the problem, evict so the next attempt re-issues one.
            accessTokenService.evict(account.getId());
            throw e;
        }

        if (response == null || !response.hasNonNull("id")) {
            throw new VacademyException("Unexpected Zoom response when creating meeting");
        }

        String meetingId = response.get("id").asText();
        String joinUrl = response.path("join_url").asText("");
        String startUrl = response.path("start_url").asText("");
        String passcode = response.path("password").asText("");

        Map<String, Object> raw = new HashMap<>();
        // Generic key — LiveSessionProviderService pins this onto session_schedules
        // .provider_account_id regardless of provider.
        raw.put("providerAccountId", account.getId());
        raw.put("passcode", passcode);
        raw.put("meetingNumber", meetingId);

        log.info("zoom.meeting.create accountId={} meetingId={} institute={}",
                account.getId(), meetingId, instituteId);

        return CreateMeetingResponseDTO.builder()
                .providerMeetingId(meetingId)
                .joinUrl(joinUrl)
                .hostUrl(startUrl)
                .provider(MeetingProvider.ZOOM_MEETING)
                .rawResponse(raw)
                .justCreated(true)
                .build();
    }

    // Note: getParticipantJoinLink is intentionally NOT overridden — Zoom learners
    // join via the embedded Meeting SDK signature (see ZoomSdkController), so it
    // falls through to the interface default (throws NOT_IMPLEMENTED). supportsSdkJoin()
    // returns true to signal this.

    @Override
    public List<MeetingRecordingDTO> getRecordings(String providerMeetingId, String instituteId) {
        return fetchRecordings(resolveAccountByMeeting(providerMeetingId), providerMeetingId);
    }

    @Override
    public List<MeetingAttendeeDTO> getAttendance(String providerMeetingId, String instituteId) {
        return fetchAttendance(resolveAccountByMeeting(providerMeetingId), providerMeetingId);
    }

    /**
     * Fetches cloud recordings for a meeting from Zoom. Account-aware variant used
     * by the recording.completed webhook, which already holds the schedule's account.
     * The hourly sweep uses {@link #fetchAllInstanceRecordings} instead.
     * GET /v2/meetings/{meetingId}/recordings
     */
    public List<MeetingRecordingDTO> fetchRecordings(ZoomAccount account, String meetingId) {
        // Cheap path: one call, the meeting's LATEST instance. This is what the
        // recording.completed webhook wants — it already names the meeting that just
        // finished, and Zoom expects a prompt response, so fanning out over history here
        // would only add latency and rate-limit pressure at the worst moment.
        return fetchRecordingsForInstance(account, meetingId, meetingId);
    }

    /**
     * Every instance of a recurring meeting, not just the latest.
     *
     * <p>A numeric meeting id addresses only the most recent instance. Trainers routinely
     * rejoin the same meeting every day, so asking by id alone returns today's files and
     * silently drops any earlier occurrence the poll happened to miss — those are then lost
     * for good once Zoom's ~30-day retention expires. The hourly sweep uses this; the webhook
     * does not need it.
     */
    public List<MeetingRecordingDTO> fetchAllInstanceRecordings(ZoomAccount account, String meetingId) {
        List<MeetingRecordingDTO> all = new ArrayList<>();
        java.util.Set<String> seen = new java.util.HashSet<>();
        List<String> instances = fetchPastInstanceUuids(account, meetingId);
        // Each instance is one more Zoom call, and this job already competes for a shared
        // rate limit. Zoom deletes cloud recordings after ~30 days and the poll runs hourly
        // and merges (never removes), so the newest slice is all that can still be new.
        if (instances.size() > MAX_INSTANCES_PER_SYNC) {
            log.info("zoom.recordings.instances.capped meetingId={} total={} fetching newest={}",
                    meetingId, instances.size(), MAX_INSTANCES_PER_SYNC);
            instances = instances.subList(instances.size() - MAX_INSTANCES_PER_SYNC, instances.size());
        }
        for (String uuid : instances) {
            for (MeetingRecordingDTO rec : fetchRecordingsForInstance(account, meetingId, encodeUuid(uuid))) {
                if (rec.getRecordingId() == null || seen.add(rec.getRecordingId())) {
                    all.add(rec);
                }
            }
        }
        if (all.isEmpty()) {
            // Never ran, or the instance list was unavailable — fall back to the plain id call.
            return fetchRecordingsForInstance(account, meetingId, meetingId);
        }
        return all;
    }

    /**
     * Mints a FRESH host start url for a meeting.
     * GET /v2/meetings/{meetingId} -> start_url, whose embedded ZAK is valid ~2 hours.
     *
     * <p>Why this exists: {@code session_schedules.provider_host_url} is written once, at
     * scheduling time, and its ZAK expires about two hours later. Every occurrence of a
     * recurring session therefore ships a host link that is already dead by the time the
     * class runs — the host cannot start the meeting, so it never starts, so it never
     * records. Anything that hands a host link to a human must refresh it through here.
     * Returns null on failure so callers can fall back to the stored value.
     */
    public String fetchStartUrl(ZoomAccount account, String meetingId) {
        try {
            JsonNode resp = webClientBuilder.build()
                    .get()
                    .uri(ZoomEndpoints.API_BASE_URL + "/meetings/" + meetingId)
                    .header("Authorization", "Bearer " + accessTokenService.getAccessToken(account))
                    .retrieve()
                    .bodyToMono(JsonNode.class)
                    .block();
            return resp != null && resp.hasNonNull("start_url") ? resp.get("start_url").asText() : null;
        } catch (Exception e) {
            log.warn("zoom.start_url.fetch.fail meetingId={} reason={}", meetingId,
                    e.getClass().getSimpleName());
            return null;
        }
    }

    /**
     * Lists the UUIDs of every past instance of a meeting.
     * GET /v2/past_meetings/{meetingId}/instances
     * Returns empty when the meeting never ran (404) or the call fails — callers then
     * fall back to addressing the meeting by its numeric id.
     */
    private List<String> fetchPastInstanceUuids(ZoomAccount account, String meetingId) {
        List<String> uuids = new ArrayList<>();
        try {
            JsonNode resp = webClientBuilder.build()
                    .get()
                    .uri(ZoomEndpoints.API_BASE_URL + "/past_meetings/" + meetingId + "/instances")
                    .header("Authorization", "Bearer " + accessTokenService.getAccessToken(account))
                    .retrieve()
                    .bodyToMono(JsonNode.class)
                    .block();
            if (resp != null && resp.has("meetings")) {
                for (JsonNode m : resp.get("meetings")) {
                    String uuid = m.path("uuid").asText(null);
                    if (uuid != null && !uuid.isBlank()) {
                        uuids.add(uuid);
                    }
                }
            }
        } catch (Exception e) {
            log.debug("zoom.past_instances.fetch.fail meetingId={} reason={}", meetingId,
                    e.getClass().getSimpleName());
        }
        return uuids;
    }

    /**
     * Zoom requires a meeting UUID to be double URL-encoded when it starts with "/" or
     * contains "//" — and double-encoding is harmless for the rest, so always do it.
     */
    static String encodeUuid(String uuid) {
        String once = java.net.URLEncoder.encode(uuid, java.nio.charset.StandardCharsets.UTF_8);
        return java.net.URLEncoder.encode(once, java.nio.charset.StandardCharsets.UTF_8);
    }

    /** Fetches the recording files for one meeting instance (by UUID) or meeting id. */
    private List<MeetingRecordingDTO> fetchRecordingsForInstance(
            ZoomAccount account, String meetingId, String addressBy) {
        String token = accessTokenService.getAccessToken(account);
        JsonNode response;
        try {
            response = webClientBuilder.build()
                    .get()
                    .uri(ZoomEndpoints.API_BASE_URL + "/meetings/" + addressBy + "/recordings")
                    .header("Authorization", "Bearer " + token)
                    .retrieve()
                    .bodyToMono(JsonNode.class)
                    .block();
        } catch (Exception e) {
            log.warn("zoom.recordings.fetch.fail meetingId={} reason={}", meetingId,
                    e.getClass().getSimpleName());
            return new ArrayList<>();
        }

        List<MeetingRecordingDTO> list = new ArrayList<>();
        if (response == null || !response.has("recording_files")) {
            return list;
        }
        // Zoom returns one passcode for the whole meeting's recordings. Two flavours:
        //   - recording_play_passcode: URL-safe encoded value that can be appended
        //     to play_url/share_url as ?pwd= for click-through playback
        //   - password: the human-readable passcode shown in the Zoom UI
        // We capture both — the encoded value goes into the URL, the plain one is
        // exposed on the DTO so admins can copy/paste it if the embed fails.
        String recordingPlayPasscode = response.path("recording_play_passcode").asText("");
        String recordingPassword = response.path("password").asText("");
        for (JsonNode rec : response.get("recording_files")) {
            // Skip non-video artifacts (chat/transcript) for the primary recording list.
            String fileType = rec.path("file_type").asText("");
            if (!"MP4".equalsIgnoreCase(fileType) && !"M4A".equalsIgnoreCase(fileType)) {
                continue;
            }
            String start = rec.path("recording_start").asText(null);
            String end = rec.path("recording_end").asText(null);
            String playUrl = rec.path("play_url").asText(null);
            String downloadUrl = rec.path("download_url").asText(null);
            list.add(MeetingRecordingDTO.builder()
                    .recordingId(rec.path("id").asText(null))
                    .downloadUrl(downloadUrl)
                    .playbackUrl(appendPasscode(playUrl, recordingPlayPasscode))
                    .durationSeconds(durationBetween(start, end))
                    .startTime(start)
                    .providerMeetingId(meetingId)
                    .type(rec.path("recording_type").asText(null))
                    .passcode(recordingPassword.isBlank() ? null : recordingPassword)
                    .build());
        }
        return list;
    }

    /**
     * Appends the URL-safe encoded recording passcode to a Zoom play/share URL so
     * the playback page doesn't prompt for it. No-op when either argument is blank
     * or the URL already has a pwd parameter.
     */
    private static String appendPasscode(String url, String encodedPasscode) {
        if (url == null || url.isBlank() || encodedPasscode == null || encodedPasscode.isBlank()) {
            return url;
        }
        if (url.contains("pwd=")) {
            return url;
        }
        return url + (url.contains("?") ? "&" : "?") + "pwd=" + encodedPasscode;
    }

    /**
     * Fetches the post-meeting participant report from Zoom.
     * GET /v2/past_meetings/{meetingId}/participants (paginated).
     */
    public List<MeetingAttendeeDTO> fetchAttendance(ZoomAccount account, String meetingId) {
        String token = accessTokenService.getAccessToken(account);
        List<MeetingAttendeeDTO> list = new ArrayList<>();
        String nextPageToken = "";
        try {
            do {
                String url = ZoomEndpoints.API_BASE_URL + "/past_meetings/" + meetingId
                        + "/participants?page_size=300"
                        + (nextPageToken.isBlank() ? "" : "&next_page_token=" + nextPageToken);
                JsonNode response = webClientBuilder.build()
                        .get()
                        .uri(url)
                        .header("Authorization", "Bearer " + token)
                        .retrieve()
                        .bodyToMono(JsonNode.class)
                        .block();
                if (response == null) break;
                for (JsonNode p : response.path("participants")) {
                    list.add(MeetingAttendeeDTO.builder()
                            .name(p.path("name").asText(null))
                            .email(p.path("user_email").asText(null))
                            .joinTime(p.path("join_time").asText(null))
                            .leaveTime(p.path("leave_time").asText(null))
                            .durationMinutes((int) (p.path("duration").asLong(0) / 60))
                            .build());
                }
                nextPageToken = response.path("next_page_token").asText("");
            } while (!nextPageToken.isBlank());
        } catch (Exception e) {
            log.warn("zoom.attendance.fetch.fail meetingId={} reason={}", meetingId,
                    e.getClass().getSimpleName());
        }
        return list;
    }

    /** Resolves the Zoom account that owns a meeting via its schedule row. */
    public ZoomAccount resolveAccountByMeeting(String meetingId) {
        List<SessionSchedule> schedules = scheduleRepository.findByProviderMeetingId(meetingId);
        String zoomAccountId = schedules.stream()
                .map(SessionSchedule::getProviderAccountId)
                .filter(id -> id != null && !id.isBlank())
                .findFirst()
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND,
                        "No Zoom account linked to meeting " + meetingId));
        return zoomAccountStore.findById(zoomAccountId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND,
                        "Zoom account not found for meeting " + meetingId));
    }

    private static long durationBetween(String startIso, String endIso) {
        if (startIso == null || endIso == null) return 0;
        try {
            return Duration.between(OffsetDateTime.parse(startIso), OffsetDateTime.parse(endIso))
                    .getSeconds();
        } catch (Exception e) {
            return 0;
        }
    }

    /**
     * Detects double-booking: other meetings already booked on the SAME Zoom
     * account ({@code provider_account_id}) that overlap the requested slot. A Zoom
     * S2S account hosts one meeting at a time, so two overlapping meetings on one
     * account collide. {@code vendorUserId} carries the Zoom account row id (=
     * provider_account_id); when blank the institute's default account is used.
     *
     * Advisory by design — any failure degrades to "available" so a check never
     * blocks scheduling.
     */
    @Override
    public UserScheduleAvailabilityDTO checkUserAvailability(
            String requestedStartTimeIso, int durationMinutes, String instituteId, String vendorUserId) {
        try {
            String accountId = (vendorUserId != null && !vendorUserId.isBlank())
                    ? vendorUserId
                    : zoomAccountStore.findDefault(instituteId).map(ZoomAccount::getId).orElse(null);
            if (accountId == null) {
                return availableResponse(requestedStartTimeIso, durationMinutes);
            }

            ZonedDateTime start = OffsetDateTime.parse(requestedStartTimeIso)
                    .atZoneSameInstant(ScheduleConflicts.DEFAULT_ZONE);
            LocalDate date = start.toLocalDate();
            LocalTime startTime = start.toLocalTime();
            int minutes = durationMinutes > 0 ? durationMinutes : 60;
            LocalTime endTime = startTime.plusMinutes(minutes);
            // Same-day window only (classes don't cross midnight); clamp a wrap.
            if (!endTime.isAfter(startTime)) {
                endTime = LocalTime.of(23, 59, 59);
            }

            List<Object[]> rows = scheduleRepository.findOverlappingSchedulesByProviderAccount(
                    accountId,
                    java.sql.Date.valueOf(date),
                    java.sql.Time.valueOf(startTime),
                    java.sql.Time.valueOf(endTime),
                    null, null);
            List<UserScheduleAvailabilityDTO.ConflictingSessionDTO> conflicts =
                    ScheduleConflicts.map(rows, ScheduleConflicts.DEFAULT_ZONE);

            return UserScheduleAvailabilityDTO.builder()
                    .available(conflicts.isEmpty())
                    .requestedStartTime(requestedStartTimeIso)
                    .requestedDurationMinutes(durationMinutes)
                    .conflicts(conflicts)
                    .build();
        } catch (Exception e) {
            log.warn("zoom.availability.check.failed reason={} msg={}",
                    e.getClass().getSimpleName(), e.getMessage());
            return availableResponse(requestedStartTimeIso, durationMinutes);
        }
    }

    private static UserScheduleAvailabilityDTO availableResponse(String requestedStartTimeIso, int durationMinutes) {
        return UserScheduleAvailabilityDTO.builder()
                .available(true)
                .requestedStartTime(requestedStartTimeIso)
                .requestedDurationMinutes(durationMinutes)
                .conflicts(List.of())
                .build();
    }

    @Override
    public LiveSessionProviderConfig connectProvider(ProviderConnectRequestDTO request) {
        // Zoom uses multi-account manual credential entry via the dedicated
        // ZoomAccountController (POST /provider/zoom/accounts), not the single
        // per-institute connectProvider OAuth flow.
        throw new VacademyException(HttpStatus.BAD_REQUEST,
                "Use POST /admin-core-service/live-sessions/provider/zoom/accounts to register a Zoom account");
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /**
     * Resolves the Zoom account to create the meeting under. Prefers the explicitly
     * requested account; falls back to the institute's default. Both are scoped to
     * the institute so a crafted id from another tenant can't be used.
     */
    private ZoomAccount resolveAccount(String instituteId, String zoomAccountId) {
        if (zoomAccountId != null && !zoomAccountId.isBlank()) {
            return zoomAccountStore.findByIdAndInstitute(zoomAccountId, instituteId)
                    .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND,
                            "Zoom account not found for this institute"));
        }
        return zoomAccountStore.findDefault(instituteId)
                .orElseThrow(() -> new VacademyException(HttpStatus.BAD_REQUEST,
                        "No Zoom account selected and no default configured for this institute"));
    }

    /**
     * Maps our zoomConfig map (camelCase keys from the wizard) to Zoom's settings
     * object (snake_case). Unknown keys are ignored; sensible defaults applied.
     */
    private Map<String, Object> buildSettings(Map<String, Object> cfg) {
        Map<String, Object> settings = new HashMap<>();

        // Entry / security. Defaults tuned for a teaching platform:
        //   - waiting_room OFF: with the SDK-embedded learner experience,
        //     gating every join through an explicit host admit is friction
        //     the admin doesn't want by default. Admin can still toggle it on.
        //   - join_before_host ON: learners can land in the meeting room
        //     immediately when they click Join Early; no "waiting for host"
        //     friction if the admin is running a few minutes late.
        settings.put("waiting_room", boolValue(cfg, "waitingRoom", false));
        settings.put("join_before_host", boolValue(cfg, "joinBeforeHost", true));
        settings.put("meeting_authentication", boolValue(cfg, "meetingAuthentication", false));
        // Zoom approval_type: 0=auto, 1=manual, 2=no registration required (default).
        settings.put("approval_type", intValue(cfg, "approvalType", 2));
        if (cfg != null && cfg.get("alternativeHosts") instanceof List<?> hosts && !hosts.isEmpty()) {
            settings.put("alternative_hosts",
                    String.join(",", hosts.stream().map(Object::toString).toList()));
        }

        // Audio / Video defaults
        settings.put("mute_upon_entry", boolValue(cfg, "muteUponEntry", true));
        settings.put("host_video", boolValue(cfg, "hostVideo", false));
        settings.put("participant_video", boolValue(cfg, "participantVideo", false));
        Object audio = cfg != null ? cfg.get("audio") : null;
        settings.put("audio", audio != null ? audio.toString() : "both");

        // In-meeting features
        Object autoRecording = cfg != null ? cfg.get("autoRecording") : null;
        settings.put("auto_recording",
                autoRecording != null ? autoRecording.toString() : "cloud");
        settings.put("focus_mode", boolValue(cfg, "focusMode", false));
        settings.put("allow_multiple_devices", boolValue(cfg, "allowMultipleDevices", false));
        settings.put("watermark", boolValue(cfg, "watermark", false));
        // Breakout rooms — Zoom uses a nested object even when only the
        // enable flag is being toggled.
        if (boolValue(cfg, "breakoutRoom", false)) {
            settings.put("breakout_room", Map.of("enable", true));
        }

        return settings;
    }

    private static boolean boolValue(Map<String, Object> cfg, String key, boolean dflt) {
        if (cfg == null || cfg.get(key) == null) return dflt;
        Object v = cfg.get(key);
        if (v instanceof Boolean b) return b;
        return Boolean.parseBoolean(v.toString());
    }

    private static int intValue(Map<String, Object> cfg, String key, int dflt) {
        if (cfg == null || cfg.get(key) == null) return dflt;
        Object v = cfg.get(key);
        if (v instanceof Number n) return n.intValue();
        try {
            return Integer.parseInt(v.toString());
        } catch (NumberFormatException e) {
            return dflt;
        }
    }

    /** Converts an ISO-8601 instant (any offset) to Zoom's GMT format "yyyy-MM-ddTHH:mm:ssZ". */
    private static String toZoomUtc(String isoStartTime) {
        if (isoStartTime == null || isoStartTime.isBlank()) {
            return OffsetDateTime.now(ZoneOffset.UTC).format(ZOOM_UTC);
        }
        try {
            return OffsetDateTime.parse(isoStartTime)
                    .withOffsetSameInstant(ZoneOffset.UTC)
                    .format(ZOOM_UTC);
        } catch (Exception e) {
            log.warn("zoom.create could not parse startTime '{}', sending as-is", isoStartTime);
            return isoStartTime;
        }
    }
}
