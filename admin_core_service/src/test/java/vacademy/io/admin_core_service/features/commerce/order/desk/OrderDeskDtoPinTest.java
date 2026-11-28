package vacademy.io.admin_core_service.features.commerce.order.desk;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.OrderDeskDtos;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.StaffOrderRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.StaffOrderDtos;
import vacademy.io.admin_core_service.features.commerce.shipment.dto.ShipmentDtos;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * The wire names of the order desk bodies (snake_case, as the contract writes them). A renamed
 * field fails here before it breaks the admin screens.
 */
class OrderDeskDtoPinTest {

    private final ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();

    private Set<String> names(Object dto) {
        JsonNode node = mapper.valueToTree(dto);
        Set<String> out = new TreeSet<>();
        Iterator<String> it = node.fieldNames();
        it.forEachRemaining(out::add);
        return out;
    }

    private <T> T read(String json, Class<T> type) throws Exception {
        return mapper.readValue(json, type);
    }

    @Test
    void requestBodiesReadTheContractNames() throws Exception {
        OrderDeskDtos.TransitionRequest transition = read("{\"client_request_id\":\"k-12345678\",\"from_status\":"
                + "\"CONFIRMED\",\"to_status\":\"CANCELLED\",\"reason\":\"r\",\"note\":\"n\",\"unknown\":1}",
                OrderDeskDtos.TransitionRequest.class);
        assertEquals("CONFIRMED", transition.getFromStatus());
        assertEquals("CANCELLED", transition.getToStatus());

        OrderDeskDtos.LineCancelRequest cancel = read("{\"client_request_id\":\"k-12345678\",\"quantity\":2,"
                + "\"reason\":\"r\",\"piece_ids\":[\"p1\"]}", OrderDeskDtos.LineCancelRequest.class);
        assertEquals(List.of("p1"), cancel.getPieceIds());

        OrderDeskDtos.ReceiptRequest receipt = read("{\"client_request_id\":\"k-12345678\",\"mode\":\"UPI\","
                + "\"amount\":10.50,\"reference\":\"x\",\"received_on\":\"2026-11-15\"}", OrderDeskDtos.ReceiptRequest.class);
        assertEquals(new BigDecimal("10.50"), receipt.getAmount());
        assertEquals(LocalDate.of(2026, 11, 15), receipt.getReceivedOn());

        OrderDeskDtos.BulkRequest bulk = read("{\"client_request_id\":\"bulk-0001\",\"action\":\"SHIP\",\"items\":"
                + "[{\"order_id\":\"o1\",\"from_status\":\"PACKED\",\"carrier_name\":\"c\",\"tracking_number\":\"t\","
                + "\"tracking_url\":\"https://x.example\",\"delivered_on\":\"2026-11-15\"}]}", OrderDeskDtos.BulkRequest.class);
        assertEquals("t", bulk.getItems().get(0).getTrackingNumber());

        StaffOrderRequest staff = read("{\"client_request_id\":\"k-12345678\",\"customer\":{\"phone\":\"p\",\"name\":"
                + "\"n\",\"email\":\"e\"},\"shipping_address\":{\"line1\":\"l\",\"pincode\":\"226001\"},"
                + "\"billing_address\":{\"line1\":\"b\"},\"buyer_gstin\":\"g\",\"lines\":[{\"variant_id\":\"v\","
                + "\"sku\":\"s\",\"quantity\":1,\"unit_price_override\":9.5}],\"coupon_code\":\"c\","
                + "\"charge_shipping\":false,\"tenders\":[{\"mode\":\"CASH\",\"amount\":1,\"reference\":\"r\"}],"
                + "\"rest_on_credit\":true,\"hand_over_now\":true,\"customer_note\":\"x\"}", StaffOrderRequest.class);
        assertEquals(new BigDecimal("9.5"), staff.getLines().get(0).getUnitPriceOverride());
        assertEquals(Boolean.TRUE, staff.getRestOnCredit());
        assertEquals(Boolean.TRUE, staff.getHandOverNow());
        assertEquals(Boolean.FALSE, staff.getChargeShipping());

        ShipmentDtos.PackRequest pack = read("{\"client_request_id\":\"k-12345678\",\"order_id\":\"o1\",\"from_status\":"
                + "\"CONFIRMED\",\"lines\":[{\"order_line_id\":\"l1\",\"quantity\":1,\"piece_ids\":[\"a\"],"
                + "\"piece_codes\":[\"B\"]}],\"weight_grams\":500}", ShipmentDtos.PackRequest.class);
        assertEquals(List.of("B"), pack.getLines().get(0).getPieceCodes());
        ShipmentDtos.ShipRequest ship = read("{\"client_request_id\":\"k-12345678\",\"carrier_name\":\"c\","
                + "\"tracking_number\":\"t\",\"tracking_url\":\"u\",\"weight_grams\":1,\"notify_customer\":false}",
                ShipmentDtos.ShipRequest.class);
        assertEquals(Boolean.FALSE, ship.getNotifyCustomer());
        ShipmentDtos.StatusRequest status = read("{\"client_request_id\":\"k-12345678\",\"to\":\"RTO_RECEIVED\","
                + "\"delivered_on\":\"2026-11-15\",\"rto_reason\":\"REFUSED\",\"lines\":[{\"order_line_id\":\"l1\","
                + "\"condition\":\"DAMAGED\",\"quantity\":1,\"piece_ids\":[\"p\"]}],\"note\":\"n\"}",
                ShipmentDtos.StatusRequest.class);
        assertEquals("DAMAGED", status.getLines().get(0).getCondition());
    }

