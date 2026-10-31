package vacademy.io.admin_core_service.features.engagement.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementAssetRequest;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAsset;
import vacademy.io.admin_core_service.features.engagement.service.EngagementAccessGuard;
import vacademy.io.admin_core_service.features.engagement.service.EngagementEngineService;
import vacademy.io.admin_core_service.features.engagement.service.EngagementAssetService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

/** The engine's assets of sendable material (brochures, demo videos…). Admin only. */
@RestController
@RequestMapping("/admin-core-service/v1/engagement/engines/{engineId}/assets")
@RequiredArgsConstructor
public class EngagementAssetController {

    private final EngagementAssetService assetService;
    private final EngagementEngineService engineService;
    private final EngagementAccessGuard accessGuard;

    @GetMapping
    public ResponseEntity<List<EngagementAsset>> list(@PathVariable String engineId,
                                                           @RequestParam String instituteId,
                                                           @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        engineService.requireEngine(engineId, instituteId);
        return ResponseEntity.ok(assetService.list(engineId));
    }

    @PostMapping
    public ResponseEntity<EngagementAsset> add(@PathVariable String engineId,
                                                    @RequestParam String instituteId,
                                                    @RequestBody EngagementAssetRequest request,
                                                    @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        engineService.requireEngine(engineId, instituteId);
        return ResponseEntity.ok(assetService.add(engineId, instituteId, request, user.getUserId()));
    }

    @PutMapping("/{assetId}")
    public ResponseEntity<EngagementAsset> update(@PathVariable String engineId,
                                                       @PathVariable String assetId,
                                                       @RequestParam String instituteId,
                                                       @RequestBody EngagementAssetRequest request,
                                                       @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        engineService.requireEngine(engineId, instituteId);
        return ResponseEntity.ok(assetService.update(engineId, assetId, request));
    }

    @DeleteMapping("/{assetId}")
    public ResponseEntity<Void> delete(@PathVariable String engineId,
                                       @PathVariable String assetId,
                                       @RequestParam String instituteId,
                                       @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        engineService.requireEngine(engineId, instituteId);
        assetService.delete(engineId, assetId);
        return ResponseEntity.noContent().build();
    }
}
