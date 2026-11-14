package vacademy.io.assessment_service.features.open_evaluation.config;

import lombok.Getter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Settings of the partner API. Defaults are safe for production: off until flipped.
 */
@Getter
@Component
public class OpenApiProperties {

    /** Master switch; while false every partner path answers 404. */
    @Value("${assessment.open-api.enabled:false}")
    private boolean enabled;

    /**
     * assessment_service replicas sharing the per-pod in-memory rate limits; each pod
     * enforces limit / pods (spec 11.5).
     */
    @Value("${assessment.open-api.pods:2}")
    private int pods;

    /**
     * Internal choice (spec 7.1/7.2, T1.30). Off until the grade request carries
     * {@code choice_groups} and {@code paper_max} (with T1.36): while false, choice groups on
     * {@code POST /exams} and {@code PUT /exams/{id}/choice-groups} answer 422
     * {@code feature_not_available}, so no partner gets a paper max the engine does not apply.
     */
    @Value("${assessment.open-api.choice-groups-enabled:false}")
    private boolean choiceGroupsEnabled;

    /**
     * Host of the private CloudFront distribution that serves media's eval-api objects
     * (e.g. {@code private-cdn.vacademy.io}). {@code GET /submissions/{id}/checked-copy?redirect=true}
     * answers 302 only to a signed URL on this host (spec 7.8); empty = always stream. Never a
     * raw S3 presign.
     */
    @Value("${assessment.open-api.private-cdn-host:}")
    private String privateCdnHost;
}