    @Test
    void theAnswersCarryTheDeskFields() {
        assertEquals(new TreeSet<>(List.of("order_id", "ok", "code", "message")), names(OrderDeskDtos.BulkResult
                .builder().orderId("o").ok(false).code("C").message("m").build()));
        assertEquals(Set.of("order_id", "ok"), names(OrderDeskDtos.BulkResult.builder().orderId("o").ok(true).build()));

        Set<String> row = names(StaffOrderDtos.StaffOrderRow.builder().stockShort(true).refundDue(BigDecimal.ONE)
                .shipmentStatus("PACKED").trackingNumber("t").statusSince("s").build());
        for (String name : List.of("stock_short", "refund_due", "shipment_status", "tracking_number", "status_since")) {
            assertEquals(true, row.contains(name), name);
        }
        Set<String> detail = names(StaffOrderDtos.StaffOrderDetail.builder().shipments(List.of())
                .refundDue(BigDecimal.ONE).stockShort(true).codAmount(BigDecimal.ONE).codRemittanceId("r")
                .invoiceId("i").creditNoteIds(List.of()).nextActions(List.of()).replayed(true).build());
        for (String name : List.of("shipments", "refund_due", "stock_short", "cod_amount", "cod_remittance_id",
                "invoice_id", "credit_note_ids", "next_actions", "replayed")) {
            assertEquals(true, detail.contains(name), name);
        }
        assertEquals(new TreeSet<>(List.of("id", "status", "location_id", "carrier_code", "carrier_name",
                        "tracking_number", "tracking_url", "ship_count", "weight_grams", "invoice_id", "rto_reason",
                        "packed_at", "shipped_at", "delivered_on", "rto_at", "rto_received_at", "cancelled_at", "lines")),
                names(StaffOrderDtos.StaffShipment.builder().id("i").status("s").locationId("l").carrierCode("c")
                        .carrierName("n").trackingNumber("t").trackingUrl("u").shipCount(1).weightGrams(1)
                        .invoiceId("i").rtoReason("r").packedAt("a").shippedAt("b").deliveredOn("c").rtoAt("d")
                        .rtoReceivedAt("e").cancelledAt("f").lines(List.of()).build()));
        assertEquals(new TreeSet<>(List.of("id", "order_line_id", "quantity", "piece_codes")),
                names(StaffOrderDtos.StaffShipmentLine.builder().id("i").orderLineId("l").quantity(1)
                        .pieceCodes(List.of("A")).build()));
    }
}
