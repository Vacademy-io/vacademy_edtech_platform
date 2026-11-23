package vacademy.io.assessment_service.features.assessment.manager;

import com.fasterxml.jackson.databind.JsonNode;

/** Lets tests in other packages reach the manager's package-private helpers. */
public final class AssessmentBasicDetailsManagerTestAccess {
    private AssessmentBasicDetailsManagerTestAccess() {
    }

    public static JsonNode summary(JsonNode pages, String profileId) {
        return AssessmentBasicDetailsManager.reportPagesAuditSummary(pages, profileId);
    }
}
