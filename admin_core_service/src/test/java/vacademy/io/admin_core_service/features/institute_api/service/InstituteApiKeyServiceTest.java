package vacademy.io.admin_core_service.features.institute_api.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.institute_api.dto.ApiKeyVerifyResponse;
import vacademy.io.admin_core_service.features.institute_api.dto.IssueApiKeyRequest;
import vacademy.io.admin_core_service.features.institute_api.entity.InstituteApiAccess;
import vacademy.io.admin_core_service.features.institute_api.entity.InstituteApiKey;
import vacademy.io.admin_core_service.features.institute_api.repository.InstituteApiAccessRepository;
import vacademy.io.admin_core_service.features.institute_api.repository.InstituteApiKeyRepository;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class InstituteApiKeyServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final Instant NOW = Instant.parse("2026-10-01T10:00:00Z");

    private InstituteApiKeyRepository keyRepository;
    private InstituteApiAccessRepository accessRepository;
    private InstituteApiAuditWriter auditWriter;
    private InstituteApiKeyService service;

    @BeforeEach
    void setUp() {
        keyRepository = mock(InstituteApiKeyRepository.class);
        accessRepository = mock(InstituteApiAccessRepository.class);
        auditWriter = mock(InstituteApiAuditWriter.class);
        service = new InstituteApiKeyService(keyRepository, accessRepository, auditWriter);
        service.setClock(Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private static CustomUserDetails admin() {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("admin-1");
        dto.setUsername("admin@school.test");
        dto.setFullName("School Admin");
        dto.setAuthorities(List.of("ADMIN"));
        return new CustomUserDetails(dto);
    }

    private static InstituteApiAccess access(boolean enabled) {
        InstituteApiAccess a = InstituteApiAccess.defaults(INSTITUTE, "evaluation");
        a.setEnabled(enabled);
        a.setUpdatedBy("staff");
        return a;
    }

    private static IssueApiKeyRequest request(String name) {
        return IssueApiKeyRequest.builder().name(name).build();
    }

    private void accessEnabled() {
        when(accessRepository.findForUpdate(INSTITUTE, "evaluation")).thenReturn(Optional.of(access(true)));
    }

    // ── issue ────────────────────────────────────────────────────────────────

    @Test
    void issueStoresOnlyTheHashAndReturnsPlaintextOnce() {
        accessEnabled();
        InstituteApiKeyService.IssuedKey issued =
                service.issue(INSTITUTE, request("  ERP prod  "), admin(), InstituteApiKey.VIA_DASHBOARD);

        ArgumentCaptor<InstituteApiKey> saved = ArgumentCaptor.forClass(InstituteApiKey.class);
        verify(keyRepository).save(saved.capture());
        InstituteApiKey row = saved.getValue();

        String plaintext = issued.plaintext();
        assertTrue(plaintext.matches("^vak_eval_[0-9a-f]{48}$"));
        assertEquals(ApiKeySecrets.sha256Hex(plaintext), row.getKeyHash());
        assertEquals(plaintext.substring(0, 16), row.getKeyPrefix());
        assertEquals("ERP prod", row.getName());
        assertEquals(INSTITUTE, row.getInstituteId());
        assertArrayEquals(new String[]{"evaluation"}, row.getProducts());
        assertArrayEquals(new String[]{"evaluation:read", "evaluation:write"}, row.getScopes());
        assertEquals("ACTIVE", row.getStatus());
        assertEquals("admin-1", row.getCreatedBy());
        assertEquals("dashboard", row.getCreatedVia());
        assertEquals(NOW, row.getCreatedAt());
        assertTrue(row.getId().matches("^[0-9a-f-]{36}$"), row.getId());
        assertEquals(row.getId(), issued.key().getId());
        assertNull(row.getExpiresAt());
        assertNull(row.getDailyCopyCap());
    }

    @Test
    void issueAuditsWithoutThePlaintext() {
        accessEnabled();
        InstituteApiKeyService.IssuedKey issued =
                service.issue(INSTITUTE, request("ERP"), admin(), InstituteApiKey.VIA_SUPER_ADMIN);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> payload = ArgumentCaptor.forClass(Map.class);
        ArgumentCaptor<String> description = ArgumentCaptor.forClass(String.class);
        verify(auditWriter).record(eq(INSTITUTE), any(), eq("INSTITUTE_API_KEY"), anyString(), eq("ISSUE"),
                description.capture(), payload.capture(), isNull());
        String all = payload.getValue().toString() + description.getValue();
        assertFalse(all.contains(issued.plaintext()), "audit must never hold the key");
        assertFalse(all.contains(ApiKeySecrets.sha256Hex(issued.plaintext())), "audit must not hold the hash");
        assertEquals("super_admin", payload.getValue().get("created_via"));
    }

    @Test
    void issueKeepsRequestedScopesExpiryAndCap() {
        accessEnabled();
        IssueApiKeyRequest req = IssueApiKeyRequest.builder()
                .name("Vendor")
                .scopes(List.of("evaluation:read", "EVALUATION:REVIEW", "evaluation:read"))
                .expiresAt("2027-03-31T00:00:00Z")
                .dailyCopyCap(500)
                .build();
        service.issue(INSTITUTE, req, admin(), InstituteApiKey.VIA_DASHBOARD);
        ArgumentCaptor<InstituteApiKey> saved = ArgumentCaptor.forClass(InstituteApiKey.class);
        verify(keyRepository).save(saved.capture());
        assertArrayEquals(new String[]{"evaluation:read", "evaluation:review"}, saved.getValue().getScopes());
        assertEquals(Instant.parse("2027-03-31T00:00:00Z"), saved.getValue().getExpiresAt());
        assertEquals(500, saved.getValue().getDailyCopyCap());
    }

    @Test
    void issueRefusedWhenProductNotEnabled() {
        when(accessRepository.findForUpdate(INSTITUTE, "evaluation")).thenReturn(Optional.of(access(false)));
        VacademyException ex = assertThrows(VacademyException.class,
                () -> service.issue(INSTITUTE, request("x"), admin(), InstituteApiKey.VIA_DASHBOARD));
        assertEquals(HttpStatus.FORBIDDEN, ex.getStatus());
        verify(keyRepository, never()).save(any());
        verifyNoInteractions(auditWriter);
    }

    @Test
    void issueRefusedWhenNoAccessRow() {
        when(accessRepository.findForUpdate(INSTITUTE, "evaluation")).thenReturn(Optional.empty());
        VacademyException ex = assertThrows(VacademyException.class,
                () -> service.issue(INSTITUTE, request("x"), admin(), InstituteApiKey.VIA_DASHBOARD));
        assertEquals(HttpStatus.FORBIDDEN, ex.getStatus());
        verify(keyRepository, never()).save(any());
    }

    @Test
    void issueRefusedAtFiftyUsableKeys() {
        accessEnabled();
        when(keyRepository.countUsable(INSTITUTE, NOW)).thenReturn(50L);
        VacademyException ex = assertThrows(VacademyException.class,
                () -> service.issue(INSTITUTE, request("x"), admin(), InstituteApiKey.VIA_DASHBOARD));
        assertEquals(HttpStatus.CONFLICT, ex.getStatus());
        verify(keyRepository, never()).save(any());
    }

    @Test
    void issueAllowedAtFortyNineKeys() {
        accessEnabled();
        when(keyRepository.countUsable(INSTITUTE, NOW)).thenReturn(49L);
        service.issue(INSTITUTE, request("x"), admin(), InstituteApiKey.VIA_DASHBOARD);
        verify(keyRepository).save(any());
    }

    @Test
    void issueValidatesInputBeforeTouchingTheDatabase() {
        assertBadRequest(() -> service.issue(INSTITUTE, request("  "), admin(), "dashboard"));
        assertBadRequest(() -> service.issue(INSTITUTE, request("x".repeat(121)), admin(), "dashboard"));
        assertBadRequest(() -> service.issue(INSTITUTE,
                IssueApiKeyRequest.builder().name("x").scopes(List.of("admin:all")).build(), admin(), "dashboard"));
        assertBadRequest(() -> service.issue(INSTITUTE,
                IssueApiKeyRequest.builder().name("x").expiresAt("2026-09-30T00:00:00Z").build(), admin(), "dashboard"));
        assertBadRequest(() -> service.issue(INSTITUTE,
                IssueApiKeyRequest.builder().name("x").expiresAt("tomorrow").build(), admin(), "dashboard"));
        assertBadRequest(() -> service.issue(INSTITUTE,
                IssueApiKeyRequest.builder().name("x").dailyCopyCap(0).build(), admin(), "dashboard"));
        assertBadRequest(() -> service.issue(" ", request("x"), admin(), "dashboard"));
        verifyNoInteractions(accessRepository);
        verify(keyRepository, never()).save(any());
    }

    private static void assertBadRequest(org.junit.jupiter.api.function.Executable call) {
        VacademyException ex = assertThrows(VacademyException.class, call);
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
    }

    // ── verify ───────────────────────────────────────────────────────────────

    private static InstituteApiKey key(String status, Instant expiresAt) {
        return InstituteApiKey.builder()
                .id("key-1").instituteId(INSTITUTE).name("ERP")
                .keyPrefix("vak_eval_0123456").keyHash(ApiKeySecrets.sha256Hex("k"))
                .products(new String[]{"evaluation"})
                .scopes(new String[]{"evaluation:read", "evaluation:write"})
                .dailyCopyCap(300).status(status).expiresAt(expiresAt)
                .createdBy("admin-1").createdVia("dashboard").createdAt(NOW.minusSeconds(3600))
                .build();
    }

    @Test
    void verifyRejectsMalformedHashWith400() {
        assertBadRequest(() -> service.verify("vak_eval_abc", null));
        assertBadRequest(() -> service.verify(null, null));
        verifyNoInteractions(keyRepository);
    }

    @Test
    void verifyUnknownRevokedOrExpiredIsEmpty() {
        String hash = ApiKeySecrets.sha256Hex("k");
        when(keyRepository.findByKeyHash(hash)).thenReturn(Optional.empty());
        assertTrue(service.verify(hash, null).isEmpty());

        when(keyRepository.findByKeyHash(hash)).thenReturn(Optional.of(key("REVOKED", null)));
        assertTrue(service.verify(hash, null).isEmpty());

        when(keyRepository.findByKeyHash(hash)).thenReturn(Optional.of(key("ACTIVE", NOW)));
        assertTrue(service.verify(hash, null).isEmpty(), "expires_at == now is expired");

        when(keyRepository.findByKeyHash(hash)).thenReturn(Optional.of(key("ACTIVE", NOW.minusSeconds(1))));
        assertTrue(service.verify(hash, null).isEmpty());

        verify(keyRepository, never()).touchLastUsed(anyString(), any());
    }

    @Test
    void verifyLooksUpByLowercasedHash() {
        String hash = ApiKeySecrets.sha256Hex("k");
        when(keyRepository.findByKeyHash(hash)).thenReturn(Optional.of(key("ACTIVE", null)));
        assertTrue(service.verify(hash.toUpperCase(), null).isPresent());
    }

    @Test
    void verifyReturnsKeyAndAccessLimits() {
        String hash = ApiKeySecrets.sha256Hex("k");
        when(keyRepository.findByKeyHash(hash)).thenReturn(Optional.of(key("ACTIVE", NOW.plusSeconds(60))));
        InstituteApiAccess a = access(true);
        a.setSegment("school");
        a.setRateTier("high");
        a.setDailyCopyQuota(3000);
        a.setCopyLaneCap(4);
        a.setCreditLimit(new BigDecimal("500.00"));
        a.setFireWorkflowEvents(true);
        when(accessRepository.findByInstituteIdAndProduct(INSTITUTE, "evaluation")).thenReturn(Optional.of(a));

        ApiKeyVerifyResponse r = service.verify(hash, null).orElseThrow();
        assertEquals("key-1", r.keyId());
        assertEquals(INSTITUTE, r.instituteId());
        assertEquals("ERP", r.name());
        assertEquals(List.of("evaluation"), r.products());
        assertEquals(List.of("evaluation:read", "evaluation:write"), r.scopes());
        assertEquals("ACTIVE", r.status());
        assertEquals("2026-10-01T10:01:00Z", r.expiresAt());
        assertEquals(300, r.dailyCopyCap());
        assertEquals("school", r.segment());
        assertEquals("high", r.rateTier());
        assertEquals(3000, r.dailyCopyQuota());
        assertEquals(5000, r.dailyIdentifyPages());
        assertEquals(200, r.dailyRubricGenerations());
        assertEquals(4, r.copyLaneCap());
        assertNull(r.typedLaneCap());
        assertEquals(new BigDecimal("500.00"), r.creditLimit());
        assertTrue(r.fireWorkflowEvents());
        assertTrue(r.accessEnabled());
    }

    @Test
    void verifyWithoutAccessRowReportsDisabledWithDefaults() {
        String hash = ApiKeySecrets.sha256Hex("k");
        when(keyRepository.findByKeyHash(hash)).thenReturn(Optional.of(key("ACTIVE", null)));
        when(accessRepository.findByInstituteIdAndProduct(INSTITUTE, "evaluation")).thenReturn(Optional.empty());
        ApiKeyVerifyResponse r = service.verify(hash, null).orElseThrow();
        assertFalse(r.accessEnabled());
        assertEquals("standard", r.rateTier());
        assertEquals(2000, r.dailyCopyQuota());
        assertEquals(BigDecimal.ZERO, r.creditLimit());
        assertNull(r.expiresAt());
    }

    @Test
    void verifyResponseSerialisesEveryContractFieldInSnakeCase() throws Exception {
        ApiKeyVerifyResponse r = InstituteApiKeyService.toVerifyResponse(key("ACTIVE", null), null);
        JsonNode json = new ObjectMapper().valueToTree(r);
        List<String> fields = List.of("key_id", "institute_id", "name", "products", "scopes", "status",
                "expires_at", "daily_copy_cap", "segment", "rate_tier", "daily_copy_quota",
                "daily_identify_pages", "daily_rubric_generations", "copy_lane_cap", "typed_lane_cap",
                "credit_limit", "fire_workflow_events", "access_enabled");
        for (String f : fields) {
            assertTrue(json.has(f), "missing " + f + " in " + json);
        }
        assertEquals(fields.size(), json.size(), "no extra fields: " + json);
        assertTrue(json.get("expires_at").isNull());
        assertTrue(json.get("segment").isNull());
    }

    @Test
    void lastUsedIsWrittenAtMostOncePerMinutePerKey() {
        String hash = ApiKeySecrets.sha256Hex("k");
        when(keyRepository.findByKeyHash(hash)).thenReturn(Optional.of(key("ACTIVE", null)));

        service.verify(hash, null);
        service.verify(hash, null);
        service.setClock(Clock.fixed(NOW.plus(Duration.ofSeconds(59)), ZoneOffset.UTC));
        service.verify(hash, null);
        verify(keyRepository, times(1)).touchLastUsed(eq("key-1"), any());

        service.setClock(Clock.fixed(NOW.plus(Duration.ofSeconds(60)), ZoneOffset.UTC));
        service.verify(hash, "203.0.113.9");
        verify(keyRepository).touchLastUsedWithIp("key-1", NOW.plus(Duration.ofSeconds(60)), "203.0.113.9");
    }

    @Test
    void lastUsedStampFailureDoesNotFailVerify() {
        String hash = ApiKeySecrets.sha256Hex("k");
        when(keyRepository.findByKeyHash(hash)).thenReturn(Optional.of(key("ACTIVE", null)));
        when(keyRepository.touchLastUsed(anyString(), any())).thenThrow(new RuntimeException("db down"));
        assertTrue(service.verify(hash, null).isPresent());
    }

    @Test
    void claimLastUsedWriteIsPerKey() {
        assertTrue(service.claimLastUsedWrite("a", 0));
        assertTrue(service.claimLastUsedWrite("b", 1));
        assertFalse(service.claimLastUsedWrite("a", 59_999));
        assertTrue(service.claimLastUsedWrite("a", 60_000));
    }

    // ── revoke ───────────────────────────────────────────────────────────────

    @Test
    void revokeActiveKeyAudits() {
        when(keyRepository.findByIdAndInstituteId("key-1", INSTITUTE)).thenReturn(Optional.of(key("ACTIVE", null)));
        when(keyRepository.revoke("key-1", INSTITUTE, NOW, "admin-1")).thenReturn(1);
        assertEquals(InstituteApiKeyService.RevokeOutcome.REVOKED, service.revoke(INSTITUTE, "key-1", admin()));
        verify(auditWriter).record(eq(INSTITUTE), any(), eq("INSTITUTE_API_KEY"), eq("key-1"), eq("REVOKE"),
                anyString(), anyMap(), isNull());
    }

    @Test
    void revokeOtherInstitutesKeyIsNotFound() {
        when(keyRepository.findByIdAndInstituteId("key-1", INSTITUTE)).thenReturn(Optional.empty());
        assertEquals(InstituteApiKeyService.RevokeOutcome.NOT_FOUND, service.revoke(INSTITUTE, "key-1", admin()));
        verify(keyRepository, never()).revoke(anyString(), anyString(), any(), anyString());
        verifyNoInteractions(auditWriter);
    }

    @Test
    void revokeAlreadyRevokedIsNoOp() {
        when(keyRepository.findByIdAndInstituteId("key-1", INSTITUTE)).thenReturn(Optional.of(key("REVOKED", null)));
        assertEquals(InstituteApiKeyService.RevokeOutcome.ALREADY_REVOKED,
                service.revoke(INSTITUTE, "key-1", admin()));
        verifyNoInteractions(auditWriter);
    }

    @Test
    void revokeAllRevokesActiveKeysAndAuditsOnce() {
        when(keyRepository.findActiveIds(INSTITUTE)).thenReturn(List.of("k1", "k2"));
        when(keyRepository.revokeAllActive(INSTITUTE, NOW, "admin-1")).thenReturn(2);
        assertEquals(2, service.revokeAll(INSTITUTE, admin(), "leaked in a repo"));
        verify(auditWriter, times(1)).record(eq(INSTITUTE), any(), eq("INSTITUTE_API_KEY"), isNull(),
                eq("REVOKE_ALL"), anyString(), anyMap(), isNull());
    }

    @Test
    void revokeAllWithNoActiveKeysWritesNothing() {
        when(keyRepository.findActiveIds(INSTITUTE)).thenReturn(List.of());
        assertEquals(0, service.revokeAll(INSTITUTE, admin(), null));
        verify(keyRepository, never()).revokeAllActive(anyString(), any(), anyString());
        verifyNoInteractions(auditWriter);
    }
}
