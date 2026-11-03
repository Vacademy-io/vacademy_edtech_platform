package vacademy.io.admin_core_service.features.engagement.report;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReport.Roi;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.CreditRate;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.InfluencedPayment;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportService.EngineMoney;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** The ROI block: spend in money, influenced revenue counted once per payment, and the multiple. */
class EngagementDailyReportRoiTest {

    private static final CreditRate PACK = new CreditRate("PURCHASE", "INR", 0.93);

    private static InfluencedPayment pay(String engine, String id, String user, double amount, String currency) {
        return new InfluencedPayment(engine, id, user, amount, currency);
    }

    @Test
    void spendIsCreditsAtTheRatePlusWhatsAppInTheSameCurrency() {
        Roi r = EngagementDailyReportService.roi(100, PACK, 50, "INR",
                List.of(pay("e1", "p1", "u1", 5000, "INR")), true);
        assertEquals(93.0, r.creditSpend());
        assertTrue(r.whatsappIncluded());
        assertEquals(143.0, r.totalSpend());
        assertEquals(5000.0, r.revenue());
        assertEquals(34.97, r.roiMultiple());
        assertEquals(4857.0, r.net());
        assertEquals(143.0, r.costPerPayingLead());
        assertEquals("PURCHASE", r.rateSource());
        assertFalse(r.currencyMismatch());
    }

    @Test
    void whatsAppInAnotherCurrencyIsShownButNotAdded() {
        Roi r = EngagementDailyReportService.roi(100, PACK, 2, "USD", List.of(), true);
        assertFalse(r.whatsappIncluded());
        assertEquals(93.0, r.totalSpend());
        assertEquals(0.0, r.roiMultiple());
        assertEquals("INR", r.revenueCurrency());
    }

    @Test
    void aPaymentTwoEnginesTouchedCountsOnceInTotalAndForEachEngine() {
        List<InfluencedPayment> rows = List.of(
                pay("e1", "p1", "u1", 1000, "INR"),
                pay("e2", "p1", "u1", 1000, "INR"),
                pay("e2", "p2", "u2", 500, "INR"));
        Roi r = EngagementDailyReportService.roi(10, PACK, 0, "INR", rows, true);
        assertEquals(1500.0, r.revenue());
        assertEquals(2, r.payments());
        assertEquals(2, r.payingLeads());

        EngineMoney e1 = EngagementDailyReportService.engineMoney("e1", 4, 0, PACK, "INR", r, rows);
        EngineMoney e2 = EngagementDailyReportService.engineMoney("e2", 6, 0, PACK, "INR", r, rows);
        assertEquals(1000.0, e1.revenue());
        assertEquals(1500.0, e2.revenue());
        assertEquals(3.72, e1.spend());
        assertEquals(268.82, e1.roi());
        assertEquals(2, e2.payingLeads());
    }

    @Test
    void unknownRateOrFailedRevenueLeavesTheMultipleUnknownNotZero() {
        Roi noRate = EngagementDailyReportService.roi(10, null, 0, "INR",
                List.of(pay("e1", "p1", "u1", 100, "INR")), true);
        assertNull(noRate.totalSpend());
        assertNull(noRate.roiMultiple());
        assertEquals(100.0, noRate.revenue());

        Roi failed = EngagementDailyReportService.roi(10, PACK, 0, "INR", List.of(), false);
        assertNull(failed.roiMultiple());
        assertNull(failed.net());
    }

    @Test
    void revenueInAnotherCurrencyThanTheSpendIsAMismatch() {
        Roi r = EngagementDailyReportService.roi(10, PACK, 0, "INR", List.of(
                pay("e1", "p1", "u1", 100, "USD"),
                pay("e1", "p2", "u2", 200, "USD"),
                pay("e1", "p3", "u3", 999, "INR")), true);
        assertEquals("USD", r.revenueCurrency());
        assertEquals(300.0, r.revenue());
        assertEquals(1, r.otherCurrencyPayments());
        assertTrue(r.currencyMismatch());
        assertNull(r.roiMultiple());
    }

    @Test
    void zeroSpendHasNoMultiple() {
        Roi r = EngagementDailyReportService.roi(0, PACK, 0, "INR", List.of(pay("e1", "p1", "u1", 100, "INR")), true);
        assertEquals(0.0, r.totalSpend());
        assertNull(r.roiMultiple());
        assertEquals(100.0, r.net());
    }
}
