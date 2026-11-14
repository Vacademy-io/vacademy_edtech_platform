package vacademy.io.auth_service.feature.panel.phase2.fleet;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.FleetResponse;
import vacademy.io.common.auth.model.CustomUserDetails;

/** Fleet alerts for an institute's own admins. 404 FEATURE_OFF while panel.fleet.enabled is false. */
@RestController
@RequestMapping("/auth-service/v1/panel/admin")
public class PanelFleetAdminController {

    private final PanelFleetService fleet;

    public PanelFleetAdminController(PanelFleetService fleet) {
        this.fleet = fleet;
    }

    @GetMapping("/fleet")
    public FleetResponse fleet(@RequestAttribute("user") CustomUserDetails user,
            @RequestParam("institute_id") String instituteId) {
        return fleet.forAdmin(user, instituteId);
    }
}
