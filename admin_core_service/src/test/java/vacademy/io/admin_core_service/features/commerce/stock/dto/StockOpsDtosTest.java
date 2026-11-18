package vacademy.io.admin_core_service.features.commerce.stock.dto;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.label.dto.LabelDtos;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.Approval;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CountReview;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.PlaceRef;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.ReviewLine;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.ReviewTotals;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.TransferLineView;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.TransferTotals;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.TransferView;

import java.lang.reflect.RecordComponent;
import java.math.BigDecimal;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The wire names of the stock-operation answers (snake case, nulls left out) and the rule that
 * no answer a warehouse hand can read carries a cost: the review's money is the only value field
 * and it is filled for cost viewers only.
 */
class StockOpsDtosTest {

    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();

    /** Answers that warehouse staff read (stock screens, label printing). */
    private static final List<Class<?>> STAFF_ANSWERS = List.of(
            StockOpsDtos.TransferView.class, StockOpsDtos.TransferLineView.class, StockOpsDtos.TransferRow.class,
            StockOpsDtos.TransferTotals.class, StockOpsDtos.CountView.class, StockOpsDtos.CountLineView.class,
            StockOpsDtos.CountRow.class, StockOpsDtos.CountLinesAnswer.class, StockOpsDtos.OverviewRow.class,
            StockOpsDtos.LevelCell.class, StockOpsDtos.VariantPick.class, StockOpsDtos.LowRow.class,
            StockOpsDtos.Elsewhere.class, StockOpsDtos.UncountedItem.class, StockOpsDtos.ReviewPiece.class,
            StockOpsDtos.ReviewLine.class, StockOpsDtos.ReviewTotals.class, StockOpsDtos.Approver.class,
            LabelDtos.LabelRow.class, LabelDtos.PrintLabel.class, LabelDtos.PrintDataAnswer.class,
            LabelDtos.ReplaceRow.class);

    @Test
    void noStaffAnswerHasACostField() {
        for (Class<?> type : STAFF_ANSWERS) {
            for (RecordComponent component : type.getRecordComponents()) {
                String name = component.getName().toLowerCase(Locale.ROOT);
                assertFalse(name.contains("cost"), type.getSimpleName() + "." + component.getName());
                assertFalse(name.contains("standard"), type.getSimpleName() + "." + component.getName());
            }
        }
    }

    @Test
    void namesAreSnakeCaseAndNullsAreLeftOut() throws Exception {
        TransferLineView line = new TransferLineView("line-1", "ps-1", "BOTTLE-1", "Steel bottle", "One size",
                "QUANTITY", "PCS", 1, null, null, 5, null, null, new BigDecimal("450.00"), new BigDecimal("2250.00"),
                "0000");
        TransferView view = new TransferView("t-1", "TRF-000001", "DRAFT", new PlaceRef("l-2", "WH", "Warehouse", null),
                new PlaceRef("l-1", "ST", "Store", null), false, null, null, null, null, null, null, "user-1",
                "2026-11-18T10:15:30.123", null, null, null, null, null, List.of(line),
                new TransferTotals(5, null, new BigDecimal("2250.00")), false, List.of(), List.of("DISPATCH"), null,
                null);
        JsonNode tree = json.valueToTree(view);
        assertEquals("TRF-000001", tree.get("transfer_number").asText());
        assertTrue(tree.has("gstin_differs"));
        assertTrue(tree.has("next_actions"));
        assertFalse(tree.has("document_number"), "null left out");
        assertFalse(tree.has("replayed"), "absent unless a replay");
        assertFalse(tree.has("sellable_shortfall"));
        JsonNode first = tree.get("lines").get(0);
        assertEquals("ps-1", first.get("package_session_id").asText());
        assertEquals(5, first.get("qty_sent").asInt());
        assertFalse(first.has("qty_received"));
        assertEquals(0, new BigDecimal("450.00").compareTo(first.get("unit_value").decimalValue()));
        assertEquals(Boolean.TRUE, json.valueToTree(view.withReplayed()).get("replayed").booleanValue());
        Set<String> wire = Set.copyOf(iterable(tree.fieldNames()));
        for (String name : wire) {
            assertEquals(name.toLowerCase(Locale.ROOT), name, "snake case: " + name);
        }
    }

