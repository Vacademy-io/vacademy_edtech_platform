package vacademy.io.admin_core_service.features.engagement.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.service.EngagementAccessGuard;
import vacademy.io.admin_core_service.features.engagement.service.EngagementCrmActionService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * B6: approve or undo a CRM action the engine drafted (follow-up, note, escalation, status, AI
 * call). Approve runs it through its handler; undo reverses it (S9). Messages keep using
 * {@code /tasks/{id}/send}.
 */
@RestController
@RequestMapping("/admin-core-service/v1/engagement/tasks")
@RequiredArgsConstructor
public class EngagementActionController {

    private final EngagementAccessGuard accessGuard;
    private final EngagementCrmActionService crmActions;

    @Auditable(
            entityType = "ENGAGEMENT_TASK",
            action = "APPROVE_ACTION",
            entityIdExpr = "#taskId",
            descriptionExpr = "'approved an engagement CRM action (' + (#result?.body?.actionType ?: '?') + ')'")
    @PostMapping("/{taskId}/approve")
    public ResponseEntity<EngagementAction> approve(@PathVariable String taskId,
                                                    @RequestParam String instituteId,
                                                    @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(crmActions.approve(taskId, instituteId, user));
    }

    @Auditable(
            entityType = "ENGAGEMENT_TASK",
            action = "UNDO_ACTION",
            entityIdExpr = "#taskId",
            descriptionExpr = "'undid an engagement CRM action (' + (#result?.body?.actionType ?: '?') + ')'")
    @PostMapping("/{taskId}/undo")
    public ResponseEntity<EngagementAction> undo(@PathVariable String taskId,
                                                 @RequestParam String instituteId,
                                                 @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(crmActions.undo(taskId, instituteId, user));
    }
}
