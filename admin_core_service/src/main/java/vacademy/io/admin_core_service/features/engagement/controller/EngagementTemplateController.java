package vacademy.io.admin_core_service.features.engagement.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.engagement.dto.TemplateAlternativesRequest;
import vacademy.io.admin_core_service.features.engagement.dto.TemplateEditRequest;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementTemplateProposal;
import vacademy.io.admin_core_service.features.engagement.service.EngagementAccessGuard;
import vacademy.io.admin_core_service.features.engagement.service.EngagementTemplateProposalService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Map;

/**
 * The D8 template-negotiation wizard surface (design §9): recommend → review/edit → approve →
 * submit-to-Meta → alternatives on rejection. All institute-ADMIN gated. Status is refreshed
 * automatically by {@link vacademy.io.admin_core_service.features.engagement.service.EngagementTemplateSyncJob};
 * {@code POST /sync} is the manual "check now" for the wizard.
 */
@RestController
@RequestMapping("/admin-core-service/v1/engagement/template-proposals")
@RequiredArgsConstructor
public class EngagementTemplateController {

    private final EngagementTemplateProposalService service;
    private final EngagementAccessGuard accessGuard;

    /** AI proposes a first batch of templates for the engine. */
    @Auditable(
            entityType = "ENGAGEMENT_TEMPLATE",
            action = "GENERATE",
            entityIdExpr = "#engineId",
            descriptionExpr = "'generated WhatsApp templates with AI for engine ' + #engineId + ((#purpose != null) ? (' (' + #purpose + ')') : '')")
    @PostMapping("/recommend")
    public ResponseEntity<List<EngagementTemplateProposal>> recommend(
            @RequestParam String instituteId,
            @RequestParam String engineId,
            @RequestParam(required = false) Integer count,
            @RequestParam(required = false) String purpose,
            @RequestParam(required = false) String language,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(service.recommend(engineId, instituteId, user.getUserId(), count, purpose, language));
    }

    /** "Give me other options" — a fresh round seeded with feedback / a Meta rejection reason. */
    @Auditable(
            entityType = "ENGAGEMENT_TEMPLATE",
            action = "GENERATE",
            entityIdExpr = "#req?.basedOnId ?: #engineId",
            descriptionExpr = "'asked AI for ' + (#req?.mode ?: 'NEW') + ' WhatsApp template options for engine ' + #engineId")
    @PostMapping("/request-alternatives")
    public ResponseEntity<List<EngagementTemplateProposal>> requestAlternatives(
            @RequestParam String instituteId,
            @RequestParam String engineId,
            @RequestBody(required = false) TemplateAlternativesRequest req,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(service.requestAlternatives(engineId, instituteId, req, user.getUserId()));
    }

    /** W1 — whether the brief is enough to write from, and questions for the admin when it is not. */
    @GetMapping("/brief-check")
    public ResponseEntity<vacademy.io.admin_core_service.features.engagement.templates.EngagementBriefAdvisor.BriefCheck> briefCheck(
            @RequestParam String instituteId,
            @RequestParam String engineId,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(service.briefCheck(engineId, instituteId));
    }

    @GetMapping
    public ResponseEntity<List<EngagementTemplateProposal>> list(
            @RequestParam String instituteId,
            @RequestParam String engineId,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(service.list(engineId, instituteId));
    }

    /** Approved-and-usable templates for the engine (name + variables) — for the sender/brain. */
    @GetMapping("/approved")
    public ResponseEntity<List<EngagementTemplateProposal>> approved(
            @RequestParam String instituteId,
            @RequestParam String engineId,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(service.approved(engineId, instituteId));
    }

    @Auditable(
            entityType = "ENGAGEMENT_TEMPLATE",
            action = "UPDATE",
            entityIdExpr = "#id",
            descriptionExpr = "'edited WhatsApp template ' + (#result?.body?.name ?: #id)")
    @PutMapping("/{id}")
    public ResponseEntity<EngagementTemplateProposal> edit(
            @PathVariable String id,
            @RequestParam String instituteId,
            @RequestBody TemplateEditRequest req,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(service.edit(id, instituteId, req, user.getUserId()));
    }

    @Auditable(
            entityType = "ENGAGEMENT_TEMPLATE",
            action = "APPROVE",
            entityIdExpr = "#id",
            descriptionExpr = "'approved WhatsApp template ' + (#result?.body?.name ?: #id)")
    @PostMapping("/{id}/approve")
    public ResponseEntity<EngagementTemplateProposal> approve(
            @PathVariable String id,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(service.approve(id, instituteId));
    }

    /** Submit the approved template to Meta (create-or-update draft → submit). */
    @Auditable(
            entityType = "ENGAGEMENT_TEMPLATE",
            action = "SUBMIT",
            entityIdExpr = "#id",
            descriptionExpr = "'submitted WhatsApp template ' + (#result?.body?.name ?: #id) + ' to Meta'")
    @PostMapping("/{id}/submit")
    public ResponseEntity<EngagementTemplateProposal> submit(
            @PathVariable String id,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(service.submit(id, instituteId, user.getUserId()));
    }

    @Auditable(
            entityType = "ENGAGEMENT_TEMPLATE",
            action = "WITHDRAW",
            entityIdExpr = "#id",
            descriptionExpr = "'withdrew WhatsApp template ' + (#result?.body?.name ?: #id)")
    @PostMapping("/{id}/withdraw")
    public ResponseEntity<EngagementTemplateProposal> withdraw(
            @PathVariable String id,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(service.withdraw(id, instituteId));
    }

    /** Manual "check Meta now" for the wizard (the scheduled job does this every few minutes anyway). */
    @Auditable(
            entityType = "ENGAGEMENT_TEMPLATE",
            action = "SYNC",
            entityIdExpr = "#instituteId",
            payload = Auditable.PayloadMode.NONE,
            descriptionExpr = "'checked WhatsApp template status with Meta'")
    @PostMapping("/sync")
    public ResponseEntity<Map<String, Object>> sync(
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        int changed = service.sync(instituteId);
        return ResponseEntity.ok(Map.of("changed", changed));
    }
}
