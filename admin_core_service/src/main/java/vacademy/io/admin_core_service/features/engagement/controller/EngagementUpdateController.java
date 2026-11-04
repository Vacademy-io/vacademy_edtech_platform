package vacademy.io.admin_core_service.features.engagement.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementUpdateRequest;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementUpdate;
import vacademy.io.admin_core_service.features.engagement.service.EngagementAccessGuard;
import vacademy.io.admin_core_service.features.engagement.service.EngagementEngineService;
import vacademy.io.admin_core_service.features.engagement.service.EngagementUpdateService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

/** Updates and offers an admin feeds one engine. */
@RestController
@RequestMapping("/admin-core-service/v1/engagement/engines/{engineId}/updates")
@RequiredArgsConstructor
public class EngagementUpdateController {

    private final EngagementUpdateService updateService;
    private final EngagementEngineService engineService;
    private final EngagementAccessGuard accessGuard;

    @GetMapping
    public ResponseEntity<List<EngagementUpdate>> list(@PathVariable String engineId, @RequestParam String instituteId,
                                                       @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        engineService.requireEngine(engineId, instituteId);
        return ResponseEntity.ok(updateService.list(engineId));
    }

    @PostMapping
    @Auditable(
            entityType = "ENGAGEMENT_ENGINE",
            action = "UPDATE",
            entityIdExpr = "#engineId",
            descriptionExpr = "'added an update to engagement engine ' + #engineId")
    public ResponseEntity<EngagementUpdate> create(@PathVariable String engineId, @RequestParam String instituteId,
                                                   @RequestBody EngagementUpdateRequest request,
                                                   @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(updateService.create(managedEngine(engineId, instituteId), request, user.getUserId()));
    }

    @PostMapping("/{updateId}/end")
    @Auditable(
            entityType = "ENGAGEMENT_ENGINE",
            action = "UPDATE",
            entityIdExpr = "#engineId",
            descriptionExpr = "'ended an update of engagement engine ' + #engineId")
    public ResponseEntity<EngagementUpdate> end(@PathVariable String engineId, @PathVariable String updateId,
                                                @RequestParam String instituteId,
                                                @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(updateService.end(managedEngine(engineId, instituteId), updateId));
    }

    private EngagementEngine managedEngine(String engineId, String instituteId) {
        EngagementEngine engine = engineService.requireEngine(engineId, instituteId);
        engineService.requireAdminManaged(engine);
        return engine;
    }
}
