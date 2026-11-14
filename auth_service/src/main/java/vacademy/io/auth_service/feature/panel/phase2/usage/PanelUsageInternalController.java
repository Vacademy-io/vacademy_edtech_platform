package vacademy.io.auth_service.feature.panel.phase2.usage;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.HasPanelsResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.InternalInstitutesResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.UsageResponse;

/**
 * Service-to-service reads for admin_core's weekly report and notification job. The "internal" path
 * segment puts every route here behind the HMAC client filter. Other internal panel routes (fleet)
 * live in their own controllers under the same base path.
 */
@RestController
@RequestMapping(PanelUsageInternalController.BASE)
public class PanelUsageInternalController {

    public static final String BASE = "/auth-service/internal/panel/v1";

    private final PanelUsageService usage;

    public PanelUsageInternalController(PanelUsageService usage) {
        this.usage = usage;
    }

    /** The usage report with short lists: totals, least used rooms, idle rooms, top teachers and content. */
    @GetMapping("/usage-summary")
    public UsageResponse usageSummary(@RequestParam(name = "institute_id", required = false) String instituteId,
            @RequestParam(name = "from", required = false) String from,
            @RequestParam(name = "to", required = false) String to,
            @RequestParam(name = "tz", required = false) String tz) {
        return usage.summary(instituteId, from, to, tz);
    }

    /** Institutes with at least one live panel, 500 a page. */
    @GetMapping("/institutes")
    public InternalInstitutesResponse institutes(@RequestParam(name = "page", required = false) Integer page) {
        return usage.institutes(page);
    }

    @GetMapping("/has-panels")
    public HasPanelsResponse hasPanels(@RequestParam(name = "institute_id", required = false) String instituteId) {
        return usage.hasPanels(instituteId);
    }
}
