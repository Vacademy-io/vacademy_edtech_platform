package vacademy.io.admin_core_service.features.commerce.order.desk;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.OrderDeskDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.StaffOrderDtos;
import vacademy.io.admin_core_service.features.commerce.shipment.controller.CommerceShipmentController;
import vacademy.io.admin_core_service.features.commerce.shipment.dto.ShipmentDtos;
import vacademy.io.admin_core_service.features.commerce.shipment.service.CommerceShipmentService;
import vacademy.io.common.auth.model.CustomUserDetails;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** The desk and shipment controllers hand each route to its service; pack answers 201, a replay 200. */
class CommerceOrderDeskControllerTest {

    private final CustomUserDetails user = mock(CustomUserDetails.class);
    private final StaffOrderDtos.StaffOrderDetail detail = StaffOrderDtos.StaffOrderDetail.builder().build();

    @Test
    void everyDeskRouteAnswersItsServicesDetail() {
        CommerceOrderDeskService desk = mock(CommerceOrderDeskService.class);
        CommerceLineCancelService lines = mock(CommerceLineCancelService.class);
        CommerceReceiptService receipts = mock(CommerceReceiptService.class);
        CommerceOrderDeskController controller = new CommerceOrderDeskController(desk, lines, receipts);
        OrderDeskDtos.TransitionRequest transition = OrderDeskDtos.TransitionRequest.builder().build();
        OrderDeskDtos.LineCancelRequest cancel = OrderDeskDtos.LineCancelRequest.builder().build();
        OrderDeskDtos.ReceiptRequest receipt = OrderDeskDtos.ReceiptRequest.builder().build();
        OrderDeskDtos.StockShortClearRequest clear = OrderDeskDtos.StockShortClearRequest.builder().build();
        OrderDeskDtos.BulkRequest bulk = OrderDeskDtos.BulkRequest.builder().build();
        OrderDeskDtos.BulkResponse bulkResponse = OrderDeskDtos.BulkResponse.builder().build();
        when(desk.transition(user, "inst-1", "o-1", transition)).thenReturn(detail);
        when(lines.cancelLine(user, "inst-1", "o-1", "l-1", cancel)).thenReturn(detail);
        when(receipts.record(user, "inst-1", "o-1", receipt)).thenReturn(detail);
        when(desk.clearStockShort(user, "inst-1", "o-1", clear)).thenReturn(detail);
        when(desk.bulk(user, "inst-1", bulk)).thenReturn(bulkResponse);

        assertSame(detail, controller.transition("o-1", "inst-1", transition, user).getBody());
        assertSame(detail, controller.cancelLine("o-1", "l-1", "inst-1", cancel, user).getBody());
        assertSame(detail, controller.receipt("o-1", "inst-1", receipt, user).getBody());
        assertSame(detail, controller.clearStockShort("o-1", "inst-1", clear, user).getBody());
        assertSame(bulkResponse, controller.bulk("inst-1", bulk, user).getBody());
    }

    @Test
    void theShipmentRoutesAnswerTheOrderAndPackIs201() {
        CommerceShipmentService service = mock(CommerceShipmentService.class);
        CommerceShipmentController controller = new CommerceShipmentController(service);
        ShipmentDtos.PackRequest pack = ShipmentDtos.PackRequest.builder().build();
        ShipmentDtos.ShipRequest ship = ShipmentDtos.ShipRequest.builder().build();
        ShipmentDtos.StatusRequest status = ShipmentDtos.StatusRequest.builder().build();
        ShipmentDtos.PatchRequest patch = ShipmentDtos.PatchRequest.builder().build();
        when(service.pack(user, "inst-1", pack)).thenReturn(detail);
        when(service.ship(user, "inst-1", "sh-1", ship)).thenReturn(detail);
        when(service.status(user, "inst-1", "sh-1", status)).thenReturn(detail);
        when(service.patch(user, "inst-1", "sh-1", patch)).thenReturn(detail);

        assertEquals(HttpStatus.CREATED, controller.pack("inst-1", pack, user).getStatusCode());
        detail.setReplayed(true);
        assertEquals(HttpStatus.OK, controller.pack("inst-1", pack, user).getStatusCode());
        assertSame(detail, controller.ship("sh-1", "inst-1", ship, user).getBody());
        assertSame(detail, controller.status("sh-1", "inst-1", status, user).getBody());
        assertSame(detail, controller.patch("sh-1", "inst-1", patch, user).getBody());
    }
}
