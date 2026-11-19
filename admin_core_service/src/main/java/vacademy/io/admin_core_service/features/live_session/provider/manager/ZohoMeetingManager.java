package vacademy.io.admin_core_service.features.live_session.provider.manager;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import vacademy.io.admin_core_service.features.live_session.provider.LiveSessionProviderStrategy;
import vacademy.io.admin_core_service.features.live_session.provider.service.ZohoOAuthService;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.meeting.dto.*;
import vacademy.io.common.meeting.enums.MeetingProvider;
import vacademy.io.common.external.VendorCallLog;

import java.util.*;

/**
 * Zoho Meeting implementation of LiveSessionProviderStrategy.
 *
 * All credentials come from configJson via
 * ZohoOAuthService.getValidConfigMap().
 * API reference: https://www.zoho.com/meeting/api-integration.html
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ZohoMeetingManager implements LiveSessionProviderStrategy {

    private final ZohoOAuthService oAuthService;
    private final WebClient.Builder webClientBuilder;

    @Override
    public String getProviderName() {
        return MeetingProvider.ZOHO_MEETING.name();
    }

    // -----------------------------------------------------------------------
    // Connect mapping
    // -----------------------------------------------------------------------

    @Override
    public vacademy.io.admin_core_service.features.live_session.provider.entity.LiveSessionProviderConfig connectProvider(
            vacademy.io.admin_core_service.features.live_session.provider.dto.ProviderConnectRequestDTO request) {
        String domain = (request.getDomain() != null && !request.getDomain().isBlank())
                ? request.getDomain()
                : "zoho.com";
        return oAuthService.connectZoho(
                request.getInstituteId(),
                request.getClientId(),
                request.getClientSecret(),
                request.getAuthorizationCode(),
                domain,
                request.getVendorUserId());
    }

    @Override
    public vacademy.io.admin_core_service.features.live_session.provider.entity.LiveSessionProviderConfig connectSdkProvider(
            vacademy.io.admin_core_service.features.live_session.provider.dto.ProviderConnectRequestDTO request) {
        String domain = (request.getDomain() != null && !request.getDomain().isBlank())
                ? request.getDomain()
                : "zoho.com";
        return oAuthService.connectSdkZoho(
                request.getInstituteId(),
                request.getClientId(),
                request.getClientSecret(),
                request.getAuthorizationCode(),
                request.getRedirectUri(),
                domain,
                request.getPresenterZuid());
    }

    // -----------------------------------------------------------------------
    // Create meeting
    // POST /api/v2/{zohoUserId}/sessions.json
    // -----------------------------------------------------------------------

    @Override
    public CreateMeetingResponseDTO createMeeting(CreateMeetingRequestDTO request, String instituteId) {
        Map<String, Object> cfg = oAuthService.getValidConfigMap(instituteId);
        String domain = (String) cfg.getOrDefault("domain", "zoho.com");

        // Use SDK endpoint when SDK credentials are present
        if (cfg.containsKey("sdkClientId")) {
            return createSdkMeeting(request, instituteId, cfg, domain);
        }
        return createRegularMeeting(request, instituteId, cfg, domain);
    }

    /**
     * Creates a session via Zoho Meeting SDK API (embedded/iframe capable).
     * POST /meeting/api/v2/{orgId}/sdk/session
     */
    private CreateMeetingResponseDTO createSdkMeeting(CreateMeetingRequestDTO request, String instituteId,
            Map<String, Object> cfg, String domain) {
        Map<String, Object> sdkCfg = oAuthService.getSdkValidConfigMap(instituteId);
        String sdkToken = (String) sdkCfg.get("sdkAccessToken");
        String orgId = resolveOrgId(cfg); // org-level ZSOID
        String apiBase = ZohoOAuthService.buildApiBase(domain);

        if (orgId == null || orgId.isBlank()) {
            throw new VacademyException("Zoho org ID not found in config for institute: " + instituteId);
        }

        String presenterZuid = (String) sdkCfg.getOrDefault("presenterZuid", cfg.get("presenterZuid"));
        if (presenterZuid == null || presenterZuid.isBlank()) {
            throw new VacademyException("presenterZuid not configured for SDK sessions — re-connect SDK credentials");
        }

        Map<String, Object> sessionBody = new HashMap<>();
        sessionBody.put("topic", request.getTopic());
        sessionBody.put("agenda", request.getAgenda() != null ? request.getAgenda() : "");
        sessionBody.put("duration",
                request.getDurationMinutes() > 0 ? request.getDurationMinutes() * 60000L : 3600000L);
        sessionBody.put("timezone", "Asia/Calcutta");
        sessionBody.put("presenter", Long.parseLong(presenterZuid));

        String formattedTime = formatZohoTime(request.getStartTime());
        sessionBody.put("startTime", formattedTime);

        String url = apiBase + "/meeting/api/v2/" + orgId + "/sdk/session";
        log.debug("[Zoho SDK] Creating SDK session for institute={}, orgId={}, presenter={}", instituteId, orgId,
                presenterZuid);

        JsonNode response = webClientBuilder.build()
                .post().uri(url)
                .header("Authorization", "Zoho-oauthtoken " + sdkToken)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("session", sessionBody))
                .retrieve()
                .onStatus(status -> status.is4xxClientError() || status.is5xxServerError(),
                        clientResponse -> clientResponse.bodyToMono(String.class)
                                .map(body -> {
                                    log.error("[Zoho SDK] Error response: HTTP {} - {}", clientResponse.statusCode(),
                                            body);
                                    return new VacademyException("Zoho SDK error: " + body);
                                }))
                .bodyToMono(JsonNode.class)
                .doOnError(e -> VendorCallLog.failed(url, "create sdk session", sessionBody, e))
                .block();

        return parseCreateMeetingResponse(response);
    }

    /**
     * Creates a session via the regular Zoho Meeting API.
     * POST /api/v2/{zohoUserId}/sessions.json
     */
    private CreateMeetingResponseDTO createRegularMeeting(CreateMeetingRequestDTO request, String instituteId,
            Map<String, Object> cfg, String domain) {
        String token = (String) cfg.get("accessToken");
        String userId = resolveOrgId(cfg);
        String apiBase = ZohoOAuthService.buildApiBase(domain);

        if (userId == null || userId.isBlank()) {
            throw new VacademyException("Zoho User ID not found in config for institute: " + instituteId);
        }

        Map<String, Object> sessionBody = new HashMap<>();
        sessionBody.put("topic", request.getTopic());
        sessionBody.put("agenda", request.getAgenda() != null ? request.getAgenda() : "");
        sessionBody.put("startTime", formatZohoTime(request.getStartTime()));
        sessionBody.put("duration",
                request.getDurationMinutes() > 0 ? request.getDurationMinutes() * 60000L : 3600000L);
        sessionBody.put("timezone", "Asia/Calcutta");

        Object presenterObj = cfg.get("presenterZuid");
        if (presenterObj == null) {
            presenterObj = cfg.get("presenterId"); // fallback alias
        }
        Long presenter = presenterObj != null ? Long.parseLong(presenterObj.toString()) : Long.parseLong(userId);
        sessionBody.put("presenter", presenter);

        String url = apiBase + "/api/v2/" + userId + "/sessions.json";
        JsonNode response = webClientBuilder.build()
                .post().uri(url)
                .header("Authorization", "Zoho-oauthtoken " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("session", sessionBody))
                .retrieve()
                .onStatus(status -> status.is4xxClientError() || status.is5xxServerError(),
                        clientResponse -> clientResponse.bodyToMono(String.class)
                                .map(body -> {
                                    log.error("[Zoho] Error response: HTTP {} - {}", clientResponse.statusCode(), body);
                                    return new VacademyException("Zoho error: " + body);
                                }))
                .bodyToMono(JsonNode.class)
                .doOnError(e -> VendorCallLog.failed(url, "create meeting", sessionBody, e))
                .block();

        return parseCreateMeetingResponse(response);
    }

    private String formatZohoTime(String isoStartTime) {
        try {
            java.time.format.DateTimeFormatter formatter = java.time.format.DateTimeFormatter
                    .ofPattern("MMM dd, yyyy hh:mm a", java.util.Locale.ENGLISH);
            java.time.LocalDateTime localDateTime = java.time.OffsetDateTime.parse(isoStartTime).toLocalDateTime();
            return localDateTime.format(formatter);
        } catch (Exception e) {
            log.warn("Could not format time: {}", isoStartTime);
            return isoStartTime;
        }
    }

    // -----------------------------------------------------------------------
    // Participant join link
    // POST /api/v2/{zohoUserId}/sessions/{meetingKey}/participant.json
    // -----------------------------------------------------------------------

    @Override
    public ParticipantJoinLinkDTO getParticipantJoinLink(String providerMeetingId, String participantName,
            String participantEmail, String instituteId) {
        Map<String, Object> cfg = oAuthService.getValidConfigMap(instituteId);
        String token = (String) cfg.get("accessToken");
        String domain = (String) cfg.getOrDefault("domain", "zoho.com");
        String userId = resolveOrgId(cfg);
        String apiBase = ZohoOAuthService.buildApiBase(domain);

        String url = apiBase + "/api/v2/" + userId + "/sessions/" + providerMeetingId + "/participant.json";

        Map<String, Object> participantBody = new HashMap<>();
        participantBody.put("name", participantName);
        participantBody.put("email", participantEmail);

        log.debug("[Zoho] Registering participant {} for meeting {}", participantEmail, providerMeetingId);

        JsonNode response = webClientBuilder.build()
                .post().uri(url)
                .header("Authorization", "Zoho-oauthtoken " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("participant", participantBody))
                .retrieve()
                .onStatus(status -> status.is4xxClientError() || status.is5xxServerError(),
                        resp -> resp.bodyToMono(String.class).map(body -> {
                            log.error("[Zoho] Participant register failed: {}", body);
                            return new VacademyException("Zoho participant error: " + body);
                        }))
                .bodyToMono(JsonNode.class)
                .doOnError(e -> VendorCallLog.failed(url, "register participant", participantBody, e))
                .block();

        if (response == null) {
            throw new VacademyException("Null response from Zoho participant register API");
        }

        JsonNode firstElement = response.isArray() && response.size() > 0 ? response.get(0) : response;
        JsonNode participantNode = firstElement.path("participant");
        String joinLink = participantNode.path("joinLink").asText(null);
        if (joinLink == null || joinLink.isBlank()) {
            joinLink = firstElement.path("joinLink").asText(null);
        }

        return ParticipantJoinLinkDTO.builder()
                .joinLink(joinLink)
                .participantName(participantName)
                .participantEmail(participantEmail)
                .providerMeetingId(providerMeetingId)
                .build();
    }

    // -----------------------------------------------------------------------
    // User schedule availability
    // GET /api/v2/{zohoUserId}/sessions.json?listtype=upcoming
    // -----------------------------------------------------------------------

    @Override
    public UserScheduleAvailabilityDTO checkUserAvailability(
            String requestedStartTimeIso, int durationMinutes, String instituteId, String vendorUserId) {

        Map<String, Object> cfg = oAuthService.getValidConfigMap(instituteId, vendorUserId);
        String token = (String) cfg.get("accessToken");
        String domain = (String) cfg.getOrDefault("domain", "zoho.com");
        String userId = resolveOrgId(cfg);
        String apiBase = ZohoOAuthService.buildApiBase(domain);

        // Parse requested window
        long requestedStartMs = java.time.OffsetDateTime.parse(requestedStartTimeIso)
                .toInstant().toEpochMilli();
        long requestedEndMs = requestedStartMs + (long) durationMinutes * 60_000L;

        // Fetch upcoming sessions (paginate — stop once startTime is past our window)
        String url = apiBase + "/api/v2/" + userId + "/sessions.json?listtype=upcoming&index=1&count=50";
        log.debug("[Zoho Availability] Fetching upcoming sessions for userId={}", userId);

        JsonNode response = webClientBuilder.build()
                .get().uri(url)
                .header("Authorization", "Zoho-oauthtoken " + token)
                .retrieve()
                .onStatus(status -> status.is4xxClientError() || status.is5xxServerError(),
                        resp -> resp.bodyToMono(String.class).map(body -> {
                            log.error("[Zoho Availability] API failed: {}", body);
                            return new VacademyException("Zoho sessions list error: " + body);
                        }))
                .bodyToMono(JsonNode.class)
                .doOnError(e -> VendorCallLog.failed(url, "list upcoming sessions", null, e))
                .block();

        List<UserScheduleAvailabilityDTO.ConflictingSessionDTO> conflicts = new ArrayList<>();

        if (response != null && !response.isNull()) {
            JsonNode sessions = response.isArray() ? response
                    : response.has("sessions") ? response.get("sessions")
                    : response;

            if (sessions.isArray()) {
                for (JsonNode s : sessions) {
                    long sStart = s.path("startTimeMillisec").asLong(0);
                    long duration = s.path("duration").asLong(0); // milliseconds
                    long sEnd = sStart + duration;

                    // Overlap: existing [sStart, sEnd] overlaps [requestedStart, requestedEnd]
                    boolean overlaps = sStart < requestedEndMs && sEnd > requestedStartMs;
                    if (overlaps) {
                        conflicts.add(UserScheduleAvailabilityDTO.ConflictingSessionDTO.builder()
                                .meetingKey(s.path("meetingKey").asText(null))
                                .topic(s.path("topic").asText(null))
                                .startTimeMillisec(sStart)
                                .endTimeMillisec(sEnd)
                                .build());
                    }
                }
            }
        }

        return UserScheduleAvailabilityDTO.builder()
                .available(conflicts.isEmpty())
                .requestedStartTime(requestedStartTimeIso)
                .requestedDurationMinutes(durationMinutes)
                .conflicts(conflicts)
                .build();
    }

    // -----------------------------------------------------------------------
    // Get recordings
    // GET /api/v2/{zohoUserId}/sessions/{meetingKey}/recordings.json
    // -----------------------------------------------------------------------

    @Override
    public List<MeetingRecordingDTO> getRecordings(String providerMeetingId, String instituteId) {
        Map<String, Object> cfg = oAuthService.getValidConfigMap(instituteId);
        String token = (String) cfg.get("accessToken");
        String domain = (String) cfg.getOrDefault("domain", "zoho.com");
        String userId = resolveOrgId(cfg);
        String apiBase = ZohoOAuthService.buildApiBase(domain);

        // Correct Zoho Recording API:
        // https://meeting.zoho.in/api/v2/{zsoid}/recordings/{meetingKey}.json
        String url = apiBase + "/api/v2/" + userId + "/recordings/" + providerMeetingId + ".json";
        log.debug("[Zoho Recordings] Calling URL: {}", url);

        JsonNode response = webClientBuilder.build()
                .get().uri(url)
                .header("Authorization", "Zoho-oauthtoken " + token)
                .retrieve()
                .onStatus(status -> status.is4xxClientError() || status.is5xxServerError(),
                        resp -> resp.bodyToMono(String.class).map(body -> {
                            log.error("[Zoho Recordings] API failed — HTTP {} — body: {}", resp.statusCode(), body);
                            return new VacademyException("Zoho recordings error: " + body);
                        }))
                .bodyToMono(JsonNode.class)
                .doOnError(e -> VendorCallLog.failed(url, "fetch recordings", null, e))
                .block();

        log.debug("[Zoho Recordings] Raw response for meetingKey={}: {}", providerMeetingId, response);
        return parseRecordingsResponse(response, providerMeetingId);
    }

    // -----------------------------------------------------------------------
    // Get attendance
    // GET /api/v2/{zohoUserId}/sessions/{meetingKey}/attendees.json
    // -----------------------------------------------------------------------

    @Override
    public List<MeetingAttendeeDTO> getAttendance(String providerMeetingId, String instituteId) {
        Map<String, Object> cfg = oAuthService.getValidConfigMap(instituteId);
        String token = (String) cfg.get("accessToken");
        String domain = (String) cfg.getOrDefault("domain", "zoho.com");
        String userId = resolveOrgId(cfg);
        String apiBase = ZohoOAuthService.buildApiBase(domain);

        String url = apiBase + "/api/v2/" + userId + "/participant/" + providerMeetingId + ".json?index=1&count=100";
        JsonNode response = webClientBuilder.build()
                .get().uri(url)
                .header("Authorization", "Zoho-oauthtoken " + token)
                .retrieve()
                .onStatus(status -> status.is4xxClientError() || status.is5xxServerError(),
                        resp -> resp.bodyToMono(String.class).map(body -> {
                            log.error("Zoho attendance API failed: {}", body);
                            return new VacademyException("Zoho attendance error: " + body);
                        }))
                .bodyToMono(JsonNode.class)
                .doOnError(e -> VendorCallLog.failed(url, "fetch attendance", null, e))
                .block();

        return parseAttendeesResponse(response);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /**
     * Returns zohoOrgId if explicitly set in config (preferred for all API paths),
     * falls back to zohoUserId for backward compatibility.
     */
    private String resolveOrgId(Map<String, Object> cfg) {
        Object orgId = cfg.get("zohoOrgId");
        if (orgId != null && !orgId.toString().isBlank()) {
            return orgId.toString();
        }
        return (String) cfg.get("zohoUserId");
    }

    // -----------------------------------------------------------------------
    // Parsers
    // -----------------------------------------------------------------------

    private CreateMeetingResponseDTO parseCreateMeetingResponse(JsonNode response) {
        if (response == null) {
            throw new VacademyException("Empty response from Zoho when creating meeting");
        }

        JsonNode firstElement = response.isArray() ? response.get(0) : response;
        JsonNode session = firstElement.path("session");

        if (session.isMissingNode()) {
            throw new VacademyException("Zoho create meeting failed: " +
                    response.path("message").asText("Unknown error"));
        }
        Map<String, Object> raw = new HashMap<>();
        session.fields().forEachRemaining(e -> raw.put(e.getKey(), e.getValue().asText()));

        return CreateMeetingResponseDTO.builder()
                .providerMeetingId(session.path("meetingKey").asText())
                .joinUrl(session.path("joinLink").asText(""))
                .hostUrl(session.path("startLink").asText(""))
                .provider(MeetingProvider.ZOHO_MEETING)
                .rawResponse(raw)
                .build();
    }

    private List<MeetingRecordingDTO> parseRecordingsResponse(JsonNode response, String meetingId) {
        List<MeetingRecordingDTO> list = new ArrayList<>();
        if (response == null || response.isNull() || response.isMissingNode()) {
            log.warn("[Zoho Recordings] Null/empty response for meetingId={}", meetingId);
            return list;
        }

        // Zoho returns: { "recordings": [ {...}, ... ] }
        // or a wrapped array [ { "recordings": [...] } ]
        JsonNode firstElement = response.isArray() && response.size() > 0 ? response.get(0) : response;
        JsonNode node = firstElement.has("recordings") ? firstElement.get("recordings") : response;

        if (!node.isArray()) {
            log.warn("[Zoho Recordings] 'recordings' node is not an array. Full response: {}", response);
            return list;
        }

        log.debug("[Zoho Recordings] Parsing {} recording(s) for meetingId={}", node.size(), meetingId);
        for (JsonNode rec : node) {
            // erecordingId is Zoho's primary recording identifier; recordingId is a
            // fallback
            String recId = rec.path("erecordingId").asText(null);
            if (recId == null || recId.isBlank())
                recId = rec.path("recordingId").asText(null);
            if (recId == null || recId.isBlank())
                recId = rec.path("id").asText(null);

            // Zoho returns duration in milliseconds → convert to seconds
            long durationMs = rec.path("duration").asLong(0);
            long durationSecs = durationMs > 0 ? durationMs / 1000L
                    : rec.path("durationInMins").asLong(0) * 60L;

            // Zoho uses 'playUrl' for the browser-embeddable viewer link
            String playUrl = rec.path("playUrl").asText(null);
            if (playUrl == null || playUrl.isBlank())
                playUrl = rec.path("shareUrl").asText(null);

            list.add(MeetingRecordingDTO.builder()
                    .recordingId(recId)
                    .downloadUrl(rec.path("downloadUrl").asText(null))
                    .playbackUrl(playUrl)
                    .durationSeconds(durationSecs)
                    .startTime(rec.path("startTime").asText(null))
                    .providerMeetingId(meetingId)
                    .build());
            log.debug("[Zoho Recordings] Parsed recording: id={}, downloadUrl={}, durationSecs={}",
                    recId, rec.path("downloadUrl").asText("N/A"), durationSecs);
        }
        return list;
    }

    private List<MeetingAttendeeDTO> parseAttendeesResponse(JsonNode response) {
        List<MeetingAttendeeDTO> list = new ArrayList<>();
        if (response == null || response.isNull() || response.isMissingNode())
            return list;

        JsonNode firstElement = response.isArray() && response.size() > 0 ? response.get(0) : response;
        JsonNode node = firstElement.has("attendees") ? firstElement.get("attendees") : response;

        if (!node.isArray())
            return list;

        for (JsonNode att : node) {
            list.add(MeetingAttendeeDTO.builder()
                    .name(att.path("name").asText(null))
                    .email(att.path("email").asText(null))
                    .joinTime(att.path("joinTime").asText(null))
                    .leaveTime(att.path("leaveTime").asText(null))
                    .durationMinutes(att.path("duration").asInt(0))
                    .build());
        }
        return list;
    }
}
