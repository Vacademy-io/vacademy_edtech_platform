package vacademy.io.admin_core_service.features.audience.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.audience.dto.LeadSlaSettingsDTO;
import vacademy.io.admin_core_service.features.audience.service.LeadSlaConfigService;
import vacademy.io.admin_core_service.features.audience.service.LeadTatOverrideService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Map;

/**
 * Read/write the table-backed TAT + Follow-up SLA config (replaces the LEAD_SETTING JSON).
 */
@RestController
@RequestMapping("/admin-core-service/v1/lead-sla-config")
@RequiredArgsConstructor
public class LeadSlaConfigController {

    private final LeadSlaConfigService leadSlaConfigService;
    private final LeadTatOverrideService leadTatOverrideService;

    @GetMapping
    public ResponseEntity<LeadSlaSettingsDTO> get(@RequestParam String instituteId) {
        return ResponseEntity.ok(leadSlaConfigService.getSettings(instituteId));
    }

    @PutMapping
    @Auditable(
            entityType = "LEAD_SLA_CONFIG",
            action = "UPDATE",
            entityIdExpr = "#instituteId",
            captureBefore = "@leadSlaConfigService.getSettings(#instituteId)",
            // Not "updated lead ..." — the audit table's name matcher would read
            // the rest of that sentence as a lead's name and bold it.
            descriptionExpr = "'updated TAT and follow-up SLA settings'")
    public ResponseEntity<String> save(@RequestParam String instituteId,
                                       @RequestBody LeadSlaSettingsDTO dto,
                                       @RequestAttribute("user") CustomUserDetails user) {
        leadSlaConfigService.save(instituteId, dto);
        return ResponseEntity.ok("Lead SLA config saved");
    }

    /**
     * Admin-only: set one lead's TAT deadline by hand, or clear it back to automatic.
     * Body: {@code {"due_at": "2026-10-07T04:30:00Z"}} — null/absent due_at clears the override.
     */
    @PutMapping("/lead/{responseId}/tat-due")
    @Auditable(
            entityType = "LEAD_TAT_DEADLINE",
            action = "UPDATE",
            entityIdExpr = "#responseId",
            descriptionExpr = "'changed a lead TAT deadline'")
    public ResponseEntity<String> setTatDue(@RequestParam String instituteId,
                                            @PathVariable String responseId,
                                            @RequestBody(required = false) Map<String, String> body,
                                            @RequestAttribute("user") CustomUserDetails user) {
        String dueAt = body != null ? body.get("due_at") : null;
        leadTatOverrideService.setOverride(instituteId, responseId, dueAt, user);
        return ResponseEntity.ok(dueAt == null || dueAt.isBlank() ? "TAT deadline reset" : "TAT deadline updated");
    }
}
