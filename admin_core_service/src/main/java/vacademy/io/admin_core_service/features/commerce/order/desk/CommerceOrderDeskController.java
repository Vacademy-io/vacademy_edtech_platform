package vacademy.io.admin_core_service.features.commerce.order.desk;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.OrderDeskDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.StaffOrderDtos;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * The order desk's moves on one order ({@code /commerce/v1/orders/...}): status transitions,
 * line cancel, receipts on a staff order, the stock-short clear, and the bulk route. Every
 * write takes a {@code client_request_id} and answers the order as it is now. Who may do what is
 * checked by the services (role, then the order's location, then the state under the lock).
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/orders")
public class CommerceOrderDeskController {

    private final CommerceOrderDeskService deskService;
    private final CommerceLineCancelService lineCancelService;
    private final CommerceReceiptService receiptService;

    public CommerceOrderDeskController(CommerceOrderDeskService deskService,
                                       CommerceLineCancelService lineCancelService,
                                       CommerceReceiptService receiptService) {
        this.deskService = deskService;
        this.lineCancelService = lineCancelService;
        this.receiptService = receiptService;
    }

    @PostMapping("/{orderId}/transition")
    public ResponseEntity<StaffOrderDtos.StaffOrderDetail> transition(
            @PathVariable("orderId") String orderId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) OrderDeskDtos.TransitionRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(deskService.transition(user, instituteId, orderId, request));
    }

    @PostMapping("/{orderId}/lines/{lineId}/cancel")
    public ResponseEntity<StaffOrderDtos.StaffOrderDetail> cancelLine(
            @PathVariable("orderId") String orderId,
            @PathVariable("lineId") String lineId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) OrderDeskDtos.LineCancelRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(lineCancelService.cancelLine(user, instituteId, orderId, lineId, request));
    }

    @PostMapping("/{orderId}/receipts")
    public ResponseEntity<StaffOrderDtos.StaffOrderDetail> receipt(
            @PathVariable("orderId") String orderId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) OrderDeskDtos.ReceiptRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(receiptService.record(user, instituteId, orderId, request));
    }

    @PostMapping("/{orderId}/stock-short/clear")
    public ResponseEntity<StaffOrderDtos.StaffOrderDetail> clearStockShort(
            @PathVariable("orderId") String orderId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) OrderDeskDtos.StockShortClearRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(deskService.clearStockShort(user, instituteId, orderId, request));
    }

    @PostMapping("/bulk")
    public ResponseEntity<OrderDeskDtos.BulkResponse> bulk(
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) OrderDeskDtos.BulkRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(deskService.bulk(user, instituteId, request));
    }
}
