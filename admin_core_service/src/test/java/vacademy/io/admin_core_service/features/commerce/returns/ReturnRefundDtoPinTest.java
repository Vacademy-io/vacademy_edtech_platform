package vacademy.io.admin_core_service.features.commerce.returns;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.returns.dto.RefundDtos;
import vacademy.io.admin_core_service.features.commerce.returns.dto.ReturnDtos;

import java.lang.reflect.Field;
import java.math.BigDecimal;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

/**
 * ReturnDtoPinTest and RefundDtoPinTest: the wire names of the return and refund bodies, and no
 * cost or gateway payment id in an answer (a warehouse user reads returns).
 */
class ReturnRefundDtoPinTest {

    private final ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();

    private static Set<String> fields(Class<?> type) {
        Set<String> out = new TreeSet<>();
        for (Field f : type.getDeclaredFields()) {
            if (!f.isSynthetic() && !java.lang.reflect.Modifier.isStatic(f.getModifiers())) {
                out.add(f.getName());
            }
        }
        return out;
    }

    @Test
    void returnBodiesReadTheContractNames() throws Exception {
        ReturnDtos.CreateReturnRequest create = mapper.readValue("{\"client_request_id\":\"k-12345678\","
                + "\"order_id\":\"o1\",\"location_id\":\"l1\",\"reason\":\"DEFECTIVE\",\"reason_note\":\"n\","
                + "\"requested_via\":\"WHATSAPP\",\"lines\":[{\"order_line_id\":\"ol1\",\"quantity\":2}],"
                + "\"photo_media_ids\":[\"m1\"],\"override_reason\":\"o\",\"approve_now\":true,\"note\":\"x\","
                + "\"unknown\":1}", ReturnDtos.CreateReturnRequest.class);
        assertEquals("ol1", create.getLines().get(0).getOrderLineId());
        assertEquals(Boolean.TRUE, create.getApproveNow());
        assertEquals(List.of("m1"), create.getPhotoMediaIds());
        ReturnDtos.ReceiveRequest receive = mapper.readValue("{\"client_request_id\":\"k-12345678\","
                + "\"from_status\":\"APPROVED\",\"location_id\":\"l2\",\"lines\":[{\"order_line_id\":\"ol1\","
                + "\"condition\":\"DAMAGED\",\"quantity\":1,\"piece_ids\":[\"p1\"]}],\"note\":\"n\"}",
                ReturnDtos.ReceiveRequest.class);
        assertEquals("DAMAGED", receive.getLines().get(0).getCondition());
        assertEquals(List.of("p1"), receive.getLines().get(0).getPieceIds());
        ReturnDtos.RejectRequest reject = mapper.readValue("{\"client_request_id\":\"k-12345678\","
                + "\"from_status\":\"REQUESTED\",\"reason\":\"r\"}", ReturnDtos.RejectRequest.class);
        assertEquals("REQUESTED", reject.getFromStatus());
    }

    @Test
    void refundBodiesReadTheContractNames() throws Exception {
        RefundDtos.CreateRefundRequest create = mapper.readValue("{\"client_request_id\":\"k-12345678\","
                + "\"order_id\":\"o1\",\"return_id\":\"r1\",\"amount\":10.50,\"method\":\"UPI\",\"reference\":\"u\","
                + "\"paid_on\":\"2026-11-15\",\"reason\":\"r\",\"gateway_refund_id\":\"rfnd_1\"}",
                RefundDtos.CreateRefundRequest.class);
        assertEquals(new BigDecimal("10.50"), create.getAmount());
        assertEquals("rfnd_1", create.getGatewayRefundId());
        RefundDtos.PayoutRequest payout = mapper.readValue("{\"client_request_id\":\"k-12345678\",\"reference\":\"u\","
                + "\"paid_on\":\"2026-11-15\"}", RefundDtos.PayoutRequest.class);
        assertEquals("2026-11-15", payout.getPaidOn());
    }

    @Test
    void answersCarryTheContractNamesAndNoCostOrPaymentId() {
        assertEquals(new TreeSet<>(Set.of("id", "returnNumber", "orderId", "orderNumber", "status", "reason",
                "reasonNote", "requestedVia", "locationId", "lines", "policyWarnings", "overrideReason",
                "photoMediaIds", "creditNote", "creditTotal", "dueRaised", "refunded", "refunds", "requestedBy",
                "createdAt", "approvedAt", "approvedBy", "rejectedAt", "rejectedBy", "rejectReason", "receivedAt",
                "receivedBy", "closedAt", "nextActions", "replayed")), fields(ReturnDtos.ReturnView.class));
        assertEquals(new TreeSet<>(Set.of("id", "orderLineId", "lineNo", "name", "sku", "quantity", "qtyResaleable",
                "qtyDamaged", "pieceCodes", "creditedValue")), fields(ReturnDtos.ReturnLineView.class));
        assertEquals(new TreeSet<>(Set.of("id", "returnNumber", "orderId", "orderNumber", "status", "reason",
                "locationId", "units", "creditTotal", "refunded", "createdAt")), fields(ReturnDtos.ReturnSummary.class));
        assertEquals(new TreeSet<>(Set.of("id", "orderId", "orderNumber", "returnId", "returnNumber", "kind", "source",
                "method", "amount", "currency", "status", "reference", "gatewayRefundId", "gatewayStatus",
                "appliedOrderId", "paidOn", "reason", "failureCode", "failureReason", "createdBy", "createdAt",
                "processedAt", "failedAt", "replayed")), fields(RefundDtos.RefundView.class));
        Set<String> summary = fields(RefundDtos.RefundView.class);
        summary.removeAll(Set.of("reason", "failureReason", "replayed"));
        assertEquals(summary, fields(RefundDtos.RefundSummary.class));
        for (Class<?> type : List.of(ReturnDtos.ReturnView.class, ReturnDtos.ReturnLineView.class,
                ReturnDtos.ReturnSummary.class, RefundDtos.RefundView.class, RefundDtos.RefundSummary.class)) {
            for (String name : fields(type)) {
                assertFalse(name.toLowerCase().contains("cost"), type.getSimpleName() + "." + name);
                assertFalse(name.equals("gatewayPaymentId"), type.getSimpleName() + "." + name);
            }
        }
        JsonNode node = mapper.valueToTree(RefundDtos.RefundView.builder().gatewayRefundId("r").paidOn("d").build());
        assertEquals(Set.of("gateway_refund_id", "paid_on"), new TreeSet<>(iterator(node)));
    }

    private static List<String> iterator(JsonNode node) {
        List<String> out = new java.util.ArrayList<>();
        node.fieldNames().forEachRemaining(out::add);
        return out;
    }
}
