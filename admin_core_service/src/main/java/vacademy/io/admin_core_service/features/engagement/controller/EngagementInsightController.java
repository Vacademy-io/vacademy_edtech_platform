package vacademy.io.admin_core_service.features.engagement.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementTrackingDTO;
import vacademy.io.admin_core_service.features.engagement.service.EngagementTrackingService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.nio.charset.StandardCharsets;

/**
 * Teacher insight for daily engagement: filtered item tracking, flashcard card stats, the
 * paged plan overview and the plan CSV.
 *
 * <p>Same prefix as {@link EngagementAdminController}, which keeps the original
 * {@code /item/{id}/tracking} and {@code /plan/{id}/overview} handlers. The handlers here
 * that share those paths are selected by a {@code params} condition: Spring prefers the
 * mapping with more matching parameter expressions, so a request carrying {@code status}
 * (tracking) or any of {@code page / size / q / needsAttention} (overview) lands here,
 * and a request with none of them is answered by the original handler exactly as
 * before. The overview variants are made mutually exclusive with negated expressions so
 * two of them can never match the same request.
 *
 * <p>Every endpoint proves staff membership of the institute it names, like the rest of
 * the admin surface.
 */
@RestController
@RequestMapping("/admin-core-service/engagement/admin/v1")
@RequiredArgsConstructor
public class EngagementInsightController {

    private final EngagementTrackingService trackingService;
    private final InstituteAccessValidator instituteAccessValidator;

    /**
     * Item tracking with a status filter: ALL | DONE | NOT_DONE | STARTED | LATE.
     * NOT_DONE lists enrolled learners who never opened the task (synthesized rows with
     * status NOT_STARTED); ALL is every attempt followed by those rows.
     */
    @GetMapping(value = "/item/{itemId}/tracking", params = "status")
    public ResponseEntity<EngagementTrackingDTO> itemTrackingFiltered(
            @PathVariable String itemId,
            @RequestParam String instituteId,
            @RequestParam String status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        return ResponseEntity.ok(trackingService.getItemTracking(itemId, instituteId, status, page, size));
    }

    /** Per-card outcomes of a FLASHCARDS task across every completed attempt. */
    @GetMapping("/item/{itemId}/tracking/cards")
    public ResponseEntity<EngagementTrackingDTO.CardStats> itemCardStats(
            @PathVariable String itemId,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        return ResponseEntity.ok(trackingService.getCardStats(itemId, instituteId));
    }

    // ── Plan overview, paged / searched / filtered ───────────────────────────
    // Four thin variants because a params condition can only AND its expressions:
    // each one owns one "first present" parameter, so exactly one matches.

    @GetMapping(value = "/plan/{planId}/overview", params = "page")
    public ResponseEntity<EngagementTrackingDTO.PlanOverview> planOverviewByPage(
            @PathVariable String planId,
            @RequestParam String instituteId,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) Boolean needsAttention,
            @RequestAttribute("user") CustomUserDetails user) {
        return overview(planId, instituteId, page, size, q, needsAttention, user);
    }

    @GetMapping(value = "/plan/{planId}/overview", params = {"size", "!page"})
    public ResponseEntity<EngagementTrackingDTO.PlanOverview> planOverviewBySize(
            @PathVariable String planId,
            @RequestParam String instituteId,
            @RequestParam(required = false) Integer size,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) Boolean needsAttention,
            @RequestAttribute("user") CustomUserDetails user) {
        return overview(planId, instituteId, null, size, q, needsAttention, user);
    }

    @GetMapping(value = "/plan/{planId}/overview", params = {"q", "!page", "!size"})
    public ResponseEntity<EngagementTrackingDTO.PlanOverview> planOverviewBySearch(
            @PathVariable String planId,
            @RequestParam String instituteId,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) Boolean needsAttention,
            @RequestAttribute("user") CustomUserDetails user) {
        return overview(planId, instituteId, null, null, q, needsAttention, user);
    }

    @GetMapping(value = "/plan/{planId}/overview", params = {"needsAttention", "!page", "!size", "!q"})
    public ResponseEntity<EngagementTrackingDTO.PlanOverview> planOverviewNeedsAttention(
            @PathVariable String planId,
            @RequestParam String instituteId,
            @RequestParam(required = false) Boolean needsAttention,
            @RequestAttribute("user") CustomUserDetails user) {
        return overview(planId, instituteId, null, null, null, needsAttention, user);
    }

    /**
     * The plan as a learner × task CSV (UTF-8 with a BOM so Excel opens Hindi and Arabic
     * names correctly; every learner-typed cell is formula-escaped).
     */
    @GetMapping("/plan/{planId}/overview/export")
    public ResponseEntity<byte[]> exportPlanOverview(
            @PathVariable String planId,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        byte[] csv = trackingService.exportPlanCsv(planId, instituteId).getBytes(StandardCharsets.UTF_8);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_TYPE, "text/csv; charset=UTF-8")
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"engagement-plan-" + planId + ".csv\"")
                .body(csv);
    }

    private ResponseEntity<EngagementTrackingDTO.PlanOverview> overview(
            String planId, String instituteId, Integer page, Integer size, String q,
            Boolean needsAttention, CustomUserDetails user) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        // Any of these params asks for the paged shape; page defaults to 0.
        Integer effectivePage = page == null ? 0 : page;
        EngagementTrackingService.OverviewQuery query = new EngagementTrackingService.OverviewQuery(
                effectivePage, size, q, Boolean.TRUE.equals(needsAttention));
        return ResponseEntity.ok(trackingService.getPlanOverview(planId, instituteId, query));
    }
}
