package vacademy.io.auth_service.feature.panel.phase2.fleet;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.FleetResponse;

/**
 * Fleet alerts for the scheduled digest in another service. The "internal" path segment puts this
 * behind the signed service-to-service filter. Same body as the admin endpoint.
 */
@RestController
@RequestMapping("/auth-service/internal/panel/v1")
public class PanelFleetInternalController {

    private final PanelFleetService fleet;

    public PanelFleetInternalController(PanelFleetService fleet) {
        this.fleet = fleet;
    }

    @GetMapping("/fleet")
    public FleetResponse fleet(@RequestParam("institute_id") String instituteId) {
        return fleet.forService(instituteId);
    }
}
