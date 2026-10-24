package vacademy.io.admin_core_service.features.live_session.provider.manager;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.provider.LiveSessionProviderStrategy;
import vacademy.io.admin_core_service.features.live_session.provider.dto.ProviderConnectRequestDTO;
import vacademy.io.admin_core_service.features.live_session.provider.dto.google.GoogleAccount;
import vacademy.io.admin_core_service.features.live_session.provider.entity.LiveSessionProviderConfig;
import vacademy.io.admin_core_service.features.live_session.provider.service.google.GoogleAccessTokenService;
import vacademy.io.admin_core_service.features.live_session.provider.service.google.GoogleAccountStore;
import vacademy.io.admin_core_service.features.live_session.provider.service.google.GoogleConferenceService;
import vacademy.io.admin_core_service.features.live_session.provider.service.google.GoogleEventsSubscriptionService;
import vacademy.io.admin_core_service.features.live_session.provider.service.google.GoogleMeetEndpoints;
import vacademy.io.admin_core_service.features.live_session.provider.support.ScheduleConflicts;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.meeting.dto.*;
import vacademy.io.common.meeting.enums.MeetingProvider;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZonedDateTime;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Google Meet implementation of {@link LiveSessionProviderStrategy}.
 *
 * Unlike Zoom (embedded Meeting SDK) Google Meet has NO embeddable in-page SDK — learners
 * join by opening the {@code meetingUri} (URL-join, like BBB/Zoho), so this manager OVERRIDES
 * {@link #getParticipantJoinLink} and leaves {@link #supportsSdkJoin()} false.
 *
 * A meeting is a Meet REST API "space" created via {@code POST /v2/spaces} under the
 * institute's connected organizer account. One space is created per call → the
 * {@code ProviderMeetingBatchService} loop yields one durable space per recurring occurrence,
 * keeping each occurrence independently addressable for attendance/recording (it never reuses
 * one space across a series). The durable {@code spaces/{space}} name is the providerMeetingId;
 * {@code meetingUri} is the join link.
 *
 * Phase 2 scope: createMeeting + getParticipantJoinLink + availability. Recordings/attendance
 * (conferenceRecords) and Events-API webhooks arrive in Phase 4 and currently return empty.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class GoogleMeetManager implements LiveSessionProviderStrategy {

    private static final Set<String> ACCESS_TYPES = Set.of("OPEN", "TRUSTED", "RESTRICTED");
    private static final Set<String> RESTRICTION_TYPES = Set.of("HOSTS_ONLY", "NO_RESTRICTION");

    private final GoogleAccountStore googleAccountStore;
    private final GoogleAccessTokenService accessTokenService;
    private final GoogleConferenceService conferenceService;
    private final GoogleEventsSubscriptionService eventsSubscriptionService;
    private final WebClient.Builder webClientBuilder;
    private final SessionScheduleRepository scheduleRepository;

    @Override
    public String getProviderName() {
        return MeetingProvider.GOOGLE_MEET.name();
    }

    // Capabilities — URL-join (no SDK), one connected organizer account per institute
    // (multi-account supported), and Events-API webhooks (Phase 4).
    @Override
    public boolean supportsMultiAccount() {
        return true;
    }

    @Override
    public boolean supportsWebhooks() {
        return true;
    }

    // -----------------------------------------------------------------------
    // Create meeting — POST /v2/spaces (one durable space per occurrence)
    // -----------------------------------------------------------------------

    @Override
    public CreateMeetingResponseDTO createMeeting(CreateMeetingRequestDTO request, String instituteId) {
        GoogleAccount account = resolveAccount(instituteId, request.resolveProviderAccountId());
        String token = accessTokenService.getAccessToken(account);

        Map<String, Object> config = buildSpaceConfig(account, request.resolveProviderConfig());
        boolean recordingRefused = false;

        JsonNode response;
        while (true) {
            try {
                response = createSpace(account, token, config);
                break;
            } catch (SpaceCreateException e) {
                log.error("google.meet.create.fail accountId={} httpStatus={} body={}",
                        account.getId(), e.status, snippet(e.body));
                // Evict ONLY on 401 (expired/invalid token). Google returns 403 for a feature the
                // plan lacks ("updateAutoRecordingGeneration is not available to the user") — that's
                // NOT a token problem, so don't evict; the feature fallback below handles it.
                if (e.status == 401) {
                    accessTokenService.evict(account.getId());
                }
                // Graceful degradation: Google fails the WHOLE spaces.create when one optional
                // feature (recording, transcript, smart notes, attendance report, host management)
                // isn't on the institute's plan. Drop the feature the error names and retry, so the
                // class still gets a link; if the error names none, drop all optional features at once.
                boolean featureRefusal = e.status >= 400 && e.status < 500 && e.status != 401;
                List<SpaceFeature> present = SpaceFeature.presentIn(config);
                if (!featureRefusal || present.isEmpty()) {
                    throw new VacademyException("Google Meet create space failed: HTTP " + e.status);
                }
                SpaceFeature blamed = SpaceFeature.blamedBy(e.body, present);
                List<SpaceFeature> dropped = blamed != null ? List.of(blamed) : present;
                dropped.forEach(f -> f.removeFrom(config));
                log.warn("google.meet.create feature unavailable for account {} (HTTP {}) — retrying without {}",
                        account.getId(), e.status, dropped);
                // Recording is only proven to be the blocker when the error names it, or when it was
                // the only feature sent (the pre-existing recording-only fallback).
                if (blamed == SpaceFeature.RECORDING || present.equals(List.of(SpaceFeature.RECORDING))) {
                    recordingRefused = true;
                }
            }
        }

        // The retry succeeding IS the proof that recording was the blocker → self-heal by turning
        // auto-record off on the account (an account-wide plan property).
        if (recordingRefused && account.isRecordingEnabled()) {
            log.warn("google.meet.create recording unavailable for account {} — disabled auto-record on the account",
                    account.getId());
            account.setRecordingEnabled(false);
            try {
                googleAccountStore.update(account);
            } catch (Exception ignore) {
                /* best-effort self-heal */
            }
        }

        if (response == null || !response.hasNonNull("name")) {
            throw new VacademyException("Unexpected Google Meet response when creating space");
        }

        String spaceName = response.get("name").asText();      // durable: spaces/{space}
        String meetingUri = response.path("meetingUri").asText("");
        String meetingCode = response.path("meetingCode").asText("");

        // Best-effort: subscribe to Meet events for this space (no-op unless Pub/Sub is configured).
        eventsSubscriptionService.subscribeForSpace(account, spaceName);

        Map<String, Object> raw = new HashMap<>();
        // Generic key — LiveSessionProviderService pins this onto session_schedules
        // .provider_account_id regardless of provider.
        raw.put("providerAccountId", account.getId());
        raw.put("meetingCode", meetingCode);

        log.info("google.meet.create accountId={} space={} institute={}",
                account.getId(), spaceName, instituteId);

        return CreateMeetingResponseDTO.builder()
                .providerMeetingId(spaceName)
                .joinUrl(meetingUri)   // learner join URL → stored as schedule.customMeetingLink
                .hostUrl(meetingUri)   // Google has no separate host start-URL; organizer opens the same link
                .provider(MeetingProvider.GOOGLE_MEET)
                .rawResponse(raw)
                .justCreated(true)
                .build();
    }

    // -----------------------------------------------------------------------
    // Join — URL-join: every participant opens the same meetingUri
    // -----------------------------------------------------------------------

    @Override
    public ParticipantJoinLinkDTO getParticipantJoinLink(String providerMeetingId, String participantName,
            String participantEmail, String instituteId) {
        // Google Meet can't pre-fill the participant name (no SDK) — the link is the same for
        // everyone. We return the meetingUri already stored on the schedule at create time.
        String meetingUri = scheduleRepository.findByProviderMeetingId(providerMeetingId).stream()
                .map(SessionSchedule::getCustomMeetingLink)
                .filter(u -> u != null && !u.isBlank())
                .findFirst()
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND,
                        "No Google Meet join URL stored for meeting " + providerMeetingId));
        return ParticipantJoinLinkDTO.builder()
                .joinLink(meetingUri)
                .participantName(participantName)
                .participantEmail(participantEmail)
                .providerMeetingId(providerMeetingId)
                .build();
    }

    // -----------------------------------------------------------------------
    // Recordings & attendance — Phase 4 (conferenceRecords + Events API)
    // -----------------------------------------------------------------------

    @Override
    public List<MeetingRecordingDTO> getRecordings(String providerMeetingId, String instituteId) {
        return conferenceService.fetchRecordings(resolveAccountByMeeting(providerMeetingId), providerMeetingId);
    }

    @Override
    public List<MeetingAttendeeDTO> getAttendance(String providerMeetingId, String instituteId) {
        // Authenticated join-time markPresent (Phase 3) is the primary attendance signal; this
        // conferenceRecords view is on-demand enrichment (Meet exposes no enrolled-user email).
        return conferenceService.fetchAttendance(resolveAccountByMeeting(providerMeetingId), providerMeetingId);
    }

    /** Resolves the Google account that owns a meeting via its schedule row's provider_account_id. */
    public GoogleAccount resolveAccountByMeeting(String spaceName) {
        String accountId = scheduleRepository.findByProviderMeetingId(spaceName).stream()
                .map(SessionSchedule::getProviderAccountId)
                .filter(id -> id != null && !id.isBlank())
                .findFirst()
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND,
                        "No Google account linked to meeting " + spaceName));
        return googleAccountStore.findById(accountId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND,
                        "Google account not found for meeting " + spaceName));
    }

    /**
     * Advisory double-booking check: other meetings already booked on the SAME connected
     * Google account ({@code provider_account_id}) that overlap the requested slot. Mirrors the
     * Zoom check; any failure degrades to "available" so it never blocks scheduling.
     */
    @Override
    public UserScheduleAvailabilityDTO checkUserAvailability(
            String requestedStartTimeIso, int durationMinutes, String instituteId, String vendorUserId) {
        try {
            String accountId = (vendorUserId != null && !vendorUserId.isBlank())
                    ? vendorUserId
                    : googleAccountStore.findDefault(instituteId).map(GoogleAccount::getId).orElse(null);
            if (accountId == null) {
                return availableResponse(requestedStartTimeIso, durationMinutes);
            }

            ZonedDateTime start = OffsetDateTime.parse(requestedStartTimeIso)
                    .atZoneSameInstant(ScheduleConflicts.DEFAULT_ZONE);
            LocalDate date = start.toLocalDate();
            LocalTime startTime = start.toLocalTime();
            int minutes = durationMinutes > 0 ? durationMinutes : 60;
            LocalTime endTime = startTime.plusMinutes(minutes);
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
            log.warn("google.availability.check.failed reason={} msg={}",
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
        // Google uses per-tenant authorization-code OAuth via GoogleOAuthController, not the
        // single per-institute connectProvider flow.
        throw new VacademyException(HttpStatus.BAD_REQUEST,
                "Use the Connect Google Workspace flow "
                        + "(POST /admin-core-service/live-sessions/provider/google/oauth/initiate)");
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private GoogleAccount resolveAccount(String instituteId, String accountId) {
        if (accountId != null && !accountId.isBlank()) {
            return googleAccountStore.findByIdAndInstitute(accountId, instituteId)
                    .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND,
                            "Google account not found for this institute"));
        }
        return googleAccountStore.findDefault(instituteId)
                .orElseThrow(() -> new VacademyException(HttpStatus.BAD_REQUEST,
                        "No Google account connected for this institute"));
    }

    /**
     * Builds the Meet REST API SpaceConfig from the wizard's per-class config, falling back to the
     * account defaults. accessType: wizard override or account default. Recording: wizard override
     * or the account's auto-record flag. Transcript, smart notes, attendance report and host
     * management are per-class only.
     *
     * Optional features are sent only when turned ON — "off" omits the field so Google keeps its
     * own default (off unless the Workspace admin forces it). Sending OFF for a feature the plan
     * lacks is refused just like ON, which would cost every occurrence a failed call.
     */
    static Map<String, Object> buildSpaceConfig(GoogleAccount account, Map<String, Object> cfg) {
        Map<String, Object> config = new LinkedHashMap<>();

        String accessType = stringValue(cfg, "accessType", account.getDefaultAccessType());
        if (accessType == null || !ACCESS_TYPES.contains(accessType.toUpperCase())) {
            // OPEN so anonymous learners join without knocking (the learner product is URL-join).
            accessType = "OPEN";
        }
        config.put("accessType", accessType.toUpperCase());
        config.put("entryPointAccess", "ALL");

        if (boolValue(cfg, "recording", account.isRecordingEnabled())) {
            SpaceFeature.RECORDING.addTo(config);
        }
        if (boolValue(cfg, "transcription", false)) {
            SpaceFeature.TRANSCRIPTION.addTo(config);
        }
        if (boolValue(cfg, "smartNotes", false)) {
            SpaceFeature.SMART_NOTES.addTo(config);
        }
        if (boolValue(cfg, "attendanceReport", false)) {
            SpaceFeature.ATTENDANCE_REPORT.addTo(config);
        }
        if (boolValue(cfg, "hostManagement", false)) {
            config.put("moderation", "ON");
            Map<String, Object> restrictions = new LinkedHashMap<>();
            putRestriction(restrictions, "chatRestriction", cfg);
            putRestriction(restrictions, "reactionRestriction", cfg);
            putRestriction(restrictions, "presentRestriction", cfg);
            if (cfg.get("joinAsViewer") != null) {
                restrictions.put("defaultJoinAsViewerType", boolValue(cfg, "joinAsViewer", false) ? "ON" : "OFF");
            }
            if (!restrictions.isEmpty()) {
                config.put("moderationRestrictions", restrictions);
            }
        }
        return config;
    }

    private static void putRestriction(Map<String, Object> restrictions, String key, Map<String, Object> cfg) {
        String v = stringValue(cfg, key, null);
        if (v != null && RESTRICTION_TYPES.contains(v.toUpperCase())) {
            restrictions.put(key, v.toUpperCase());
        }
    }

    /**
     * Optional SpaceConfig features that depend on the institute's Google plan (recording and
     * transcripts need Business Standard+ / Education Plus, smart notes need Gemini, the
     * attendance report needs Business Plus+ / Education). Each knows how to add and remove
     * itself so {@link #createMeeting} can retry without the one Google refused.
     */
    enum SpaceFeature {
        RECORDING("recordingConfig", "autoRecordingGeneration", "autorecordinggeneration"),
        TRANSCRIPTION("transcriptionConfig", "autoTranscriptionGeneration", "autotranscriptiongeneration"),
        SMART_NOTES("smartNotesConfig", "autoSmartNotesGeneration", "autosmartnotesgeneration"),
        ATTENDANCE_REPORT(null, null, "attendancereport"),
        HOST_MANAGEMENT(null, null, "moderation");

        private final String artifactKey;
        private final String generationKey;
        /** The field name Google's error message carries for this feature, lower-cased with
         *  "_" and spaces removed (e.g. "updateAutoRecordingGeneration is not available to the
         *  user"). The full field name, so a message that merely mentions "recording" while
         *  refusing another feature doesn't blame recording. */
        private final String errorHint;

        SpaceFeature(String artifactKey, String generationKey, String errorHint) {
            this.artifactKey = artifactKey;
            this.generationKey = generationKey;
            this.errorHint = errorHint;
        }

        @SuppressWarnings("unchecked")
        void addTo(Map<String, Object> config) {
            if (this == ATTENDANCE_REPORT) {
                config.put("attendanceReportGenerationType", "GENERATE_REPORT");
                return;
            }
            Map<String, Object> artifacts = (Map<String, Object>) config
                    .computeIfAbsent("artifactConfig", k -> new LinkedHashMap<String, Object>());
            artifacts.put(artifactKey, Map.of(generationKey, "ON"));
        }

        @SuppressWarnings("unchecked")
        void removeFrom(Map<String, Object> config) {
            switch (this) {
                case ATTENDANCE_REPORT -> config.remove("attendanceReportGenerationType");
                case HOST_MANAGEMENT -> {
                    config.remove("moderation");
                    config.remove("moderationRestrictions");
                }
                default -> {
                    if (config.get("artifactConfig") instanceof Map<?, ?> artifacts) {
                        ((Map<String, Object>) artifacts).remove(artifactKey);
                        if (artifacts.isEmpty()) config.remove("artifactConfig");
                    }
                }
            }
        }

        boolean isIn(Map<String, Object> config) {
            return switch (this) {
                case ATTENDANCE_REPORT -> config.containsKey("attendanceReportGenerationType");
                case HOST_MANAGEMENT -> config.containsKey("moderation");
                default -> config.get("artifactConfig") instanceof Map<?, ?> artifacts
                        && artifacts.containsKey(artifactKey);
            };
        }

        static List<SpaceFeature> presentIn(Map<String, Object> config) {
            return java.util.Arrays.stream(values()).filter(f -> f.isIn(config)).toList();
        }

        /** The present feature Google's error body names, or null when it names none of them. */
        static SpaceFeature blamedBy(String body, List<SpaceFeature> present) {
            if (body == null) return null;
            String b = body.toLowerCase().replace("_", "").replace(" ", "");
            for (SpaceFeature f : present) {
                if (b.contains(f.errorHint)) return f;
            }
            if (present.contains(HOST_MANAGEMENT) && (b.contains("restriction") || b.contains("viewer"))) {
                return HOST_MANAGEMENT;
            }
            return null;
        }
    }

    private static String stringValue(Map<String, Object> cfg, String key, String dflt) {
        if (cfg == null || cfg.get(key) == null) return dflt;
        return cfg.get(key).toString();
    }

    private static boolean boolValue(Map<String, Object> cfg, String key, boolean dflt) {
        if (cfg == null || cfg.get(key) == null) return dflt;
        Object v = cfg.get(key);
        if (v instanceof Boolean b) return b;
        return Boolean.parseBoolean(v.toString());
    }

    /** POST /v2/spaces; throws {@link SpaceCreateException} (status + body) on any 4xx/5xx so the
     *  caller can decide whether to gracefully retry without recording. */
    private JsonNode createSpace(GoogleAccount account, String token, Map<String, Object> config) {
        return webClientBuilder.build()
                .post()
                .uri(GoogleMeetEndpoints.MEET_API_BASE_URL + "/spaces")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("config", config))
                .retrieve()
                .onStatus(status -> status.is4xxClientError() || status.is5xxServerError(),
                        resp -> resp.bodyToMono(String.class).defaultIfEmpty("")
                                .map(b -> new SpaceCreateException(resp.statusCode().value(), b)))
                .bodyToMono(JsonNode.class)
                .timeout(java.time.Duration.ofSeconds(15)) // don't hang the @Transactional create
                .block();
    }

    /**
     * Makes {@code email} a co-host of the space ({@code POST /v2/{space}/members}, role COHOST) so a
     * teacher joining from their own Google account gets host controls while the meeting stays on the
     * organizer's plan. Works for outside accounts (personal Gmail) with the existing
     * meetings.space.created scope. 409 ALREADY_EXISTS means they already are one. Best-effort: never
     * throws, so a Google hiccup can't block the join.
     */
    public boolean ensureCohost(GoogleAccount account, String spaceName, String email) {
        if (account == null || spaceName == null || email == null || email.isBlank()
                || email.equalsIgnoreCase(account.getOrganizerEmail())) {
            return false;
        }
        try {
            String token = accessTokenService.getAccessToken(account);
            Integer status = webClientBuilder.build()
                    .post()
                    .uri(GoogleMeetEndpoints.MEET_API_BASE_URL + "/" + spaceName + "/members")
                    .header("Authorization", "Bearer " + token)
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(Map.of("email", email.trim(), "role", "COHOST"))
                    .exchangeToMono(resp -> resp.releaseBody().thenReturn(resp.statusCode().value()))
                    .timeout(java.time.Duration.ofSeconds(5)) // the host waits on this before Meet opens
                    .block();
            if (status != null && (status == 200 || status == 409)) {
                return true;
            }
            if (status != null && status == 401) {
                accessTokenService.evict(account.getId());
            }
            log.warn("google.meet.cohost.fail accountId={} space={} httpStatus={}",
                    account.getId(), spaceName, status);
        } catch (Exception e) {
            log.warn("google.meet.cohost.fail accountId={} space={} reason={}",
                    account.getId(), spaceName, e.getMessage());
        }
        return false;
    }

    private static String snippet(String body) {
        if (body == null || body.isEmpty()) return "";
        return body.length() > 200 ? body.substring(0, 200) : body;
    }

    /** Carries the HTTP status + body from a failed spaces.create so {@code createMeeting} can
     *  gracefully fall back (create without recording) when a plan can't record. */
    private static final class SpaceCreateException extends RuntimeException {
        private final int status;
        private final String body;

        SpaceCreateException(int status, String body) {
            this.status = status;
            this.body = body;
        }
    }
}
