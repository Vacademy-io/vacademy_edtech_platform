package vacademy.io.auth_service.feature.panel.phase2.licence;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LicenceResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LicenceRoomActionResponse;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Room seats for an institute admin. Each call needs an ACTIVE ADMIN role at the row's own
 * institute, read from user_role. 404 FEATURE_OFF while panel.licence.enabled is false.
 */
@RestController
@RequestMapping("/auth-service/v1/panel/admin")
public class PanelLicenceAdminController {

    private final PanelLicenceService licence;

    public PanelLicenceAdminController(PanelLicenceService licence) {
        this.licence = licence;
    }

    @GetMapping("/licence")
    public LicenceResponse licence(@RequestAttribute("user") CustomUserDetails user,
            @RequestParam("institute_id") String instituteId) {
        return licence.adminLicence(user, instituteId);
    }

    @PostMapping("/licence/rooms/{room_id}/assign")
    public LicenceRoomActionResponse assign(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("room_id") String roomId) {
        return licence.assign(user, roomId);
    }

    @PostMapping("/licence/rooms/{room_id}/release")
    public LicenceRoomActionResponse release(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("room_id") String roomId) {
        return licence.release(user, roomId);
    }
}
