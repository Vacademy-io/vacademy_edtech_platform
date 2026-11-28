package vacademy.io.admin_core_service.features.audience.leadagent.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.audience.leadagent.dto.LeadAgentBulkIntakeRequestDTO;
import vacademy.io.admin_core_service.features.audience.leadagent.dto.LeadAgentBulkIntakeResponseDTO;
import vacademy.io.admin_core_service.features.audience.leadagent.dto.LeadAgentExistingContactsRequestDTO;
import vacademy.io.admin_core_service.features.audience.leadagent.dto.LeadAgentExistingContactsResponseDTO;
import vacademy.io.admin_core_service.features.audience.leadagent.service.LeadAgentIntakeService;

/**
 * Lead Agent delivery, called by ai_service's background agent (no user JWT) with
 * {@code internal_auth_headers()}. The "internal" path segment puts every route here behind
 * {@code InternalAuthFilter} (clientName + Signature) and ApplicationSecurityConfig's
 * {@code /admin-core-service/internal/**} rule. The institute comes from the body, so this must
 * never be exposed to anything but trusted services.
 */
@RestController
@RequestMapping("/admin-core-service/internal/audience/v1/lead-agent")
@RequiredArgsConstructor
public class LeadAgentInternalController {

    private final LeadAgentIntakeService intakeService;

    /** Which of these phones (last 10 digits) / emails are already a live lead of the institute. */
    @PostMapping("/existing-contacts")
    public ResponseEntity<LeadAgentExistingContactsResponseDTO> existingContacts(
            @RequestBody LeadAgentExistingContactsRequestDTO request) {
        return ResponseEntity.ok(intakeService.existingContacts(request));
    }

    /** Deliver up to 50 researched leads into a lead list; per-row CREATED / DUPLICATE / FAILED. */
    @PostMapping("/bulk-intake")
    public ResponseEntity<LeadAgentBulkIntakeResponseDTO> bulkIntake(
            @RequestBody LeadAgentBulkIntakeRequestDTO request) {
        return ResponseEntity.ok(intakeService.bulkIntake(request));
    }
}
