package vacademy.io.admin_core_service.features.commerce.pos.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosSession;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosReadRepository.MovementFact;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosReadRepository.RefundFact;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosReadRepository.TenderFact;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Expected cash, the cash count and the variance rule of a close. */
class PosSessionMathTest {

    private static BigDecimal money(String value) {
        return new BigDecimal(value);
    }

    @Test
    void expectedCashIsOpeningPlusCashTakenPlusInLessOutLessCashRefunds() {
        BigDecimal expected = PosSessionService.expectedCash(money("500.00"),
                List.of(new TenderFact("o1", "CASH", money("1000.00"), "RECEIVED"),
                        new TenderFact("o2", "CASH", money("300.00"), "VOID"),
                        new TenderFact("o3", "UPI", money("450.00"), "RECEIVED"),
                        new TenderFact("o4", "CREDIT_NOTE", money("200.00"), "RECEIVED")),
                List.of(new MovementFact("CASH_IN", money("100.00")), new MovementFact("CASH_OUT", money("40.00"))),
                List.of(new RefundFact("CASH", money("150.00"), "PROCESSED"),
                        new RefundFact("CASH", money("70.00"), "PENDING"),
                        new RefundFact("UPI", money("90.00"), "PROCESSED")));
        // 500 + 1000 + 100 - 40 - 150
        assertEquals(0, money("1410.00").compareTo(expected));
    }

    @Test
    void anEmptySessionExpectsTheOpeningCash() {
        assertEquals(0, money("250.00").compareTo(PosSessionService.expectedCash(money("250.00"), List.of(),
                List.of(), List.of())));
    }

    @Test
    void theCountIsTheSumOfTheDenominations() {
        Map<String, Integer> notes = new LinkedHashMap<>();
        notes.put("500", 2);
        notes.put("100", 3);
        notes.put("2", 4);
        notes.put("1", 0);
        PosSessionService.Count count = PosSessionService.count(null, notes);
        assertEquals(0, money("1308.00").compareTo(count.counted()));
        assertEquals(List.of("500", "100", "2", "1"), List.copyOf(count.denominations().keySet()));
    }

    @Test
    void aTypedTotalBesideDenominationsMustMatch() {
        Map<String, Integer> notes = Map.of("200", 1);
        assertEquals(0, money("200.00").compareTo(PosSessionService.count(money("200"), notes).counted()));
        InvalidRequestException e = assertThrows(InvalidRequestException.class,
                () -> PosSessionService.count(money("201.00"), notes));
        assertTrue(e.getMessage().startsWith("COUNT_MISMATCH"));
    }

    @Test
    void aTypedTotalAloneIsTheCount() {
        PosSessionService.Count count = PosSessionService.count(money("99.50"), null);
        assertEquals(0, money("99.50").compareTo(count.counted()));
        assertNull(count.denominations());
    }

    @Test
    void neitherACountNorUnknownNotesAreAccepted() {
        assertTrue(assertThrows(InvalidRequestException.class, () -> PosSessionService.count(null, null))
                .getMessage().startsWith("VALIDATION"));
        assertThrows(InvalidRequestException.class, () -> PosSessionService.count(null, Map.of("25", 1)));
        assertThrows(InvalidRequestException.class, () -> PosSessionService.count(null, Map.of("100", -1)));
        assertThrows(InvalidRequestException.class, () -> PosSessionService.count(null, Map.of("100", 100_001)));
        assertThrows(InvalidRequestException.class, () -> PosSessionService.count(money("-1"), null));
        assertThrows(InvalidRequestException.class, () -> PosSessionService.count(money("1.005"), null));
    }

    @Test
    void aCashierNeedsAPinAboveTheVarianceLimitAndTheUnsetLimitIsZero() {
        assertFalse(PosSessionService.varianceNeedsApproval(false, money("0.00"), money("0.00")));
        assertTrue(PosSessionService.varianceNeedsApproval(false, money("-0.01"), money("0.00")));
        assertTrue(PosSessionService.varianceNeedsApproval(false, money("0.01"), null));
        assertFalse(PosSessionService.varianceNeedsApproval(false, money("-50.00"), money("50.00")));
        assertTrue(PosSessionService.varianceNeedsApproval(false, money("50.01"), money("50.00")));
        assertFalse(PosSessionService.varianceNeedsApproval(true, money("5000.00"), money("0.00")));
    }

    @Test
    void theLastCloseLeftItsCountLessWhatWasHandedOver() {
        PosSession previous = new PosSession();
        previous.setCountedCash(money("1200.00"));
        assertEquals(0, money("1200.00").compareTo(PosSessionService.previousCounted(previous)));
        previous.setHandoverAmount(money("1000.00"));
        assertEquals(0, money("200.00").compareTo(PosSessionService.previousCounted(previous)));
        previous.setCountedCash(null);
        assertNull(PosSessionService.previousCounted(previous));
    }

    @Test
    void anIndiaDateStartsAtItsMidnightInUtc() {
        assertEquals(LocalDateTime.of(2026, 11, 17, 18, 30), PosSessionService.indiaDayStart("2026-11-18", "from", 0));
        assertEquals(LocalDateTime.of(2026, 11, 18, 18, 30), PosSessionService.indiaDayStart("2026-11-18", "to", 1));
        assertNull(PosSessionService.indiaDayStart(" ", "from", 0));
        assertThrows(InvalidRequestException.class, () -> PosSessionService.indiaDayStart("18-11-2026", "from", 0));
    }
}
