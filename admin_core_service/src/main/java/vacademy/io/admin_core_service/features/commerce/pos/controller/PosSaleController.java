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
import vacademy.io.admin_core_service.features.commerce.pos.service.PosReceiptService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosSaleService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Bills at the counter: quote, sale, bill-book entry and the receipt. Every write carries a
 * {@code client_request_id}: a double tap or a retry with the same id and body is one bill.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/pos")
public class PosSaleController {

    private final PosSaleService saleService;
    private final PosReceiptService receiptService;

    public PosSaleController(PosSaleService saleService, PosReceiptService receiptService) {
        this.saleService = saleService;
        this.receiptService = receiptService;
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
}
