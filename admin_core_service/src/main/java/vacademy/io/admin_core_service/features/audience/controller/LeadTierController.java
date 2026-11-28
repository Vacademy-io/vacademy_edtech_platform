package vacademy.io.admin_core_service.features.audience.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.audience.dto.LeadTierDTO;
import vacademy.io.admin_core_service.features.audience.service.LeadTierService;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.stream.Collectors;

/**
 * CRUD for the per-institute lead tier catalog (Hot / Warm / Cold by default; institutes can
 * rename, recolour, re-band and add their own). Setting a lead's tier stays on
 * {@code POST /audience/user-lead-profile/update-tier}.
 */
@RestController
@RequestMapping("/admin-core-service/v1/lead-tier")
@RequiredArgsConstructor
public class LeadTierController {

    private final LeadTierService leadTierService;

    /** List the institute's tiers (seeds Hot/Warm/Cold on first access). */
    @GetMapping
    public ResponseEntity<List<LeadTierDTO>> list(@RequestParam String instituteId) {
        List<LeadTierDTO> dtos = leadTierService.listForInstitute(instituteId).stream()
                .map(LeadTierDTO::from)
                .collect(Collectors.toList());
        return ResponseEntity.ok(dtos);
    }

    @PostMapping
    @Auditable(
            entityType = "LEAD_TIER",
            action = "CREATE",
            entityIdExpr = "#result?.body?.id",
            descriptionExpr = "'created lead tier ' + (#dto?.label ?: #dto?.tierKey)")
    public ResponseEntity<LeadTierDTO> create(@RequestParam String instituteId,
                                              @RequestBody LeadTierDTO dto,
                                              @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(LeadTierDTO.from(leadTierService.create(instituteId, dto, user != null ? user.getUserId() : null)));
    }

    /** Partial update; pass {@code clearMinScore=true} to turn a banded tier into a manual-only one. */
    @PutMapping("/{id}")
    @Auditable(
            entityType = "LEAD_TIER",
            action = "UPDATE",
            entityIdExpr = "#id",
            captureBefore = "@crmAuditNarrator.leadTierSnapshot(#id)",
            descriptionExpr = "'updated lead tier ' + (#dto?.label "
                    + "?: @crmAuditNarrator.nameFromSnapshot(#before, #id))")
    public ResponseEntity<LeadTierDTO> update(@PathVariable String id,
                                              @RequestBody LeadTierDTO dto,
                                              @RequestParam(required = false, defaultValue = "false") boolean clearMinScore,
                                              @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(LeadTierDTO.from(leadTierService.update(id, dto, clearMinScore, user != null ? user.getUserId() : null)));
    }

    @DeleteMapping("/{id}")
    @Auditable(
            entityType = "LEAD_TIER",
            action = "DELETE",
            entityIdExpr = "#id",
            captureBefore = "@crmAuditNarrator.leadTierSnapshot(#id)",
            descriptionExpr = "'deleted lead tier ' + @crmAuditNarrator.nameFromSnapshot(#before, #id)")
    public ResponseEntity<Void> delete(@PathVariable String id,
                                       @RequestAttribute("user") CustomUserDetails user) {
        leadTierService.deactivate(id, user != null ? user.getUserId() : null);
        return ResponseEntity.ok().build();
    }
}
