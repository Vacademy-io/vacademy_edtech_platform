package vacademy.io.admin_core_service.features.institute_api.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Body of a key issue (institute admin: POST /admin-core-service/v1/api-keys;
 * super-admin: POST /admin-core-service/super-admin/v1/institutes/{id}/api-keys).
 * snake_case per the spec, camelCase accepted as an alias.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonIgnoreProperties(ignoreUnknown = true)
public class IssueApiKeyRequest {

    /** Institute admin route only (or ?instituteId=); the super-admin route takes it from the path. */
    @JsonProperty("institute_id")
    @JsonAlias("instituteId")
    private String instituteId;

    private String name;

    /**
     * evaluation (default when empty) | login_links | ai_calling. A login_links key always gets
     * the single scope login_links:create; scopes and daily_copy_cap are ignored for it. An
     * ai_calling key (vak_call_...) takes calls:read, calls:write, webhooks:manage (all three
     * when empty) and, only when named, human_calls:read / human_calls:write; daily_copy_cap is ignored for it. A catalog key (vak_pub_..., publishable)
     * takes catalog:read, leads:write (both when empty); daily_copy_cap is ignored for it.
     */
    private String product;

    /** Defaults to evaluation:read + evaluation:write when empty. */
    private List<String> scopes;

    /** ISO-8601 instant, e.g. 2027-03-31T00:00:00Z. Optional; must be in the future. */
    @JsonProperty("expires_at")
    @JsonAlias("expiresAt")
    private String expiresAt;

    /** Optional per-key daily copy cap (>= 1). */
    @JsonProperty("daily_copy_cap")
    @JsonAlias("dailyCopyCap")
    private Integer dailyCopyCap;
}
