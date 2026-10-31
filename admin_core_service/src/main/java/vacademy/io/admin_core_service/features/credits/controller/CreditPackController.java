package vacademy.io.admin_core_service.features.credits.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.credits.dto.BillingProfileDTO;
import vacademy.io.admin_core_service.features.credits.dto.CreditPackDTO;
import vacademy.io.admin_core_service.features.credits.dto.CreditPackOrderStatusDTO;
import vacademy.io.admin_core_service.features.credits.dto.CreditPackPurchaseRequestDTO;
import vacademy.io.admin_core_service.features.credits.dto.CreditPackPurchaseResponseDTO;
import vacademy.io.admin_core_service.features.credits.dto.PlatformInvoiceSummaryDTO;
import vacademy.io.admin_core_service.features.credits.service.CreditPackService;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoice;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPayment;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformInvoiceRepository;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformInvoicePdfService;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

/**
 * Endpoints for the AI credit pack purchase flow.
 *
 *   GET    /admin-core-service/credits/packs?instituteId=...
 *   POST   /admin-core-service/credits/packs/purchase
 *   GET    /admin-core-service/credits/packs/orders/{platformPaymentId}/status
 *
 * Listing packs needs institute staff; purchase, billing profile, invoices,
 * invoice PDFs and order status need an institute ADMIN. Neither check has the
 * root-user bypass of validateUserAccess: learners and invited staff are root
 * users, so that bypass let any learner read or change any institute's billing
 * (GSTIN, invoices, orders). The webhook itself lives at PlatformWebHookController.
 */
@Slf4j
@RestController
@RequestMapping("/admin-core-service/credits/packs")
public class CreditPackController {

    @Autowired
    private CreditPackService creditPackService;

    @Autowired
    private InstituteAccessValidator instituteAccessValidator;

    @Autowired
    private PlatformPaymentRepository platformPaymentRepository;

    @Autowired
    private PlatformInvoiceRepository platformInvoiceRepository;

    @Autowired
    private PlatformInvoicePdfService platformInvoicePdfService;

    @GetMapping
    public ResponseEntity<List<CreditPackDTO>> listPacks(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return ResponseEntity.ok(creditPackService.listPacksForInstitute(instituteId));
    }

    @PostMapping("/purchase")
    public ResponseEntity<CreditPackPurchaseResponseDTO> purchase(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestBody CreditPackPurchaseRequestDTO request) {
        if (request == null || request.getInstituteId() == null || request.getPackId() == null) {
            throw new VacademyException("instituteId and packId are required");
        }
        instituteAccessValidator.requireInstituteAdmin(user, request.getInstituteId());
        UserDTO buyer = toUserDTO(user);
        CreditPackPurchaseResponseDTO response = creditPackService.createOrder(
                request.getInstituteId(), request.getPackId(), buyer, request.getReturnUrl(),
                request.getBuyerGstin(), request.getBuyerStateCode());
        return ResponseEntity.ok(response);
    }

    /** Current GST identity for the institute — prefills the top-up modal. */
    @GetMapping("/billing-profile")
    public ResponseEntity<BillingProfileDTO> getBillingProfile(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(creditPackService.getBillingProfile(instituteId));
    }

    /** All AI-credit invoices for the institute, newest first (back-fills missing ones). */
    @GetMapping("/invoices")
    public ResponseEntity<List<PlatformInvoiceSummaryDTO>> listInvoices(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(creditPackService.listInvoices(instituteId));
    }

    /** GST tax invoice PDF, rendered on demand. */
    @GetMapping(value = "/invoices/{invoiceId}/pdf", produces = MediaType.APPLICATION_PDF_VALUE)
    public ResponseEntity<byte[]> downloadInvoicePdf(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable("invoiceId") String invoiceId) {
        PlatformInvoice invoice = platformInvoiceRepository.findById(invoiceId)
                .orElseThrow(() -> new VacademyException("Invoice not found: " + invoiceId));
        instituteAccessValidator.requireInstituteAdmin(user, invoice.getBuyerInstituteId());

        byte[] pdf = platformInvoicePdfService.renderPdf(invoice);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_PDF);
        headers.setContentDisposition(ContentDisposition.attachment()
                .filename(platformInvoicePdfService.fileName(invoice))
                .build());
        headers.setCacheControl("private, max-age=3600");
        return new ResponseEntity<>(pdf, headers, HttpStatus.OK);
    }

    @GetMapping("/orders/{platformPaymentId}/status")
    public ResponseEntity<CreditPackOrderStatusDTO> getOrderStatus(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable("platformPaymentId") String platformPaymentId) {
        // Resolve the order's owning institute, then verify the caller is a
        // member. Without this an attacker who guesses UUIDs could enumerate
        // other institutes' purchase statuses.
        PlatformPayment payment = platformPaymentRepository.findById(platformPaymentId)
                .orElseThrow(() -> new VacademyException("Order not found: " + platformPaymentId));
        instituteAccessValidator.requireInstituteAdmin(user, payment.getInstituteId());
        return ResponseEntity.ok(creditPackService.getOrderStatus(platformPaymentId));
    }

    private static UserDTO toUserDTO(CustomUserDetails user) {
        if (user == null) {
            return null;
        }
        return UserDTO.builder()
                .id(user.getUserId())
                .username(user.getUsername())
                .email(user.getEmail())
                .build();
    }
}
