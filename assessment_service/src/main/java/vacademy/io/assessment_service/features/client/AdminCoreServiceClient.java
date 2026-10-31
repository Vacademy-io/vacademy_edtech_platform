package vacademy.io.assessment_service.features.client;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.assessment_service.features.assessment.dto.batch_pending.EnrolledLearnerDto;
import vacademy.io.assessment_service.features.assessment_dashboard.dto.BatchEnrollmentRow;
import vacademy.io.assessment_service.features.learner_assessment.dto.ReportBrandingDto;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
public class AdminCoreServiceClient {

    private final InternalClientUtils internalClientUtils;
    private final ObjectMapper objectMapper;

    @Value("${admin.core.service.baseurl:http://localhost:8072}")
    private String adminCoreServiceBaseUrl;

    @Value("${spring.application.name:assessment_service}")
    private String clientName;

    public void saveAssessmentRawDataAsync(Map<String, Object> assessmentRawDataRequest) {
        try {
            String route = "/admin-core-service/llm-analytics/assessment";
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName, "POST", adminCoreServiceBaseUrl, route, assessmentRawDataRequest);
            if (response.getStatusCode() == HttpStatus.OK || response.getStatusCode() == HttpStatus.CREATED) {
                log.info("Assessment data sent successfully to admin-core service");
            } else {
                log.warn("Unexpected response status: {}", response.getStatusCode());
            }
        } catch (Exception e) {
            log.error("Error saving assessment data - continuing anyway. Error: {}", e.getMessage(), e);
        }
    }

    /**
     * Fetches report branding settings for an institute from admin-core-service.
     * Uses the internal HMAC-authenticated endpoint. Cached for 30 minutes per institute.
     */
    /**
     * Fetches processed AI report JSON from admin-core-service for a given user and assessment.
     * Returns null if not found or not yet processed.
     */
    public String getProcessedAIReport(String userId, String assessmentId) {
        try {
            String route = "/admin-core-service/llm-analytics/internal/processed-logs?userId="
                    + userId + "&sourceId=" + assessmentId;
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName, "GET", adminCoreServiceBaseUrl, route, null);

            if (response.getStatusCode() == HttpStatus.OK && response.getBody() != null) {
                Map<String, Object> body = objectMapper.readValue(utf8(response.getBody()), Map.class);
                java.util.List<?> logs = (java.util.List<?>) body.get("activity_logs");
                if (logs != null && !logs.isEmpty()) {
                    Map<String, Object> firstLog = (Map<String, Object>) logs.get(0);
                    Object processedJson = firstLog.get("processed_json");
                    return processedJson != null ? processedJson.toString() : null;
                }
            }
        } catch (Exception e) {
            log.warn("Failed to fetch AI report for user {} assessment {}: {}", userId, assessmentId, e.getMessage());
        }
        return null;
    }

    /**
     * Every learner's stored AI analysis for one assessment, in one call.
     *
     * <p>This is what makes a CLASS-level AI report free: the per-learner
     * analyses have already been generated and paid for, so the class view is
     * arithmetic over them rather than a fresh model call.
     *
     * <p>Never throws — an unreachable admin_core costs the AI half of the
     * report, not the report.
     */
    public List<String> getProcessedAIReportsForAssessment(String assessmentId) {
        try {
            String route = "/admin-core-service/llm-analytics/internal/processed-logs/by-source?sourceId="
                    + assessmentId;
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName, "GET", adminCoreServiceBaseUrl, route, null);

            if (response.getStatusCode() == HttpStatus.OK && response.getBody() != null) {
                Map<String, Object> body = objectMapper.readValue(response.getBody(), Map.class);
                Object analyses = body.get("analyses");
                if (analyses instanceof List<?> rows) {
                    List<String> out = new ArrayList<>(rows.size());
                    for (Object row : rows) {
                        if (row instanceof Map<?, ?> map) {
                            Object json = map.get("processed_json");
                            if (json != null) out.add(json.toString());
                        }
                    }
                    return out;
                }
            }
            log.warn("Bulk AI analyses returned {} for assessment {}", response.getStatusCode(), assessmentId);
        } catch (Exception e) {
            log.warn("Failed to fetch AI analyses for assessment {}: {}", assessmentId, e.getMessage());
        }
        return List.of();
    }

    /**
     * Outcome of an on-demand AI report generation request.
     *
     * @param status       admin_core's activity_log status - {@code processed},
     *                     {@code skipped_no_credits}, {@code failed},
     *                     {@code not_found} or {@code error}
     * @param processedJson the report JSON; non-null only when {@code status} is
     *                     {@code processed}
     */
    public record AiReportGenerationResult(String status, String processedJson) {

        public static final String STATUS_PROCESSED = "processed";
        public static final String STATUS_NO_CREDITS = "skipped_no_credits";
        public static final String STATUS_NOT_FOUND = "not_found";
        /**
         * The model call outran our HTTP read timeout. admin_core keeps working and
         * stores the result, so this means "come back shortly", not "it failed" —
         * and crucially not "retry now", which would risk a second charge.
         */
        public static final String STATUS_GENERATING = "generating";

        public boolean isProcessed() {
            return STATUS_PROCESSED.equalsIgnoreCase(status) && processedJson != null && !processedJson.isBlank();
        }

        public boolean isOutOfCredits() {
            return STATUS_NO_CREDITS.equalsIgnoreCase(status);
        }

        public boolean isNotFound() {
            return STATUS_NOT_FOUND.equalsIgnoreCase(status);
        }
    }

    /**
     * Generates the AI report for {@code userId} + {@code assessmentId} right now
     * instead of waiting for admin_core's hourly scheduler, and returns the result.
     * <p>
     * This is the call that <b>spends the institute's AI credits</b>, so it must only
     * be made on an explicit user action. It is a no-op cost-wise when the report has
     * already been generated: admin_core returns the stored row without calling the
     * model again.
     * <p>
     * Never throws - a transport failure degrades to {@code status="error"} so the
     * caller can decide what to tell the admin.
     */
    public AiReportGenerationResult generateAiReportOnDemand(String userId, String assessmentId) {
        try {
            String route = "/admin-core-service/llm-analytics/internal/process-on-demand?userId="
                    + userId + "&sourceId=" + assessmentId;
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName, "POST", adminCoreServiceBaseUrl, route, null);

            if (response.getStatusCode() == HttpStatus.OK && response.getBody() != null) {
                Map<String, Object> body = objectMapper.readValue(response.getBody(), Map.class);
                Object status = body.get("status");
                Object processedJson = body.get("processed_json");
                return new AiReportGenerationResult(
                        status != null ? status.toString() : "error",
                        processedJson != null ? processedJson.toString() : null);
            }
            log.warn("On-demand AI report generation returned {} for user {} assessment {}",
                    response.getStatusCode(), userId, assessmentId);
        } catch (org.springframework.web.client.ResourceAccessException e) {
            // Read timeout: admin_core is still running the model call and will
            // persist the result. Reported as "generating" so the caller waits
            // instead of firing a second, separately-charged request.
            log.warn("On-demand AI report generation timed out for user {} assessment {}: {}",
                    userId, assessmentId, e.getMessage());
            return new AiReportGenerationResult(AiReportGenerationResult.STATUS_GENERATING, null);
        } catch (Exception e) {
            log.warn("Failed to generate AI report on demand for user {} assessment {}: {}",
                    userId, assessmentId, e.getMessage());
        }
        return new AiReportGenerationResult("error", null);
    }

    /**
     * Report branding for an institute, read from {@code ASSESSMENT_SETTING.reportBranding}.
     * <p>
     * Two things matter here beyond the plain fetch:
     * <ul>
     *   <li><b>Institute fallback.</b> Most admins set their logo and theme colour on the
     *       institute itself and never open Settings → Assessment → Report Branding, so
     *       {@code reportBranding} is absent (or still carries the untouched default colour).
     *       Falling back to the institute's own logo/theme means reports look branded without
     *       the admin having to configure branding twice.</li>
     *   <li><b>Never cache a failed lookup.</b> This used to return a fully-populated default
     *       DTO on any error, which {@code unless = "#result.primaryColor == null"} then happily
     *       cached — one blip pinned every report to the default palette for the whole TTL.
     *       We now return {@code null} on failure and let callers apply defaults; nulls are not
     *       cached.</li>
     * </ul>
     * Callers must treat {@code null} as "unbranded" (all of them already do).
     */
    @Cacheable(value = "reportBranding", key = "#instituteId", unless = "#result == null")
    public ReportBrandingDto getReportBranding(String instituteId) {
        ReportBrandingDto branding = null;
        try {
            String route = "/admin-core-service/internal/institute/v1/" + instituteId
                    + "/setting?settingKey=ASSESSMENT_SETTING";
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName, "GET", adminCoreServiceBaseUrl, route, null);

            if (response.getStatusCode() == HttpStatus.OK && response.getBody() != null
                    && !response.getBody().isBlank() && !"null".equals(response.getBody().trim())) {
                Map<String, Object> settingData = objectMapper.readValue(response.getBody(), Map.class);
                Object brandingObj = settingData.get("reportBranding");
                if (brandingObj != null) {
                    branding = objectMapper.convertValue(brandingObj, ReportBrandingDto.class);
                }
            }
        } catch (Exception e) {
            log.warn("Failed to fetch report branding for institute {}: {}", instituteId, e.getMessage());
            return null;
        }

        try {
            return applyInstituteFallback(branding, instituteId);
        } catch (Exception e) {
            log.warn("Failed to apply institute branding fallback for institute {}: {}", instituteId, e.getMessage());
            return branding;
        }
    }

    /** Default primary colour baked into {@link ReportBrandingDto} — treated as "not configured". */
    private static final String DEFAULT_PRIMARY_COLOR = "#FF6B35";

    /**
     * Fills the logo and primary colour from the institute profile when report branding
     * leaves them unset. Anything the admin explicitly configured always wins.
     */
    private ReportBrandingDto applyInstituteFallback(ReportBrandingDto branding, String instituteId) {
        boolean logoMissing = branding == null || !StringUtils.hasText(branding.getLogoFileId());
        boolean colorMissing = branding == null || !StringUtils.hasText(branding.getPrimaryColor())
                || DEFAULT_PRIMARY_COLOR.equalsIgnoreCase(branding.getPrimaryColor());
        if (!logoMissing && !colorMissing) return branding;

        Map<String, Object> institute = getInstituteInfo(instituteId);
        if (institute == null || institute.isEmpty()) return branding;

        String themeCode = firstNonBlank(institute, "institute_theme_code", "instituteThemeCode");
        String logoFileId = firstNonBlank(institute, "institute_logo_file_id", "instituteLogoFileId");

        ReportBrandingDto result = branding != null ? branding : ReportBrandingDto.builder().build();
        if (logoMissing && StringUtils.hasText(logoFileId)) result.setLogoFileId(logoFileId);
        if (colorMissing && StringUtils.hasText(themeCode)) result.setPrimaryColor(themeCode);
        return result;
    }

    /** Institute profile as a raw map (naming strategy differs per environment, so read both forms). */
    private Map<String, Object> getInstituteInfo(String instituteId) {
        try {
            String route = "/admin-core-service/internal/institute/v1/" + instituteId;
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName, "GET", adminCoreServiceBaseUrl, route, null);
            if (response.getStatusCode() == HttpStatus.OK && response.getBody() != null) {
                return objectMapper.readValue(response.getBody(), Map.class);
            }
        } catch (Exception e) {
            log.warn("Failed to fetch institute {} for branding fallback: {}", instituteId, e.getMessage());
        }
        return null;
    }

    /**
     * The result-release template for this assessment on one channel (EMAIL / WHATSAPP):
     * assessment binding, else institute, else DEFAULT. Null when none applies or admin_core
     * cannot be reached; keys: template_id, name, type, subject, content, setting_json, level.
     */
    public Map<String, Object> resolveResultTemplate(String instituteId, String assessmentId, String channel) {
        try {
            String route = "/admin-core-service/internal/v1/assessment-result-notification/resolve?institute_id=" + instituteId
                    + (StringUtils.hasText(assessmentId) ? "&assessment_id=" + assessmentId : "") + "&template_type=" + channel;
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName, "GET", adminCoreServiceBaseUrl, route, null);
            if (response.getStatusCode() == HttpStatus.OK && StringUtils.hasText(response.getBody())) {
                return objectMapper.readValue(utf8(response.getBody()), Map.class);
            }
        } catch (Exception e) {
            log.warn("Result template lookup failed for assessment {} ({}): {}", assessmentId, channel, e.getMessage());
        }
        return null;
    }

    /**
     * The shared RestTemplate decodes a response without a charset as ISO-8859-1, which turns
     * UTF-8 emoji and curly quotes in admin_core's JSON into mojibake. When every char fits in
     * one byte and those bytes are valid UTF-8, re-decode them; otherwise leave the text alone.
     */
    static String utf8(String body) {
        if (body == null) return null;
        for (int i = 0; i < body.length(); i++) {
            if (body.charAt(i) > 0xFF) return body; // already proper Unicode
        }
        try {
            return java.nio.charset.StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                    .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
                    .decode(java.nio.ByteBuffer.wrap(body.getBytes(java.nio.charset.StandardCharsets.ISO_8859_1)))
                    .toString();
        } catch (java.nio.charset.CharacterCodingException e) {
            return body;
        }
    }

    /** Institute display name for report headers; null when it cannot be read. */
    @Cacheable(value = "reportBranding", key = "'name:' + #instituteId", unless = "#result == null")
    public String getInstituteName(String instituteId) {
        Map<String, Object> institute = getInstituteInfo(instituteId);
        return institute == null ? null : firstNonBlank(institute, "institute_name", "instituteName", "name");
    }

    /**
     * The learner's enrollment number at this institute (from their batch enrolment), or
     * null when they have none or admin_core cannot be reached. Shown on report headers.
     */
    public String getEnrollmentNumber(String userId, String instituteId) {
        if (!StringUtils.hasText(userId) || !StringUtils.hasText(instituteId)) return null;
        try {
            String route = "/admin-core-service/internal/learner/v1/enrollment-number?userId=" + userId
                    + "&instituteId=" + instituteId;
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName, "GET", adminCoreServiceBaseUrl, route, null);
            if (response.getStatusCode() == HttpStatus.OK && StringUtils.hasText(response.getBody())) {
                Map<String, Object> body = objectMapper.readValue(response.getBody(), Map.class);
                return firstNonBlank(body, "enrollment_number", "enrollmentNumber");
            }
        } catch (Exception e) {
            log.debug("Enrollment number unavailable for user {} at institute {}: {}", userId, instituteId, e.getMessage());
        }
        return null;
    }

    private static String firstNonBlank(Map<String, Object> map, String... keys) {
        for (String key : keys) {
            Object value = map.get(key);
            if (value != null && StringUtils.hasText(value.toString())) return value.toString();
        }
        return null;
    }

    /**
     * Learners enrolled in {@code batchIds}, for the "enrolled but has not attempted"
     * list. Returns an empty list on any failure — the Pending tab degrades to empty
     * rather than failing the whole submissions page.
     *
     * <p><b>Cached, and that is load-critical.</b> The submissions page fetches the
     * Pending count on every mount, so without a cache each page view would cost an
     * admin_core round trip. Batch enrollment barely changes, so a short window collapses
     * every mount, tab switch and page step for the same batch set onto one call. The key
     * is the SORTED batch id list, so callers passing the same batches in a different
     * order still share the entry.
     *
     * <p>Deliberately fetches the whole enrolled set instead of asking admin_core to
     * exclude the already-attempted learners: an exclusion array is unestimable, and on a
     * generic plan Postgres re-evaluated it per row (22ms -> 434-880ms on prod data,
     * intermittently). See the endpoint's own javadoc.
     */
    @Cacheable(value = "batchEnrolledLearners", key = "#instituteId + '|' + #batchIds", unless = "#result.isEmpty()")
    public List<EnrolledLearnerDto> getEnrolledLearnersForBatches(String instituteId, List<String> batchIds) {
        if (instituteId == null || instituteId.isBlank() || batchIds == null || batchIds.isEmpty()) {
            return List.of();
        }
        try {
            Map<String, Object> body = new HashMap<>();
            body.put("institute_id", instituteId);
            body.put("package_session_ids", batchIds);
            body.put("statuses", List.of("ACTIVE"));

            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName, "POST", adminCoreServiceBaseUrl,
                    "/admin-core-service/internal/learner/v1/enrolled-by-package-sessions", body);

            if (response.getStatusCode() == HttpStatus.OK && StringUtils.hasText(response.getBody())) {
                return objectMapper.readValue(response.getBody(), new TypeReference<List<EnrolledLearnerDto>>() {
                });
            }
            log.warn("Enrolled-learner lookup returned {} for institute {} ({} batches)",
                    response.getStatusCode(), instituteId, batchIds.size());
        } catch (Exception e) {
            log.warn("Failed to fetch enrolled learners for institute {} ({} batches): {}",
                    instituteId, batchIds.size(), e.getMessage());
        }
        return List.of();
    }

    /** One (learner, batch) enrolment and the institute enrollment number recorded on it. */
    @com.fasterxml.jackson.annotation.JsonIgnoreProperties(ignoreUnknown = true)
    public record EnrollmentNumberRow(
            @com.fasterxml.jackson.annotation.JsonProperty("user_id") String userId,
            @com.fasterxml.jackson.annotation.JsonProperty("package_session_id") String packageSessionId,
            @com.fasterxml.jackson.annotation.JsonProperty("institute_enrollment_number") String instituteEnrollmentNumber) {
    }

    /** admin_core refuses more users than this in one enrollment-number lookup. */
    private static final int ENROLLMENT_NUMBER_CHUNK = 2000;

    /**
     * The institute enrollment number on every ACTIVE enrolment of these learners (OMR
     * roll numbers). Unlike the lookups above this does NOT swallow failures: an empty
     * answer would read as "nobody has a roll number" and block every OMR download, or
     * worse, match no scanned sheet, so the caller must see that admin_core was down.
     */
    public List<EnrollmentNumberRow> getEnrollmentNumbers(String instituteId, List<String> userIds) {
        if (instituteId == null || instituteId.isBlank() || userIds == null || userIds.isEmpty()) {
            return List.of();
        }
        List<EnrollmentNumberRow> out = new ArrayList<>();
        for (int from = 0; from < userIds.size(); from += ENROLLMENT_NUMBER_CHUNK) {
            List<String> chunk = new ArrayList<>(userIds.subList(from, Math.min(userIds.size(), from + ENROLLMENT_NUMBER_CHUNK)));
            Map<String, Object> body = new HashMap<>();
            body.put("institute_id", instituteId);
            body.put("user_ids", chunk);
            body.put("statuses", List.of("ACTIVE"));
            try {
                ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                        clientName, "POST", adminCoreServiceBaseUrl,
                        "/admin-core-service/internal/learner/v1/enrollment-numbers", body);
                if (response.getStatusCode() != HttpStatus.OK) {
                    throw new VacademyException("admin-core answered " + response.getStatusCode());
                }
                if (StringUtils.hasText(response.getBody())) {
                    out.addAll(objectMapper.readValue(response.getBody(), new TypeReference<List<EnrollmentNumberRow>>() {
                    }));
                }
            } catch (VacademyException e) {
                throw e;
            } catch (Exception e) {
                log.warn("Enrollment-number lookup failed for institute {} ({} users): {}",
                        instituteId, chunk.size(), e.getMessage());
                throw new VacademyException("Could not load the learners' enrollment numbers right now; please try again.");
            }
        }
        return out;
    }

    /** admin_core refuses more batches than this in one enrolment lookup. */
    private static final int ENROLLMENT_BATCH_CHUNK = 200;

    /**
     * Every (learner, batch) enrolment in the given batches, with the enrolment date — for
     * the Assessment Dashboard, which needs each batch's full membership (a learner in two
     * batches appears under both, unlike {@link #getEnrolledLearnersForBatches}).
     *
     * <p>Returns {@code null}, not an empty list, when any chunk fails, so the dashboard can
     * say "batch membership unavailable" instead of reporting that nobody was set a test.
     */
    public List<BatchEnrollmentRow> getBatchEnrollments(String instituteId, List<String> batchIds) {
        if (instituteId == null || instituteId.isBlank() || batchIds == null || batchIds.isEmpty()) {
            return List.of();
        }
        List<BatchEnrollmentRow> out = new ArrayList<>();
        for (int from = 0; from < batchIds.size(); from += ENROLLMENT_BATCH_CHUNK) {
            List<String> chunk = new ArrayList<>(
                    batchIds.subList(from, Math.min(batchIds.size(), from + ENROLLMENT_BATCH_CHUNK)));
            try {
                Map<String, Object> body = new HashMap<>();
                body.put("institute_id", instituteId);
                body.put("package_session_ids", chunk);
                body.put("statuses", List.of("ACTIVE"));

                ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                        clientName, "POST", adminCoreServiceBaseUrl,
                        "/admin-core-service/internal/learner/v1/enrollments-by-package-sessions", body);

                if (response.getStatusCode() != HttpStatus.OK) {
                    log.warn("Batch enrolment lookup returned {} for institute {} ({} batches)",
                            response.getStatusCode(), instituteId, chunk.size());
                    return null;
                }
                if (StringUtils.hasText(response.getBody())) {
                    out.addAll(objectMapper.readValue(response.getBody(),
                            new TypeReference<List<BatchEnrollmentRow>>() {
                            }));
                }
            } catch (Exception e) {
                log.warn("Failed to fetch batch enrolments for institute {} ({} batches): {}",
                        instituteId, chunk.size(), e.getMessage());
                return null;
            }
        }
        return out;
    }

    /**
     * Display name per batch id, for the batch column in the participant CSV exports.
     * Missing ids simply stay absent, so callers must fall back to the raw id (or blank)
     * rather than assuming a hit.
     *
     * <p>Reuses admin_core's existing {@code /v1/package-sessions/names} — the same
     * endpoint notification_service uses to title batch chats — so batch naming stays
     * consistent across services instead of this one inventing its own format.
     *
     * <p>Cached: an export resolves every batch in the sheet at once, and batch names
     * essentially never change, so this should not be a per-export round trip.
     */
    @Cacheable(value = "batchNames", key = "#batchIds", unless = "#result.isEmpty()")
    public Map<String, String> getBatchNames(List<String> batchIds) {
        if (batchIds == null || batchIds.isEmpty()) {
            return Map.of();
        }
        try {
            // camelCase key: that endpoint binds PackageSessionsRequest.packageSessionIds
            // with the default naming strategy, not the snake_case one used elsewhere.
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName, "POST", adminCoreServiceBaseUrl,
                    "/admin-core-service/v1/package-sessions/names",
                    Map.of("packageSessionIds", batchIds));

            if (response.getStatusCode() == HttpStatus.OK && StringUtils.hasText(response.getBody())) {
                return objectMapper.readValue(response.getBody(), new TypeReference<Map<String, String>>() {
                });
            }
            log.warn("Batch-name lookup returned {} for {} batches", response.getStatusCode(), batchIds.size());
        } catch (Exception e) {
            log.warn("Failed to resolve names for {} batches: {}", batchIds.size(), e.getMessage());
        }
        return Map.of();
    }

    private static final String STUDENT = "STUDENT";
    private static final String LEARNER = "LEARNER";

    /**
     * Reads {@code ASSESSMENT_SETTING.resultNotifications.roles} — a map of
     * role-name -> should-receive-result-notification — for an institute.
     * Returns an empty map when unset/unreadable (callers apply per-role defaults).
     * Not cached, so a Settings toggle takes effect on the next result release.
     */
    public Map<String, Boolean> getResultNotificationRoles(String instituteId) {
        Map<String, Boolean> roles = new HashMap<>();
        try {
            String route = "/admin-core-service/internal/institute/v1/" + instituteId
                    + "/setting?settingKey=ASSESSMENT_SETTING";
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName, "GET", adminCoreServiceBaseUrl, route, null);
            if (response.getStatusCode() == HttpStatus.OK && response.getBody() != null) {
                Map<String, Object> settingData = objectMapper.readValue(response.getBody(), Map.class);
                Object rn = settingData.get("resultNotifications");
                if (rn instanceof Map) {
                    Object rolesObj = ((Map<?, ?>) rn).get("roles");
                    if (rolesObj instanceof Map) {
                        for (Map.Entry<?, ?> e : ((Map<?, ?>) rolesObj).entrySet()) {
                            if (e.getKey() != null && e.getValue() instanceof Boolean) {
                                roles.put(e.getKey().toString(), (Boolean) e.getValue());
                            }
                        }
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Failed to fetch result-notification roles for institute {}: {}", instituteId, e.getMessage());
        }
        return roles;
    }

    /**
     * The institute's default checked-copy template, from
     * {@code ASSESSMENT_SETTING.aiCopyCheck.commentPlacement}: the raw value as saved
     * ("INSIDE" / "OUTSIDE"), or "" when the institute never set one or admin-core
     * could not be asked. A failure is cached like an answer (the usual copy, for the
     * cache's 5 minutes) so a slow admin-core is asked once per institute, not once
     * per copy dispatched.
     */
    @Cacheable(value = "aiCopyCommentPlacement", key = "#instituteId", unless = "#result == null")
    public String getAiCopyCommentPlacement(String instituteId) {
        if (!StringUtils.hasText(instituteId)) return null;
        try {
            String route = "/admin-core-service/internal/institute/v1/" + instituteId
                    + "/setting?settingKey=ASSESSMENT_SETTING";
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName, "GET", adminCoreServiceBaseUrl, route, null);
            if (response.getStatusCode() != HttpStatus.OK) return "";
            String body = response.getBody();
            if (body == null || body.isBlank() || "null".equals(body.trim())) return "";
            Map<String, Object> settingData = objectMapper.readValue(body, Map.class);
            Object copyCheck = settingData == null ? null : settingData.get("aiCopyCheck");
            if (copyCheck instanceof Map) {
                Object placement = ((Map<?, ?>) copyCheck).get("commentPlacement");
                if (placement != null) return placement.toString();
            }
            return "";
        } catch (Exception e) {
            log.warn("Failed to fetch AI copy-check template for institute {}: {}", instituteId, e.getMessage());
            return "";
        }
    }

    /**
     * The institute's default AI checking settings, {@code ASSESSMENT_SETTING.aiCopyCheck}
     * as saved (instructions, languageFeedback, ...); an empty map when the institute set
     * none or admin-core could not be asked. Cached like the template above, failures
     * included, so admin-core is asked once per institute per 5 minutes.
     */
    @Cacheable(value = "aiCopyCheckDefaults", key = "#instituteId", unless = "#result == null")
    public Map<String, Object> getAiCopyCheckDefaults(String instituteId) {
        if (!StringUtils.hasText(instituteId)) return null;
        try {
            String route = "/admin-core-service/internal/institute/v1/" + instituteId
                    + "/setting?settingKey=ASSESSMENT_SETTING";
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName, "GET", adminCoreServiceBaseUrl, route, null);
            if (response.getStatusCode() != HttpStatus.OK) return Map.of();
            String body = response.getBody();
            if (body == null || body.isBlank() || "null".equals(body.trim())) return Map.of();
            Map<String, Object> settingData = objectMapper.readValue(body, Map.class);
            Object copyCheck = settingData == null ? null : settingData.get("aiCopyCheck");
            if (copyCheck instanceof Map) {
                Map<String, Object> out = new java.util.HashMap<>();
                ((Map<?, ?>) copyCheck).forEach((k, v) -> out.put(String.valueOf(k), v));
                return out;
            }
            return Map.of();
        } catch (Exception e) {
            log.warn("Failed to fetch AI copy-check defaults for institute {}: {}", instituteId, e.getMessage());
            return Map.of();
        }
    }

    /**
     * Staff roles explicitly enabled to receive the "result released"/"reevaluated"
     * email (the learner audience is excluded — it's handled separately). Default
     * for every staff role (incl. ADMIN) is OFF, so this is simply the explicitly
     * enabled non-learner roles.
     */
    public List<String> enabledStaffResultRoles(String instituteId) {
        List<String> out = new ArrayList<>();
        for (Map.Entry<String, Boolean> e : getResultNotificationRoles(instituteId).entrySet()) {
            String role = e.getKey();
            if (role != null && Boolean.TRUE.equals(e.getValue())
                    && !STUDENT.equalsIgnoreCase(role) && !LEARNER.equalsIgnoreCase(role)) {
                out.add(role);
            }
        }
        return out;
    }

    /**
     * Whether learners should receive result/report notifications. Default ON
     * (current behaviour) — only disabled when an admin explicitly turns the
     * learner/student toggle off.
     */
    public boolean isLearnerResultNotificationEnabled(String instituteId) {
        for (Map.Entry<String, Boolean> e : getResultNotificationRoles(instituteId).entrySet()) {
            String role = e.getKey();
            if (role != null && (STUDENT.equalsIgnoreCase(role) || LEARNER.equalsIgnoreCase(role))) {
                return Boolean.TRUE.equals(e.getValue());
            }
        }
        return true;
    }
}
