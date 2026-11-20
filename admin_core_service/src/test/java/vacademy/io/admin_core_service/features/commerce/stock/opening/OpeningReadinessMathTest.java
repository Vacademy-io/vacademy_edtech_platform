package vacademy.io.admin_core_service.features.commerce.stock.opening;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.stock.opening.OpeningReadinessMath.Items;
import vacademy.io.admin_core_service.features.commerce.stock.opening.OpeningReadinessMath.LaterCount;
import vacademy.io.admin_core_service.features.commerce.stock.opening.OpeningReadinessMath.Readiness;
import vacademy.io.admin_core_service.features.commerce.stock.opening.OpeningReadinessMath.Receipts;
import vacademy.io.admin_core_service.features.commerce.stock.opening.OpeningReadinessMath.Recount;
import vacademy.io.admin_core_service.features.commerce.stock.opening.OpeningReadinessMath.Status;
import vacademy.io.admin_core_service.features.commerce.stock.opening.OpeningReadinessMath.UncostedReceipt;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Opening readiness: the status machine, the 10 % sample rule and the 98 % agreement. */
class OpeningReadinessMathTest {

    private static final LocalDateTime RECEIVED = LocalDateTime.of(2026, 11, 20, 10, 0);
    private static final Items COSTED = new Items(20, 20, List.of(), 1);
    private static final Receipts ONE_RECEIPT = new Receipts(1, 20, 40, 40, new BigDecimal("4000.00"), RECEIVED,
            List.of());
    private static final Receipts NONE = new Receipts(0, 0, 0, 0, null, null, List.of());

    private static LaterCount count(String id, String kind, String status) {
        return new LaterCount(id, kind, status, RECEIVED.plusHours(1));
    }

    private static Recount recount(long mainLines, int compared, int agreeing, String percent, Boolean passes) {
        return new Recount("rc-1", "CNT-000002", "c-1", "CNT-000001", mainLines, compared, agreeing,
                new BigDecimal(percent), passes);
    }

    // ── Status machine ─────────────────────────────────────────────────────

    @Test
    void noOpeningReceiptIsNotStarted() {
        Readiness readiness = OpeningReadinessMath.decide(COSTED, NONE, List.of(), null);
        assertEquals(Status.NOT_STARTED, readiness.status());
        assertNull(readiness.recount());
        assertFalse(readiness.ready());
    }

    @Test
    void receiptsWithNoLaterCountAreReceiving() {
        assertEquals(Status.RECEIVING, OpeningReadinessMath.decide(COSTED, ONE_RECEIPT, List.of(), null).status());
    }

    @Test
    void anOpenCountAfterTheReceiptIsCounting() {
        Readiness readiness = OpeningReadinessMath.decide(COSTED, ONE_RECEIPT,
                List.of(count("c-1", "COUNT", "OPEN")), null);
        assertEquals(Status.COUNTING, readiness.status());
    }

    @Test
    void aPassingRecountWithEnoughSampleIsPassedAndReady() {
        Readiness readiness = OpeningReadinessMath.decide(COSTED, ONE_RECEIPT,
                List.of(count("c-1", "COUNT", "OPEN"), count("rc-1", "RECOUNT", "POSTED")),
                recount(20, 2, 2, "100.0", true));
        assertEquals(Status.PASSED, readiness.status());
        assertTrue(readiness.ready());
        assertEquals(List.of(), readiness.blockers());
        assertEquals(new BigDecimal("10.0"), readiness.recount().samplePercent());
    }

    @Test
    void aFailingRecountIsRecountFailedWithItsBlocker() {
        Readiness readiness = OpeningReadinessMath.decide(COSTED, ONE_RECEIPT, List.of(),
                recount(20, 4, 3, "75.0", false));
        assertEquals(Status.RECOUNT_FAILED, readiness.status());
        assertEquals(List.of(OpeningReadinessMath.AGREEMENT_BELOW_98), readiness.blockers());
    }

    @Test
    void aNewOpenRecountAfterAFailureIsCountingAgain() {
        Readiness readiness = OpeningReadinessMath.decide(COSTED, ONE_RECEIPT,
                List.of(count("rc-2", "RECOUNT", "OPEN"), count("c-1", "COUNT", "OPEN")),
                recount(20, 4, 3, "75.0", false));
        assertEquals(Status.COUNTING, readiness.status());
    }

