package vacademy.io.admin_core_service.features.institute;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.EnableAspectJAutoProxy;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.admin_activity_logs.aspect.AuditableAspect;
import vacademy.io.admin_core_service.features.admin_activity_logs.async.AsyncAuditDispatcher;
import vacademy.io.admin_core_service.features.admin_activity_logs.config.AuditProperties;
import vacademy.io.admin_core_service.features.admin_activity_logs.entity.AdminActivityLog;
import vacademy.io.admin_core_service.features.admin_activity_logs.repository.AdminActivityLogRepository;
import vacademy.io.admin_core_service.features.admin_activity_logs.service.PayloadRedactor;
import vacademy.io.admin_core_service.features.admin_activity_logs.util.AuditSpelEvaluator;
import vacademy.io.admin_core_service.features.institute.dto.PaymentGatewayMappingDTO;
import vacademy.io.admin_core_service.features.institute.dto.PaymentGatewayMappingUpsertRequest;
import vacademy.io.admin_core_service.features.institute.service.InstitutePaymentGatewayMappingService;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Every payment-gateway write, audited end to end minus the database: the real
 * aspect, SpEL evaluator and redactor, the annotations copied verbatim off
 * {@code InstitutePaymentGatewayAdminController}, driven through a Spring proxy
 * with a real request context and a real actor.
 *
 * <p>Two things are proven here. First, a gateway that gets switched off (or back
 * on) leaves a row saying who did it, to which gateway. Before these annotations a
 * live gateway could be deactivated with no trace at all. Second, no live
 * credential reaches {@code admin_activity_log}: the request body carries the new
 * keys in clear text when an admin rotates them.
 */
@SpringJUnitConfig(PaymentGatewayAuditableEndToEndTest.AuditTestConfig.class)
class PaymentGatewayAuditableEndToEndTest {

    private static final String INSTITUTE = "inst-1";
    private static final String MAPPING = "map-1";
    private static final String LIVE_SECRET = "s3cr3t-live-key-value-9876";
    private static final String LIVE_WEBHOOK_SECRET = "whsec-live-value-5432";

    @Autowired
    private AuditedGatewayEndpoints endpoints;

    @MockBean
    private AdminActivityLogRepository repository;

    /** Named so {@code @institutePaymentGatewayMappingService.…} in the SpEL resolves to this mock. */
    @MockBean(name = "institutePaymentGatewayMappingService")
    private InstitutePaymentGatewayMappingService gatewayService;

    @MockBean
    private AsyncAuditDispatcher asyncAuditDispatcher;

    private CustomUserDetails actor;

    @BeforeEach
    void resetMocks() {
        reset(repository, gatewayService);
        when(repository.save(any(AdminActivityLog.class))).thenAnswer(invocation -> invocation.getArgument(0));
    }

    @AfterEach
    void clearRequestContext() {
        RequestContextHolder.resetRequestAttributes();
    }

    @Test
    @DisplayName("adding a gateway records who added which vendor, with the keys masked")
    void recordsCreateWithoutSecrets() {
        bindRequest("POST", "/admin-core-service/v1/institute/payment-gateways");

        endpoints.create(actor, INSTITUTE, razorpayRequest(null));

        AdminActivityLog row = savedRow();
        assertEquals("PAYMENT_GATEWAY", row.getEntityType());
        assertEquals("CREATE", row.getAction());
        assertEquals("added RAZORPAY payment gateway", row.getDescription());
        assertEquals(MAPPING, row.getEntityId());
        assertEquals("user-admin", row.getActorId());
        assertEquals("Institute Admin", row.getActorName());
        assertEquals(INSTITUTE, row.getInstituteId());
        assertNoSecrets(row);
        assertTrue(row.getRequestPayload().contains("rzp_live_key"), "the public key id stays readable");
    }

    @Test
    @DisplayName("rotating keys is an UPDATE with the masked pre-edit state, never the new secret")
    void recordsCredentialUpdate() {
        bindRequest("PUT", "/admin-core-service/v1/institute/payment-gateways/" + MAPPING);
        when(gatewayService.auditSnapshot(INSTITUTE, MAPPING)).thenReturn(mapping("ACTIVE"));

        endpoints.update(actor, INSTITUTE, MAPPING, razorpayRequest(null));

        AdminActivityLog row = savedRow();
        assertEquals("UPDATE", row.getAction());
        assertEquals("updated credentials of RAZORPAY payment gateway", row.getDescription());
        assertEquals(MAPPING, row.getEntityId());
        assertNotNull(row.getBeforePayload(), "the pre-edit snapshot backs the before/after diff");
        assertTrue(row.getBeforePayload().contains("RAZORPAY"));
        assertNoSecrets(row);
    }

