package vacademy.io.auth_service.feature.login_link.controller;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.auth_service.feature.institute_oauth.service.InstituteOAuthClientAccessGuard;
import vacademy.io.auth_service.feature.login_link.entity.InstituteLoginLinkPolicy;
import vacademy.io.auth_service.feature.login_link.enums.LoginLinkRoute;
import vacademy.io.auth_service.feature.login_link.service.LoginCodeService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The institute's "Require login code" switch (admin dashboard: Settings → Security). Off (the default):
 * username-only links keep working. On: a learner of this institute can only be signed in by a
 * link carrying a valid {@code ?lc=} code. ACTIVE ADMIN of the institute only.
 */
@RestController
@RequestMapping("/auth-service/v1/institutes/{instituteId}/login-link-policy")
public class LoginLinkPolicyController {

    private final LoginCodeService loginCodeService;
    private final InstituteOAuthClientAccessGuard accessGuard;

    public LoginLinkPolicyController(LoginCodeService loginCodeService, InstituteOAuthClientAccessGuard accessGuard) {
        this.loginCodeService = loginCodeService;
        this.accessGuard = accessGuard;
    }

    @GetMapping
    public ResponseEntity<Map<String, Object>> get(@RequestAttribute("user") CustomUserDetails user,
                                                   @PathVariable String instituteId) {
        accessGuard.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(view(instituteId, loginCodeService.findPolicy(instituteId).orElse(null)));
    }

    /**
     * Body: {"require_login_code": true|false, "code_free_routes": ["SUBSCRIPTIONS", ...]}. Either
     * field may be left out to keep its current value; at least one must be sent.
     */
    @PutMapping
    public ResponseEntity<Map<String, Object>> save(@RequestAttribute("user") CustomUserDetails user,
                                                    @PathVariable String instituteId,
                                                    @RequestBody JsonNode body) {
        accessGuard.requireInstituteAdmin(user, instituteId);
        JsonNode flag = body == null ? null : body.get("require_login_code");
        JsonNode routes = body == null ? null : body.get("code_free_routes");
        if (flag != null && !flag.isBoolean()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "require_login_code must be true or false");
        }
        if (flag == null && routes == null) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "require_login_code or code_free_routes is required");
        }
        List<LoginLinkRoute> codeFree = null;
        if (routes != null) {
            if (!routes.isArray()) {
                throw new VacademyException(HttpStatus.BAD_REQUEST, "code_free_routes must be a list of route names");
            }
            codeFree = new ArrayList<>();
            for (JsonNode route : routes) {
                codeFree.add(LoginLinkRoute.parse(route.asText()).orElseThrow(() -> new VacademyException(
                        HttpStatus.BAD_REQUEST, "Unknown route: " + route.asText()
                                + ". Allowed: " + Arrays.toString(LoginLinkRoute.values()))));
            }
        }
        InstituteLoginLinkPolicy saved = loginCodeService.savePolicy(instituteId,
                flag == null ? null : flag.asBoolean(), codeFree, user.getUserId());
        return ResponseEntity.ok(view(instituteId, saved));
    }

    private static Map<String, Object> view(String instituteId, InstituteLoginLinkPolicy policy) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("institute_id", instituteId);
        out.put("require_login_code", policy != null && policy.isRequireLoginCode());
        out.put("updated_by", policy == null ? null : policy.getUpdatedBy());
        out.put("updated_at", policy == null || policy.getUpdatedAt() == null ? null : policy.getUpdatedAt().toString());
        out.put("code_free_routes", policy == null ? List.of()
                : policy.codeFreeRouteSet().stream().map(Enum::name).toList());
        out.put("available_routes", Arrays.stream(LoginLinkRoute.values()).map(Enum::name).toList());
        out.put("max_expires_in_days", LoginCodeService.MAX_TTL_DAYS);
        return out;
    }
}
