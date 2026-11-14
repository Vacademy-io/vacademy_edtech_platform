package vacademy.io.admin_core_service.features.enroll_invite;

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
import vacademy.io.admin_core_service.features.admin_activity_logs.service.AuditNarrator;
import vacademy.io.admin_core_service.features.admin_activity_logs.service.PayloadRedactor;
import vacademy.io.admin_core_service.features.admin_activity_logs.util.AuditSpelEvaluator;
import vacademy.io.admin_core_service.features.enroll_invite.dto.AssignCpoToPackageSessionDTO;
import vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollInviteDTO;
import vacademy.io.admin_core_service.features.enroll_invite.dto.UpdateEnrollInvitePackageSessionPaymentOptionDTO;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.service.EnrollInviteService;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Every invite-link mutation, audited end to end minus the database: the real
 * aspect and SpEL evaluator, the annotations copied verbatim off
 * {@code EnrollInviteController}, driven through a Spring proxy with a real
 * request context and a real actor.
 *
 * <p>The contract test proves the expressions parse; this proves that an admin
 * creating, editing, deleting, defaulting or re-pricing an invite link ends up
 * as a row that says who did what to which link — the whole point of the
 * request "show in the activity log who created / updated / deleted the
 * invite". The aspect swallows its own failures by design, so a wrong
 * expression would otherwise ship as a row with a null description.
 */
@SpringJUnitConfig(EnrollInviteAuditableEndToEndTest.AuditTestConfig.class)
class EnrollInviteAuditableEndToEndTest {

    private static final String INSTITUTE = "inst-1";

    @Autowired
    private AuditedInviteEndpoints endpoints;

    @MockBean
    private AdminActivityLogRepository repository;

    /** Named so {@code @enrollInviteService.…} in the SpEL resolves to this mock. */
    @MockBean(name = "enrollInviteService")
    private EnrollInviteService enrollInviteService;

    @MockBean(name = "auditNarrator")
    private AuditNarrator narrator;

    @MockBean
    private AsyncAuditDispatcher asyncAuditDispatcher;

    private CustomUserDetails actor;

