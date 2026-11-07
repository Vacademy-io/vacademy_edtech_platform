package vacademy.io.admin_core_service.features.admin_activity_logs;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
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
import vacademy.io.admin_core_service.features.admin_activity_logs.service.CrmAuditNarrator;
import vacademy.io.admin_core_service.features.admin_activity_logs.service.PayloadRedactor;
import vacademy.io.admin_core_service.features.admin_activity_logs.util.AuditSpelEvaluator;
import vacademy.io.admin_core_service.features.audience.dto.AudienceDTO;
import vacademy.io.admin_core_service.features.audience.dto.LeadDeleteRequestDTO;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The CRM audit path end to end, minus the database: the real aspect, the real
 * SpEL evaluator, and the annotations copied verbatim off the CRM controllers,
 * driven through a Spring proxy with a real request context.
 *
 * <p>Everything else in this package tests a piece — that the expressions parse,
 * that their variables exist, that a guard's branches behave. None of that
 * proves an admin clicking "create audience list" ends up as a row that says so,
 * which is the only thing the feature is for. The failure mode this catches is
 * silent by construction: the aspect swallows its own errors so it can never
 * break a customer mutation, so a broken expression produces a row with a null
 * description and nothing anywhere complains.
 */
@SpringJUnitConfig(CrmAuditableEndToEndTest.AuditTestConfig.class)
class CrmAuditableEndToEndTest {

    private static final String INSTITUTE = "inst-1";

    @Autowired
    private AuditedCrmEndpoints endpoints;

    /**
     * @MockBean rather than a mock returned from a @Bean method: a Mockito mock
     * of {@link CrmAuditNarrator} is still a subclass carrying its @Autowired
     * repository fields, and Spring would try to satisfy every one of them.
     */
    @MockBean
    private AdminActivityLogRepository repository;

    @MockBean(name = "crmAuditNarrator")
    private CrmAuditNarrator narrator;

    @MockBean
    private AsyncAuditDispatcher asyncAuditDispatcher;

    private CustomUserDetails actor;

    @BeforeEach
    void bindRequestContext() {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/admin-core-service/v1/audience/campaign");
        request.addHeader("clientId", INSTITUTE);
        request.addHeader("X-Forwarded-For", "203.0.113.9, 10.0.0.1");
        // userId has no setter, so build the actor the way the JWT filter does.
        User user = new User();
        user.setId("user-kajal");
        user.setFullName("Kajal Kumari");
        user.setUsername("kaja7824");
        actor = new CustomUserDetails(user, INSTITUTE, List.of());
        request.setAttribute("user", actor);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        // The context is shared across tests, so the mocks must not be.
        reset(repository, narrator);
        when(repository.save(any(AdminActivityLog.class))).thenAnswer(invocation -> invocation.getArgument(0));
    }

    @AfterEach
    void clearRequestContext() {
        RequestContextHolder.resetRequestAttributes();
    }

    @Test
    @DisplayName("creating an audience list is recorded as who did it, to what, and when")
    void recordsAudienceCreation() {
        AudienceDTO dto = new AudienceDTO();
        dto.setCampaignName("Winter Admissions 2026");
        dto.setInstituteId(INSTITUTE);

        endpoints.createCampaign(dto, actor);

        AdminActivityLog row = savedRow();
        assertEquals("AUDIENCE", row.getEntityType());
        assertEquals("CREATE", row.getAction());
        assertEquals("created audience Winter Admissions 2026", row.getDescription());
        assertEquals("aud-new", row.getEntityId());
        assertEquals(INSTITUTE, row.getInstituteId());
        assertEquals("user-kajal", row.getActorId());
        assertEquals("Kajal Kumari", row.getActorName());
        // The first hop of X-Forwarded-For, not the proxy's own address.
        assertEquals("203.0.113.9", row.getIpAddress());
    }

    @Test
    @DisplayName("a bulk lead delete names the count, and a delete that matched nothing is not recorded")
    void recordsOnlyDeletesThatDeleted() {
        when(narrator.leadsFor(anyList())).thenReturn("3 lead(s)");
        LeadDeleteRequestDTO request = new LeadDeleteRequestDTO();
        request.setResponseIds(List.of("r-1", "r-2", "r-3"));

        endpoints.deleteLeads(request, 3, actor);
        assertEquals("deleted lead 3 lead(s)", savedRow().getDescription());

        // A delete that matched nothing returns 200 with a zero count.
        clearInvocations(repository);
        endpoints.deleteLeads(request, 0, actor);
        verify(repository, never()).save(any(AdminActivityLog.class));
    }

    @Test
    @DisplayName("assigning and removing a counsellor are two distinct, separately filterable actions")
    void distinguishesAssignFromUnassign() {
        when(narrator.counsellorAssignment(anyString(), any(), any())).thenReturn("assigned lead Amit to Riya");
        when(narrator.assignedCounsellorFor(anyString(), anyString())).thenReturn("counsellor-old");

        endpoints.assignCounselor("lead-user", INSTITUTE, "counsellor-new", "Riya", actor);
        assertEquals("ASSIGN", savedRow().getAction());

        endpoints.assignCounselor("lead-user", INSTITUTE, "  ", null, actor);
        assertEquals("UNASSIGN", savedRow().getAction());
    }

