package vacademy.io.admin_core_service.features.workflow.controller;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.workflow.dto.PagedWorkflowScheduleResponseDTO;
import vacademy.io.admin_core_service.features.workflow.dto.WorkflowScheduleFilterDTO;
import vacademy.io.admin_core_service.features.workflow.dto.WorkflowWithSchedulesFilterDTO;
import vacademy.io.admin_core_service.features.workflow.repository.NodeTemplateRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowExecutionRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowTemplateRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowTriggerRepository;
import vacademy.io.admin_core_service.features.workflow.service.AsyncWorkflowExecutor;
import vacademy.io.admin_core_service.features.workflow.service.EnrollmentWorkflowRunService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowBuilderService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowContextSchemaService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowEngineService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowScheduleQueryService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowValidationService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The institute-wide automation list reads (schedules, workflows with schedules, enrollment
 * runs): open as before while security.institute-guards.enforce is off, with the callers the
 * staff check would refuse logged; staff of the institute (or a super admin) only when it is on.
 */
class WorkflowListGuardTest {

    private static final String OWN = "inst-1";

    private final InstituteAccessValidator validator = new InstituteAccessValidator();
    private WorkflowService workflowService;
    private WorkflowScheduleQueryService scheduleQueryService;
    private EnrollmentWorkflowRunService runService;
    private WorkflowController workflowController;
    private EnrollmentWorkflowRunController runController;
    private ListAppender<ILoggingEvent> logs;

    @BeforeEach
    void setUp() {
        workflowService = mock(WorkflowService.class);
        scheduleQueryService = mock(WorkflowScheduleQueryService.class);
        when(scheduleQueryService.getWorkflowSchedules(any(), anyInt(), anyInt()))
                .thenReturn(PagedWorkflowScheduleResponseDTO.builder().content(List.of()).totalElements(0).build());
        runService = mock(EnrollmentWorkflowRunService.class);
        WorkflowAccessGuard guard = new WorkflowAccessGuard(validator, mock(WorkflowRepository.class),
                mock(WorkflowExecutionRepository.class), mock(NodeTemplateRepository.class));
        workflowController = new WorkflowController(workflowService, scheduleQueryService,
                mock(WorkflowBuilderService.class), mock(WorkflowValidationService.class),
                mock(WorkflowEngineService.class), mock(WorkflowTemplateRepository.class),
                mock(WorkflowTriggerRepository.class), mock(AsyncWorkflowExecutor.class),
                mock(WorkflowContextSchemaService.class), new ObjectMapper(), guard);
        runController = new EnrollmentWorkflowRunController(runService, guard);
        clientId(OWN);

        logs = new ListAppender<>();
        logs.start();
        ((Logger) LoggerFactory.getLogger(InstituteAccessValidator.class)).addAppender(logs);
    }

    @AfterEach
    void tearDown() {
        ((Logger) LoggerFactory.getLogger(InstituteAccessValidator.class)).detachAppender(logs);
        RequestContextHolder.resetRequestAttributes();
    }

    private static void clientId(String instituteId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        if (instituteId != null) {
            request.addHeader("clientId", instituteId);
        }
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    private static CustomUserDetails user(boolean root, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("u-1");
        dto.setUsername("u-1");
        dto.setFullName("User");
        dto.setRootUser(root);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    private static WorkflowScheduleFilterDTO scheduleFilter() {
        WorkflowScheduleFilterDTO filter = new WorkflowScheduleFilterDTO();
        filter.setInstituteId(OWN);
        return filter;
    }

    private static WorkflowWithSchedulesFilterDTO workflowsFilter() {
        WorkflowWithSchedulesFilterDTO filter = new WorkflowWithSchedulesFilterDTO();
        filter.setInstituteId(OWN);
        return filter;
    }

    private void callAll(CustomUserDetails u) {
        workflowController.getWorkflowSchedules(scheduleFilter(), 0, 20, u);
        workflowController.getWorkflowsWithSchedules(workflowsFilter(), 0, 20, u);
        runController.getEnrollmentRuns(OWN, "ps-1,ps-2", u);
    }

    private List<String> wouldRefuse() {
        return logs.list.stream().map(ILoggingEvent::getFormattedMessage)
                .filter(m -> m.startsWith("INSTITUTE_GUARD_WOULD_REFUSE")).toList();
    }

    @Test
    void staffOfTheInstituteIsServedQuietly() {
        assertDoesNotThrow(() -> callAll(user(false, "ADMIN")));
        assertTrue(wouldRefuse().isEmpty());
    }

    @Test
    void notEnforced_callersWithoutAMatchingClientIdAreServedAsBeforeAndLogged() {
        clientId(null); // the legacy in-app agent sends no clientId
        assertDoesNotThrow(() -> callAll(user(true, "ADMIN")));
        assertDoesNotThrow(() -> callAll(null));
        verify(runService, org.mockito.Mockito.times(2)).getRuns(OWN, List.of("ps-1", "ps-2"));
        assertEquals(6, wouldRefuse().size());
        assertTrue(wouldRefuse().contains(
                "INSTITUTE_GUARD_WOULD_REFUSE route=workflow.getEnrollmentRuns user=u-1 institute=inst-1 reason=not_member previous=allow"));
    }

    @Test
    void enforced_learnerAndOtherInstituteAreRefused() {
        ReflectionTestUtils.setField(validator, "instituteGuardsEnforced", true);
        assertThrows(ForbiddenException.class,
                () -> workflowController.getWorkflowsWithSchedules(workflowsFilter(), 0, 20, user(true, "STUDENT")));
        clientId("inst-2");
        assertThrows(ForbiddenException.class,
                () -> runController.getEnrollmentRuns(OWN, "ps-1", user(true, "ADMIN")));
        assertThrows(ForbiddenException.class,
                () -> workflowController.getWorkflowSchedules(scheduleFilter(), 0, 20, user(true, "ADMIN")));
        verify(workflowService, never()).getWorkflowsWithSchedulesPaged(any(), anyInt(), anyInt());
        verify(runService, never()).getRuns(anyString(), anyList());
        verify(scheduleQueryService, never()).getWorkflowSchedules(any(), anyInt(), anyInt());

        clientId(OWN);
        assertDoesNotThrow(() -> callAll(user(false, "TEACHER")));
    }
}
