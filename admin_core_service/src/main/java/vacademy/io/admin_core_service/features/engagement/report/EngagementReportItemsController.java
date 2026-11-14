package vacademy.io.admin_core_service.features.engagement.report;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.engagement.service.EngagementAccessGuard;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

/**
 * The leads behind the daily report's numbers (the dashboard's "Leads &amp; outcomes" page): who was
 * added, who booked or had a demo, whose status moved, who converted, in a period of
 * institute-local days (one day, or from–to). Institute admins only, as the report.
 */
@RestController
@RequestMapping("/admin-core-service/v1/engagement/reports")
@RequiredArgsConstructor
public class EngagementReportItemsController {

    private final EngagementReportItemsService itemsService;
    private final EngagementAccessGuard accessGuard;

    /**
     * @param engineId omit for all engines
     * @param date     YYYY-MM-DD in the institute's zone; date or from + to is required
     * @param from     with to: the period, YYYY-MM-DD inclusive (wins over date), as the report's
     * @param kind     LEADS_ADDED | DEMOS_BOOKED | DEMOS_SCHEDULED | STATUS_CHANGES | CONVERSIONS
     * @param filter   LEADS_ADDED: new | existing | list:&lt;listId|BATCH|USERS&gt;; DEMOS_SCHEDULED:
     *                 done | no_show | not_marked; STATUS_CHANGES: engine | team | automation
     * @param search   on the lead's name, email or phone
     * @param size     at most 500
     */
    @GetMapping("/daily/items")
    public ResponseEntity<EngagementReportItems> items(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "engineId", required = false) String engineId,
            @RequestParam(value = "date", required = false) String date,
            @RequestParam(value = "from", required = false) String from,
            @RequestParam(value = "to", required = false) String to,
            @RequestParam(value = "kind", required = false) String kind,
            @RequestParam(value = "filter", required = false) String filter,
            @RequestParam(value = "search", required = false) String search,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "50") int size) {
        if (instituteId == null || instituteId.isBlank()) {
            throw new InvalidRequestException("instituteId is required");
        }
        try {
            accessGuard.requireAdmin(user, instituteId);
        } catch (VacademyException e) {
            // The shared guard answers 510 for every refusal; this endpoint is new, so it says 403.
            throw new ForbiddenException(e.getMessage());
        }
        return ResponseEntity.ok(itemsService.items(instituteId, engineId, date, from, to, kind, filter, search,
                page, size));
    }
}
