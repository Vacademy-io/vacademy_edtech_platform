package vacademy.io.admin_core_service.features.ai_usage.service;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import vacademy.io.admin_core_service.features.ai_usage.entity.AiTokenUsage;
import vacademy.io.admin_core_service.features.ai_usage.enums.ApiProvider;
import vacademy.io.admin_core_service.features.ai_usage.enums.RequestType;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.credits.client.MeteringFields;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class JavaLlmBillingServiceTest {

    private static final String SONNET = "anthropic/claude-sonnet-4.5";
    private static final UUID INSTITUTE = UUID.fromString("6f0c1d1e-0000-4000-8000-000000000001");
    private static final UUID USER = UUID.fromString("6f0c1d1e-0000-4000-8000-000000000002");
    private static final UUID ROW = UUID.fromString("6f0c1d1e-0000-4000-8000-0000000000aa");

    /** Fake DB: the setting row, ai_models prices, and every UPDATE it saw. */
    static class FakeDb extends JdbcTemplate {
        String setting;
        RuntimeException settingError;
        final AtomicInteger settingReads = new AtomicInteger();
        final Map<String, Object[]> prices = new HashMap<>();
        final List<Object[]> updates = new ArrayList<>();

        @Override
        @SuppressWarnings("unchecked")
        public <T> List<T> queryForList(String sql, Class<T> elementType, Object... args) {
            settingReads.incrementAndGet();
            if (settingError != null) {
                throw settingError;
            }
            return setting == null ? List.of() : (List<T>) List.of(setting);
        }

        @Override
        public List<Map<String, Object>> queryForList(String sql, Object... args) {
            Object[] p = prices.get((String) args[0]);
            if (p == null) {
                return List.of();
            }
            Map<String, Object> row = new HashMap<>();
            row.put("input_price_per_1m", p[0]);
            row.put("output_price_per_1m", p[1]);
            return List.of(row);
        }

        @Override
        public int update(String sql, Object... args) {
            updates.add(args);
            return 1;
        }
    }

    private final FakeDb db = new FakeDb();
    private final AiTokenUsageService usage = mock(AiTokenUsageService.class);
    private final CreditClient credits = mock(CreditClient.class);
    private final JavaLlmBillingService billing = new JavaLlmBillingService(db, usage, credits);

    @Test
    void flagParsing() {
        assertTrue(JavaLlmBillingService.parseFlag("\"true\""));
        assertTrue(JavaLlmBillingService.parseFlag("true"));
        assertTrue(JavaLlmBillingService.parseFlag(" \"TRUE\" "));
        assertFalse(JavaLlmBillingService.parseFlag("\"false\""));
        assertFalse(JavaLlmBillingService.parseFlag("false"));
        assertFalse(JavaLlmBillingService.parseFlag("\"yes\""));
        assertFalse(JavaLlmBillingService.parseFlag(""));
        assertFalse(JavaLlmBillingService.parseFlag(null));
    }

    @Test
    void absentSettingIsOff() {
        assertFalse(billing.isEnabled());
    }

    @Test
    void settingIsCachedAndAReadErrorKeepsTheLastValue() {
        db.setting = "\"true\"";
        assertTrue(billing.isEnabled());
        db.setting = "\"false\"";
        assertTrue(billing.isEnabled(), "cached for 60 s");
        assertEquals(1, db.settingReads.get());

        JavaLlmBillingService broken = new JavaLlmBillingService(db, usage, credits);
        db.settingError = new IllegalStateException("db down");
        assertFalse(broken.isEnabled(), "never read = off");
    }

    @Test
    void recordsPricesAndChargesIdempotentlyOnTheUsageRow() {
        db.prices.put(SONNET, new Object[]{new BigDecimal("3.000000"), new BigDecimal("15.000000")});
        when(usage.recordUsage(ApiProvider.OPENAI, RequestType.AGENT, SONNET, 12000, 2000, INSTITUTE, USER))
                .thenReturn(AiTokenUsage.builder().id(ROW).build());
        when(credits.deductAttributedTokenUsage(anyString(), anyString(), anyString(), anyInt(), anyInt(),
                anyString(), any(), anyString(), any(), anyString(), any(), anyString(), anyBoolean(), any()))
                .thenReturn(true);

        billing.recordAndCharge(RequestType.AGENT, SONNET, 12000, 2000, INSTITUTE, USER);

        assertEquals(1, db.updates.size());
        Object[] u = db.updates.get(0);
        assertEquals(0, new BigDecimal("0.000003").compareTo((BigDecimal) u[0]), "per-token input price");
        assertEquals(0, new BigDecimal("0.000015").compareTo((BigDecimal) u[1]), "per-token output price");
        assertEquals(0, new BigDecimal("0.066").compareTo((BigDecimal) u[2]), "12000*3e-6 + 2000*15e-6");
        assertEquals(ROW, u[3]);
        verify(credits).deductAttributedTokenUsage(INSTITUTE.toString(), "agent", SONNET, 12000, 2000,
                ROW.toString(), USER.toString(), "ADMIN", null, "agent using " + SONNET, null,
                "java-llm-usage:" + ROW, false,
                MeteringFields.user("admin_agent", MeteringFields.SURFACE_ADMIN_APP).build());
    }

    @Test
    void noUserIsASystemCharge() {
        when(usage.recordUsage(any(), any(), any(), anyInt(), anyInt(), any(), any()))
                .thenReturn(AiTokenUsage.builder().id(ROW).build());
        billing.recordAndCharge(RequestType.AGENT, SONNET, 10, 5, INSTITUTE, null);
        verify(credits).deductAttributedTokenUsage(eq(INSTITUTE.toString()), eq("agent"), eq(SONNET), eq(10), eq(5),
                eq(ROW.toString()), isNull(), eq("SYSTEM"), isNull(), anyString(), isNull(), eq("java-llm-usage:" + ROW),
                eq(false), eq(MeteringFields.system("admin_agent").build()));
    }

    @Test
    void unknownModelIsStillChargedButLeftUnpriced() {
        when(usage.recordUsage(any(), any(), any(), anyInt(), anyInt(), any(), any()))
                .thenReturn(AiTokenUsage.builder().id(ROW).build());
        billing.recordAndCharge(RequestType.AGENT, "x/not-in-registry", 10, 5, INSTITUTE, USER);
        assertTrue(db.updates.isEmpty());
        verify(credits).deductAttributedTokenUsage(anyString(), anyString(), eq("x/not-in-registry"), anyInt(), anyInt(),
                anyString(), any(), anyString(), any(), anyString(), any(), anyString(), eq(false), any());
    }

    @Test
    void noInstituteMeansNoCharge() {
        db.prices.put(SONNET, new Object[]{new BigDecimal("3"), new BigDecimal("15")});
        when(usage.recordUsage(any(), any(), any(), anyInt(), anyInt(), any(), any()))
                .thenReturn(AiTokenUsage.builder().id(ROW).build());
        billing.recordAndCharge(RequestType.AGENT, SONNET, 10, 5, null, USER);
        assertEquals(1, db.updates.size(), "still priced");
        verify(credits, never()).deductAttributedTokenUsage(any(), any(), any(), anyInt(), anyInt(),
                any(), any(), any(), any(), any(), any(), any(), anyBoolean(), any());
    }

    @Test
    void anUnsavedRowChargesNothing() {
        when(usage.recordUsage(any(), any(), any(), anyInt(), anyInt(), any(), any())).thenReturn(null);
        billing.recordAndCharge(RequestType.AGENT, SONNET, 10, 5, INSTITUTE, USER);
        assertTrue(db.updates.isEmpty());
        verify(credits, never()).deductAttributedTokenUsage(any(), any(), any(), anyInt(), anyInt(),
                any(), any(), any(), any(), any(), any(), any(), anyBoolean(), any());
    }

    @Test
    void theCallersUseCaseIsReportedToMeteringOnly() {
        when(usage.recordUsage(any(), any(), any(), anyInt(), anyInt(), any(), any()))
                .thenReturn(AiTokenUsage.builder().id(ROW).build());
        billing.recordAndCharge(RequestType.AGENT, SONNET, 10, 5, INSTITUTE, USER, "workflow_draft");
        // Same ledger fields as an admin_agent charge; only the metering label differs.
        verify(credits).deductAttributedTokenUsage(INSTITUTE.toString(), "agent", SONNET, 10, 5,
                ROW.toString(), USER.toString(), "ADMIN", null, "agent using " + SONNET, null,
                "java-llm-usage:" + ROW, false,
                MeteringFields.user("workflow_draft", MeteringFields.SURFACE_ADMIN_APP).build());
    }
}
