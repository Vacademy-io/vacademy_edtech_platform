package vacademy.io.auth_service.feature.panel.phase2.usage;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.UsageMultiRow;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.UsageResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.UsageSessionsResponse;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

/**
 * The usage report for institute admins. Every parameter is optional at binding, so a switched-off
 * feature answers 404 FEATURE_OFF before any parameter is judged. Authorisation is per institute in
 * {@link PanelUsageService}.
 */
@RestController
@RequestMapping("/auth-service/v1/panel/admin")
public class PanelUsageController {

    private final PanelUsageService usage;

    public PanelUsageController(PanelUsageService usage) {
        this.usage = usage;
    }

    @GetMapping("/usage")
    public UsageResponse usage(@RequestAttribute("user") CustomUserDetails user,
            @RequestParam(name = "institute_id", required = false) String instituteId,
            @RequestParam(name = "from", required = false) String from,
            @RequestParam(name = "to", required = false) String to,
            @RequestParam(name = "tz", required = false) String tz) {
        return usage.usage(user, instituteId, from, to, tz);
    }

    @GetMapping("/usage/sessions")
    public UsageSessionsResponse sessions(@RequestAttribute("user") CustomUserDetails user,
            @RequestParam(name = "institute_id", required = false) String instituteId,
            @RequestParam(name = "from", required = false) String from,
            @RequestParam(name = "to", required = false) String to,
            @RequestParam(name = "tz", required = false) String tz,
            @RequestParam(name = "room_id", required = false) String roomId,
            @RequestParam(name = "user_id", required = false) String userId,
            @RequestParam(name = "page", required = false) Integer page,
            @RequestParam(name = "size", required = false) Integer size) {
        return usage.sessions(user, instituteId, from, to, tz, roomId, userId, page, size);
    }

    @GetMapping("/usage/multi")
    public List<UsageMultiRow> multi(@RequestAttribute("user") CustomUserDetails user,
            @RequestParam(name = "institute_ids", required = false) String instituteIds,
            @RequestParam(name = "from", required = false) String from,
            @RequestParam(name = "to", required = false) String to,
            @RequestParam(name = "tz", required = false) String tz) {
        return usage.multi(user, instituteIds, from, to, tz);
    }
}
