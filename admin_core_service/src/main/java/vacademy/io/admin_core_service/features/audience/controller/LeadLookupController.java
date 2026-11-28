package vacademy.io.admin_core_service.features.audience.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.audience.dto.LeadLookupResultDto;
import vacademy.io.admin_core_service.features.audience.service.LeadLookupService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Lead lookup — the "Check Lead" page.
 *
 * Its own endpoint rather than a flag on the leads list, so the list's scoping
 * is untouched and this stays the one small surface to audit. Every call is
 * logged: this is the only place a counsellor learns anything about a lead
 * outside their own.
 */
@RestController
@RequestMapping("/admin-core-service/v1/lead-lookup")
@RequiredArgsConstructor
public class LeadLookupController {

    private final LeadLookupService leadLookupService;

    @GetMapping
    @Auditable(
            entityType = "LEAD_LOOKUP",
            action = "SEARCH",
            descriptionExpr = "'checked whether a lead already exists'")
    public ResponseEntity<LeadLookupResultDto> lookup(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "phone", required = false) String phone,
            @RequestParam(value = "email", required = false) String email,
            @RequestParam(value = "name", required = false) String name,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(leadLookupService.lookup(instituteId, phone, email, name, user));
    }
}
