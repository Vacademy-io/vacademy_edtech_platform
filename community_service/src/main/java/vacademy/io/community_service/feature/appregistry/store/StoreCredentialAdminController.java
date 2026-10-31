package vacademy.io.community_service.feature.appregistry.store;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Builder;
import lombok.Data;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.UUID;

/**
 * SuperAdmin management of per-institute store API credentials — App Store Connect today,
 * Play Developer / Partner Center once those provider integrations exist. See
 * {@link StoreCredentialResolver} for how a credential is picked at sync time, and
 * {@link StoreCredential}'s javadoc for why institute-scoped credentials exist at all.
 *
 * <p>Secrets are write-only through this API: {@link StoreCredentialView} never includes
 * {@code credentialJson}, so a private key can be set here but never read back over HTTP —
 * the same posture as changing a password without displaying the old one.
 */
@RestController
@RequestMapping("/community-service/super-admin/v1/store-credentials")
public class StoreCredentialAdminController {

    @Autowired
    private StoreCredentialRepository repository;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @GetMapping
    public ResponseEntity<List<StoreCredentialView>> list(@RequestAttribute("user") CustomUserDetails user) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(repository.findAllByOrderByInstituteIdAscPlatformAsc()
                .stream().map(StoreCredentialView::of).toList());
    }

    @PostMapping
    public ResponseEntity<StoreCredentialView> upsert(@RequestAttribute("user") CustomUserDetails user,
                                                       @RequestBody UpsertRequest request) {
        SuperAdminAuthUtil.requireSuperAdmin(user);

        if (request.getPlatform() == null || request.getProvider() == null
                || request.getCredentialJson() == null) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "platform, provider and credentialJson are required");
        }
        validateCredentialJson(request.getProvider(), request.getCredentialJson());

        StoreCredential credential = request.getId() != null
                ? repository.findById(request.getId())
                        .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND,
                                "Credential not found: " + request.getId()))
                : StoreCredential.builder().id(UUID.randomUUID().toString()).build();

        credential.setInstituteId(request.getInstituteId());
        credential.setPlatform(request.getPlatform());
        credential.setProvider(request.getProvider());
        credential.setLabel(request.getLabel());
        credential.setCredentialJson(request.getCredentialJson());

        return ResponseEntity.ok(StoreCredentialView.of(repository.save(credential)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@RequestAttribute("user") CustomUserDetails user, @PathVariable String id) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        if (!repository.existsById(id)) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "Credential not found: " + id);
        }
        repository.deleteById(id);
        return ResponseEntity.noContent().build();
    }

    private void validateCredentialJson(String provider, String credentialJson) {
        JsonNode json;
        try {
            json = objectMapper.readTree(credentialJson);
        } catch (Exception e) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "credentialJson is not valid JSON");
        }

        switch (provider) {
            case "APP_STORE_CONNECT" -> requireFields(provider, json, "issuerId", "keyId", "p8");
            case "GOOGLE_PLAY" -> requireFields(provider, json, "serviceAccountJson");
            case "PARTNER_CENTER" -> requireFields(provider, json, "tenantId", "clientId", "clientSecret");
            default -> throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "Unknown provider: " + provider + " (expected APP_STORE_CONNECT, GOOGLE_PLAY or PARTNER_CENTER)");
        }
    }

    private static void requireFields(String provider, JsonNode json, String... fields) {
        for (String field : fields) {
            if (!json.hasNonNull(field)) {
                throw new VacademyException(HttpStatus.BAD_REQUEST,
                        provider + " credentialJson needs: " + String.join(", ", fields));
            }
        }
    }

    @Data
    public static class UpsertRequest {
        private String id;
        private String instituteId;
        private String platform;
        private String provider;
        private String label;
        private String credentialJson;
    }

    /** Redacted view — never carries {@code credentialJson} back out over HTTP. */
    @Data
    @Builder
    public static class StoreCredentialView {
        private String id;
        private String instituteId;
        private String platform;
        private String provider;
        private String label;
        private String createdAt;
        private String updatedAt;

        static StoreCredentialView of(StoreCredential c) {
            return StoreCredentialView.builder()
                    .id(c.getId())
                    .instituteId(c.getInstituteId())
                    .platform(c.getPlatform())
                    .provider(c.getProvider())
                    .label(c.getLabel())
                    .createdAt(c.getCreatedAt() == null ? null : c.getCreatedAt().toInstant().toString())
                    .updatedAt(c.getUpdatedAt() == null ? null : c.getUpdatedAt().toInstant().toString())
                    .build();
        }
    }
}
