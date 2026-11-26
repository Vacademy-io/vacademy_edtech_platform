package vacademy.io.admin_core_service.features.certificate.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Reads learners' best final assessment marks from assessment_service for course
 * certificate criteria. Assessment attempts live in that service's database, so an
 * Assessment slide's result cannot be reached by SQL from here.
 *
 * <p>One call per evaluation, however many learners and assessments: the endpoint takes
 * the whole batch in a POST body.
 */
@Component
@Slf4j
public class AssessmentScoreClient {

    private static final String ROUTE = "/assessment-service/internal/certificate/v1/learner-scores";

    private final InternalClientUtils internalClientUtils;
    private final ObjectMapper objectMapper;
    private final String assessmentServiceBaseUrl;
    private final String clientName;

    public AssessmentScoreClient(
            InternalClientUtils internalClientUtils,
            ObjectMapper objectMapper,
            @Value("${assessment.server.baseurl:http://localhost:8074}") String assessmentServiceBaseUrl,
            @Value("${spring.application.name:admin_core_service}") String clientName) {
        this.internalClientUtils = internalClientUtils;
        this.objectMapper = objectMapper;
        this.assessmentServiceBaseUrl = assessmentServiceBaseUrl;
        this.clientName = clientName;
    }

    /** One learner's best final result on one assessment. */
    public record AssessmentScore(Double bestPercent, long finalAttempts, long heldAttempts) {
    }

    /**
     * @return userId to assessmentId to score; a pair with no ENDED attempt is absent.
     *         Null when the call failed - callers must treat that as "unknown", never as
     *         "not attempted", or a network blip would read as a failed test.
     */
    public Map<String, Map<String, AssessmentScore>> fetchBestScores(List<String> userIds,
                                                                     List<String> assessmentIds) {
        Map<String, Map<String, AssessmentScore>> out = new HashMap<>();
        if (userIds == null || userIds.isEmpty() || assessmentIds == null || assessmentIds.isEmpty()) {
            return out;
        }
        try {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("user_ids", new ArrayList<>(userIds));
            body.put("assessment_ids", new ArrayList<>(assessmentIds));

            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName, "POST", assessmentServiceBaseUrl, ROUTE, body);
            if (response.getStatusCode() != HttpStatus.OK || response.getBody() == null) {
                log.warn("[certificate] assessment scores returned {}", response.getStatusCode());
                return null;
            }
            JsonNode rows = objectMapper.readTree(response.getBody());
            if (!rows.isArray()) {
                return null;
            }
            for (JsonNode row : rows) {
                String userId = row.path("user_id").asText(null);
                String assessmentId = row.path("assessment_id").asText(null);
                if (userId == null || assessmentId == null) {
                    continue;
                }
                JsonNode percent = row.path("best_percent");
                out.computeIfAbsent(userId, k -> new HashMap<>()).put(assessmentId, new AssessmentScore(
                        percent.isNumber() ? percent.asDouble() : null,
                        row.path("final_attempts").asLong(0),
                        row.path("held_attempts").asLong(0)));
            }
            return out;
        } catch (Exception e) {
            log.warn("[certificate] assessment scores failed: {}", e.getMessage());
            return null;
        }
    }
}