    @Test
    @DisplayName("a PUT that switches an inactive gateway back on is logged as a re-activation")
    void recordsStatusFlipThroughUpdate() {
        bindRequest("PUT", "/admin-core-service/v1/institute/payment-gateways/" + MAPPING);
        when(gatewayService.auditSnapshot(INSTITUTE, MAPPING)).thenReturn(mapping("INACTIVE"));

        endpoints.update(actor, INSTITUTE, MAPPING, razorpayRequest("ACTIVE"));

        AdminActivityLog row = savedRow();
        assertEquals("MAKE_ACTIVE", row.getAction());
        assertEquals("re-activated RAZORPAY payment gateway", row.getDescription());
    }

    @Test
    @DisplayName("deactivating names the gateway and keeps its pre-change state")
    void recordsDeactivate() {
        bindRequest("DELETE", "/admin-core-service/v1/institute/payment-gateways/" + MAPPING);
        when(gatewayService.auditSnapshot(INSTITUTE, MAPPING)).thenReturn(mapping("ACTIVE"));

        endpoints.deactivate(actor, INSTITUTE, MAPPING);

        AdminActivityLog row = savedRow();
        assertEquals("DEACTIVATE", row.getAction());
        assertEquals("deactivated RAZORPAY payment gateway", row.getDescription());
        assertEquals(MAPPING, row.getEntityId());
        assertEquals("user-admin", row.getActorId());
        assertTrue(row.getBeforePayload().contains("\"status\":\"ACTIVE\""));
    }

    @Test
    @DisplayName("deactivating a gateway that is already inactive writes nothing")
    void skipsNoOpDeactivate() {
        bindRequest("DELETE", "/admin-core-service/v1/institute/payment-gateways/" + MAPPING);
        when(gatewayService.auditSnapshot(INSTITUTE, MAPPING)).thenReturn(mapping("INACTIVE"));

        endpoints.deactivate(actor, INSTITUTE, MAPPING);

        verify(repository, never()).save(any(AdminActivityLog.class));
    }

    @Test
    @DisplayName("every gateway credential key is masked by the audit redactor")
    void redactorMasksEveryGatewayCredentialKey() {
        PayloadRedactor redactor = new PayloadRedactor();
        // The secret fields of every vendor form in PaymentGatewaySettings.tsx.
        for (String key : List.of("apiKey", "publishableKey", "webhookSecret", "keySecret", "clientSecret",
                "webhookPassword", "password", "encryptionKey", "saltKey")) {
            assertTrue(redactor.isSensitive(key), key + " must be masked in the audit log");
        }
        for (String key : List.of("keyId", "clientId", "baseUrl", "publicKey", "clientVersion")) {
            assertFalse(redactor.isSensitive(key), key + " is not a secret and should stay readable");
        }
    }

    // ── Fixtures ─────────────────────────────────────────────────────────────

