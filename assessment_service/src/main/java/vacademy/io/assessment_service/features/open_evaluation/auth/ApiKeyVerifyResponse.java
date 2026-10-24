package vacademy.io.assessment_service.features.open_evaluation.auth;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.List;

/**
 * 200 body of admin_core {@code POST /admin-core-service/internal/api-keys/v1/verify}
 * (contract C2, spec 6.4). Unknown fields are ignored so admin_core can add more.
 */
@Data
@NoArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class ApiKeyVerifyResponse {

    @JsonProperty("key_id")
    private String keyId;
    @JsonProperty("institute_id")
    private String instituteId;
    @JsonProperty("name")
    private String name;
    @JsonProperty("products")
    private List<String> products;
    @JsonProperty("scopes")
    private List<String> scopes;
    @JsonProperty("status")
    private String status;
    /** ISO-8601 instant, or null for "never". */
    @JsonProperty("expires_at")
    private String expiresAt;
    @JsonProperty("daily_copy_cap")
    private Integer dailyCopyCap;
    @JsonProperty("segment")
    private String segment;
    @JsonProperty("rate_tier")
    private String rateTier;
    @JsonProperty("daily_copy_quota")
    private Integer dailyCopyQuota;
    @JsonProperty("daily_identify_pages")
    private Integer dailyIdentifyPages;
    @JsonProperty("daily_rubric_generations")
    private Integer dailyRubricGenerations;
    @JsonProperty("copy_lane_cap")
    private Integer copyLaneCap;
    @JsonProperty("typed_lane_cap")
    private Integer typedLaneCap;
    @JsonProperty("credit_limit")
    private BigDecimal creditLimit;
    @JsonProperty("fire_workflow_events")
    private boolean fireWorkflowEvents;
    @JsonProperty("access_enabled")
    private boolean accessEnabled;

    public ApiKeyPrincipal toPrincipal() {
        return ApiKeyPrincipal.builder()
                .keyId(keyId)
                .instituteId(instituteId)
                .name(name)
                .products(products)
                .scopes(scopes)
                .status(status)
                .expiresAt(parseInstant(expiresAt))
                .dailyCopyCap(dailyCopyCap)
                .segment(segment)
                .rateTier(rateTier)
                .dailyCopyQuota(dailyCopyQuota)
                .dailyIdentifyPages(dailyIdentifyPages)
                .dailyRubricGenerations(dailyRubricGenerations)
                .copyLaneCap(copyLaneCap)
                .typedLaneCap(typedLaneCap)
                .creditLimit(creditLimit)
                .fireWorkflowEvents(fireWorkflowEvents)
                .accessEnabled(accessEnabled)
                .build();
    }

    /**
     * admin_core sends {@code Instant.toString()}; an offset or a zone-less local time
     * (read as UTC) is accepted too. Unparseable → treated as already expired, so a
     * garbled expiry can never make a key immortal.
     */
    static Instant parseInstant(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String value = raw.trim();
        try {
            return Instant.parse(value);
        } catch (DateTimeParseException ignored) {
            // fall through
        }
        try {
            return OffsetDateTime.parse(value).toInstant();
        } catch (DateTimeParseException ignored) {
            // fall through
        }
        try {
            return LocalDateTime.parse(value).toInstant(ZoneOffset.UTC);
        } catch (DateTimeParseException ignored) {
            return Instant.EPOCH;
        }
    }
}
