package vacademy.io.admin_core_service.features.credits.service;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformBillingFlags;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformRazorpayWebHookService;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** F1 / F7 safety net: the hourly pack-link reconcile is dark by default and never throws. */
class CreditPackReconcileJobTest {

    @Test
    void offByDefaultMakesNoQueryAndNoRazorpayCall() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        PlatformBillingFlags flags = mock(PlatformBillingFlags.class);
        PlatformRazorpayWebHookService webhook = mock(PlatformRazorpayWebHookService.class);
        when(flags.packReconcileEnabled()).thenReturn(false);

        assertNull(new CreditPackReconcileJob(jdbc, flags, webhook).runOnce());
        verifyNoInteractions(jdbc, webhook);
    }

    @Test
    void eachOpenLinkIsReconciledAndOneFailureDoesNotStopThePass() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        PlatformBillingFlags flags = mock(PlatformBillingFlags.class);
        PlatformRazorpayWebHookService webhook = mock(PlatformRazorpayWebHookService.class);
        when(flags.packReconcileEnabled()).thenReturn(true);
        when(jdbc.queryForList(eq(CreditPackReconcileJob.SELECT_OPEN_PACK_LINKS), eq(String.class), any(), any()))
                .thenReturn(List.of("pp-paid", "pp-boom", "pp-open", "pp-expired"));
        when(webhook.reconcileFromLink("pp-paid")).thenReturn("paid");
        when(webhook.reconcileFromLink("pp-boom")).thenThrow(new RuntimeException("razorpay down"));
        when(webhook.reconcileFromLink("pp-open")).thenReturn("created");
        when(webhook.reconcileFromLink("pp-expired")).thenReturn("expired");

        int[] r = new CreditPackReconcileJob(jdbc, flags, webhook).runOnce();

        assertArrayEquals(new int[] {3, 2, 1}, r);
        verify(webhook).reconcileFromLink("pp-expired");
    }

    @Test
    void theQueryIsPlainSqlWithoutTextBlockOrColonCastTraps() {
        String sql = CreditPackReconcileJob.SELECT_OPEN_PACK_LINKS;
        assertFalse(sql.contains("::"), "no colon casts in native SQL");
        assertFalse(sql.matches(".*[^\\s(](WHERE|AND|ORDER BY|LIMIT)\\b.*"), "fragments are space-separated");
        assertFalse(sql.contains("'plink_%'"), "underscore is a LIKE wildcard; left() is exact");
    }

    @Test
    void runNeverThrows() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        PlatformBillingFlags flags = mock(PlatformBillingFlags.class);
        PlatformRazorpayWebHookService webhook = mock(PlatformRazorpayWebHookService.class);
        when(flags.packReconcileEnabled()).thenReturn(true);
        when(jdbc.queryForList(anyString(), eq(String.class), any(), any())).thenThrow(new RuntimeException("db"));

        new CreditPackReconcileJob(jdbc, flags, webhook).run();
        verify(webhook, never()).reconcileFromLink(anyString());
    }
}
