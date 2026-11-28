package vacademy.io.admin_core_service.features.institute_api.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute_api.entity.InstituteApiAccess;
import vacademy.io.admin_core_service.features.institute_api.entity.InstituteApiKey;
import vacademy.io.admin_core_service.features.institute_api.repository.InstituteApiAccessRepository;
import vacademy.io.admin_core_service.features.institute_api.repository.InstituteApiKeyRepository;
import vacademy.io.admin_core_service.features.institute_api.repository.InstituteApiUsageRepository;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

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
import static org.mockito.Mockito.when;

class InstituteApiAccessServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final Instant NOW = Instant.parse("2026-10-01T10:00:00Z");
    private static final ObjectMapper JSON = new ObjectMapper();

    private InstituteApiAccessRepository accessRepository;
    private InstituteApiKeyRepository keyRepository;
    private InstituteApiUsageRepository usageRepository;
    private InstituteRepository instituteRepository;
    private InstituteApiAuditWriter auditWriter;
    private InstituteApiAccessService service;

    @BeforeEach
    void setUp() {
        accessRepository = mock(InstituteApiAccessRepository.class);
        keyRepository = mock(InstituteApiKeyRepository.class);
        usageRepository = mock(InstituteApiUsageRepository.class);
        instituteRepository = mock(InstituteRepository.class);
        auditWriter = mock(InstituteApiAuditWriter.class);
        service = new InstituteApiAccessService(accessRepository, keyRepository, usageRepository,
                instituteRepository, auditWriter);
        service.setClock(Clock.fixed(NOW, ZoneOffset.UTC));
        when(instituteRepository.existsById(INSTITUTE)).thenReturn(true);
        when(accessRepository.save(any(InstituteApiAccess.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    private static CustomUserDetails staff() {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("staff-1");
        dto.setUsername("ops@vacademy.test");
        dto.setFullName("Ops");
        dto.setAuthorities(List.of());
        return new CustomUserDetails(dto);
    }

    private static JsonNode body(String json) throws Exception {
        return JSON.readTree(json);
    }

    private static InstituteApiAccess row() {
        InstituteApiAccess a = InstituteApiAccess.defaults(INSTITUTE, "evaluation");
        a.setUpdatedBy("someone");
        return a;
    }

    // ── applyPatch ───────────────────────────────────────────────────────────

    @Test
    void segmentPresetSetsCopyQuotaOnChange() throws Exception {
        InstituteApiAccess a = row();
        InstituteApiAccessService.applyPatch(a, body("{\"segment\":\"University\"}"), false);
        assertEquals("university", a.getSegment());
        assertEquals(6000, a.getDailyCopyQuota());
        InstituteApiAccessService.applyPatch(a, body("{\"segment\":\"upsc\"}"), false);
        assertEquals(10000, a.getDailyCopyQuota());
        InstituteApiAccessService.applyPatch(a, body("{\"segment\":null}"), false);
        assertNull(a.getSegment());
        assertEquals(2000, a.getDailyCopyQuota());
    }

    @Test
    void explicitQuotaWinsOverPresetAndUnchangedSegmentKeepsTunedQuota() throws Exception {
        InstituteApiAccess a = row();
        InstituteApiAccessService.applyPatch(a, body("{\"segment\":\"school\",\"daily_copy_quota\":4500}"), false);
        assertEquals(4500, a.getDailyCopyQuota());
        // Same segment again (e.g. the UI re-sends the whole form): quota untouched.
        InstituteApiAccessService.applyPatch(a, body("{\"segment\":\"school\",\"enabled\":true}"), false);
        assertEquals(4500, a.getDailyCopyQuota());
        assertTrue(a.isEnabled());
    }

    @Test
    void missingFieldsKeepValuesAndNullClearsLaneCaps() throws Exception {
        InstituteApiAccess a = row();
        InstituteApiAccessService.applyPatch(a, body("{\"copy_lane_cap\":4,\"typed_lane_cap\":6,"
                + "\"credit_limit\":250.5,\"rate_tier\":\"HIGH\",\"fire_workflow_events\":true,\"notes\":\" contract 12 \"}"),
                false);
        assertEquals(4, a.getCopyLaneCap());
        assertEquals(6, a.getTypedLaneCap());
        assertEquals(new BigDecimal("250.5"), a.getCreditLimit());
        assertEquals("high", a.getRateTier());
        assertTrue(a.isFireWorkflowEvents());
        assertEquals("contract 12", a.getNotes());

        InstituteApiAccessService.applyPatch(a, body("{\"copy_lane_cap\":null}"), false);
        assertNull(a.getCopyLaneCap());
        assertEquals(6, a.getTypedLaneCap());
        assertEquals("high", a.getRateTier());
    }

    @Test
    void invalidValueLeavesRowUntouched() throws Exception {
        InstituteApiAccess a = row();
        String[] bad = {
                "{\"enabled\":true,\"segment\":\"college\"}",
                "{\"enabled\":true,\"rate_tier\":\"gold\"}",
                "{\"enabled\":true,\"daily_copy_quota\":-1}",
                "{\"enabled\":true,\"daily_copy_quota\":1.5}",
                "{\"enabled\":true,\"copy_lane_cap\":0}",
                "{\"enabled\":true,\"credit_limit\":-5}",
                "{\"enabled\":true,\"credit_limit\":1.234}",
                "{\"enabled\":\"yes\"}",
                "{\"enabled\":true,\"segment\":5}",
        };
        for (String json : bad) {
            VacademyException ex = assertThrows(VacademyException.class,
                    () -> InstituteApiAccessService.applyPatch(a, body(json), false), json);
            assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus(), json);
            assertFalse(a.isEnabled(), "row changed by " + json);
        }
    }

    // ── update ───────────────────────────────────────────────────────────────

    @Test
    void updateCreatesRowWithPresetAndAudits() throws Exception {
        when(accessRepository.findForUpdate(INSTITUTE, "evaluation")).thenReturn(Optional.empty());
        InstituteApiAccess saved = service.update(INSTITUTE, "evaluation",
                body("{\"enabled\":true,\"segment\":\"school\",\"reason\":\"Pilot contract #7\"}"), staff());
        assertTrue(saved.isEnabled());
        assertEquals(3000, saved.getDailyCopyQuota());
        assertEquals("staff-1", saved.getUpdatedBy());
        assertEquals(NOW, saved.getUpdatedAt());
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> payload = ArgumentCaptor.forClass(Map.class);
        verify(auditWriter).record(eq(INSTITUTE), any(), eq("INSTITUTE_API_ACCESS"), eq("inst-1:evaluation"),
                eq("CREATE"), anyString(), payload.capture(), isNull());
        assertEquals("Pilot contract #7", payload.getValue().get("reason"));
    }

    @Test
    void updateExistingRowRecordsBefore() throws Exception {
        InstituteApiAccess existing = row();
        existing.setEnabled(true);
        when(accessRepository.findForUpdate(INSTITUTE, "evaluation")).thenReturn(Optional.of(existing));
        service.update(INSTITUTE, "evaluation", body("{\"enabled\":false,\"reason\":\"unpaid\"}"), staff());
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> before = ArgumentCaptor.forClass(Map.class);
        verify(auditWriter).record(eq(INSTITUTE), any(), eq("INSTITUTE_API_ACCESS"), anyString(),
                eq("UPDATE"), anyString(), anyMap(), before.capture());
        assertEquals(true, before.getValue().get("enabled"));
        assertFalse(existing.isEnabled());
    }

    @Test
    void updateRequiresReasonKnownProductAndInstitute() throws Exception {
        VacademyException noReason = assertThrows(VacademyException.class,
                () -> service.update(INSTITUTE, "evaluation", body("{\"enabled\":true}"), staff()));
        assertEquals(HttpStatus.BAD_REQUEST, noReason.getStatus());

        VacademyException badProduct = assertThrows(VacademyException.class,
                () -> service.update(INSTITUTE, "calling", body("{\"enabled\":true,\"reason\":\"x\"}"), staff()));
        assertEquals(HttpStatus.BAD_REQUEST, badProduct.getStatus());

        when(instituteRepository.existsById("nope")).thenReturn(false);
        VacademyException noInstitute = assertThrows(VacademyException.class,
                () -> service.update("nope", "evaluation", body("{\"enabled\":true,\"reason\":\"x\"}"), staff()));
        assertEquals(HttpStatus.NOT_FOUND, noInstitute.getStatus());

        verify(accessRepository, never()).save(any());
    }

    // ── bulk enable ──────────────────────────────────────────────────────────

    private static Institute institute(String id) {
        Institute i = new Institute();
        i.setId(id);
        return i;
    }

    @Test
    void bulkEnableEnablesKnownInstitutesAndReportsUnknown() {
        when(instituteRepository.findAllById(any())).thenReturn(List.of(institute("a"), institute("b")));
        InstituteApiAccess existingB = InstituteApiAccess.defaults("b", "evaluation");
        existingB.setSegment("upsc");
        existingB.setDailyCopyQuota(10000);
        existingB.setUpdatedBy("x");
        when(accessRepository.findForUpdate("a", "evaluation")).thenReturn(Optional.empty());
        when(accessRepository.findForUpdate("b", "evaluation")).thenReturn(Optional.of(existingB));

        Map<String, Object> out = service.bulkEnable(List.of("a", " b ", "zz", "a", ""), "evaluation",
                "school", "ERP vendor rollout", staff());

        assertEquals(List.of("a", "b"), out.get("enabled"));
        assertEquals(List.of("zz"), out.get("not_found"));
        assertEquals(2, out.get("count"));

        ArgumentCaptor<InstituteApiAccess> saved = ArgumentCaptor.forClass(InstituteApiAccess.class);
        verify(accessRepository, times(2)).save(saved.capture());
        List<InstituteApiAccess> rows = new ArrayList<>(saved.getAllValues());
        assertTrue(rows.stream().allMatch(InstituteApiAccess::isEnabled));
        assertTrue(rows.stream().allMatch(r -> "school".equals(r.getSegment()) && r.getDailyCopyQuota() == 3000));
        verify(auditWriter, times(2)).record(anyString(), any(), eq("INSTITUTE_API_ACCESS"), anyString(),
                eq("BULK_ENABLE"), anyString(), anyMap(), any());
    }

    @Test
    void bulkEnableWithoutSegmentKeepsExistingSegment() {
        when(instituteRepository.findAllById(any())).thenReturn(List.of(institute("b")));
        InstituteApiAccess existingB = InstituteApiAccess.defaults("b", "evaluation");
        existingB.setSegment("upsc");
        existingB.setDailyCopyQuota(12000);
        existingB.setUpdatedBy("x");
        when(accessRepository.findForUpdate("b", "evaluation")).thenReturn(Optional.of(existingB));
        service.bulkEnable(List.of("b"), "evaluation", null, "re-enable", staff());
        assertTrue(existingB.isEnabled());
        assertEquals("upsc", existingB.getSegment());
        assertEquals(12000, existingB.getDailyCopyQuota());
    }

    @Test
    void bulkEnableValidates() {
        assertThrows(VacademyException.class,
                () -> service.bulkEnable(List.of("a"), "evaluation", "school", " ", staff()));
        assertThrows(VacademyException.class,
                () -> service.bulkEnable(List.of(), "evaluation", "school", "r", staff()));
        assertThrows(VacademyException.class,
                () -> service.bulkEnable(List.of("a"), "evaluation", "kindergarten", "r", staff()));
        List<String> tooMany = new ArrayList<>();
        for (int i = 0; i < 501; i++) tooMany.add("i" + i);
        assertThrows(VacademyException.class,
                () -> service.bulkEnable(tooMany, "evaluation", null, "r", staff()));
        verify(accessRepository, never()).save(any());
    }

    // ── overview ─────────────────────────────────────────────────────────────

    @Test
    void overviewShowsDefaultsKeysWithoutSecretsAndApiCredits() {
        when(accessRepository.findByInstituteIdOrderByProductAsc(INSTITUTE)).thenReturn(List.of());
        InstituteApiKey k = InstituteApiKey.builder().id("k1").instituteId(INSTITUTE).name("ERP")
                .keyPrefix("vak_eval_0123456").keyHash("f".repeat(64))
                .products(new String[]{"evaluation"}).scopes(new String[]{"evaluation:read"})
                .status("ACTIVE").createdBy("admin-1").createdVia("dashboard").createdAt(NOW).build();
        when(keyRepository.findByInstituteIdOrderByCreatedAtDesc(INSTITUTE)).thenReturn(List.of(k));
        when(usageRepository.sumApiKeyCreditsSince(eq(INSTITUTE), any(Timestamp.class)))
                .thenReturn(new BigDecimal("123.5"));

        Map<String, Object> out = service.overview(INSTITUTE);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> products = (List<Map<String, Object>>) out.get("products");
        assertEquals(1, products.size());
        assertEquals("evaluation", products.get(0).get("product"));
        assertEquals(false, products.get(0).get("enabled"));

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> keys = (List<Map<String, Object>>) out.get("keys");
        assertEquals("vak_eval_0123456", keys.get(0).get("prefix"));
        assertFalse(keys.get(0).toString().contains("f".repeat(64)), "hash must not be listed");

        @SuppressWarnings("unchecked")
        Map<String, Object> usage = (Map<String, Object>) out.get("usage_30d");
        assertEquals(new BigDecimal("123.5"), usage.get("credits"));
        assertTrue(usage.containsKey("copies"));
        assertNull(usage.get("copies"));

        ArgumentCaptor<Timestamp> from = ArgumentCaptor.forClass(Timestamp.class);
        verify(usageRepository).sumApiKeyCreditsSince(eq(INSTITUTE), from.capture());
        assertEquals(Instant.parse("2026-09-01T10:00:00Z"), from.getValue().toInstant());
    }

    @Test
    void overviewSurvivesLedgerFailure() {
        when(accessRepository.findByInstituteIdOrderByProductAsc(INSTITUTE)).thenReturn(List.of());
        when(keyRepository.findByInstituteIdOrderByCreatedAtDesc(INSTITUTE)).thenReturn(List.of());
        when(usageRepository.sumApiKeyCreditsSince(anyString(), any())).thenThrow(new RuntimeException("boom"));
        @SuppressWarnings("unchecked")
        Map<String, Object> usage = (Map<String, Object>) service.overview(INSTITUTE).get("usage_30d");
        assertNull(usage.get("credits"));
    }
}
