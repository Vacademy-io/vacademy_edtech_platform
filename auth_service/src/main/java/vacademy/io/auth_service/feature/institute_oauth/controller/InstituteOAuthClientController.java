package vacademy.io.auth_service.feature.institute_oauth.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.web.bind.annotation.*;
import vacademy.io.auth_service.feature.institute_oauth.dto.InstituteOAuthClientRequest;
import vacademy.io.auth_service.feature.institute_oauth.dto.InstituteOAuthClientResponse;
import vacademy.io.auth_service.feature.institute_oauth.entity.InstituteOAuthClient;
import vacademy.io.auth_service.feature.institute_oauth.service.InstituteOAuthClientAccessGuard;
import vacademy.io.auth_service.feature.institute_oauth.service.InstituteOAuthClientService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Map;

/**
 * A white-label institute's own OAuth client, e.g. the brand's Google client so Google's sign-in
 * screen shows the brand's name. Managed by the institute's admins from White Label settings;
 * takes effect on every pod within 5 minutes, no deploy or GitHub secret per brand.
 */
@RestController
@RequestMapping("/auth-service/v1/institutes/{instituteId}/oauth-clients/{provider}")
public class InstituteOAuthClientController {

    @Autowired
    private InstituteOAuthClientService instituteOAuthClientService;

    @Autowired
    private InstituteOAuthClientAccessGuard accessGuard;

    @Autowired
    private ClientRegistrationRepository clientRegistrationRepository;

    @GetMapping
    public ResponseEntity<InstituteOAuthClientResponse> get(@RequestAttribute("user") CustomUserDetails user,
                                                            @PathVariable String instituteId,
                                                            @PathVariable String provider) {
        accessGuard.requireInstituteAdmin(user, instituteId);
        InstituteOAuthClient row = instituteOAuthClientService.find(instituteId, provider).orElse(null);
        return ResponseEntity.ok(toResponse(instituteId, provider, row));
    }

    @PutMapping
    public ResponseEntity<InstituteOAuthClientResponse> save(@RequestAttribute("user") CustomUserDetails user,
                                                             @PathVariable String instituteId,
                                                             @PathVariable String provider,
                                                             @RequestBody InstituteOAuthClientRequest body) {
        accessGuard.requireInstituteAdmin(user, instituteId);
        InstituteOAuthClient saved = instituteOAuthClientService.save(instituteId, provider,
                body.getClientId(), body.getClientSecret(), body.getEnabled(), user.getUserId());
        return ResponseEntity.ok(toResponse(instituteId, provider, saved));
    }

    @DeleteMapping
    public ResponseEntity<Map<String, Object>> delete(@RequestAttribute("user") CustomUserDetails user,
                                                      @PathVariable String instituteId,
                                                      @PathVariable String provider) {
        accessGuard.requireInstituteAdmin(user, instituteId);
        boolean deleted = instituteOAuthClientService.delete(instituteId, provider, user.getUserId());
        return ResponseEntity.ok(Map.of("deleted", deleted));
    }

    private InstituteOAuthClientResponse toResponse(String instituteId, String provider, InstituteOAuthClient row) {
        InstituteOAuthClientResponse.InstituteOAuthClientResponseBuilder response = InstituteOAuthClientResponse.builder()
                .instituteId(instituteId)
                .provider(provider)
                .redirectUri(platformRedirectUri(provider));
        if (row == null) {
            return response.configured(false).build();
        }
        return response
                .configured(true)
                .clientId(row.getClientId())
                .enabled(row.isEnabled())
                .hasSecret(row.getClientSecretEncrypted() != null && !row.getClientSecretEncrypted().isBlank())
                .updatedBy(row.getUpdatedBy())
                .updatedAt(row.getUpdatedAt())
                .build();
    }

    private String platformRedirectUri(String provider) {
        ClientRegistration registration = clientRegistrationRepository.findByRegistrationId(provider);
        return registration == null ? null
                : registration.getRedirectUri().replace("{registrationId}", registration.getRegistrationId());
    }
}