    @Test
    void theReviewCarriesValueOnlyWhenFilled() {
        ReviewLine staff = new ReviewLine("line-1", "ps-1", "CLOTH-1", "Cotton cloth", null, "QUANTITY", "MTR", 10,
                null, 150, "2026-11-18T10:15:30", "2026-11-18T10:14:00", 200, 0, 0, 200, -50, null, 3,
                List.of(StockOpsDtos.FLAG_NEEDS_RECOUNT, StockOpsDtos.FLAG_MEASURED_CONFIRM), null);
        CountReview review = new CountReview("c-1", "now", List.of(staff), List.of(), List.of(), List.of(), List.of(),
                List.of(), List.of(), List.of(), new ReviewTotals(1, 0, 50, null, null), true, 1, true, "f-1");
        String wire = json.valueToTree(review).toString();
        assertFalse(wire.contains("\"value"), wire);
        assertTrue(wire.contains("\"expected_at_count\":200"), wire);
        assertTrue(wire.contains("\"needs_approval\":true"), wire);
        // The measure and the timing flags the screen shows (F-M3, L4, L7).
        for (String field : List.of("\"unit\":\"MTR\"", "\"qty_scale\":10", "\"stock_mode\":\"QUANTITY\"",
                "\"first_counted_at\":", "\"packed_unshipped\":0", "\"moved_while_counting\":3",
                "\"flags\":[\"NEEDS_RECOUNT\",\"MEASURED_CONFIRM\"]", "\"needs_recount\":1",
                "\"measured_confirm\":true")) {
            assertTrue(wire.contains(field), field + " in " + wire);
        }
        ReviewLine manager = new ReviewLine("line-1", "ps-1", "CLOTH-1", "Cotton cloth", null, null, null, null, null,
                150, null, null, 200, 0, null, 200, -50, new BigDecimal("-500.00"), null, null, null);
        assertTrue(json.valueToTree(manager).has("value"));
    }

    @Test
    void approvalNeverPrintsThePinAndIsReadInSnakeCase() throws Exception {
        Approval approval = json.readValue("{\"approver_user_id\":\"m-1\",\"pin\":\"482917\",\"reason\":\"ok\"}",
                Approval.class);
        assertEquals("m-1", approval.approverUserId());
        assertEquals("482917", approval.pin());
        assertFalse(approval.toString().contains("482917"), approval.toString());
        StockOpsDtos.TransferReceiveRequest receive = new StockOpsDtos.TransferReceiveRequest("key-12345678",
                List.of(), null, approval);
        assertFalse(receive.toString().contains("482917"), receive.toString());
        assertEquals(null, receive.withoutApproval().approval());
        StockOpsDtos.CountPostRequest post = new StockOpsDtos.CountPostRequest("key-12345678", "SKIP", approval, null, null);
        assertEquals(null, post.withoutApproval().approval());
        assertEquals("SKIP", post.withoutApproval().uncounted());
        // The measured confirm is resent under the same key, like the PIN.
        assertEquals(null, new StockOpsDtos.CountPostRequest("key-12345678", "SKIP", null, Boolean.TRUE, null)
                .withoutApproval().confirmMeasured());
    }

    @Test
    void labelNamesKeepBothLanguagesEvenWhenEmpty() {
        JsonNode names = json.valueToTree(new LabelDtos.Names("Cotton scarf", null));
        assertTrue(names.has("hi"), "both keys always present");
        assertTrue(names.get("hi").isNull());
        JsonNode label = json.valueToTree(new LabelDtos.PrintLabel("r-1", "PABCDEFGH2",
                "https://shop.example/q/PABCDEFGH2", "SCARF-1", new LabelDtos.Names("Cotton scarf", "सूती स्कार्फ"),
                new LabelDtos.Names("One size", null), new BigDecimal("1200.00"), new BigDecimal("1200.00"), "INR",
                "PCS", 1, 1, "piece-1"));
        assertEquals("https://shop.example/q/PABCDEFGH2", label.get("qr_value").asText());
        assertEquals("सूती स्कार्फ", label.get("product_name").get("hi").asText());
        assertEquals(1, label.get("qty_scale").asInt());
    }

    private static List<String> iterable(java.util.Iterator<String> names) {
        List<String> out = new java.util.ArrayList<>();
        names.forEachRemaining(out::add);
        return out;
    }
}
