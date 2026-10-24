package vacademy.io.admin_core_service.features.super_admin.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.super_admin.dto.SuperAdminCallDTO;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * The health dashboard's revenue estimate for a call the ledger has not charged yet
 * must price it the way CallBillingService does: 30-second pulses, both meters, the
 * engine surcharge on the AI leg. It used ceil-MINUTES and booked a 77 s call at
 * 12 credits; the wallet took 9.
 *
 * <p>And it must estimate PER LEG: one charged leg is not the whole call, and a leg
 * stamped billed with no ledger row (0-rate override) earned 0, not an estimate.
 */
class SuperAdminBilledEstimateTest {

    private final SuperAdminCallService svc = new SuperAdminCallService();
    private final Map<String, Double> card = Map.of("credit_inr", 1.0);
    private final Map<String, double[]> pricing = Map.of(
            "voice_call_out", new double[]{1.0, 0.0},
            "ai_call_out", new double[]{5.0, 0.0});
    private final Map<String, Double> surcharge = Map.of("sarvam", 4.0, "sarvam_v4", 0.0);

    @Test
    void billsInThirtySecondPulsesLikeTheWallet() {
        // 77 s = 3 pulses = 1.5 min: voice 1.5 + AI 7.5 = 9 credits.
        assertEquals(9.0, svc.estimatedInr(card, surcharge, pricing, "navana", "OUTBOUND", 77, true, true), 1e-9);
        // 30 s is one pulse, not a whole minute.
        assertEquals(3.0, svc.estimatedInr(card, surcharge, pricing, "navana", "OUTBOUND", 30, true, true), 1e-9);
        assertEquals(0.0, svc.estimatedInr(card, surcharge, pricing, "navana", "OUTBOUND", 0, true, true), 1e-9);
    }

    @Test
    void engineSurchargeRidesTheAiLeg() {
        // Sarvam v3 carries +4/min; v4 Flash carries none.
        assertEquals(1.0 + 9.0, svc.estimatedInr(card, surcharge, pricing, "sarvam", "OUTBOUND", 60, true, true), 1e-9);
        assertEquals(1.0 + 5.0, svc.estimatedInr(card, surcharge, pricing, "sarvam_v4", "OUTBOUND", 60, true, true), 1e-9);
        // Only the AI leg pending: the surcharge still rides it, no voice minutes.
        assertEquals(9.0, svc.estimatedInr(card, surcharge, pricing, "sarvam", "OUTBOUND", 60, false, true), 1e-9);
    }

    @Test
    void partialLedgerEstimatesOnlyTheMissingLeg() {
        // Voice leg charged by the Plivo webhook (1.5 credits for 77 s), AI leg still
        // waiting on the report: ledger 1.5 + AI estimate 7.5, and it is an estimate.
        SuperAdminCallService.Billed b = svc.billed(card, surcharge, pricing, "navana", "OUTBOUND", 77,
                1.5, null, false, true);
        assertEquals(9.0, b.inr(), 1e-9);
        assertTrue(b.estimated(), "a pending leg keeps the est. marker");

        // The reverse order: AI charged first, voice still pending.
        b = svc.billed(card, surcharge, pricing, "navana", "OUTBOUND", 77, null, 7.5, true, false);
        assertEquals(9.0, b.inr(), 1e-9);
        assertTrue(b.estimated());
    }

    @Test
    void bothLegsInTheLedgerIsFinal() {
        SuperAdminCallService.Billed b = svc.billed(card, surcharge, pricing, "navana", "OUTBOUND", 77,
                1.5, 7.5, false, false);
        assertEquals(9.0, b.inr(), 1e-9);
        assertFalse(b.estimated());
    }

