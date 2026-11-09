package vacademy.io.admin_core_service.features.marketing.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.marketing.MarketingConstants;
import vacademy.io.admin_core_service.features.marketing.dto.ConnectOptionsResponse;
import vacademy.io.admin_core_service.features.marketing.dto.ConnectSelectRequest;
import vacademy.io.admin_core_service.features.marketing.dto.ConnectSelectResponse;
import vacademy.io.admin_core_service.features.marketing.dto.OauthInitiateResponse;
import vacademy.io.admin_core_service.features.marketing.service.MarketingAccountSelectionService;
import vacademy.io.admin_core_service.features.marketing.service.MarketingOAuthService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.net.URI;

/**
 * OAuth for marketing connections: Meta Ads, Facebook Pages + Instagram, Google Ads and Google
 * Business Profile.
 *
 * <ol>
 *   <li>POST /initiate (institute admin) returns the consent URL and a session key;</li>
 *   <li>the platform redirects the browser to /meta/callback or /google/callback (public, no JWT;
 *       the state row is the CSRF guard), which exchanges the code server-side and 302s back to
 *       the dashboard with {@code mkt_session} or {@code mkt_error};</li>
 *   <li>GET /session/{key}/options and POST /session/{key}/select (institute admin) list and store
 *       the accounts the admin picks.</li>
 * </ol>
 * Tokens never reach the browser.
 */
@RestController
@RequestMapping("/admin-core-service/v1/marketing/oauth")
@RequiredArgsConstructor
@Slf4j
public class MarketingOAuthController {

    private final InstituteAccessValidator instituteAccessValidator;
    private final MarketingOAuthService oauthService;
    private final MarketingAccountSelectionService selectionService;

    @Value("${marketing.oauth.frontend-base-url:https://dash.vacademy.io}")
    private String frontendBaseUrl;

    @PostMapping("/initiate")
    public ResponseEntity<OauthInitiateResponse> initiate(
            @RequestParam String instituteId,
            @RequestParam String provider,
            @RequestParam(required = false) String frontendOrigin,
            @RequestHeader(value = "Origin", required = false) String originHeader,
            @RequestHeader(value = "Referer", required = false) String refererHeader,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        String requestedOrigin = notBlank(frontendOrigin) ? frontendOrigin
                : notBlank(originHeader) ? originHeader : refererHeader;
        return ResponseEntity.ok(oauthService.initiate(instituteId, provider, requestedOrigin, user.getUserId()));
    }

    /** Meta redirect target. Public: every parameter is optional so a denied consent still lands here. */
    @GetMapping("/meta/callback")
    public ResponseEntity<Void> metaCallback(
            @RequestParam(value = "code", required = false) String code,
            @RequestParam(value = "state", required = false) String state,
            @RequestParam(value = "error", required = false) String error,
            @RequestParam(value = "error_description", required = false) String errorDescription) {
        String target;
        try {
            target = oauthService.handleMetaCallback(code, state, error);
        } catch (Exception e) {
            log.error("Marketing Meta callback failed before redirect", e);
            target = fallbackErrorUrl();
        }
        return redirect(target);
    }

    /** Google redirect target. Public: every parameter is optional so a denied consent still lands here. */
    @GetMapping("/google/callback")
    public ResponseEntity<Void> googleCallback(
            @RequestParam(value = "code", required = false) String code,
            @RequestParam(value = "state", required = false) String state,
            @RequestParam(value = "error", required = false) String error,
            @RequestParam(value = "error_description", required = false) String errorDescription) {
        String target;
        try {
            target = oauthService.handleGoogleCallback(code, state, error);
        } catch (Exception e) {
            log.error("Marketing Google callback failed before redirect", e);
            target = fallbackErrorUrl();
        }
        return redirect(target);
    }

    @GetMapping("/session/{sessionKey}/options")
    public ResponseEntity<ConnectOptionsResponse> options(
            @PathVariable String sessionKey,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(selectionService.getOptions(sessionKey, instituteId));
    }

    @PostMapping("/session/{sessionKey}/select")
    public ResponseEntity<ConnectSelectResponse> select(
            @PathVariable String sessionKey,
            @RequestParam String instituteId,
            @RequestBody ConnectSelectRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(selectionService.select(sessionKey, instituteId,
                request == null ? null : request.getExternalIds()));
    }

    private ResponseEntity<Void> redirect(String target) {
        URI location;
        try {
            location = URI.create(target);
        } catch (Exception e) {
            location = URI.create(fallbackErrorUrl());
        }
        return ResponseEntity.status(HttpStatus.FOUND).location(location).build();
    }

    private String fallbackErrorUrl() {
        String base = notBlank(frontendBaseUrl) ? frontendBaseUrl.trim() : "https://dash.vacademy.io";
        if (base.endsWith("/")) base = base.substring(0, base.length() - 1);
        return base + MarketingConstants.FRONTEND_PATH_ADS + "?mkt_error=server_error";
    }

    private static boolean notBlank(String value) {
        return value != null && !value.isBlank();
    }
}
