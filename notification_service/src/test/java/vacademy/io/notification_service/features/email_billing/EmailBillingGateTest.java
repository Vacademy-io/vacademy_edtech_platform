package vacademy.io.notification_service.features.email_billing;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/** When an email may go: free allowance first, then credits; never blocked while off, exempt or unknown. */
class EmailBillingGateTest {

    private static final String INST = "inst-1";
    private static final BigDecimal RATE = new BigDecimal("0.04");

    private EmailBillingSettings settings;
    private EmailUsageStore store;
    private CreditLedgerClient ledger;
    private EmailBillingGate gate;

    @BeforeEach
    void setUp() {
        settings = mock(EmailBillingSettings.class);
        store = mock(EmailUsageStore.class);
        ledger = mock(CreditLedgerClient.class);
        gate = new EmailBillingGate(settings, store, ledger);
        enforce(true, Set.of());
    }

    private void enforce(boolean on, Set<String> exempt) {
        when(settings.get()).thenReturn(new EmailBillingSettings.Snapshot(on, true, true, 1000, RATE, exempt));
    }

    private void month(long chargeable, long charged) {
        when(store.monthTotals(eq(INST), anyString()))
                .thenReturn(new EmailUsageStore.MonthTotals(chargeable, charged, BigDecimal.ZERO));
    }

    private void balance(String b) {
        when(ledger.balance(INST)).thenReturn(b == null ? Optional.empty() : Optional.of(new BigDecimal(b)));
    }

    private static <T> T eq(T v) {
        return org.mockito.ArgumentMatchers.eq(v);
    }

    @Test
    void nothingIsBlockedWhileEnforcementIsOff() {
        enforce(false, Set.of());
        month(50_000, 0);
        balance("0");
        assertTrue(gate.allows(INST, EmailBillingClass.BILLABLE, 1));
        verifyNoInteractions(ledger);
    }

    @Test
    void freeAndEssentialMailIsNeverBlocked() {
        month(50_000, 0);
        balance("-100");
        assertTrue(gate.allows(INST, EmailBillingClass.FREE, 1));
        assertTrue(gate.allows(INST, EmailBillingClass.ESSENTIAL, 1));
        assertTrue(gate.allows(INST, EmailBillingClass.EXCLUDED, 1));
    }

    @Test
    void anExemptInstituteIsNeverBlocked() {
        enforce(true, Set.of(INST));
        month(50_000, 0);
        balance("0");
        assertTrue(gate.allows(INST, EmailBillingClass.BILLABLE, 1));
    }

    @Test
    void theFreeAllowanceCoversMailEvenWithAnEmptyWallet() {
        month(999, 0);
        balance("0");
        assertTrue(gate.allows(INST, EmailBillingClass.BILLABLE, 1));
        verify(ledger, never()).balance(any());
    }

    @Test
    void beyondTheAllowanceOneEmailNeedsAPositiveWallet() {
        month(1000, 0);
        balance("0.01");
        assertTrue(gate.allows(INST, EmailBillingClass.BILLABLE, 1));
        balance("0");
        assertFalse(gate.allows(INST, EmailBillingClass.BILLABLE, 1));
        balance("-3");
        assertFalse(gate.allows(INST, EmailBillingClass.BILLABLE, 1));
    }

    @Test
    void usageNotYetChargedIsTakenOffTheWallet() {
        month(1100, 0); // 100 units beyond free, uncharged = 4.00 credits
        balance("4.00");
        assertFalse(gate.allows(INST, EmailBillingClass.BILLABLE, 1));
        balance("4.05");
        assertTrue(gate.allows(INST, EmailBillingClass.BILLABLE, 1));
        month(1100, 100); // now on the ledger: the wallet already reflects it
        balance("0.05");
        assertTrue(gate.allows(INST, EmailBillingClass.BILLABLE, 1));
    }

    @Test
    void aBatchNeedsCreditsForAllOfIt() {
        month(900, 0); // 100 free left
        balance("10");
        EmailBillingGate.Estimate fits = gate.estimate(INST, EmailBillingClass.BILLABLE, 350); // 250 x 0.04 = 10
        assertTrue(fits.allowed());
        assertEquals(new BigDecimal("10.00"), fits.credits());
        assertEquals(100, fits.freeUnitsRemaining());
        assertEquals(250, fits.chargeableUnits());

        EmailBillingGate.Estimate tooMany = gate.estimate(INST, EmailBillingClass.BILLABLE, 351);
        assertFalse(tooMany.allowed());
        assertEquals(new BigDecimal("10.04"), tooMany.credits());
    }

    @Test
    void anUnreadableWalletLetsMailThrough() {
        month(5000, 0);
        balance(null);
        assertTrue(gate.allows(INST, EmailBillingClass.BILLABLE, 1));
        assertTrue(gate.estimate(INST, EmailBillingClass.BILLABLE, 10_000).allowed());
    }
}
