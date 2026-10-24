package vacademy.io.admin_core_service.features.telephony.controller;

import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.telephony.apikey.AiCallApiKeyService;
import vacademy.io.admin_core_service.features.telephony.apikey.entity.AiCallApiKey;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Admin lifecycle for external AI-Calling API keys (issue / list / revoke).
 *
 * JWT-authenticated like every other admin route: the API key itself is only
 * for
 * the PUBLIC calling API — a key is issued BY a logged-in admin of the
 * institute,
 * then handed to the external client. requireInstituteAdmin (ADMIN role in
 * that institute, no root-user bypass -- learners are root users) keeps
 * learners and other institutes' admins from minting keys that spend its credits.
 */
@RestController
@RequestMapping("/admin-core-service/v1/telephony/ai-call/api-keys")
@RequiredArgsConstructor
public class AiCallApiKeyAdminController {

    private final AiCallApiKeyService keyService;
    private final InstituteAccessValidator instituteAccessValidator;

    /** Issue a new key. The plaintext appears exactly once, in this response. */
    @PostMapping
    public ResponseEntity<Map<String, Object>> issue(
            @RequestBody IssueKeyRequest body,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, body.getInstituteId());
        AiCallApiKeyService.IssuedKey issued = keyService.issue(
                body.getInstituteId(), body.getKeyName(),
                user == null ? null : user.getUserId());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", issued.entity().getId());
        out.put("instituteId", issued.entity().getInstituteId());
        out.put("keyName", issued.entity().getKeyName());
        out.put("keyPrefix", issued.entity().getKeyPrefix());
        out.put("apiKey", issued.plaintext()); // SHOWN ONCE — never retrievable again
        out.put("createdAt", issued.entity().getCreatedAt());
        out.put("note", "Store this key now — it cannot be shown again.");
        return ResponseEntity.ok(out);
    }

    /** List keys for the institute — metadata only; no plaintext, no hash. */
    @GetMapping
    public ResponseEntity<List<Map<String, Object>>> list(
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        List<Map<String, Object>> keys = keyService.list(instituteId).stream()
                .map(AiCallApiKeyAdminController::toView)
                .toList();
        return ResponseEntity.ok(keys);
    }

    /**
     * Revoke — immediately invalid; the public API rejects it from the next call
     * on.
     */
    @DeleteMapping("/{keyId}")
    public ResponseEntity<Map<String, Object>> revoke(
            @PathVariable String keyId,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        boolean ok = keyService.revoke(instituteId, keyId);
        return ResponseEntity.ok(Map.of(
                "revoked", ok,
                "message", ok ? "API key revoked." : "Key not found or already revoked."));
    }

    static Map<String, Object> toView(AiCallApiKey k) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", k.getId());
        m.put("keyName", k.getKeyName());
        m.put("keyPrefix", k.getKeyPrefix());
        m.put("status", k.getStatus());
        m.put("createdAt", k.getCreatedAt());
        m.put("lastUsedAt", k.getLastUsedAt());
        m.put("revokedAt", k.getRevokedAt());
        return m;
    }

    @Data
    public static class IssueKeyRequest {
        private String instituteId;
        private String keyName;
    }
}