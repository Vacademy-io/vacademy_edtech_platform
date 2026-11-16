package vacademy.io.admin_core_service.features.commerce.document.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.document.dto.CommerceInvoiceDTO;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteDTO;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteRequest;
import vacademy.io.admin_core_service.features.commerce.document.dto.ReissueB2bRequest;
import vacademy.io.admin_core_service.features.commerce.document.pdf.CommerceDocumentPdfService;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceCreditNoteService;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceInvoiceService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/**
 * Commerce invoices and credit notes for staff ({@code /credit-notes},
 * {@code /invoices/{id}/reissue-b2b}). The store manager issues; the accountant reads. A credit
 * note for a counter return by a cashier is issued by the return flow, not from here.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1")
@RequiredArgsConstructor
public class CommerceDocumentController {

    private static final Set<CommerceRole> WRITE = Set.of(CommerceRole.STORE_MANAGER);
    private static final Set<CommerceRole> READ = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT);

    private final CommerceInvoiceService invoiceService;
    private final CommerceCreditNoteService creditNoteService;
    private final CommerceDocumentPdfService pdfService;
    private final CommerceAccessGuard commerceAccessGuard;

    @GetMapping("/invoices/{invoiceId}")
    public ResponseEntity<CommerceInvoiceDTO> getInvoice(
            @PathVariable("invoiceId") String invoiceId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.ORDERS, READ);
        return ResponseEntity.ok(invoiceService.get(instituteId, invoiceId));
    }

    @GetMapping("/invoices/{invoiceId}/pdf")
    public ResponseEntity<Map<String, String>> invoicePdf(
            @PathVariable("invoiceId") String invoiceId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.ORDERS, READ);
        return ResponseEntity.ok(link(pdfService.invoicePdfUrl(instituteId, invoiceId)));
    }

    @PostMapping("/invoices/{invoiceId}/reissue-b2b")
    public ResponseEntity<CommerceInvoiceDTO> reissueAsB2b(
            @PathVariable("invoiceId") String invoiceId,
            @RequestBody ReissueB2bRequest request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        requireWriteAt(user, instituteId, invoiceId);
        return ResponseEntity.ok(invoiceService.reissueAsB2b(instituteId, user.getUserId(), invoiceId, request));
    }

    @GetMapping("/credit-notes")
    public ResponseEntity<Page<CreditNoteDTO>> listCreditNotes(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "invoiceId", required = false) String invoiceId,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "50") int size,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.ORDERS, READ);
        return ResponseEntity.ok(creditNoteService.list(instituteId, invoiceId, page, size));
    }

    @GetMapping("/credit-notes/{creditNoteId}")
    public ResponseEntity<CreditNoteDTO> getCreditNote(
            @PathVariable("creditNoteId") String creditNoteId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.ORDERS, READ);
        return ResponseEntity.ok(creditNoteService.get(instituteId, creditNoteId));
    }

    @GetMapping("/credit-notes/{creditNoteId}/pdf")
    public ResponseEntity<Map<String, String>> creditNotePdf(
            @PathVariable("creditNoteId") String creditNoteId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.ORDERS, READ);
        return ResponseEntity.ok(link(pdfService.creditNotePdfUrl(instituteId, creditNoteId)));
    }

    /** A credit note against a commerce invoice of this institute, full or by line. */
    @PostMapping("/credit-notes")
    public ResponseEntity<CreditNoteDTO> issueCreditNote(
            @RequestBody CreditNoteRequest request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        requireWriteAt(user, instituteId, request == null ? null : request.getInvoiceId());
        if (request != null) {
            // These three belong to the return flow, which sets them in code: a return id is
            // not checked here, a cost feeds margin figures, and the date decides the series year.
            request.setReturnId(null);
            request.setDocumentDate(null);
            if (request.getLines() != null) {
                request.getLines().forEach(line -> {
                    if (line != null) {
                        line.setCostTotal(null);
                    }
                });
            }
        }
        return ResponseEntity.ok(creditNoteService.issue(instituteId, user.getUserId(), request));
    }

    /**
     * A write on a document: the caller is a store manager of this institute and, when the
     * invoice belongs to a location, is assigned to that location (an institute ADMIN always
     * passes). The invoice is looked up inside the institute only, so an id of another
     * institute answers 404 before any location is read.
     */
    private void requireWriteAt(CustomUserDetails user, String instituteId, String invoiceId) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.ORDERS, WRITE);
        if (invoiceId == null || invoiceId.isBlank()) {
            return;
        }
        String locationId = invoiceService.requireDocument(instituteId, invoiceId.trim()).getLocationId();
        if (locationId != null) {
            commerceAccessGuard.require(user, instituteId, CommerceFeature.ORDERS, WRITE, locationId);
        }
    }

    private static Map<String, String> link(String url) {
        Map<String, String> body = new HashMap<>();
        body.put("url", url);
        return body;
    }
}
