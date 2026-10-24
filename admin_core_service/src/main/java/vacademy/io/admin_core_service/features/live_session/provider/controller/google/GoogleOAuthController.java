package vacademy.io.admin_core_service.features.live_session.provider.controller.google;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.audience.entity.OAuthConnectState;
import vacademy.io.admin_core_service.features.audience.repository.OAuthConnectStateRepository;
import vacademy.io.admin_core_service.features.live_session.provider.dto.google.GoogleAccount;
import vacademy.io.admin_core_service.features.live_session.provider.service.google.GoogleOAuthService;
import vacademy.io.admin_core_service.features.mentorship.repository.MentorRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.Map;
import java.util.Set;

/**
 * "Connect Google Workspace" onboarding (per-tenant authorization-code OAuth).
 *
 * POST /initiate → admin-authed; returns the Google consent URL + a CSRF state
 * key.
 * GET /callback → PUBLIC (browser redirect from Google, no JWT); exchanges the
 * code,
 * stores the encrypted refresh token, then bounces back to the admin UI.
 *
 * The /callback path MUST be in ApplicationSecurityConfig's permitAll list.
 * Mirrors {@code ZoomOAuthController}.
 */
@RestController
@RequestMapping("/admin-core-service/live-sessions/provider/google/oauth")
@RequiredArgsConstructor
@Slf4j
public class GoogleOAuthController {

    private static final String VENDOR = "GOOGLE_OAUTH";
    private static final Set<String> ADMIN_ROLES = Set.of("ADMIN", "INSTITUTE_ADMIN");

    private final GoogleOAuthService googleOAuthService;
    private final OAuthConnectStateRepository stateRepository;
    private final InstituteAccessValidator instituteAccessValidator;
    private final MentorRepository mentorRepository;

    @Value("${google.oauth.frontend.callback.url:https://dash.vacademy.io/settings}")
    private String frontendCallbackUrl;

    /**
     * Step 1 — return the Google consent URL the admin's browser should open.
     * {@code driveAccess=true} additionally asks for Drive read access to Meet recordings
     * (used by "Save to library"); off by default because that scope is restricted.
     */
    @PostMapping("/initiate")
    public ResponseEntity<Map<String, String>> initiate(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam String instituteId,
            @RequestParam(defaultValue = "false") boolean driveAccess) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        requireAdminRole(user);

        OAuthConnectState state = stateRepository.save(OAuthConnectState.builder()
                .instituteId(instituteId)
                .vendor(VENDOR)
                .initiatedBy(user.getUserId())
                .expiresAt(LocalDateTime.now().plusMinutes(10))
                .build());

        return ResponseEntity.ok(Map.of(
                "oauth_url", googleOAuthService.buildAuthorizeUrl(state.getId(), driveAccess),
                "session_key", state.getId()));
    }

    /**
     * Step 2 — Google redirects the browser here (PUBLIC). All token work is
     * server-side.
     */
    @GetMapping("/callback")
    public ResponseEntity<Void> callback(
            @RequestParam(required = false) String code,
            @RequestParam(required = false) String state,
            @RequestParam(required = false) String error) {
        if (error != null)
            return redirect("google_error=" + error);
        if (state == null || code == null)
            return redirect("google_error=missing_params");

        OAuthConnectState st = stateRepository.findValidById(state, LocalDateTime.now()).orElse(null);
        if (st == null || !VENDOR.equals(st.getVendor())) {
            return redirect("google_error=invalid_state");
        }
        try {
            GoogleAccount saved = googleOAuthService.completeConnection(code, st.getInstituteId());
            // Per-mentor Google: if this connect was initiated by a mentor, link the
            // freshly-connected account to their mentor record so their bookings use it.
            if (saved != null && st.getMentorId() != null && !st.getMentorId().isBlank()) {
                mentorRepository.findById(st.getMentorId()).ifPresent(m -> {
                    m.setGoogleAccountId(saved.getId());
                    mentorRepository.save(m);
                });
            }
            // Single-shot flow: mark CONSUMED so the same ?state= can't be replayed within
            // its TTL
            // (findValidById only accepts PENDING/AUTHORIZED). Unlike Meta's
            // multi-connector flow,
            // Google connects once per callback.
            st.setSessionStatus("CONSUMED");
            stateRepository.save(st);
            return redirect("google_connected=1");
        } catch (Exception e) {
            log.error("google.oauth.callback.fail state={} reason={}", state, e.getMessage());
            String reason = e.getMessage() == null ? "connect_failed" : e.getMessage();
            if (reason.length() > 200) {
                reason = reason.substring(0, 200);
            }
            return redirect("google_error=connect_failed&google_reason="
                    + URLEncoder.encode(reason, StandardCharsets.UTF_8));
        }
    }

    private ResponseEntity<Void> redirect(String query) {
        String sep = frontendCallbackUrl.contains("?") ? "&" : "?";
        return ResponseEntity.status(HttpStatus.FOUND)
                .location(URI.create(frontendCallbackUrl + sep + query))
                .build();
    }

    private void requireAdminRole(CustomUserDetails user) {
        if (user.isRootUser())
            return;
        boolean hasAdmin = user.getAuthorities() != null && user.getAuthorities().stream()
                .map(a -> a.getAuthority().toUpperCase())
                .anyMatch(ADMIN_ROLES::contains);
        if (!hasAdmin) {
            throw new VacademyException(HttpStatus.FORBIDDEN, "Admin role required to connect Google Workspace");
        }
    }
}
