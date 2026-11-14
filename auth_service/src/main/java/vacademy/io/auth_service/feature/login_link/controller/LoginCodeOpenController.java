package vacademy.io.auth_service.feature.login_link.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.auth_service.feature.login_link.dto.CreateLoginCodeRequest;
import vacademy.io.auth_service.feature.login_link.entity.LearnerLoginCode;
import vacademy.io.auth_service.feature.login_link.service.LoginCodeService;
import vacademy.io.common.auth.apikey.ApiKeyAuthFilter;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;
import vacademy.io.common.exceptions.VacademyException;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Public API for an institute's own server (CRM, website, mailer) to get a login code for one
 * of its learners, then append {@code ?lc=<code>} to any learner-portal link.
 *
 * <pre>
 * POST /auth-service/open/v1/login-codes
 * X-API-Key: vak_login_…      (admin dashboard: Settings → Security)
 * {"username": "rahul123", "expires_in_days": 7}     (or "email": "rahul@example.com")
 * →
 * {"code": "…", "expires_at": "…", "user_id": "…", "username": "rahul123", "query_param": "lc"}
 * </pre>
 *
 * The key is checked by {@link ApiKeyAuthFilter} (product login_links) before this runs; the
 * institute comes from the key, never from the request. 404 when no learner of that institute
 * has that username / email. The response carries the username, for routes that put it in the
 * path (e.g. /user-profile/edit/<username>?lc=<code>). Codes can be minted at any time but
 * sign learners in only once the institute switches on "require a login code"; until then
 * links work by username as before.
 */
@RestController
@RequestMapping("/auth-service/open/v1/login-codes")
public class LoginCodeOpenController {

    public static final String PATH = "/auth-service/open/v1/login-codes";

    private final LoginCodeService loginCodeService;

    public LoginCodeOpenController(LoginCodeService loginCodeService) {
        this.loginCodeService = loginCodeService;
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(HttpServletRequest request,
                                                      @RequestBody(required = false) CreateLoginCodeRequest body) {
        Object attribute = request.getAttribute(ApiKeyAuthFilter.PRINCIPAL_ATTRIBUTE);
        if (!(attribute instanceof ApiKeyPrincipal principal)) {
            throw new VacademyException(HttpStatus.UNAUTHORIZED, "Send your API key in the X-API-Key header.");
        }
        CreateLoginCodeRequest req = body == null ? new CreateLoginCodeRequest() : body;
        LoginCodeService.MintedCode minted = loginCodeService.mint(principal.getInstituteId(), req.getUsername(),
                req.getEmail(), req.getUserId(), req.getExpiresInDays(), LearnerLoginCode.VIA_API_KEY, principal.actorId());
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(view(minted));
    }

    static Map<String, Object> view(LoginCodeService.MintedCode minted) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("code", minted.code());
        out.put("expires_at", minted.expiresAt().toString());
        out.put("user_id", minted.userId());
        out.put("username", minted.username());
        out.put("query_param", "lc");
        return out;
    }
}