    @Test
    void aRecountOlderThanTheLastReceiptIsIgnored() {
        // The reader only hands over recounts whose main count started after the last receipt;
        // a later receipt leaves none, so the location is receiving again.
        Readiness readiness = OpeningReadinessMath.decide(COSTED, ONE_RECEIPT, List.of(), null);
        assertEquals(Status.RECEIVING, readiness.status());
        assertNull(readiness.recount());
    }

    @Test
    void missingCostsAndAnUncostedReceiptAreBlockersButNotTheStatus() {
        Items missing = new Items(20, 18, List.of("TST-0001", "TST-0002"), 0);
        Receipts uncosted = new Receipts(1, 20, 40, 0, null, RECEIVED,
                List.of(new UncostedReceipt("r-1", "GRN-000001", "2026-11-16", 20, 40)));
        Readiness readiness = OpeningReadinessMath.decide(missing, uncosted, List.of(),
                recount(20, 2, 2, "100.0", true));
        assertEquals(Status.PASSED, readiness.status());
        assertEquals(List.of(OpeningReadinessMath.COSTS_MISSING, OpeningReadinessMath.UNCOSTED_OPENING_RECEIPT),
                readiness.blockers());
        assertFalse(readiness.ready());
        assertEquals(2, missing.withoutCost());
    }

    // ── Sample rule ────────────────────────────────────────────────────────

    @Test
    void tenOfAHundredIsEnoughNineIsNot() {
        assertTrue(OpeningReadinessMath.verdict(recount(100, 10, 10, "100.0", true)).sampleOk());
        assertFalse(OpeningReadinessMath.verdict(recount(100, 9, 9, "100.0", true)).sampleOk());
        assertEquals(new BigDecimal("9.0"), OpeningReadinessMath.verdict(recount(100, 9, 9, "100.0", true))
                .samplePercent());
    }

    @Test
    void oneOfFiveIsEnoughBecauseHalfALineRoundsUp() {
        assertEquals(1, OpeningReadinessMath.sampleNeeded(5));
        assertTrue(OpeningReadinessMath.verdict(recount(5, 1, 1, "100.0", true)).sampleOk());
        assertEquals(11, OpeningReadinessMath.sampleNeeded(101));
    }

    @Test
    void aSampleTooSmallFailsEvenAtFullAgreement() {
        Readiness readiness = OpeningReadinessMath.decide(COSTED, ONE_RECEIPT, List.of(),
                recount(20, 1, 1, "100.0", true));
        assertEquals(Status.RECOUNT_FAILED, readiness.status());
        assertEquals(List.of(OpeningReadinessMath.SAMPLE_TOO_SMALL), readiness.blockers());
    }

    // ── Agreement ──────────────────────────────────────────────────────────

    @Test
    void ninetyEightPassesNinetySevenNineFails() {
        assertTrue(OpeningReadinessMath.agreementPasses(null, new BigDecimal("98.0"), 50));
        assertFalse(OpeningReadinessMath.agreementPasses(null, new BigDecimal("97.9"), 50));
        assertFalse(OpeningReadinessMath.agreementPasses(null, new BigDecimal("100.0"), 0));
        assertTrue(OpeningReadinessMath.verdict(recount(100, 50, 49, "98.0", null)).passes());
        assertFalse(OpeningReadinessMath.verdict(recount(100, 50, 48, "97.9", null)).passes());
    }

    @Test
    void passNeedsBothTheSampleAndTheAgreement() {
        assertTrue(OpeningReadinessMath.verdict(recount(100, 10, 10, "100.0", true)).passes());
        assertFalse(OpeningReadinessMath.verdict(recount(100, 9, 9, "100.0", true)).passes());
        assertFalse(OpeningReadinessMath.verdict(recount(100, 10, 9, "90.0", false)).passes());
        Readiness both = OpeningReadinessMath.decide(COSTED, ONE_RECEIPT, List.of(),
                recount(100, 5, 4, "80.0", false));
        assertEquals(List.of(OpeningReadinessMath.SAMPLE_TOO_SMALL, OpeningReadinessMath.AGREEMENT_BELOW_98),
                both.blockers());
    }

    @Test
    void theStoredVerdictWins() {
        assertFalse(OpeningReadinessMath.agreementPasses(false, new BigDecimal("98.0"), 50));
    }
}