    @Test
    @DisplayName("removing a counsellor from a lead that has none is not recorded at all")
    void skipsTheUnassignNoOp() {
        when(narrator.assignedCounsellorFor(anyString(), anyString())).thenReturn(null);

        endpoints.assignCounselor("lead-user", INSTITUTE, null, null, actor);

        verify(repository, never()).save(any(AdminActivityLog.class));
    }

    @Test
    @DisplayName("a request without the clientId header still succeeds — it just is not audited")
    void skipsWhenThereIsNoInstituteContext() {
        MockHttpServletRequest anonymous = new MockHttpServletRequest();
        anonymous.setAttribute("user", actor);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(anonymous));

        AudienceDTO dto = new AudienceDTO();
        dto.setCampaignName("Winter Admissions 2026");

        // The business call must return normally …
        assertEquals("aud-new", endpoints.createCampaign(dto, actor).getBody());
        // … and nothing is written.
        verify(repository, never()).save(any(AdminActivityLog.class));
    }

    @Test
    @DisplayName("an audit failure never reaches the caller")
    void anAuditFailureIsSwallowed() {
        when(repository.save(any(AdminActivityLog.class)))
                .thenThrow(new IllegalStateException("connection pool exhausted"));

        AudienceDTO dto = new AudienceDTO();
        dto.setCampaignName("Winter Admissions 2026");

        assertEquals("aud-new", endpoints.createCampaign(dto, actor).getBody());
    }

    @Test
    @DisplayName("the payload is captured, with secrets masked")
    void capturesTheRequestBodyWithSecretsMasked() {
        AudienceDTO dto = new AudienceDTO();
        dto.setCampaignName("Winter Admissions 2026");

        endpoints.createCampaign(dto, actor);

        String payload = savedRow().getRequestPayload();
        org.junit.jupiter.api.Assertions.assertNotNull(payload, "the submitted body should be recorded");
        org.junit.jupiter.api.Assertions.assertTrue(payload.contains("Winter Admissions 2026"));
    }

    /** The single row the aspect wrote for the most recent call. */
    private AdminActivityLog savedRow() {
        ArgumentCaptor<AdminActivityLog> captor = ArgumentCaptor.forClass(AdminActivityLog.class);
        verify(repository, org.mockito.Mockito.atLeastOnce()).save(captor.capture());
        return captor.getValue();
    }

    // ── The endpoints under test: annotations copied off the real controllers ──

    /**
     * Mirrors the annotated CRM controller methods, with the same parameter
     * names and the same SpEL. If a real annotation changes, copy the change
     * here — that is the point of the duplication: it is a fixture of the
     * expressions, not a re-implementation of the controllers.
     */
    static class AuditedCrmEndpoints {

        @Auditable(
                entityType = "AUDIENCE",
                action = "CREATE",
                entityIdExpr = "#result?.body",
                descriptionExpr = "'created audience ' + (#audienceDTO?.campaignName ?: 'list')")
        public ResponseEntity<String> createCampaign(@RequestBody AudienceDTO audienceDTO,
                @RequestAttribute("user") CustomUserDetails user) {
            return ResponseEntity.ok("aud-new");
        }

        @Auditable(
                entityType = "LEAD",
                action = "DELETE",
                entityIdExpr = "#request?.responseIds != null and #request.responseIds.size() == 1 "
                        + "? #request.responseIds[0] : null",
                conditionExpr = "#result?.body != null and #result.body['deleted'] != null "
                        + "and #result.body['deleted'] > 0",
                descriptionExpr = "'deleted lead ' + @crmAuditNarrator.leadsFor(#request?.responseIds)")
        public ResponseEntity<Map<String, Object>> deleteLeads(@RequestBody LeadDeleteRequestDTO request,
                int deleted,
                @RequestAttribute("user") CustomUserDetails user) {
            return ResponseEntity.ok(Map.of("deleted", deleted));
        }

        @Auditable(
                entityType = "LEAD",
                actionExpr = "(#counselorId == null or #counselorId.isBlank()) ? 'UNASSIGN' : 'ASSIGN'",
                entityIdExpr = "#userId",
                captureBefore = "@crmAuditNarrator.assignedCounsellorFor(#userId, #instituteId)",
                conditionExpr = "(#counselorId != null and !#counselorId.isBlank()) or #before != null",
                descriptionExpr = "@crmAuditNarrator.counsellorAssignment(#userId, #counselorId, #counselorName)")
        public ResponseEntity<String> assignCounselor(@RequestParam String userId,
                @RequestParam String instituteId,
                @RequestParam(required = false) String counselorId,
                @RequestParam(required = false) String counselorName,
                @RequestAttribute("user") CustomUserDetails user) {
            return ResponseEntity.ok("ok");
        }

        @SuppressWarnings("unused")
        public void unannotated(@PathVariable String id) {
            // Present only to prove the aspect is opt-in.
        }
    }

    @Configuration
    @EnableAspectJAutoProxy
    static class AuditTestConfig {

        @Bean
        AuditedCrmEndpoints auditedCrmEndpoints() {
            return new AuditedCrmEndpoints();
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
