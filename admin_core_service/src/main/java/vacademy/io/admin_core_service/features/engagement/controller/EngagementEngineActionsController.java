package vacademy.io.admin_core_service.features.engagement.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.service.EngagementAccessGuard;
import vacademy.io.admin_core_service.features.engagement.service.EngagementCrmActionService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Map;

/**
 * B8: the CRM actions an engine may take, for the engine page's autonomy panel. GET lists every
 * action type with whether it is allowed, whether it may run on its own, and its graduation
 * progress (approved / needed); PUT saves the allowed and auto choices into channels.actions.
 */
@RestController
@RequestMapping("/admin-core-service/v1/engagement/engines/{engineId}/actions")
@RequiredArgsConstructor
public class EngagementEngineActionsController {

    private final EngagementAccessGuard accessGuard;
    private final EngagementEngineRepository engineRepository;
    private final EngagementCrmActionService crmActions;

    @GetMapping
    public ResponseEntity<List<EngagementCrmActionService.ActionSetting>> get(
            @PathVariable String engineId, @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(crmActions.settings(engine(engineId, instituteId)));
    }

    /** Body: {@code {"actions": [{"type": "ADD_NOTE", "allowed": true, "auto": false}, ...]}}. */
    @Auditable(
            entityType = "ENGAGEMENT_ENGINE",
            action = "UPDATE_ACTIONS",
            entityIdExpr = "#engineId",
            descriptionExpr = "'changed the CRM actions an engagement engine may take'")
    @PutMapping
    public ResponseEntity<List<EngagementCrmActionService.ActionSetting>> put(
            @PathVariable String engineId, @RequestParam String instituteId,
            @RequestBody Map<String, List<EngagementCrmActionService.ActionSetting>> body,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        EngagementEngine saved = crmActions.saveSettings(engine(engineId, instituteId),
                body != null ? body.get("actions") : List.of());
        return ResponseEntity.ok(crmActions.settings(saved));
    }

    private EngagementEngine engine(String engineId, String instituteId) {
        EngagementEngine e = engineRepository.findById(engineId)
                .orElseThrow(() -> new VacademyException("Engine not found"));
        if (!instituteId.equals(e.getInstituteId())) throw new VacademyException("Engine not found");
        return e;
    }
}
