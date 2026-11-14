package vacademy.io.auth_service.feature.login_link.controller;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.auth_service.feature.login_link.dto.CreateLoginCodeRequest;
import vacademy.io.auth_service.feature.login_link.entity.LearnerLoginCode;
import vacademy.io.auth_service.feature.login_link.service.LoginCodeService;

import java.util.Map;

/**
 * Login codes for our own services (HMAC, InternalAuthFilter): admin_core's live-class
 * reminders and workflow WhatsApp/email nodes mint one per learner and append {@code ?lc=}.
 * Body: {"institute_id", "username" | "email" | "user_id", "expires_in_days"}. Same response as the
 * public route.
 */
@RestController
@RequestMapping("/auth-service/internal/v1/login-codes")
public class LoginCodeInternalController {

    private final LoginCodeService loginCodeService;

    public LoginCodeInternalController(LoginCodeService loginCodeService) {
        this.loginCodeService = loginCodeService;
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@RequestHeader(value = "clientName", required = false) String clientName,
                                                      @RequestBody CreateLoginCodeRequest body) {
        LoginCodeService.MintedCode minted = loginCodeService.mint(body.getInstituteId(), body.getUsername(),
                body.getEmail(), body.getUserId(), body.getExpiresInDays(), LearnerLoginCode.VIA_INTERNAL, clientName);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(LoginCodeOpenController.view(minted));
    }
}
