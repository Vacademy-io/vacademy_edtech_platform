package vacademy.io.admin_core_service.features.institute_api.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;
import java.util.List;

/**
 * 200 body of POST /admin-core-service/internal/api-keys/v1/verify (spec 6.4, contract C2).
 * Every field is always present (nulls included) so the caller can rely on the shape.
 * {@code expires_at} is an ISO-8601 instant string or null.
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record ApiKeyVerifyResponse(
        @JsonProperty("key_id") String keyId,
        @JsonProperty("institute_id") String instituteId,
        @JsonProperty("name") String name,
        @JsonProperty("products") List<String> products,
        @JsonProperty("scopes") List<String> scopes,
        @JsonProperty("status") String status,
        @JsonProperty("expires_at") String expiresAt,
        @JsonProperty("daily_copy_cap") Integer dailyCopyCap,
        @JsonProperty("segment") String segment,
        @JsonProperty("rate_tier") String rateTier,
        @JsonProperty("daily_copy_quota") int dailyCopyQuota,
        @JsonProperty("daily_identify_pages") int dailyIdentifyPages,
        @JsonProperty("daily_rubric_generations") int dailyRubricGenerations,
        @JsonProperty("copy_lane_cap") Integer copyLaneCap,
        @JsonProperty("typed_lane_cap") Integer typedLaneCap,
        @JsonProperty("credit_limit") BigDecimal creditLimit,
        @JsonProperty("fire_workflow_events") boolean fireWorkflowEvents,
        @JsonProperty("access_enabled") boolean accessEnabled) {
}
