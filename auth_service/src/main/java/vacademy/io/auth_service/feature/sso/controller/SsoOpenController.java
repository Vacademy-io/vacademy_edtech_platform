package vacademy.io.auth_service.feature.sso.controller;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.auth_service.feature.sso.entity.InstituteSsoConnection;
import vacademy.io.auth_service.feature.sso.service.SsoConnectionService;
import vacademy.io.auth_service.feature.sso.service.SsoLoginService;
import vacademy.io.common.exceptions.VacademyException;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Public single sign-on routes (no session, no token). See {@link SsoLoginService} for the flow.
 */
@RestController
@RequestMapping("/auth-service/open/v1/sso")
public class SsoOpenController {

    private final SsoLoginService loginService;
    private final SsoConnectionService connectionService;

    public SsoOpenController(SsoLoginService loginService, SsoConnectionService connectionService) {
        this.loginService = loginService;
        this.connectionService = connectionService;
    }

    /** What the login page needs: is SSO on here, and what does the button say. */
    @GetMapping("/discover")
    public ResponseEntity<Map<String, Object>> discover(@RequestParam("institute_id") String instituteId) {
        Optional<InstituteSsoConnection> connection = connectionService.findByInstitute(instituteId)
                .filter(InstituteSsoConnection::isEnabled);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("enabled", connection.isPresent());
        connection.ifPresent(c -> {
            body.put("connection_id", c.getId());
            body.put("display_name", c.getDisplayName());
            body.put("auto_redirect", c.isAutoRedirect());
        });
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);
    }

    /**
     * Sends the browser to the provider. The portal passes institute_id (or connection_id),
     * its own origin and the path to come back to; a provider's app tile passes connection_id only.
     */
    @GetMapping("/start")
    public ResponseEntity<String> start(@RequestParam(value = "connection_id", required = false) String connectionId,
                                        @RequestParam(value = "institute_id", required = false) String instituteId,
                                        @RequestParam(value = "portal_origin", required = false) String portalOrigin,
                                        @RequestParam(value = "return_path", required = false) String returnPath,
                                        @RequestParam(value = "login_hint", required = false) String loginHint,
                                        @RequestParam(value = "client_binding", required = false) String clientBinding) {
        if ((connectionId == null || connectionId.isBlank()) && (instituteId == null || instituteId.isBlank())) {
            return html(HttpStatus.BAD_REQUEST, "Sign-in could not start", "The link is missing its institute.");
        }
        try {
            String url = loginService.start(connectionId, instituteId, portalOrigin, returnPath, loginHint,
                    clientBinding, false);
            return redirect(url);
        } catch (VacademyException e) {
            return html(HttpStatus.BAD_REQUEST, "Sign-in could not start", e.getMessage());
        }
    }

    /** The provider sends the browser back here. */
    @GetMapping("/oidc/callback")
    public ResponseEntity<String> callback(@RequestParam(value = "code", required = false) String code,
                                           @RequestParam(value = "state", required = false) String state,
                                           @RequestParam(value = "error", required = false) String error,
                                           @RequestParam(value = "error_description", required = false) String errorDescription) {
        SsoLoginService.CallbackResult result = loginService.callback(code, state, error, errorDescription);
        if (result.redirectUrl() != null) {
            return redirect(result.redirectUrl());
        }
        return ResponseEntity.ok().headers(htmlHeaders()).body(result.html());
    }

    /** The learner portal swaps the one-time code for tokens. */
    @PostMapping("/exchange")
    public ResponseEntity<Map<String, Object>> exchange(@RequestBody(required = false) Map<String, String> body) {
        String code = body == null ? null : body.get("code");
        String verifier = body == null ? null : body.get("client_verifier");
        SsoLoginService.ExchangeResult result = loginService.exchange(code, verifier);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("accessToken", result.tokens().getAccessToken());
        out.put("refreshToken", result.tokens().getRefreshToken());
        out.put("instituteId", result.instituteId());
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(out);
    }

    private static ResponseEntity<String> redirect(String url) {
        return ResponseEntity.status(HttpStatus.FOUND)
                .location(URI.create(url))
                .cacheControl(CacheControl.noStore())
                .header("Referrer-Policy", "no-referrer")
                .build();
    }

    private static ResponseEntity<String> html(HttpStatus status, String title, String message) {
        return ResponseEntity.status(status).headers(htmlHeaders())
                .body(SsoPages.page(title, message));
    }

    static HttpHeaders htmlHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(new MediaType("text", "html", java.nio.charset.StandardCharsets.UTF_8));
        headers.setCacheControl(CacheControl.noStore());
        headers.set("X-Frame-Options", "DENY");
        headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
        headers.set("Referrer-Policy", "no-referrer");
        return headers;
    }
}
