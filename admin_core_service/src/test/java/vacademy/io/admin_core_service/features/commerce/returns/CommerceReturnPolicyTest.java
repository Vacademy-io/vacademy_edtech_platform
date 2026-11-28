package vacademy.io.admin_core_service.features.commerce.returns;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.returns.policy.CommerceReturnPolicy;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The shop's return policy and the warnings a return gets against it. */
class CommerceReturnPolicyTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final LocalDate delivered = LocalDate.of(2026, 11, 1);

    private JsonNode json(String text) throws Exception {
        return mapper.readTree(text);
    }

    @Test
    void daySevenIsInsideTheDefaultWindowAndDayEightOutside() {
        CommerceReturnPolicy.Settings s = CommerceReturnPolicy.defaults();
        assertEquals(7, s.windowDays());
        assertTrue(CommerceReturnPolicy.check(s, delivered, delivered.plusDays(7), null, "DEFECTIVE", 0).isEmpty());
        assertEquals(List.of(CommerceReturnPolicy.OUTSIDE_WINDOW),
                CommerceReturnPolicy.check(s, delivered, delivered.plusDays(8), null, "DEFECTIVE", 0));
    }

    @Test
    void daysAreCountedInIndiaTime() {
        // 20:00 UTC on 1 Nov is 01:30 on 2 Nov in India: the delivery day is the 2nd.
        Instant evening = Instant.parse("2026-11-01T20:00:00Z");
        assertEquals(LocalDate.of(2026, 11, 2), CommerceReturnPolicy.indiaDay(evening));
        assertEquals(7, CommerceReturnPolicy.daysSince(CommerceReturnPolicy.indiaDay(evening),
                LocalDate.of(2026, 11, 9)));
    }

    @Test
    void theSmallestCollectionWindowWinsAndZeroMeansNoReturns() {
        CommerceReturnPolicy.Settings s = CommerceReturnPolicy.defaults();
        assertEquals(3, CommerceReturnPolicy.windowDays(s, 3));
        assertEquals(List.of(CommerceReturnPolicy.OUTSIDE_WINDOW),
                CommerceReturnPolicy.check(s, delivered, delivered.plusDays(4), 3, "DEFECTIVE", 0));
        assertEquals(List.of(CommerceReturnPolicy.COLLECTION_NO_RETURNS),
                CommerceReturnPolicy.check(s, delivered, delivered, 0, "DEFECTIVE", 0));
        assertEquals(List.of(CommerceReturnPolicy.OUTSIDE_WINDOW, CommerceReturnPolicy.COLLECTION_NO_RETURNS),
                CommerceReturnPolicy.check(s, delivered, delivered.plusDays(1), 0, "DEFECTIVE", 0));
        // A collection may also be longer than the shop's window.
        assertTrue(CommerceReturnPolicy.check(s, delivered, delivered.plusDays(20), 30, "DEFECTIVE", 0).isEmpty());
    }

    @Test
    void aReasonOutsideTheListAndAMissingPhotoWarn() throws Exception {
        CommerceReturnPolicy.Settings s = CommerceReturnPolicy.parse(json(
                "{\"windowDays\":10,\"allowedReasons\":[\"DEFECTIVE\"],\"photoRequired\":true}"));
        assertEquals(List.of(CommerceReturnPolicy.REASON_NOT_ALLOWED, CommerceReturnPolicy.PHOTO_MISSING),
                CommerceReturnPolicy.check(s, delivered, delivered, null, "CHANGED_MIND", 0));
        assertTrue(CommerceReturnPolicy.check(s, delivered, delivered, null, "DEFECTIVE", 1).isEmpty());
        // An empty list is kept: every reason warns.
        CommerceReturnPolicy.Settings none = CommerceReturnPolicy.parse(json("{\"allowedReasons\":[]}"));
        assertEquals(List.of(CommerceReturnPolicy.REASON_NOT_ALLOWED),
                CommerceReturnPolicy.check(none, delivered, delivered, null, "DEFECTIVE", 0));
    }

    @Test
    void parseTakesDefaultsForMissingOrBadValues() throws Exception {
        CommerceReturnPolicy.Settings d = CommerceReturnPolicy.parse(null);
        assertEquals(7, d.windowDays());
        assertEquals(List.of("DEFECTIVE", "WRONG_ITEM", "DAMAGED_IN_TRANSIT"), d.allowedReasons());
        assertFalse(d.photoRequired());
        assertEquals("SELLER", d.returnShippingPaidBy());
        assertEquals("", d.policyText().get("hi"));
        CommerceReturnPolicy.Settings bad = CommerceReturnPolicy.parse(json("{\"windowDays\":999,"
                + "\"allowedReasons\":[\"NOPE\"],\"photoRequired\":\"yes\",\"returnShippingPaidBy\":\"COURIER\","
                + "\"policyText\":{\"en\":7}}"));
        assertEquals(7, bad.windowDays());
        assertEquals(d.allowedReasons(), bad.allowedReasons());
        assertFalse(bad.photoRequired());
        assertEquals("SELLER", bad.returnShippingPaidBy());
        assertEquals("", bad.policyText().get("en"));
        CommerceReturnPolicy.Settings good = CommerceReturnPolicy.parse(json("{\"windowDays\":0,"
                + "\"returnShippingPaidBy\":\"BUYER\",\"policyText\":{\"hi\":\"h\",\"en\":\"e\"}}"));
        assertEquals(0, good.windowDays());
        assertEquals("BUYER", good.returnShippingPaidBy());
        assertEquals("e", good.policyText().get("en"));
    }

    @Test
    void aStaffWriteIsValidatedAndRoundTripsThroughTheStoredForm() throws Exception {
        CommerceReturnPolicy.Settings written = CommerceReturnPolicy.fromBody(json("{\"window_days\":14,"
                + "\"allowed_reasons\":[\"size\",\"DEFECTIVE\"],\"photo_required\":true,"
                + "\"return_shipping_paid_by\":\"BUYER\",\"policy_text\":{\"en\":\"Fourteen days\"}}"),
                CommerceReturnPolicy.defaults());
        assertEquals(14, written.windowDays());
        assertEquals(List.of("SIZE", "DEFECTIVE"), written.allowedReasons());
        CommerceReturnPolicy.Settings back = CommerceReturnPolicy.parse(CommerceReturnPolicy.toStored(written));
        assertEquals(written, back);
        assertEquals(14, CommerceReturnPolicy.view(back).get("window_days"));
        assertThrows(InvalidRequestException.class, () -> CommerceReturnPolicy.fromBody(json("{\"window_days\":366}"),
                CommerceReturnPolicy.defaults()));
        assertThrows(InvalidRequestException.class, () -> CommerceReturnPolicy.fromBody(
                json("{\"allowed_reasons\":[\"LOST\"]}"), CommerceReturnPolicy.defaults()));
        assertThrows(InvalidRequestException.class, () -> CommerceReturnPolicy.fromBody(
                json("{\"return_shipping_paid_by\":\"X\"}"), CommerceReturnPolicy.defaults()));
        assertThrows(InvalidRequestException.class, () -> CommerceReturnPolicy.fromBody(
                json("{\"policy_text\":{\"en\":\"" + "x".repeat(2001) + "\"}}"), CommerceReturnPolicy.defaults()));
        // A key left out keeps its value.
        assertEquals(14, CommerceReturnPolicy.fromBody(json("{\"photo_required\":false}"), written).windowDays());
    }
}
