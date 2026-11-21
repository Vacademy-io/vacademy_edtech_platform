package vacademy.io.community_service.feature.appregistry.build;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;

import java.util.Map;

/**
 * Health dashboard → App Stores → app → Builds → "iOS build". Super-admin only. See
 * {@link IosBuildService} for what each call does and {@code ios-white-label-build.yml} for the
 * runner side.
 */
@RestController
@RequestMapping("/community-service/super-admin/v1/app-registry/apps/{id}/ios-build")
public class IosBuildController {

    private final IosBuildService service;

    public IosBuildController(IosBuildService service) {
        this.service = service;
    }

    @GetMapping
    public ResponseEntity<Map<String, Object>> status(@RequestAttribute("user") CustomUserDetails user,
                                                      @PathVariable String id) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(service.status(id));
    }

    public record StartRequest(String version, String buildNumber) {
    }

    @PostMapping("/start")
    public ResponseEntity<Map<String, Object>> start(@RequestAttribute("user") CustomUserDetails user,
                                                     @PathVariable String id,
                                                     @RequestBody StartRequest body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(service.start(id, body.version(), body.buildNumber()));
    }

    @PostMapping("/firebase")
    public ResponseEntity<Map<String, Object>> firebase(@RequestAttribute("user") CustomUserDetails user,
                                                        @PathVariable String id) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(service.createFirebaseApp(id));
    }
}
