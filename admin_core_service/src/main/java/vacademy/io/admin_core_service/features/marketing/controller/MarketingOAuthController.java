package vacademy.io.admin_core_service.features.marketing.controller;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
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
import java.time.Duration;

/**
 * OAuth for marketing connections: Meta Ads, Facebook Pages + Instagram, Google Ads and Google
 * Business Profile.
 *
 * <ol>
 *   <li>POST /initiate (institute admin) returns the consent URL and a session key, and sets an
 *       HttpOnly cookie (on the callback path) holding a nonce whose hash is stored on the state.
 *       The dashboard must send this request with credentials so the browser keeps the cookie;</li>
 *   <li>the platform redirects the browser to /meta/callback or /google/callback (public, no JWT).
 *       The state row guards against forged or replayed codes, and the cookie ties the consent
 *       to the browser that called /initiate, so a forwarded consent link is refused. The code
 *       is exchanged server-side and the browser is 302ed back to the dashboard with
 *       {@code mkt_session} or {@code mkt_error};</li>
 *   <li>GET /session/{key}/options and POST /session/{key}/select (the admin who started the
 *       flow) list and store the accounts the admin picks.</li>
 * </ol>
 * Tokens never reach the browser.
 */
@RestController
@RequestMapping("/admin-core-service/v1/marketing/oauth")
@RequiredArgsConstructor
@Slf4j
public class MarketingOAuthController {

    /** Cookie path: only the callbacks (and initiate) under this prefix ever receive the nonce. */
    static final String BROWSER_COOKIE_PATH = "/admin-core-service/v1/marketing/oauth";

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
        MarketingOAuthService.Initiated initiated =
                oauthService.initiate(instituteId, provider, requestedOrigin, user.getUserId());
        ResponseCookie cookie = browserCookie(initiated.response().getSessionKey(), initiated.browserNonce(),
                Duration.ofMinutes(MarketingOAuthService.PENDING_TTL_MINUTES));
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, cookie.toString())
                .body(initiated.response());
    }

    /** Meta redirect target. Public: every parameter is optional so a denied consent still lands here. */
    @GetMapping("/meta/callback")
    public ResponseEntity<Void> metaCallback(
            @RequestParam(value = "code", required = false) String code,
            @RequestParam(value = "state", required = false) String state,
            @RequestParam(value = "error", required = false) String error,
            @RequestParam(value = "error_description", required = false) String errorDescription,
            HttpServletRequest request) {
        String target;
        try {
            target = oauthService.handleMetaCallback(code, state, error, browserNonce(request, state));
        } catch (Exception e) {
            log.error("Marketing Meta callback failed before redirect", e);
            target = fallbackErrorUrl();
        }
        return redirect(target, state);
    }

    /** Google redirect target. Public: every parameter is optional so a denied consent still lands here. */
    @GetMapping("/google/callback")
    public ResponseEntity<Void> googleCallback(
            @RequestParam(value = "code", required = false) String code,
            @RequestParam(value = "state", required = false) String state,
            @RequestParam(value = "error", required = false) String error,
            @RequestParam(value = "error_description", required = false) String errorDescription,
            HttpServletRequest request) {
        String target;
        try {
            target = oauthService.handleGoogleCallback(code, state, error, browserNonce(request, state));
        } catch (Exception e) {
            log.error("Marketing Google callback failed before redirect", e);
            target = fallbackErrorUrl();
        }
        return redirect(target, state);
    }

    @GetMapping("/session/{sessionKey}/options")
    public ResponseEntity<ConnectOptionsResponse> options(
            @PathVariable String sessionKey,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(selectionService.getOptions(sessionKey, instituteId, user.getUserId()));
    }

    @PostMapping("/session/{sessionKey}/select")
    public ResponseEntity<ConnectSelectResponse> select(
            @PathVariable String sessionKey,
            @RequestParam String instituteId,
            @RequestBody ConnectSelectRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(selectionService.select(sessionKey, instituteId, user.getUserId(),
                request == null ? null : request.getExternalIds()));
    }

    /** 302 to the dashboard; the flow's browser cookie is single-use, so it is cleared here. */
    private ResponseEntity<Void> redirect(String target, String stateId) {
        URI location;
        try {
            location = URI.create(target);
        } catch (Exception e) {
            location = URI.create(fallbackErrorUrl());
        }
        ResponseEntity.BodyBuilder builder = ResponseEntity.status(HttpStatus.FOUND).location(location);
        if (isCookieSafeStateId(stateId)) {
            builder.header(HttpHeaders.SET_COOKIE, browserCookie(stateId, "", Duration.ZERO).toString());
        }
        return builder.build();
    }

    /**
     * HttpOnly + Secure, scoped to the OAuth path. SameSite=None so the cookie is also kept when
     * the dashboard runs on a white-label domain (a cross-site XHR), and is sent on the top-level
     * redirect back from facebook.com / accounts.google.com. It is only a nonce: it authorises
     * nothing on its own.
     */
    private static ResponseCookie browserCookie(String stateId, String value, Duration maxAge) {
        return ResponseCookie.from(MarketingOAuthService.browserCookieName(stateId), value)
                .httpOnly(true)
                .secure(true)
                .sameSite("None")
                .path(BROWSER_COOKIE_PATH)
                .maxAge(maxAge)
                .build();
    }

    private static String browserNonce(HttpServletRequest request, String stateId) {
        if (request == null || !isCookieSafeStateId(stateId) || request.getCookies() == null) return null;
        String name = MarketingOAuthService.browserCookieName(stateId);
        for (Cookie cookie : request.getCookies()) {
            if (name.equals(cookie.getName())) return cookie.getValue();
        }
        return null;
    }

    /** State ids are UUIDs; anything else is never used to build a cookie name. */
    private static boolean isCookieSafeStateId(String stateId) {
        return stateId != null && stateId.matches("^[A-Za-z0-9-]{1,64}$");
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