    @Test
    void legStampedAtZeroEarnsZeroNotAnEstimate() {
        // 0-credit override: bill() stamps credits_billed_at without a ledger row, so
        // neither leg is pending. It used to be estimated at the global rate forever.
        SuperAdminCallService.Billed b = svc.billed(card, surcharge, pricing, "navana", "OUTBOUND", 77,
                null, null, false, false);
        assertEquals(0.0, b.inr(), 1e-9);
        assertFalse(b.estimated(), "stamped at 0 is final");

        // AI leg overridden to 0 (stamped, no row), voice leg charged normally.
        b = svc.billed(card, surcharge, pricing, "navana", "OUTBOUND", 77, 1.5, null, false, false);
        assertEquals(1.5, b.inr(), 1e-9);
        assertFalse(b.estimated());
    }

    // ---- list and summary must agree on the same call -------------------------

    /** One outbound 77 s VACADEMY_AI call on navana, as both queries would return it. */
    private SuperAdminCallService mockedService(Object voiceLedger, Object aiLedger,
                                                boolean voicePending, boolean aiPending) {
        EntityManager em = mock(EntityManager.class);
        when(em.createNativeQuery(anyString())).thenAnswer(inv -> {
            String sql = inv.getArgument(0);
            Query q = mock(Query.class, RETURNS_SELF);
            List<Object[]> rows = new ArrayList<>();
            if (sql.contains("voice_call_rate_card")) {
                rows.add(new Object[]{"credit_inr", 1.0});
            } else if (sql.contains("FROM ai_tts_model_pricing")) {
                rows.add(new Object[]{"navana", 0.0});
            } else if (sql.contains("FROM credit_pricing")) {
                rows.add(new Object[]{"voice_call_out", 1.0, 0.0});
                rows.add(new Object[]{"ai_call_out", 5.0, 0.0});
            } else if (sql.contains("GROUP BY 1")) {
                Object[] s = new Object[24];
                java.util.Arrays.fill(s, 0L);
                s[0] = "navana"; s[1] = 1L; s[2] = 77L;
                s[7] = aiPending ? 3L : 0L;          // AI-leg pending pulses
                s[8] = voicePending ? 3L : 0L;       // voice-leg pending pulses
                s[21] = ((voiceLedger == null ? 0d : ((Number) voiceLedger).doubleValue())
                        + (aiLedger == null ? 0d : ((Number) aiLedger).doubleValue()));
                rows.add(s);
            } else if (sql.contains("LIMIT")) {
                Object[] r = new Object[25];
                r[0] = "call-1"; r[6] = "navana"; r[10] = "OUTBOUND"; r[11] = "completed";
                r[14] = 77; r[19] = "VACADEMY_AI";
                r[21] = voiceLedger; r[22] = aiLedger;
                r[23] = voicePending ? 1 : 0; r[24] = aiPending ? 1 : 0;
                rows.add(r);
            }
            when(q.getResultList()).thenReturn(rows);
            when(q.getSingleResult()).thenReturn(1L);
            return q;
        });
        SuperAdminCallService s = new SuperAdminCallService();
        ReflectionTestUtils.setField(s, "em", em);
        return s;
    }

    private void assertListMatchesSummary(SuperAdminCallService s, double expected, boolean final_) {
        SuperAdminCallDTO row = s.list(null, null, null, null, null, null, 0, 5).getContent().get(0);
        double summaryBilled = s.summary(null, null, null, null, null, null).getBilledInr();
        assertEquals(expected, row.getBilledInr(), 1e-9);
        assertEquals(expected, summaryBilled, 1e-9, "summary sums what the rows show");
        assertEquals(final_, row.getBilledFromLedger());
    }

    @Test
    void listAndSummaryAgreeOnAPartialLedger() {
        assertListMatchesSummary(mockedService(1.5, null, false, true), 9.0, false);
    }

    @Test
    void listAndSummaryAgreeOnAZeroRateCall() {
        assertListMatchesSummary(mockedService(null, null, false, false), 0.0, true);
    }

    @Test
    void listAndSummaryAgreeOnAnUnchargedCall() {
        assertListMatchesSummary(mockedService(null, null, true, true), 9.0, false);
    }
}
