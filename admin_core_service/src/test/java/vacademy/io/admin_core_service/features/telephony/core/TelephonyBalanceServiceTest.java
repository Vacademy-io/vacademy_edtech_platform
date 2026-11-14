package vacademy.io.admin_core_service.features.telephony.core;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.ResourceAccessException;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.telephony.enums.ConfigRole;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.InstituteTelephonyConfig;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.InstituteTelephonyConfigRepository;
import vacademy.io.admin_core_service.features.telephony.providers.exotel.ExotelHttpClient;
import vacademy.io.admin_core_service.features.telephony.providers.plivo.PlivoHttpClient;
import vacademy.io.admin_core_service.features.telephony.spi.dto.ProviderCredentials;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Live Exotel/Plivo balances for the portal: shapes, no secrets in rows, errors, and the cache. */
class TelephonyBalanceServiceTest {

    private final InstituteTelephonyConfigRepository repo = mock(InstituteTelephonyConfigRepository.class);
    private final TelephonyConfigCache cache = mock(TelephonyConfigCache.class);
    private final ExotelHttpClient exotel = mock(ExotelHttpClient.class);
    private final PlivoHttpClient plivo = mock(PlivoHttpClient.class);
    private final InstituteRepository institutes = mock(InstituteRepository.class);
    private TelephonyBalanceService service;

    @BeforeEach
    void setUp() {
        service = new TelephonyBalanceService();
        ReflectionTestUtils.setField(service, "configRepo", repo);
        ReflectionTestUtils.setField(service, "configCache", cache);
        ReflectionTestUtils.setField(service, "exotelHttp", exotel);
        ReflectionTestUtils.setField(service, "plivoHttp", plivo);
        ReflectionTestUtils.setField(service, "instituteRepository", institutes);
        when(institutes.findAllById(any())).thenReturn(List.of());
    }

    private static InstituteTelephonyConfig cfg(String id, String institute, String provider, String accountId) {
        InstituteTelephonyConfig c = new InstituteTelephonyConfig();
        c.setId(id);
        c.setInstituteId(institute);
        c.setProviderType(provider);
        c.setApiAccountId(accountId);
        c.setRole(ConfigRole.PRIMARY);
        c.setEnabled(true);
        return c;
    }

    private void resolves(InstituteTelephonyConfig c) {
        ProviderCredentials creds = ProviderCredentials.builder().providerType(c.getProviderType())
                .accountId(c.getApiAccountId()).username("user").password("secret-token")
                .secrets(Map.of("authToken", "secret-token")).config(Map.of("authId", c.getApiAccountId())).build();
        when(cache.get(c.getInstituteId())).thenReturn(Optional.of(
                TelephonyConfigCache.Resolved.builder().config(c).credentials(creds).build()));
    }

    @Test
    void parsesBothExotelShapesAndPlivoCredits() {
        assertEquals(618.3, TelephonyBalanceParser.exotelAmount(Map.of("Balance", Map.of("Amount", 618.3))));
        assertEquals("1543.75", TelephonyBalanceParser.exotelAmount(
                Map.of("Account", Map.of("BalanceData", Map.of("Balance", "1543.75", "Currency", "inr")))));
        assertEquals("INR", TelephonyBalanceParser.exotelCurrency(
                Map.of("Account", Map.of("BalanceData", Map.of("Currency", "inr")))));
        assertEquals("INR", TelephonyBalanceParser.exotelCurrency(Map.of()));
        assertEquals(1.809, TelephonyBalanceParser.plivoCashCredits(Map.of("cash_credits", "1.80900")));
        assertNull(TelephonyBalanceParser.plivoCashCredits(Map.of("cash_credits", "n/a")));
        assertNull(TelephonyBalanceParser.exotelAmount(Map.of("Other", 1)));
    }

    @Test
    void exotelRowShowsTheSidAndAmount() {
        InstituteTelephonyConfig c = cfg("c1", "i1", ProviderType.EXOTEL, "school1");
        resolves(c);
        when(exotel.getBalanceRaw(any())).thenReturn("{\"Balance\":{\"Amount\":618.3}}");
        Map<String, Object> row = service.check(c, "Fixture School");
        assertEquals("ok", row.get("status"));
        assertEquals(618.3, row.get("balance"));
        assertEquals("INR", row.get("currency"));
        assertEquals("school1", row.get("account"));
        assertEquals("Fixture School", row.get("institute_name"));
    }

    @Test
    void plivoRowMasksTheAuthId() {
        InstituteTelephonyConfig c = cfg("c2", "i2", ProviderType.PLIVO, "SAABCDEFGH1234");
        resolves(c);
        when(plivo.getAccountRaw(any())).thenReturn("{\"cash_credits\":\"12.50000\",\"auto_recharge\":false}");
        Map<String, Object> row = service.check(c, null);
        assertEquals(12.5, row.get("balance"));
        assertEquals("USD", row.get("currency"));
        assertEquals("subaccount …1234", row.get("account"));
        assertFalse(row.toString().contains("SAABCDEFGH1234"));
    }

