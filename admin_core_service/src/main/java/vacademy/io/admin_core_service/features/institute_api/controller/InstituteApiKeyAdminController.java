package vacademy.io.admin_core_service.features.institute_api.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.institute_api.dto.IssueApiKeyRequest;
import vacademy.io.admin_core_service.features.institute_api.entity.InstituteApiKey;
import vacademy.io.admin_core_service.features.institute_api.service.InstituteApiAccessService;
import vacademy.io.admin_core_service.features.institute_api.service.InstituteApiKeyService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Institute-admin lifecycle of Evaluation API keys (spec 6.3, T1.2): Settings ->
 * Integrations -> API keys on the admin dashboard.
 *
 * <p>Every route requires {@code requireInstituteAdmin} (ADMIN role in that institute,
 * NO root-user bypass: learners are created as root users, gate G0). Issue is refused
 * by the service unless platform staff enabled the product for the institute.
 */
@RestController
@RequestMapping("/admin-core-service/v1/api-keys")
@RequiredArgsConstructor
public class InstituteApiKeyAdminController {

    private final InstituteApiKeyService keyService;
    private final InstituteAccessValidator instituteAccessValidator;

    /**
     * Issue a key. Institute from {@code ?instituteId=} or the body's {@code institute_id}.
     * The plaintext {@code key} appears exactly once, in this response.
     */
    @PostMapping
    public ResponseEntity<Map<String, Object>> issue(
            @RequestParam(value = "instituteId", required = false) String instituteId,
            @RequestBody(required = false) IssueApiKeyRequest body,
            @RequestAttribute("user") CustomUserDetails user) {
        String institute = resolveInstitute(instituteId, body == null ? null : body.getInstituteId());
        instituteAccessValidator.requireInstituteAdmin(user, institute);
        InstituteApiKeyService.IssuedKey issued =
                keyService.issue(institute, body, user, InstituteApiKey.VIA_DASHBOARD);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(issuedView(issued));
    }

    /**
     * List the institute's keys: metadata only, never the key or its hash. {@code ?product=}
     * narrows to one product (evaluation | login_links | ai_calling | catalog); omitted = every key.
     */
    @GetMapping
    public ResponseEntity<List<Map<String, Object>>> list(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "product", required = false) String product,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(keyService.list(instituteId, product).stream()
                .map(InstituteApiAccessService::keyView)
                .toList());
    }

    /** Revoke. Partners see 401 within ~60 s (the assessment pods' verify cache). */
    @DeleteMapping("/{keyId}")
    public ResponseEntity<Map<String, Object>> revoke(
            @PathVariable("keyId") String keyId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        return revokeResponse(keyService.revoke(instituteId, keyId, user));
    }

    static ResponseEntity<Map<String, Object>> revokeResponse(InstituteApiKeyService.RevokeOutcome outcome) {
        Map<String, Object> out = new LinkedHashMap<>();
        switch (outcome) {
            case REVOKED -> {
                out.put("revoked", true);
                out.put("message", "API key revoked.");
                return ResponseEntity.ok(out);
            }
            case ALREADY_REVOKED -> {
                out.put("revoked", false);
                out.put("message", "API key was already revoked.");
                return ResponseEntity.ok(out);
            }
            default -> {
                out.put("revoked", false);
                out.put("message", "API key not found.");
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(out);
            }
        }
    }

    /** The one response that carries the plaintext key (spec 6.3). */
    static Map<String, Object> issuedView(InstituteApiKeyService.IssuedKey issued) {
        InstituteApiKey k = issued.key();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", k.getId());
        out.put("institute_id", k.getInstituteId());
        out.put("name", k.getName());
        out.put("key", issued.plaintext()); // SHOWN ONCE: never retrievable again
        out.put("key_prefix", k.getKeyPrefix());
        out.put("scopes", List.of(k.getScopes()));
        out.put("expires_at", k.getExpiresAt() == null ? null : k.getExpiresAt().toString());
        out.put("daily_copy_cap", k.getDailyCopyCap());
        out.put("created_at", k.getCreatedAt() == null ? null : k.getCreatedAt().toString());
        out.put("note", "Store this key now. It cannot be shown again.");
        return out;
    }

    static String resolveInstitute(String fromQuery, String fromBody) {
        boolean hasQuery = fromQuery != null && !fromQuery.isBlank();
        boolean hasBody = fromBody != null && !fromBody.isBlank();
        if (hasQuery && hasBody && !fromQuery.trim().equals(fromBody.trim())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "instituteId in the query and the body differ.");
        }
        if (hasQuery) {
            return fromQuery.trim();
        }
        if (hasBody) {
            return fromBody.trim();
        }
        throw new VacademyException(HttpStatus.BAD_REQUEST, "instituteId is required.");
    }
}
