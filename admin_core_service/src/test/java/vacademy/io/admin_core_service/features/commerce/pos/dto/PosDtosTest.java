package vacademy.io.admin_core_service.features.commerce.pos.dto;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The wire names of the counter's answers, and that no answer carries a cost. */
class PosDtosTest {

    private static final ObjectMapper MAPPER = new ObjectMapper().findAndRegisterModules();
    private static final List<String> FORBIDDEN = List.of("cost", "cost_total", "unit_cost", "standard_cost",
            "cost_price", "available_slots", "tax_class_id");

    private static List<String> fieldNames(Class<?> type) {
        List<String> out = new ArrayList<>();
        for (var component : type.getRecordComponents()) {
            out.add(component.getName());
        }
        return out;
    }

    @Test
    void noAnswerRecordHasACostOrOnlineStockField() {
        for (Class<?> type : PosDtos.class.getDeclaredClasses()) {
            if (!type.isRecord()) {
                continue;
            }
            for (String name : fieldNames(type)) {
                String lower = name.toLowerCase();
                assertFalse(lower.contains("cost"), type.getSimpleName() + "." + name);
                assertFalse(lower.contains("availableslots"), type.getSimpleName() + "." + name);
                assertFalse(lower.contains("taxclass"), type.getSimpleName() + "." + name);
            }
        }
    }

    @Test
    void theCatalogueItemIsSnakeCaseAndLeavesNullsOut() throws Exception {
        PosDtos.CatalogueItem item = new PosDtos.CatalogueItem("ps-1", "pkg-1", "BOTTLE-1", "V0001", null,
                Map.of("en", "Steel bottle"), Map.of(), "PCS", 1, 1, "QUANTITY", true, new BigDecimal("450.00"), null,
                "INR", 12);
        JsonNode json = MAPPER.valueToTree(item);
        List<String> names = new ArrayList<>();
        Iterator<String> it = json.fieldNames();
        it.forEachRemaining(names::add);
        assertEquals(List.of("variant_id", "product_id", "sku", "label_code", "names", "variant_label", "unit",
                "qty_scale", "qty_step", "stock_mode", "tracked", "unit_price", "currency", "on_hand"), names);
        for (String forbidden : FORBIDDEN) {
            assertFalse(json.has(forbidden), forbidden);
        }
    }

    @Test
    void anEmptyRegisterSaysItsOpenSessionIsNull() {
        JsonNode json = MAPPER.valueToTree(new PosDtos.RegisterView("r-1", "R1", "Front counter", "loc-1", "Main store",
                "ACTIVE", null, List.of()));
        assertTrue(json.has("open_session"));
        assertTrue(json.get("open_session").isNull());
        assertTrue(json.has("setup_warnings"));
        assertTrue(MAPPER.valueToTree(new PosDtos.CurrentSessionAnswer(null)).has("session"));
    }

    @Test
    void theSaleBodyReadsSnakeCaseAndNotify() throws Exception {
        PosDtos.SaleRequest request = MAPPER.readValue("""
                {"client_request_id": "pos-lz3k1-9f2c6a1b7d3e", "session_id": "s-1",
                 "lines": [{"line_ref": "l1", "variant_id": "ps-1", "quantity": 1, "piece_ids": ["p-1"],
                            "line_discount": "0.00", "unit_price": "1200.00"}],
                 "bill_discount": {"kind": "AMOUNT", "value": "50.00", "reason": "Regular customer"},
                 "customer": {"phone": "9876543210", "name": "Test Buyer"},
                 "tenders": [{"mode": "CASH", "amount": "1150.00", "cash_tendered": "1200.00"}],
                 "approval": {"approver_user_id": "m-1", "pin": "1234"},
                 "notify": false}
                """, PosDtos.SaleRequest.class);
        assertEquals("pos-lz3k1-9f2c6a1b7d3e", request.clientRequestId());
        assertEquals(0, new BigDecimal("1200.00").compareTo(request.lines().get(0).unitPrice()));
        assertEquals("p-1", request.lines().get(0).pieceIds().get(0));
        assertEquals("AMOUNT", request.billDiscount().kind());
        assertEquals(0, new BigDecimal("1200.00").compareTo(request.tenders().get(0).cashTendered()));
        assertEquals("m-1", request.approval().approverUserId());
        assertEquals(Boolean.FALSE, request.notifyBuyer());
        JsonNode back = MAPPER.valueToTree(request);
        assertTrue(back.has("notify"));
        assertFalse(back.has("notify_buyer"));
    }
}
