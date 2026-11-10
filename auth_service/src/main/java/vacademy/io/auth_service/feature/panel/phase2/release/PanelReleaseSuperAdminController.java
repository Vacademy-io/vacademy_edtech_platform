package vacademy.io.auth_service.feature.panel.phase2.release;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ReleaseCreateRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ReleasePatchRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ReleaseResponse;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;

import java.util.List;

/**
 * App release registry for platform staff. Every handler checks the caller is platform staff first,
 * before the feature switch, so nobody else learns whether the feature is on.
 */
@RestController
@RequestMapping("/auth-service/super-admin/v1/panel/releases")
public class PanelReleaseSuperAdminController {

    private final PanelReleaseAdminService releases;

    public PanelReleaseSuperAdminController(PanelReleaseAdminService releases) {
        this.releases = releases;
    }

    @GetMapping
    public List<ReleaseResponse> list(@RequestAttribute("user") CustomUserDetails user) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return releases.list();
    }

    @PostMapping
    public ReleaseResponse create(@RequestAttribute("user") CustomUserDetails user,
            @RequestBody ReleaseCreateRequest body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return releases.create(user.getUserId(), body);
    }

    @PatchMapping("/{id}")
    public ReleaseResponse patch(@RequestAttribute("user") CustomUserDetails user, @PathVariable("id") String id,
            @RequestBody ReleasePatchRequest body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return releases.patch(id, body);
    }
}
