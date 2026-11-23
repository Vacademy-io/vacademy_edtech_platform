package vacademy.io.auth_service.feature.sso.controller;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.auth_service.feature.institute_oauth.service.InstituteOAuthClientAccessGuard;
import vacademy.io.auth_service.feature.sso.dto.SsoConnectionRequest;
import vacademy.io.auth_service.feature.sso.dto.SsoConnectionResponse;
import vacademy.io.auth_service.feature.sso.entity.InstituteSsoConnection;
import vacademy.io.auth_service.feature.sso.service.OidcProviderClient;
import vacademy.io.auth_service.feature.sso.service.SsoConnectionService;
import vacademy.io.auth_service.feature.sso.service.SsoLoginService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * An institute admin sets up single sign-on (Settings → Single sign-on). Only an ACTIVE ADMIN of
 * the institute in the path may read or change it.
 */
@RestController
@RequestMapping("/auth-service/v1/institutes/{instituteId}/sso-connection")
public class SsoConnectionController {

    private final SsoConnectionService connectionService;
    private final SsoLoginService loginService;
    private final OidcProviderClient providerClient;
    private final InstituteOAuthClientAccessGuard accessGuard;

    public SsoConnectionController(SsoConnectionService connectionService, SsoLoginService loginService,
                                   OidcProviderClient providerClient, InstituteOAuthClientAccessGuard accessGuard) {
        this.connectionService = connectionService;
        this.loginService = loginService;
        this.providerClient = providerClient;
        this.accessGuard = accessGuard;
    }

    @GetMapping
    public ResponseEntity<SsoConnectionResponse> get(@RequestAttribute("user") CustomUserDetails user,
                                                     @PathVariable String instituteId) {
        accessGuard.requireInstituteAdmin(user, instituteId);
        InstituteSsoConnection row = connectionService.findByInstitute(instituteId).orElse(null);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(connectionService.toResponse(instituteId, row));
    }

    @PutMapping
    public ResponseEntity<SsoConnectionResponse> save(@RequestAttribute("user") CustomUserDetails user,
                                                      @PathVariable String instituteId,
                                                      @RequestBody SsoConnectionRequest body) {
        accessGuard.requireInstituteAdmin(user, instituteId);
        InstituteSsoConnection saved = connectionService.save(instituteId, body, user.getUserId());
        return ResponseEntity.ok(connectionService.toResponse(instituteId, saved));
    }

    @DeleteMapping
    public ResponseEntity<Map<String, Object>> delete(@RequestAttribute("user") CustomUserDetails user,
                                                      @PathVariable String instituteId) {
        accessGuard.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(Map.of("deleted", connectionService.delete(instituteId)));
    }

    /** Reads the provider's discovery document for an issuer, so the admin sees it answers. */
    @PostMapping("/check")
    public ResponseEntity<Map<String, Object>> check(@RequestAttribute("user") CustomUserDetails user,
                                                     @PathVariable String instituteId,
                                                     @RequestBody Map<String, String> body) {
        accessGuard.requireInstituteAdmin(user, instituteId);
        String issuer = body == null ? null : body.get("issuer");
        Map<String, Object> out = new LinkedHashMap<>();
        try {
            OidcProviderClient.Discovery discovery = providerClient.discoverFresh(issuer);
            out.put("ok", true);
            out.put("issuer", discovery.issuer());
            out.put("authorization_endpoint", discovery.authorizationEndpoint());
            out.put("token_endpoint", discovery.tokenEndpoint());
            out.put("userinfo_endpoint", discovery.userinfoEndpoint());
            out.put("jwks_uri", discovery.jwksUri());
            out.put("id_token_signing_alg_values_supported", discovery.idTokenSigningAlgs());
        } catch (VacademyException e) {
            out.put("ok", false);
            out.put("error", e.getMessage());
        }
        return ResponseEntity.ok(out);
    }

    /**
     * A provider sign-in URL in test mode: the result page shows what the provider sent and
     * whether that person would get in. Works while SSO is still switched off; never signs in.
     */
    @GetMapping("/test-url")
    public ResponseEntity<Map<String, Object>> testUrl(@RequestAttribute("user") CustomUserDetails user,
                                                       @PathVariable String instituteId,
                                                       @RequestParam(value = "portal_origin", required = false) String portalOrigin) {
        accessGuard.requireInstituteAdmin(user, instituteId);
        String url = loginService.start(null, instituteId, portalOrigin, null, null, null, true);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("url", url));
    }
}
