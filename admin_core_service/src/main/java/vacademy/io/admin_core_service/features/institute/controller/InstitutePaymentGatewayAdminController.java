package vacademy.io.admin_core_service.features.institute.controller;

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
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.institute.dto.PaymentGatewayMappingDTO;
import vacademy.io.admin_core_service.features.institute.dto.PaymentGatewayMappingUpsertRequest;
import vacademy.io.admin_core_service.features.institute.dto.PaymentGatewayUsageDTO;
import vacademy.io.admin_core_service.features.institute.service.InstitutePaymentGatewayMappingService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Map;

/**
 * Admin-only CRUD for institute payment gateway mappings.
 *
 * Lets institute admins self-serve Stripe / Razorpay / PhonePe / Cashfree / Eway
 * credentials from the settings UI instead of needing the ops team to insert
 * rows directly into the database.
 *
 * Auth model mirrors {@link vacademy.io.admin_core_service.features.white_label.controller.WhiteLabelController}:
 * not under /admin/* (so institute admins can call it) but every endpoint asserts
 * the caller belongs to the target instituteId via {@link InstituteAccessValidator}.
 * With security.institute-guards.enforce on, reading the (masked) list needs institute staff
 * and every write needs the institute ADMIN role, the root flag is not consulted and platform
 * super admins on the allowlist pass; with it off (default) the previous checks apply
 * ({@code validateUserAccess} / {@code requireAdminAccess}) and refusals are only logged. Deactivating a
 * gateway stops checkout on every invite link that uses it, so a teacher or
 * counsellor must not be able to do it.
 *
 * Secrets are masked on read and merge-on-write so the full value never has to
 * round-trip through the browser after the first save.
 *
 * Every write lands in the admin activity log ({@code entity_type = PAYMENT_GATEWAY}):
 * who added, edited, deactivated or re-activated which gateway, with the masked
 * pre-change state as {@code before_payload}. Request bodies are captured in REDACTED
 * mode; the gateway credential keys are on the audit redactor's list.
 */
@RestController
@RequestMapping("/admin-core-service/v1/institute/payment-gateways")
@RequiredArgsConstructor
public class InstitutePaymentGatewayAdminController {

    private final InstitutePaymentGatewayMappingService paymentGatewayMappingService;
    private final InstituteAccessValidator instituteAccessValidator;

    @GetMapping
    public ResponseEntity<List<PaymentGatewayMappingDTO>> list(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId) {
        instituteAccessValidator.guardStaff("paymentGateways.list", user, instituteId);
        return ResponseEntity.ok(paymentGatewayMappingService.listForInstitute(instituteId));
    }

    @PostMapping
    @Auditable(
            entityType = "PAYMENT_GATEWAY",
            action = "CREATE",
            // Adding a vendor that has a deactivated row re-activates that row (same id).
            actionExpr = "#before == null ? 'CREATE'"
                    + " : (#result?.body?.status == 'ACTIVE' ? 'MAKE_ACTIVE' : 'UPDATE')",
            entityIdExpr = "#result?.body?.id",
            descriptionExpr = "(#before == null ? 'added '"
                    + " : (#result?.body?.status == 'ACTIVE' ? 're-activated ' : 'updated credentials of '))"
                    + " + #result?.body?.vendor + ' payment gateway'",
            captureBefore = "@institutePaymentGatewayMappingService.auditSnapshotByVendor(#instituteId, #request?.vendor)")
    public ResponseEntity<PaymentGatewayMappingDTO> create(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId,
            @RequestBody PaymentGatewayMappingUpsertRequest request) {
        instituteAccessValidator.guardAdmin("paymentGateways.create", user, instituteId);
        return ResponseEntity.ok(paymentGatewayMappingService.createMapping(instituteId, request));
    }

    @PutMapping("/{mappingId}")
    @Auditable(
            entityType = "PAYMENT_GATEWAY",
            action = "UPDATE",
            // A PUT may also carry a status; a status flip is logged as the flip, not an edit.
            actionExpr = "#before == null || #before.status == #result?.body?.status ? 'UPDATE'"
                    + " : (#result?.body?.status == 'ACTIVE' ? 'MAKE_ACTIVE' : 'DEACTIVATE')",
            entityIdExpr = "#mappingId",
            descriptionExpr = "(#before == null || #before.status == #result?.body?.status ? 'updated credentials of '"
                    + " : (#result?.body?.status == 'ACTIVE' ? 're-activated ' : 'deactivated '))"
                    + " + #result?.body?.vendor + ' payment gateway'",
            captureBefore = "@institutePaymentGatewayMappingService.auditSnapshot(#instituteId, #mappingId)")
    public ResponseEntity<PaymentGatewayMappingDTO> update(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId,
            @PathVariable("mappingId") String mappingId,
            @RequestBody PaymentGatewayMappingUpsertRequest request) {
        instituteAccessValidator.guardAdmin("paymentGateways.update", user, instituteId);
        return ResponseEntity.ok(paymentGatewayMappingService.updateMapping(instituteId, mappingId, request));
    }

    @DeleteMapping("/{mappingId}")
    @Auditable(
            entityType = "PAYMENT_GATEWAY",
            action = "DEACTIVATE",
            // Deactivating a gateway that is already inactive changes nothing; do not log it.
            conditionExpr = "#before == null || #before.status != 'INACTIVE'",
            entityIdExpr = "#mappingId",
            descriptionExpr = "'deactivated ' + (#before?.vendor ?: 'a') + ' payment gateway'",
            captureBefore = "@institutePaymentGatewayMappingService.auditSnapshot(#instituteId, #mappingId)")
    public ResponseEntity<Map<String, Object>> deactivate(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId,
            @PathVariable("mappingId") String mappingId) {
        instituteAccessValidator.guardAdmin("paymentGateways.deactivate", user, instituteId);
        paymentGatewayMappingService.deactivateMapping(instituteId, mappingId);
        return ResponseEntity.ok(Map.of("status", "INACTIVE", "id", mappingId));
    }

    /** Switches a deactivated gateway back on with its stored keys (same row, so invites keep working). */
    @PutMapping("/{mappingId}/activate")
    @Auditable(
            entityType = "PAYMENT_GATEWAY",
            action = "MAKE_ACTIVE",
            // Activating a gateway that is already active changes nothing; do not log it.
            conditionExpr = "#before == null || #before.status != 'ACTIVE'",
            entityIdExpr = "#mappingId",
            descriptionExpr = "'re-activated ' + #result?.body?.vendor + ' payment gateway'",
            captureBefore = "@institutePaymentGatewayMappingService.auditSnapshot(#instituteId, #mappingId)")
    public ResponseEntity<PaymentGatewayMappingDTO> activate(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId,
            @PathVariable("mappingId") String mappingId) {
        instituteAccessValidator.guardAdmin("paymentGateways.activate", user, instituteId);
        return ResponseEntity.ok(paymentGatewayMappingService.activateMapping(instituteId, mappingId));
    }

    /** Live invite links on this gateway; shown before an admin deactivates it. */
    @GetMapping("/{mappingId}/usage")
    public ResponseEntity<PaymentGatewayUsageDTO> usage(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId,
            @PathVariable("mappingId") String mappingId) {
        instituteAccessValidator.guardStaff("paymentGateways.usage", user, instituteId);
        return ResponseEntity.ok(paymentGatewayMappingService.usageFor(instituteId, mappingId));
    }
}