    @Test
    void failuresAreRowsWithoutProviderText() {
        InstituteTelephonyConfig c = cfg("c3", "i3", ProviderType.EXOTEL, "school3");
        resolves(c);
        when(exotel.getBalanceRaw(any())).thenThrow(HttpClientErrorException.create(HttpStatus.UNAUTHORIZED,
                "Unauthorized", null, "owner@example.com".getBytes(StandardCharsets.UTF_8), StandardCharsets.UTF_8));
        Map<String, Object> row = service.check(c, null);
        assertEquals("error", row.get("status"));
        assertEquals("Exotel refused this institute's saved credentials. They may have been changed in Exotel.", row.get("message"));
        assertFalse(row.toString().contains("owner@example.com"));
        assertFalse(row.toString().contains("secret-token"));

        // doThrow/doReturn: re-stubbing with when() would call the stub that already throws.
        doThrow(new ResourceAccessException("connect timed out")).when(exotel).getBalanceRaw(any());
        assertEquals("Could not reach Exotel", service.check(c, null).get("message"));

        doReturn("{\"Unexpected\":true}").when(exotel).getBalanceRaw(any());
        assertEquals("Exotel's response had no balance", service.check(c, null).get("message"));
    }

    @Test
    void anotherRowsCredentialsAreNeverUsed() {
        InstituteTelephonyConfig aiLine = cfg("ai", "i4", ProviderType.PLIVO, "SAAILINE0001");
        aiLine.setRole(ConfigRole.AI_VOICE);
        InstituteTelephonyConfig primary = cfg("primary", "i4", ProviderType.PLIVO, "SAPRIMARY0002");
        // getForAi fell back to the primary line, so the AI row has no credentials of its own.
        when(cache.getForAi("i4")).thenReturn(Optional.of(TelephonyConfigCache.Resolved.builder()
                .config(primary).credentials(ProviderCredentials.builder().build()).build()));
        Map<String, Object> row = service.check(aiLine, null);
        assertEquals("This institute's saved credentials could not be read", row.get("message"));
        verify(plivo, times(0)).getAccountRaw(any());
    }

    @Test
    void plivoSubaccountsShowTheSharedMasterBalanceOnce() {
        Map<String, Object> exotelRow = Map.of("vendor", "Exotel", "status", "ok", "balance", 50.0);
        Map<String, Object> failed = new java.util.HashMap<>(Map.of("vendor", "Plivo", "status", "error", "institute_id", "i9"));
        List<Map<String, Object>> rows = TelephonyBalanceService.collapsePlivo(List.of(
                exotelRow,
                new java.util.HashMap<>(Map.of("vendor", "Plivo", "status", "ok", "balance", 19.1, "institute_id", "i1")),
                new java.util.HashMap<>(Map.of("vendor", "Plivo", "status", "ok", "balance", 19.1, "institute_id", "i2")),
                failed));
        assertEquals(3, rows.size());
        Map<String, Object> master = rows.get(0);
        assertEquals(19.1, master.get("balance"));
        assertEquals(2, master.get("shared_by"));
        assertNull(master.get("institute_id"));
        assertEquals("Vacademy master account", master.get("account"));
        assertEquals(exotelRow, rows.get(1));
        assertEquals(failed, rows.get(2));
    }

    @Test
    void cachesAndLimitsRefreshes() {
        InstituteTelephonyConfig c = cfg("c5", "i5", ProviderType.EXOTEL, "school5");
        InstituteTelephonyConfig disabled = cfg("c6", "i6", ProviderType.EXOTEL, "school6");
        disabled.setEnabled(false);
        resolves(c);
        when(repo.findByProviderType(ProviderType.EXOTEL)).thenReturn(List.of(c, disabled));
        when(repo.findByProviderType(ProviderType.PLIVO)).thenReturn(List.of());
        when(exotel.getBalanceRaw(any())).thenReturn("{\"Balance\":{\"Amount\":5}}");
        AtomicLong now = new AtomicLong(1_000_000);
        service.clock = now::get;

        assertEquals(1, service.balances(false).size(), "disabled accounts are skipped");
        now.addAndGet(5_000);
        service.balances(true);
        verify(exotel, times(1)).getBalanceRaw(any());
        now.addAndGet(TelephonyBalanceService.MIN_REFRESH.toMillis());
        service.balances(true);
        verify(exotel, times(2)).getBalanceRaw(any());
        now.addAndGet(60_000);
        service.balances(false);
        verify(exotel, times(2)).getBalanceRaw(any());
    }
}