    private void bindRequest(String method, String uri) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, uri);
        request.addHeader("clientId", INSTITUTE);
        User user = new User();
        user.setId("user-admin");
        user.setFullName("Institute Admin");
        user.setUsername("admin");
        actor = new CustomUserDetails(user, INSTITUTE, List.of());
        request.setAttribute("user", actor);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    private static PaymentGatewayMappingUpsertRequest razorpayRequest(String status) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("keyId", "rzp_live_key");
        data.put("keySecret", LIVE_SECRET);
        data.put("webhookSecret", LIVE_WEBHOOK_SECRET);
        return new PaymentGatewayMappingUpsertRequest(null, status, data);
    }

    /** The masked DTO the service hands to the audit log and the admin list. */
    private static PaymentGatewayMappingDTO mapping(String status) {
        Map<String, Object> masked = new LinkedHashMap<>();
        masked.put("keyId", "rzp_live_key");
        masked.put("keySecret", "••••9876");
        masked.put("webhookSecret", "••••5432");
        return PaymentGatewayMappingDTO.builder()
                .id(MAPPING)
                .vendor("RAZORPAY")
                .instituteId(INSTITUTE)
                .status(status)
                .paymentGatewaySpecificData(masked)
                .build();
    }

    private static void assertNoSecrets(AdminActivityLog row) {
        for (String payload : new String[] {row.getRequestPayload(), row.getBeforePayload()}) {
            if (payload == null) {
                continue;
            }
            assertFalse(payload.contains(LIVE_SECRET), "live keySecret leaked into the audit log: " + payload);
            assertFalse(payload.contains(LIVE_WEBHOOK_SECRET), "live webhookSecret leaked into the audit log: " + payload);
        }
    }

    /** The single row the aspect wrote for the most recent call. */
    private AdminActivityLog savedRow() {
        ArgumentCaptor<AdminActivityLog> captor = ArgumentCaptor.forClass(AdminActivityLog.class);
        verify(repository, atLeastOnce()).save(captor.capture());
        return captor.getValue();
    }

    // ── The endpoints under test: annotations copied off InstitutePaymentGatewayAdminController ──

    /**
     * Same parameter names and the same SpEL as the real controller. If a real
     * annotation changes, copy the change here; the duplication is the fixture.
     * The bodies return what the real service returns for the given status.
     */
    static class AuditedGatewayEndpoints {

        @Auditable(
                entityType = "PAYMENT_GATEWAY",
                action = "CREATE",
                entityIdExpr = "#result?.body?.id",
                descriptionExpr = "'added ' + #result?.body?.vendor + ' payment gateway'")
        public ResponseEntity<PaymentGatewayMappingDTO> create(
                @RequestAttribute("user") CustomUserDetails user,
                @RequestParam("instituteId") String instituteId,
                @RequestBody PaymentGatewayMappingUpsertRequest request) {
            return ResponseEntity.ok(mapping("ACTIVE"));
        }

        @Auditable(
                entityType = "PAYMENT_GATEWAY",
                action = "UPDATE",
                actionExpr = "#before == null || #before.status == #result?.body?.status ? 'UPDATE'"
                        + " : (#result?.body?.status == 'ACTIVE' ? 'MAKE_ACTIVE' : 'DEACTIVATE')",
                entityIdExpr = "#mappingId",
                descriptionExpr = "(#before == null || #before.status == #result?.body?.status ? 'updated credentials of '"
                        + " : (#result?.body?.status == 'ACTIVE' ? 're-activated ' : 'deactivated '))"
                        + " + #result?.body?.vendor + ' payment gateway'",
                captureBefore = "@institutePaymentGatewayMappingService.auditSnapshot(#instituteId, #mappingId)")
        public ResponseEntity<PaymentGatewayMappingDTO> update(
                @RequestAttribute("user") CustomUserDetails user,
                @RequestParam("instituteId") String instituteId,
                @PathVariable("mappingId") String mappingId,
                @RequestBody PaymentGatewayMappingUpsertRequest request) {
            // The real service keeps the stored status unless the request names one.
            String status = request.getStatus() != null ? request.getStatus() : "ACTIVE";
            return ResponseEntity.ok(mapping(status));
        }

        @Auditable(
                entityType = "PAYMENT_GATEWAY",
                action = "DEACTIVATE",
                conditionExpr = "#before == null || #before.status != 'INACTIVE'",
                entityIdExpr = "#mappingId",
                descriptionExpr = "'deactivated ' + (#before?.vendor ?: 'a') + ' payment gateway'",
                captureBefore = "@institutePaymentGatewayMappingService.auditSnapshot(#instituteId, #mappingId)")
        public ResponseEntity<Map<String, Object>> deactivate(
                @RequestAttribute("user") CustomUserDetails user,
                @RequestParam("instituteId") String instituteId,
                @PathVariable("mappingId") String mappingId) {
            return ResponseEntity.ok(Map.of("status", "INACTIVE", "id", mappingId));
        }
    }

    // No @Configuration on purpose: the application scans vacademy.io.* without filters
    // (SharedConfigurationReference), so a @Configuration here would be loaded into every
    // @SpringBootTest of the service. @SpringJUnitConfig registers this class by name.
    @EnableAspectJAutoProxy
    static class AuditTestConfig {

        @Bean
        AuditedGatewayEndpoints auditedGatewayEndpoints() {
            return new AuditedGatewayEndpoints();
        }

        @Bean
        AuditableAspect auditableAspect() {
            return new AuditableAspect();
        }

        @Bean
        AuditSpelEvaluator auditSpelEvaluator() {
            return new AuditSpelEvaluator();
        }

        @Bean
        PayloadRedactor payloadRedactor() {
            return new PayloadRedactor();
        }

        @Bean
        ObjectMapper objectMapper() {
            return new ObjectMapper();
        }

        @Bean
        AuditProperties auditProperties() {
            return new AuditProperties();
        }
    }
}