    @BeforeEach
    void bindRequestContext() {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/admin-core-service/v1/enroll-invite");
        request.addHeader("clientId", INSTITUTE);
        User user = new User();
        user.setId("user-neeraj");
        user.setFullName("Neeraj Hariyale");
        user.setUsername("neeraj");
        actor = new CustomUserDetails(user, INSTITUTE, List.of());
        request.setAttribute("user", actor);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        reset(repository, enrollInviteService, narrator);
        when(repository.save(any(AdminActivityLog.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(enrollInviteService.auditName("inv-1")).thenReturn("Summer Batch 2026");
        when(enrollInviteService.auditLabel(List.of("inv-1"))).thenReturn("invite link Summer Batch 2026");
        when(enrollInviteService.auditLabel(List.of("inv-1", "inv-2", "inv-3"))).thenReturn("3 invite link(s)");
        when(narrator.coursesFor(anyList())).thenReturn("Physics 201");
    }

    @AfterEach
    void clearRequestContext() {
        RequestContextHolder.resetRequestAttributes();
    }

    @Test
    @DisplayName("creating an invite link records who created which link")
    void recordsCreate() {
        EnrollInviteDTO dto = new EnrollInviteDTO();
        dto.setName("Summer Batch 2026");

        endpoints.createEnrollInvite(dto, actor);

        AdminActivityLog row = savedRow();
        assertEquals("ENROLL_INVITE", row.getEntityType());
        assertEquals("CREATE", row.getAction());
        assertEquals("created invite link Summer Batch 2026", row.getDescription());
        assertEquals("inv-new", row.getEntityId());
        assertEquals("user-neeraj", row.getActorId());
        assertEquals("Neeraj Hariyale", row.getActorName());
        assertEquals(INSTITUTE, row.getInstituteId());
    }

    @Test
    @DisplayName("editing an invite link records the editor and keeps the pre-edit state for the diff")
    void recordsUpdateWithBeforeSnapshot() {
        EnrollInvite before = new EnrollInvite();
        before.setId("inv-1");
        before.setName("Old name");
        when(enrollInviteService.auditSnapshot("inv-1")).thenReturn(before);

        EnrollInviteDTO dto = new EnrollInviteDTO();
        dto.setId("inv-1");
        dto.setName("Summer Batch 2026");

        endpoints.updateEnrollInvite(dto, actor);

        AdminActivityLog row = savedRow();
        assertEquals("UPDATE", row.getAction());
        assertEquals("updated invite link Summer Batch 2026", row.getDescription());
        assertEquals("inv-1", row.getEntityId());
        assertNotNull(row.getBeforePayload(), "the pre-edit snapshot backs the before/after diff");
        assertTrue(row.getBeforePayload().contains("Old name"));
    }

    @Test
    @DisplayName("deleting names the link; a bulk delete gives the count")
    void recordsDelete() {
        endpoints.deleteEnrollInvites(List.of("inv-1"));
        AdminActivityLog row = savedRow();
        assertEquals("DELETE", row.getAction());
        assertEquals("deleted invite link Summer Batch 2026", row.getDescription());

        endpoints.deleteEnrollInvites(List.of("inv-1", "inv-2", "inv-3"));
        row = savedRow();
        assertEquals("deleted 3 invite link(s)", row.getDescription());
        assertEquals("inv-1,inv-2,inv-3", row.getEntityId());
    }

    @Test
    @DisplayName("making a link the default names the link and the course it now fronts")
    void recordsMakeDefault() {
        endpoints.updateDefaultEnrollInviteConfig("inv-1", "ps-1", actor);

        AdminActivityLog row = savedRow();
        assertEquals("MAKE_DEFAULT", row.getAction());
        assertEquals("made invite link Summer Batch 2026 the default for Physics 201", row.getDescription());
        verify(narrator).coursesFor(eq(List.of("ps-1")));
    }

    @Test
    @DisplayName("swapping payment plans on a link is an UPDATE naming the link")
    void recordsPaymentPlanUpdate() {
        UpdateEnrollInvitePackageSessionPaymentOptionDTO change = new UpdateEnrollInvitePackageSessionPaymentOptionDTO();
        change.setEnrollInviteId("inv-1");

        endpoints.updateEnrollInvitePaymentOption(List.of(change));

        AdminActivityLog row = savedRow();
        assertEquals("UPDATE", row.getAction());
        assertEquals("updated payment plans of invite link Summer Batch 2026", row.getDescription());
        assertEquals("inv-1", row.getEntityId());
    }

    @Test
    @DisplayName("assigning a fee plan (CPO) names the link and the batch's course")
    void recordsCpoAssignment() {
        AssignCpoToPackageSessionDTO request = new AssignCpoToPackageSessionDTO();
        request.setCpoId("cpo-1");
        request.setPackageSessionId("ps-1");

        endpoints.assignCpoToPackageSession("inv-1", request, actor);

        AdminActivityLog row = savedRow();
        assertEquals("ASSIGN", row.getAction());
        assertEquals("assigned fee plan to invite link Summer Batch 2026 for Physics 201", row.getDescription());
    }

    /** The single row the aspect wrote for the most recent call. */
    private AdminActivityLog savedRow() {
        ArgumentCaptor<AdminActivityLog> captor = ArgumentCaptor.forClass(AdminActivityLog.class);
        verify(repository, atLeastOnce()).save(captor.capture());
        return captor.getValue();
    }

    // ── The endpoints under test: annotations copied off EnrollInviteController ──

    /**
     * Same parameter names and the same SpEL as the real controller. If a real
     * annotation changes, copy the change here — the duplication is the fixture.
     */
    static class AuditedInviteEndpoints {

        @Auditable(
                entityType = "ENROLL_INVITE",
                action = "CREATE",
                entityIdExpr = "#result?.body",
                descriptionExpr = "'created invite link ' + #enrollInviteDTO?.name")
        public ResponseEntity<String> createEnrollInvite(@RequestBody EnrollInviteDTO enrollInviteDTO,
                @RequestAttribute("user") CustomUserDetails user) {
            return ResponseEntity.ok("inv-new");
        }

        @Auditable(
                entityType = "ENROLL_INVITE",
                action = "MAKE_DEFAULT",
                entityIdExpr = "#enrollInviteId",
                descriptionExpr = "'made invite link ' + @enrollInviteService.auditName(#enrollInviteId)"
                        + " + ' the default for ' + (@auditNarrator.coursesFor({#packageSessionId}) ?: 'its batch')")
        public ResponseEntity<String> updateDefaultEnrollInviteConfig(@RequestParam("enrollInviteId") String enrollInviteId,
                @RequestParam("packageSessionId") String packageSessionId,
                @RequestAttribute("user") CustomUserDetails user) {
            return ResponseEntity.ok(enrollInviteId);
        }

        @Auditable(
                entityType = "ENROLL_INVITE",
                action = "DELETE",
                entityIdExpr = "T(java.lang.String).join(',', #enrollInviteIds)",
                descriptionExpr = "'deleted ' + (@enrollInviteService.auditLabel(#enrollInviteIds) ?: 'invite link(s)')")
        public ResponseEntity<String> deleteEnrollInvites(@RequestBody List<String> enrollInviteIds) {
            return ResponseEntity.ok("Enroll invites deleted successfully");
        }

        @Auditable(
                entityType = "ENROLL_INVITE",
                action = "UPDATE",
                entityIdExpr = "T(java.lang.String).join(',', #updateEnrollInvitePackageSessionPaymentOptionDTO.![enrollInviteId])",
                descriptionExpr = "'updated payment plans of ' + (@enrollInviteService.auditLabel("
                        + "#updateEnrollInvitePackageSessionPaymentOptionDTO.![enrollInviteId]) ?: 'invite link(s)')")
        public ResponseEntity<String> updateEnrollInvitePaymentOption(
                @RequestBody List<UpdateEnrollInvitePackageSessionPaymentOptionDTO> updateEnrollInvitePackageSessionPaymentOptionDTO) {
            return ResponseEntity.ok("ok");
        }

        @Auditable(
                entityType = "ENROLL_INVITE",
                action = "UPDATE",
                captureBefore = "@enrollInviteService.auditSnapshot(#enrollInviteDTO?.id)",
                entityIdExpr = "#enrollInviteDTO?.id",
                descriptionExpr = "'updated invite link ' + (#enrollInviteDTO?.name ?: #enrollInviteDTO?.id)")
        public ResponseEntity<String> updateEnrollInvite(@RequestBody EnrollInviteDTO enrollInviteDTO,
                @RequestAttribute("user") CustomUserDetails user) {
            return ResponseEntity.ok(enrollInviteDTO.getId());
        }

        @Auditable(
                entityType = "ENROLL_INVITE",
                action = "ASSIGN",
                entityIdExpr = "#enrollInviteId",
                descriptionExpr = "'assigned fee plan to invite link ' + @enrollInviteService.auditName(#enrollInviteId)"
                        + " + ' for ' + (@auditNarrator.coursesFor({#request?.packageSessionId}) ?: 'its batch')")
        public ResponseEntity<Void> assignCpoToPackageSession(
                @PathVariable("enrollInviteId") String enrollInviteId,
                @RequestBody AssignCpoToPackageSessionDTO request,
                @RequestAttribute("user") CustomUserDetails user) {
            return ResponseEntity.noContent().build();
        }
    }

    @Configuration
    @EnableAspectJAutoProxy
    static class AuditTestConfig {

        @Bean
        AuditedInviteEndpoints auditedInviteEndpoints() {
            return new AuditedInviteEndpoints();
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
