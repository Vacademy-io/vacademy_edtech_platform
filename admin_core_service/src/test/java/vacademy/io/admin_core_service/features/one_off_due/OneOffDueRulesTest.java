package vacademy.io.admin_core_service.features.one_off_due;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.one_off_due.service.OneOffDueRules;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.*;

class OneOffDueRulesTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 11, 27);

    private static OneOffDueRules.Clean ok(String amount) {
        return OneOffDueRules.validate(new BigDecimal(amount), TODAY, " Bridge class ", "  ", null, " ", TODAY);
    }

    @Test
    void cleansAValidRequest() {
        OneOffDueRules.Clean c = ok("1500");
        assertEquals(new BigDecimal("1500.00"), c.amount());
        assertEquals("Bridge class", c.title());
        assertNull(c.note());
        assertEquals("MANUAL", c.sourceType());
        assertNull(c.sourceId());
    }

    @Test
    void refusesZeroNegativeAndMissingAmounts() {
        assertThrows(VacademyException.class, () -> ok("0"));
        assertThrows(VacademyException.class, () -> ok("-5"));
        assertThrows(VacademyException.class,
                () -> OneOffDueRules.validate(null, TODAY, "x", null, null, null, TODAY));
    }

    @Test
    void refusesMoreThanTwoDecimalsAndHugeAmounts() {
        assertThrows(VacademyException.class, () -> ok("10.005"));
        assertEquals(new BigDecimal("10.50"), ok("10.500").amount());
        assertThrows(VacademyException.class, () -> ok("100000000"));
    }

    @Test
    void needsTitleAndDueDate() {
        assertThrows(VacademyException.class,
                () -> OneOffDueRules.validate(BigDecimal.TEN, TODAY, "  ", null, null, null, TODAY));
        assertThrows(VacademyException.class,
                () -> OneOffDueRules.validate(BigDecimal.TEN, null, "x", null, null, null, TODAY));
        assertThrows(VacademyException.class,
                () -> OneOffDueRules.validate(BigDecimal.TEN, TODAY, "x".repeat(201), null, null, null, TODAY));
    }

    @Test
    void dueDateMustBeWithinRange() {
        assertThrows(VacademyException.class,
                () -> OneOffDueRules.validate(BigDecimal.TEN, TODAY.minusYears(2), "x", null, null, null, TODAY));
        assertThrows(VacademyException.class,
                () -> OneOffDueRules.validate(BigDecimal.TEN, TODAY.plusYears(4), "x", null, null, null, TODAY));
        assertNotNull(OneOffDueRules.validate(BigDecimal.TEN, TODAY.minusDays(10), "x", null, null, null, TODAY));
    }

    @Test
    void sourceTypeIsNormalisedAndChecked() {
        assertEquals("REENTRY_BRIDGE", OneOffDueRules
                .validate(BigDecimal.TEN, TODAY, "x", null, "reentry_bridge", "abc", TODAY).sourceType());
        assertThrows(VacademyException.class,
                () -> OneOffDueRules.validate(BigDecimal.TEN, TODAY, "x", null, "bad type!", null, TODAY));
    }

    @Test
    void statusComesFromTheInvoice() {
        assertEquals("DUE", OneOffDueRules.statusOf("PENDING_PAYMENT"));
        assertEquals("PAID", OneOffDueRules.statusOf("PAID"));
        assertEquals("CANCELLED", OneOffDueRules.statusOf("REJECTED"));
        assertEquals("CANCELLED", OneOffDueRules.statusOf(null));
    }

    @Test
    void onlyAnUnpaidChargeCanBeCancelled() {
        assertDoesNotThrow(() -> OneOffDueRules.requireCancellable("DUE"));
        assertThrows(VacademyException.class, () -> OneOffDueRules.requireCancellable("PAID"));
        assertThrows(VacademyException.class, () -> OneOffDueRules.requireCancellable("CANCELLED"));
    }
}
