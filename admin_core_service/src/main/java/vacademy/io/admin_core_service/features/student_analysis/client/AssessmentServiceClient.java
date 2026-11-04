package vacademy.io.admin_core_service.features.student_analysis.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.student_analysis.dto.comprehensive.AcademicsSection;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.util.ArrayList;
import java.util.List;

/**
 * HMAC client that calls assessment_service's internal endpoint to fetch
 * a student's assessment history for the AcademicsCollector.
 *
 * <p>Uses the same {@link InternalClientUtils#makeHmacRequest} pattern that
 * {@code AdminCoreServiceClient} in assessment_service uses for the reverse call.
 *
 * <p><strong>Graceful degradation:</strong> any exception (network, auth, timeout,
 * parse) returns {@code null} — the caller must handle null by returning an
 * "unavailable" academics section.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AssessmentServiceClient {

    private final InternalClientUtils internalClientUtils;
    private final ObjectMapper objectMapper;

    @Value("${assessment.server.baseurl:http://localhost:8074}")
    private String assessmentServiceBaseUrl;

    @Value("${spring.application.name:admin_core_service}")
    private String clientName;

    /**
     * Fetches the student's assessment history from assessment_service.
     *
     * @param userId      learner user-id
     * @param instituteId institute
     * @param startDate   ISO date string "YYYY-MM-DD"
     * @param endDate     ISO date string "YYYY-MM-DD"
     * @return parsed response node, or {@code null} on any failure
     */
    public AssessmentHistoryResponse fetchStudentAssessmentHistory(
            String userId, String instituteId, String startDate, String endDate) {
        return fetchStudentAssessmentHistory(userId, instituteId, startDate, endDate, null);
    }

    /** As above, limited to the assessments assigned to {@code batchId} when it is given. */
    public AssessmentHistoryResponse fetchStudentAssessmentHistory(
            String userId, String instituteId, String startDate, String endDate, String batchId) {

        try {
            String route = "/assessment-service/internal/student-analysis/assessment-history"
                    + "?userId=" + userId
                    + "&instituteId=" + instituteId
                    + "&startDate=" + startDate
                    + "&endDate=" + endDate
                    + (batchId != null && !batchId.isBlank() ? "&batchId=" + batchId : "");

            log.info("[AssessmentServiceClient] Fetching assessment history for user={} institute={} [{} - {}]",
                    userId, instituteId, startDate, endDate);

            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName, "GET", assessmentServiceBaseUrl, route, null);

            if (response.getStatusCode() == HttpStatus.OK && response.getBody() != null) {
                return parseResponse(response.getBody());
            }

            log.warn("[AssessmentServiceClient] Non-200 response: {}", response.getStatusCode());
            return null;

        } catch (Exception e) {
            log.warn("[AssessmentServiceClient] Failed to fetch assessment history for user={}: {}",
                    userId, e.getMessage());
            return null;
        }
    }

    /** One learner's latest attempt on one assessment, from the cohort endpoint. */
    public record CohortAttempt(String userId, String assessmentId, String assessmentName,
                                String attemptAt, Double percentage) {
    }

    private static final int COHORT_CHUNK = 500;

    /**
     * Latest ENDED attempt of each learner on each assessment in [startDate, endDate], for the
     * batch report. Users are sent in chunks of 500 (the endpoint limit). A failed chunk is
     * logged and skipped, so one bad call leaves the rest of the report intact.
     */
    public List<CohortAttempt> fetchCohortAttempts(String instituteId, List<String> userIds,
                                                   String startDate, String endDate) {
        List<CohortAttempt> out = new ArrayList<>();
        if (userIds == null || userIds.isEmpty()) return out;
        for (int i = 0; i < userIds.size(); i += COHORT_CHUNK) {
            List<String> chunk = userIds.subList(i, Math.min(userIds.size(), i + COHORT_CHUNK));
            postCohort(instituteId, chunk, startDate, endDate, out);
        }
        return out;
    }

    /** Every learner of the institute: the cohort endpoint with no userIds (all-batches report). */
    public List<CohortAttempt> fetchInstituteAttempts(String instituteId, String startDate, String endDate) {
        List<CohortAttempt> out = new ArrayList<>();
        postCohort(instituteId, List.of(), startDate, endDate, out);
        return out;
    }

    private void postCohort(String instituteId, List<String> userIds, String startDate, String endDate,
                            List<CohortAttempt> out) {
        try {
            java.util.Map<String, Object> body = java.util.Map.of(
                    "instituteId", instituteId,
                    "userIds", userIds,
                    "startDate", startDate,
                    "endDate", endDate);
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(clientName, "POST",
                    assessmentServiceBaseUrl, "/assessment-service/internal/student-analysis/assessment-history/cohort", body);
            if (response == null || response.getStatusCode() != HttpStatus.OK || response.getBody() == null) {
                log.warn("[AssessmentServiceClient] cohort call returned {}", response == null ? null : response.getStatusCode());
                return;
            }
            JsonNode attempts = objectMapper.readTree(response.getBody()).path("attempts");
            if (!attempts.isArray()) return;
            for (JsonNode a : attempts) {
                out.add(new CohortAttempt(
                        a.path("userId").asText(null),
                        a.path("assessmentId").asText(null),
                        a.path("assessmentName").asText(null),
                        a.path("attemptAt").asText(null),
                        nodeAsDouble(a, "percentage")));
            }
        } catch (Exception e) {
            log.warn("[AssessmentServiceClient] cohort call failed for institute={}: {}", instituteId, e.getMessage());
        }
    }

    private AssessmentHistoryResponse parseResponse(String body) {
        try {
            JsonNode root = objectMapper.readTree(body);

            AssessmentHistoryResponse result = new AssessmentHistoryResponse();

            JsonNode assessmentsNode = root.path("assessments");
            List<AcademicsSection.AssessmentItem> assessments = new ArrayList<>();

            if (assessmentsNode.isArray()) {
                for (JsonNode a : assessmentsNode) {
                    AcademicsSection.AssessmentItem item = AcademicsSection.AssessmentItem.builder()
                            .assessmentId(a.path("assessmentId").asText(null))
                            // "name" — try assessmentName, fall back to name field
                            .name(a.path("assessmentName").isMissingNode()
                                    ? a.path("name").asText(null)
                                    : a.path("assessmentName").asText(null))
                            .attemptId(a.path("attemptId").asText(null))
                            // "date" — try attemptDate, fall back to date field
                            .date(a.path("attemptDate").isMissingNode()
                                    ? a.path("date").asText(null)
                                    : a.path("attemptDate").asText(null))
                            // "subject" — read from subject field
                            .subject(a.path("subject").asText(null))
                            .marks(nodeAsDouble(a, "marks"))
                            .totalMarks(nodeAsDouble(a, "totalMarks"))
                            .percentage(nodeAsDouble(a, "percentage"))
                            // "status" — read resultStatus or status
                            .status(a.path("resultStatus").isMissingNode()
                                    ? a.path("status").asText(null)
                                    : a.path("resultStatus").asText(null))
                            .durationSeconds(a.has("durationSeconds") ? a.get("durationSeconds").asLong() : null)
                            .rank(a.has("rank") ? a.get("rank").asInt() : null)
                            .percentile(nodeAsDouble(a, "percentile"))
                            .accuracy(nodeAsDouble(a, "accuracy"))
                            // "classAverage" — try classAverageMarks, fall back to classAverage
                            .classAverage(a.path("classAverageMarks").isMissingNode()
                                    ? nodeAsDouble(a, "classAverage")
                                    : nodeAsDouble(a, "classAverageMarks"))
                            .classAccuracy(nodeAsDouble(a, "classAccuracy"))
                            .sections(parseSections(a.path("sections")))
                            .build();
                    assessments.add(item);
                }
            }

            result.setAssessments(assessments);
            // Note: averages are now computed in AcademicsCollector; the summary node is ignored here.
            return result;

        } catch (Exception e) {
            log.warn("[AssessmentServiceClient] Failed to parse assessment history response: {}", e.getMessage());
            return null;
        }
    }

    private List<AcademicsSection.SectionItem> parseSections(JsonNode sectionsNode) {
        List<AcademicsSection.SectionItem> sections = new ArrayList<>();
        if (sectionsNode.isArray()) {
            for (JsonNode s : sectionsNode) {
                sections.add(AcademicsSection.SectionItem.builder()
                        .sectionId(s.path("sectionId").asText(null))
                        .sectionName(s.path("sectionName").asText(null))
                        .studentMarks(nodeAsDouble(s, "studentMarks"))
                        .sectionTotalMarks(nodeAsDouble(s, "sectionTotalMarks"))
                        .sectionAverageMarks(nodeAsDouble(s, "sectionAverageMarks"))
                        .studentAccuracy(nodeAsDouble(s, "studentAccuracy"))
                        .classAccuracy(nodeAsDouble(s, "classAccuracy"))
                        .build());
            }
        }
        return sections;
    }

    private Double nodeAsDouble(JsonNode node, String field) {
        if (node.has(field) && !node.get(field).isNull()) {
            return node.get(field).asDouble();
        }
        return null;
    }

    /** Lightweight wrapper around the deserialized assessment history payload. */
    @lombok.Data
    public static class AssessmentHistoryResponse {
        private List<AcademicsSection.AssessmentItem> assessments = new ArrayList<>();
    }
}
