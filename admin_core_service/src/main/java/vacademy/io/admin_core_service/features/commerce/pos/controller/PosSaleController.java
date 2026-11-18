package vacademy.io.admin_core_service.features.commerce.pos.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosCorrectionService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosReceiptService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosReturnService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosSaleLookupService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosSaleService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Bills at the counter: quote, sale, bill-book entry and the receipt; the bill's detail, its
 * void and tender change; counter returns. Every write carries a {@code client_request_id}: a
 * double tap or a retry with the same id and body is done once.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/pos")
public class PosSaleController {

    private final PosSaleService saleService;
    private final PosReceiptService receiptService;
    private final PosCorrectionService correctionService;
    private final PosSaleLookupService lookupService;
    private final PosReturnService returnService;

    public PosSaleController(PosSaleService saleService, PosReceiptService receiptService,
                             PosCorrectionService correctionService, PosSaleLookupService lookupService,
                             PosReturnService returnService) {
        this.saleService = saleService;
        this.receiptService = receiptService;
        this.correctionService = correctionService;
        this.lookupService = lookupService;
        this.returnService = returnService;
    }

    @PostMapping("/quote")
    public ResponseEntity<PosDtos.Quote> quote(
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) PosDtos.SaleRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(saleService.quote(user, instituteId, request));
    }

    @PostMapping("/sales")
    public ResponseEntity<PosDtos.SaleAnswer> sale(
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) PosDtos.SaleRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        PosSaleService.Outcome outcome = saleService.sale(user, instituteId, request);
        return ResponseEntity.status(outcome.replayed() ? HttpStatus.OK : HttpStatus.CREATED).body(outcome.answer());
    }

    @PostMapping("/bill-book-entries")
    public ResponseEntity<PosDtos.SaleAnswer> billBook(
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) PosDtos.SaleRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        PosSaleService.Outcome outcome = saleService.billBook(user, instituteId, request);
        return ResponseEntity.status(outcome.replayed() ? HttpStatus.OK : HttpStatus.CREATED).body(outcome.answer());
    }

    @GetMapping("/sales/{orderId}/receipt")
    public ResponseEntity<PosDtos.Receipt> receipt(
            @PathVariable("orderId") String orderId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(receiptService.receipt(user, instituteId, orderId));
    }

    // ---------------------------------------------------------------- corrections, detail, returns (B2)

    @GetMapping("/sales/{orderId}")
    public ResponseEntity<PosDtos.SaleDetail> sale(
            @PathVariable("orderId") String orderId,
            @RequestParam("instituteId") String instituteId,
            @RequestParam("sessionId") String sessionId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(lookupService.detail(user, instituteId, orderId, sessionId));
    }

    @PostMapping("/sales/{orderId}/void")
    public ResponseEntity<PosDtos.SaleAnswer> voidSale(
            @PathVariable("orderId") String orderId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) PosDtos.VoidRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(correctionService.voidSale(user, instituteId, orderId, request));
    }

    @PostMapping("/sales/{orderId}/tenders/{tenderId}/change")
    public ResponseEntity<PosDtos.SaleAnswer> changeTender(
            @PathVariable("orderId") String orderId,
            @PathVariable("tenderId") String tenderId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) PosDtos.TenderChangeRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(correctionService.changeTender(user, instituteId, orderId, tenderId, request));
    }

    @PostMapping("/returns/preview")
    public ResponseEntity<PosDtos.ReturnPreview> previewReturn(
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) PosDtos.ReturnPreviewRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(returnService.preview(user, instituteId, request));
    }

    @PostMapping("/returns")
    public ResponseEntity<PosDtos.ReturnAnswer> createReturn(
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) PosDtos.ReturnRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        PosReturnService.Outcome outcome = returnService.create(user, instituteId, request);
        return ResponseEntity.status(outcome.replayed() ? HttpStatus.OK : HttpStatus.CREATED).body(outcome.answer());
    }
}
