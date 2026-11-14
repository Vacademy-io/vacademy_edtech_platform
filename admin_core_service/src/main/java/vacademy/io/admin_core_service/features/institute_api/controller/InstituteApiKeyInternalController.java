package vacademy.io.admin_core_service.features.institute_api.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.institute_api.dto.ApiKeyVerifyRequest;
import vacademy.io.admin_core_service.features.institute_api.service.InstituteApiKeyService;

import java.util.Map;

/**
 * Service-to-service key verification (spec 6.4, contract C2, T1.3).
 *
 * <p>Guarded by {@code InternalAuthFilter} (HMAC clientName + Signature headers): the
 * path has an exact {@code internal} segment, which the filter matches, and
 * {@code /admin-core-service/internal/**} is an authenticated matcher in
 * ApplicationSecurityConfig. A user JWT never reaches it.
 *
 * <p>The caller sends only the SHA-256 hex of the presented key, never the key.
 * 200 with the key + institute limits; 404 for unknown, revoked or expired (one answer
 * for all three, so the public API cannot leak which); 400 for a malformed hash.
 */
@RestController
@RequestMapping("/admin-core-service/internal/api-keys/v1")
@RequiredArgsConstructor
public class InstituteApiKeyInternalController {

    private final InstituteApiKeyService keyService;

    @PostMapping("/verify")
    public ResponseEntity<?> verify(@RequestBody(required = false) ApiKeyVerifyRequest body) {
        String hash = body == null ? null : body.getKeyHash();
        String clientIp = body == null ? null : body.getClientIp();
        return keyService.verify(hash, clientIp)
                .<ResponseEntity<?>>map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "not_found")));
    }
}
