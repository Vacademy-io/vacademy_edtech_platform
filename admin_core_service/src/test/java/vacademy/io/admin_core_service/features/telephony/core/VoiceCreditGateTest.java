package vacademy.io.admin_core_service.features.telephony.core;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.telephony.core.dto.ConnectCallRequestDTO;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.InstituteTelephonyConfig;
import vacademy.io.common.exceptions.ConflictException;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The pre-dial affordability gate on the MANUAL (counsellor click-to-call) path.
 *
 * <p>These exist because the gate was missing entirely. Manual calls on Vacademy-paid
 * trunks are metered post-paid with {@code allow_negative=true}, so an institute whose
 * wallet had emptied simply kept dialling: one ran to -1427 credits over 1,306 billed
 * calls. AI calling, the chatbot and engagement dispatch each gated their own spend;
 * this path never did.
 *
 * <p>Every branch is pinned, because the two easy ways to get this wrong are both
 * outages rather than leaks: gating a provider we never bill (Airtel/Exotel ride the
 * institute's OWN carrier account) would block calls the wallet has nothing to do with,
 * and failing closed on an unreadable balance would turn an ai_service blip into
 * "nobody on the platform can dial".
 */
class VoiceCreditGateTest {

    private static final String INSTITUTE = "inst-1";

    private static void inject(Object target, String field, Object value) {
        try {
            Field f = target.getClass().getDeclaredField(field);
            f.setAccessible(true);
            f.set(target, value);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("could not inject " + field, e);
        }
    }

    /** Invokes the private gate directly — the rest of connect() needs a provider,
     *  an HTTP client and two transactions, none of which this behaviour depends on. */
    private static void gate(CallOrchestrator orchestrator) {
        try {
            Method m = CallOrchestrator.class
                    .getDeclaredMethod("assertVoiceCreditsAvailable", String.class);
            m.setAccessible(true);
            m.invoke(orchestrator, INSTITUTE);
        } catch (ReflectiveOperationException e) {
            if (e.getCause() instanceof RuntimeException re) throw re;
            throw new IllegalStateException(e);
        }
    }

    private static CallOrchestrator orchestrator(String providerType, CreditClient credits,
                                                 boolean gateEnabled) {
        return orchestrator(providerType, credits, gateEnabled, true);
    }

    private static CallOrchestrator orchestrator(String providerType, CreditClient credits,
                                                 boolean gateEnabled, boolean callingEnabled) {
        CallOrchestrator orchestrator = new CallOrchestrator();
        TelephonyConfigCache cache = mock(TelephonyConfigCache.class);
        if (providerType == null) {
            when(cache.get(anyString())).thenReturn(Optional.empty());
        } else {
            InstituteTelephonyConfig config = new InstituteTelephonyConfig();
            config.setProviderType(providerType);
            config.setEnabled(callingEnabled);
            when(cache.get(anyString())).thenReturn(Optional.of(
                    TelephonyConfigCache.Resolved.builder()
                            .config(config)
                            .enabledNumbers(List.of())
                            .build()));
        }
        inject(orchestrator, "configCache", cache);
        inject(orchestrator, "creditClient", credits);
        inject(orchestrator, "voiceCreditGateEnabled", gateEnabled);
        return orchestrator;
    }

    private static CreditClient balanceOf(Double balance) {
        CreditClient credits = mock(CreditClient.class);
        when(credits.readBalance(anyString()))
                .thenReturn(balance == null ? Optional.empty() : Optional.of(balance));
        return credits;
    }

    @Test
    void blocksPlivoCallWhenBalanceIsNegative() {
        ConflictException ex = assertThrows(ConflictException.class,
                () -> gate(orchestrator(ProviderType.PLIVO, balanceOf(-1427.32), true)));
        // The counsellor reads this sentence off a toast; it must name the money and
        // the remedy, not just say "blocked".
        assertTrue(ex.getMessage().contains("run out of AI credits"), ex.getMessage());
        assertTrue(ex.getMessage().contains("top up"), ex.getMessage());
    }

    @Test
    void blocksAtExactlyZero() {
        // > 0, not >= 0: a zero wallet cannot pay for the next minute either.
        assertThrows(ConflictException.class,
                () -> gate(orchestrator(ProviderType.PLIVO, balanceOf(0.0), true)));
    }

    @Test
    void allowsPlivoCallWhenInCredit() {
        assertDoesNotThrow(() -> gate(orchestrator(ProviderType.PLIVO, balanceOf(12.5), true)));
    }

    @Test
    void blocksVacademyAiTrunkToo() {
        // VACADEMY_AI dials on our own Plivo subaccounts, so its voice leg is billed
        // to this wallet exactly like PLIVO's.
        assertThrows(ConflictException.class,
                () -> gate(orchestrator(ProviderType.VACADEMY_AI, balanceOf(-1.0), true)));
    }

    @Test
    void ignoresProvidersOnTheInstitutesOwnCarrier() {
        // Airtel/Exotel minutes are paid to the institute's own provider account and
        // never metered here — a zero Vacademy wallet must not stop them.
        for (String provider : List.of(ProviderType.AIRTEL, ProviderType.EXOTEL)) {
            CreditClient credits = balanceOf(-500.0);
            assertDoesNotThrow(() -> gate(orchestrator(provider, credits, true)),
                    "should not gate " + provider);
        }
    }

    @Test
    void failsOpenWhenBalanceCannotBeRead() {
        // The whole platform's outbound calling goes through this method. An
        // unreachable credits service must not become a calling outage.
        assertDoesNotThrow(() -> gate(orchestrator(ProviderType.PLIVO, balanceOf(null), true)));
    }

    @Test
    void failsOpenWhenTheBalanceReadThrows() {
        CreditClient credits = mock(CreditClient.class);
        when(credits.readBalance(anyString())).thenThrow(new RuntimeException("connection refused"));
        assertDoesNotThrow(() -> gate(orchestrator(ProviderType.PLIVO, credits, true)));
    }

    @Test
    void killSwitchDisablesTheGate() {
        assertDoesNotThrow(() -> gate(orchestrator(ProviderType.PLIVO, balanceOf(-999.0), false)));
    }

    @Test
    void skipsWhenNoTelephonyConfigResolves() {
        // Nothing to bill and nothing to dial — prepareAndPersist owns that error.
        assertDoesNotThrow(() -> gate(orchestrator(null, balanceOf(-999.0), true)));
    }

    @Test
    void gateRunsBeforeAnythingIsPersisted() {
        // Ordering is the point: a blocked call must leave no call_log row and make no
        // provider HTTP request. Both collaborators are left null, so touching either
        // would NPE rather than silently pass.
        CallOrchestrator orchestrator = orchestrator(ProviderType.PLIVO, balanceOf(-5.0), true);
        ConnectCallRequestDTO req = new ConnectCallRequestDTO();
        req.setInstituteId(INSTITUTE);
        assertThrows(ConflictException.class, () -> orchestrator.connect(req, null));
    }

    @Test
    void skipsWhenCallingIsSwitchedOffForTheInstitute() {
        // The honest error there is "calling is not configured", raised downstream —
        // telling them to top up would send them to buy something that won't help.
        assertDoesNotThrow(() ->
                gate(orchestrator(ProviderType.PLIVO, balanceOf(-999.0), true, false)));
    }

    @Test
    void meterAndGateShareTheSameProviderSet() {
        // If these ever drift, one of the two failure modes above is back.
        assertTrue(CallBillingService.isVoiceBillable(ProviderType.PLIVO));
        assertTrue(CallBillingService.isVoiceBillable(ProviderType.VACADEMY_AI));
        assertTrue(!CallBillingService.isVoiceBillable(ProviderType.AIRTEL));
        assertTrue(!CallBillingService.isVoiceBillable(ProviderType.EXOTEL));
        assertTrue(!CallBillingService.isVoiceBillable(null));
    }
}
