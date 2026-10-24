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
import vacademy.io.admin_core_service.features.engagement.dto.CreateEngineRequest;
import vacademy.io.admin_core_service.features.engagement.dto.PromptEditRequest;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPromptVersion;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.admin_core_service.features.engagement.service.EngagementEngineService;
import vacademy.io.admin_core_service.features.engagement.spi.DataPointRegistry;
import vacademy.io.admin_core_service.features.engagement.spi.DataPointSpec;
import vacademy.io.admin_core_service.features.engagement.service.EngagementAccessGuard;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Map;

/**
 * Engine CRUD — JWT, institute-admin surface (unlike notification_service, admin_core's
 * /v1/** endpoints authenticate; identity comes from the JWT, never the request body).
 * Every endpoint validates institute membership: instituteId is a request param, so without
 * this check any authenticated JWT could read/mutate another institute's engines and inbox.
 */
@RestController
@RequestMapping("/admin-core-service/v1/engagement/engines")
@RequiredArgsConstructor
public class EngagementEngineController {

    private final EngagementEngineService engineService;
    private final EngagementEngineRepository engineRepository;
    private final EngagementMemberRepository memberRepository;
    private final EngagementPromptVersionRepository promptRepository;
    private final vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository actionRepository;
    private final DataPointRegistry dataPointRegistry;
    private final EngagementAccessGuard accessGuard;

    @org.springframework.beans.factory.annotation.Value("${engagement.autonomy.first-n:5}")
    private int defaultFirstN;

    @PostMapping
    @Auditable(
            entityType = "ENGAGEMENT_ENGINE",
            action = "CREATE",
            entityIdExpr = "#result?.body?.id",
            descriptionExpr = "'created engagement engine ' + (#request?.name ?: '')")
    public ResponseEntity<EngagementEngine> create(@RequestParam String instituteId,
                                                   @RequestBody CreateEngineRequest request,
                                                   @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(engineService.create(request, instituteId, user.getUserId()));
    }

    @GetMapping
    public ResponseEntity<List<EngagementEngine>> list(@RequestParam String instituteId,
                                                       @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(engineRepository.findByInstituteIdOrderByCreatedAtDesc(instituteId));
    }

    @GetMapping("/{engineId}")
    public ResponseEntity<Map<String, Object>> get(@PathVariable String engineId,
                                                   @RequestParam String instituteId,
                                                   @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        EngagementEngine engine = engineService.requireEngine(engineId, instituteId);
        int effectiveFirstN = engine.getFirstN() != null ? engine.getFirstN() : defaultFirstN;
        // HashMap (not Map.of) — the active prompt can be null on a brand-new engine, and Map.of
        // rejects null values with an NPE. approvedSends/firstN drive the detail page's graduation UI.
        Map<String, Object> body = new java.util.HashMap<>();
        body.put("engine", engine);
        body.put("activeMembers", memberRepository.countByEngineIdAndStatus(engineId, "ACTIVE"));
        body.put("prompt", promptRepository.findTopByEngineIdAndStatusOrderByVersionDesc(engineId, "ACTIVE").orElse(null));
        body.put("approvedSends", actionRepository.countApprovedSends(engineId));
        // Graduation is per channel; the detail page shows each auto-send channel's own progress.
        Map<String, Long> byChannel = new java.util.HashMap<>();
        for (Object[] row : actionRepository.countApprovedSendsByChannel(engineId)) {
            if (row[0] != null) byChannel.put((String) row[0], ((Number) row[1]).longValue());
        }
        body.put("approvedSendsByChannel", byChannel);
        body.put("effectiveFirstN", effectiveFirstN);
        return ResponseEntity.ok(body);
    }

    /** Resolve audience selectors → enroll (idempotent, jittered) + exit leavers. */
    @PostMapping("/{engineId}/enroll")
    @Auditable(
            entityType = "ENGAGEMENT_ENGINE",
            action = "ENROLL",
            entityIdExpr = "#engineId",
            descriptionExpr = "'refreshed the audience of an engagement engine'")
    public ResponseEntity<EngagementEngineService.EnrollmentResult> enroll(
            @PathVariable String engineId,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(engineService.enrollAndReconcile(engineId, instituteId));
    }

    /** DRAFT → DRY_RUN/ACTIVE → PAUSED → ARCHIVED. Activation requires an enrolled audience. */
    @PutMapping("/{engineId}/status")
    @Auditable(
            entityType = "ENGAGEMENT_ENGINE",
            action = "STATUS_CHANGE",
            entityIdExpr = "#engineId",
            descriptionExpr = "'changed status of engagement engine ' + (#result?.body?.name ?: #engineId) "
                    + "+ ' to ' + #toStatus")
    public ResponseEntity<EngagementEngine> transition(@PathVariable String engineId,
                                                       @RequestParam String instituteId,
                                                       @RequestParam String toStatus,
                                                       @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(engineService.transition(engineId, instituteId, toStatus));
    }

    /** The prompt that grows: append an amendment; base_text is immutable. */
    @PostMapping("/{engineId}/prompt")
    @Auditable(
            entityType = "ENGAGEMENT_ENGINE",
            action = "UPDATE",
            entityIdExpr = "#engineId",
            descriptionExpr = "'edited the prompt of an engagement engine'")
    public ResponseEntity<EngagementPromptVersion> editPrompt(@PathVariable String engineId,
                                                              @RequestParam String instituteId,
                                                              @RequestBody PromptEditRequest request,
                                                              @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(engineService.editPrompt(engineId, instituteId, request, user.getUserId()));
    }

    /** Kill switch: stop/resume autonomous sending (the engine keeps drafting copilot tasks). */
    @PutMapping("/{engineId}/autonomy")
    @Auditable(
            entityType = "ENGAGEMENT_ENGINE",
            action = "AUTONOMY_CHANGE",
            entityIdExpr = "#engineId",
            descriptionExpr = "(#killed ? 'paused' : 'resumed') + ' autonomous sending for engagement engine ' "
                    + "+ (#result?.body?.name ?: #engineId)")
    public ResponseEntity<EngagementEngine> setAutonomy(@PathVariable String engineId,
                                                        @RequestParam String instituteId,
                                                        @RequestParam boolean killed,
                                                        @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(engineService.setAutonomyKilled(engineId, instituteId, killed));
    }

    @GetMapping("/{engineId}/prompt/history")
    public ResponseEntity<List<EngagementPromptVersion>> promptHistory(
            @PathVariable String engineId,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        engineService.requireEngine(engineId, instituteId);
        return ResponseEntity.ok(promptRepository.findByEngineIdOrderByVersionDesc(engineId));
    }

    /** The wizard's data-point picker — served by the registry catalog (declare()). */
    @GetMapping("/data-points")
    public ResponseEntity<List<DataPointSpec>> dataPointCatalog(
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(dataPointRegistry.all().stream()
                .map(p -> {
                    DataPointSpec spec = p.declare();
                    spec.setKey(p.key());
                    // The wizard showed these as optional checkboxes that unchecking did nothing to.
                    spec.setAlwaysOn(p.alwaysOn());
                    return spec;
                }).toList());
    }

    @DeleteMapping("/{engineId}")
    @Auditable(
            entityType = "ENGAGEMENT_ENGINE",
            action = "DELETE",
            entityIdExpr = "#engineId",
            descriptionExpr = "'archived an engagement engine'")
    public ResponseEntity<Void> archive(@PathVariable String engineId,
                                        @RequestParam String instituteId,
                                        @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        engineService.transition(engineId, instituteId, "ARCHIVED");
        return ResponseEntity.noContent().build();
    }
}
