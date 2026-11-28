package vacademy.io.assessment_service.features.open_evaluation.controller;

import com.fasterxml.jackson.annotation.JsonProperty;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.assessment_service.features.open_evaluation.OpenApiPaths;
import vacademy.io.assessment_service.features.open_evaluation.auth.AdminCoreApiKeyClient;
import vacademy.io.assessment_service.features.open_evaluation.auth.OpenApiCaller;
import vacademy.io.assessment_service.features.open_evaluation.quota.ApiQuotaService;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.util.List;

/**
 * {@code GET /me} (spec 7.14): who the key is and what it may do. Any valid key may call
 * it (no scope), so an integrator can check a key before wiring anything else. It is also
 * the end-to-end probe of the partner stack: key verification, the security rule, rate
 * limiting, quotas and the error envelope.
 */
@RestController
@RequestMapping(OpenApiPaths.BASE)
public class OpenEvaluationMeController {

    private final ApiQuotaService quotaService;
    private final AdminCoreApiKeyClient adminCore;

    public OpenEvaluationMeController(ApiQuotaService quotaService, AdminCoreApiKeyClient adminCore) {
        this.quotaService = quotaService;
        this.adminCore = adminCore;
    }

    @GetMapping("/me")
    public ResponseEntity<MeResponse> me() {
        ApiKeyPrincipal key = OpenApiCaller.require();
        ApiQuotaService.Usage usage = quotaService.usageToday(key.getInstituteId());
        // Short-timeout client, cached; null (field absent) when admin_core is slow or down.
        String instituteName = adminCore.instituteName(key.getInstituteId());
        MeResponse body = new MeResponse(
                key.getKeyId(),
                key.getName(),
                key.getInstituteId(),
                instituteName,
                key.getScopes().stream().sorted().toList(),
                key.getRateTier() == null ? "standard" : key.getRateTier(),
                key.getDailyCopyQuota() == null ? ApiQuotaService.DEFAULT_DAILY_COPY_QUOTA : key.getDailyCopyQuota(),
                key.getDailyCopyCap(),
                usage.copies(),
                quotaService.resetsAt().toString());
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);
    }

    public record MeResponse(
            @JsonProperty("key_id") String keyId,
            @JsonProperty("name") String name,
            @JsonProperty("institute_id") String instituteId,
            @JsonProperty("institute_name") String instituteName,
            @JsonProperty("scopes") List<String> scopes,
            @JsonProperty("rate_tier") String rateTier,
            @JsonProperty("daily_copy_quota") int dailyCopyQuota,
            @JsonProperty("daily_copy_cap") Integer dailyCopyCap,
            @JsonProperty("quota_used_today") int quotaUsedToday,
            @JsonProperty("quota_resets_at") String quotaResetsAt) {
    }
}
