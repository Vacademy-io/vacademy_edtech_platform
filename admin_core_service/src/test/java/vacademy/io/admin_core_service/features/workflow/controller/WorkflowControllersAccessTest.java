package vacademy.io.admin_core_service.features.workflow.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;
import org.mockito.MockedStatic;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.workflow.dto.NodeTemplateUpdateDTO;
import vacademy.io.admin_core_service.features.workflow.dto.WorkflowBuilderDTO;
import vacademy.io.admin_core_service.features.workflow.dto.WorkflowExecutionFilterDTO;
import vacademy.io.admin_core_service.features.workflow.entity.NodeTemplate;
import vacademy.io.admin_core_service.features.workflow.entity.Workflow;
import vacademy.io.admin_core_service.features.workflow.repository.NodeTemplateRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowExecutionRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowTemplateRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowTriggerRepository;
import vacademy.io.admin_core_service.features.workflow.service.AsyncWorkflowExecutor;
import vacademy.io.admin_core_service.features.workflow.service.UserWorkflowRunService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowBuilderService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowContextSchemaService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowEngineService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowExecutionLogger;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowExecutionService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowScheduleQueryService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowValidationService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The automation endpoints (builder, test-run, run-now, templates, run history and run logs) are
 * for staff of the institute that owns the automation -- the clientId header the dashboard and the
 * assistant send -- or for an allow-listed platform super admin. Learners (also with the root flag
 * or a self-signup TEACHER role), callers from another institute and callers without a role are refused
 * before any service is touched.
 */
class WorkflowControllersAccessTest {

    private static final String OWN = "inst-1";
    private static final String OTHER = "inst-2";
    private static final String WF = "wf-1";

    private WorkflowBuilderService builderService;
    private WorkflowEngineService engineService;
    private WorkflowService workflowService;
    private WorkflowExecutionService executionService;
    private UserWorkflowRunService runService;
    private WorkflowExecutionLogger executionLogger;
    private WorkflowController workflowController;
    private WorkflowExecutionController executionController;
    private WorkflowLogController logController;

    @BeforeEach
    void setUp() {
        builderService = mock(WorkflowBuilderService.class);
        when(builderService.createWorkflow(any(), anyString())).thenReturn(new WorkflowBuilderDTO());
        engineService = mock(WorkflowEngineService.class);
        workflowService = mock(WorkflowService.class);
        executionService = mock(WorkflowExecutionService.class);
        runService = mock(UserWorkflowRunService.class);
        executionLogger = mock(WorkflowExecutionLogger.class);

        WorkflowRepository workflowRepository = mock(WorkflowRepository.class);
        Workflow workflow = new Workflow();
        workflow.setId(WF);
        workflow.setInstituteId(OWN);
        when(workflowRepository.findById(WF)).thenReturn(Optional.of(workflow));
        WorkflowExecutionRepository executionRepository = mock(WorkflowExecutionRepository.class);
        when(executionRepository.findInstituteIdByExecutionId("ex-1")).thenReturn(Optional.of(OWN));
        NodeTemplateRepository nodeTemplateRepository = mock(NodeTemplateRepository.class);
        NodeTemplate template = new NodeTemplate();
        template.setId("nt-1");
        template.setInstituteId(OWN);
        when(nodeTemplateRepository.findById("nt-1")).thenReturn(Optional.of(template));

        WorkflowAccessGuard guard = new WorkflowAccessGuard(new InstituteAccessValidator(), workflowRepository,
                executionRepository, nodeTemplateRepository);
        workflowController = new WorkflowController(workflowService, mock(WorkflowScheduleQueryService.class),
                builderService, mock(WorkflowValidationService.class), engineService,
                mock(WorkflowTemplateRepository.class), mock(WorkflowTriggerRepository.class),
                mock(AsyncWorkflowExecutor.class), mock(WorkflowContextSchemaService.class), new ObjectMapper(), guard);
        executionController = new WorkflowExecutionController(executionService, runService, guard);
        logController = new WorkflowLogController(executionLogger, guard);
        clientId(OWN);
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static void clientId(String instituteId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", instituteId);
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

    private static WorkflowBuilderDTO dto(String instituteId) {
        WorkflowBuilderDTO dto = new WorkflowBuilderDTO();
        dto.setName("Welcome");
        dto.setInstituteId(instituteId);
        return dto;
    }

    private static void assertRefused(Executable call) {
        RuntimeException e = assertThrows(RuntimeException.class, call);
        assertTrue(e instanceof ForbiddenException || e instanceof VacademyException, e.getClass().getName());
    }

    private void callEveryEndpoint(CustomUserDetails u, boolean expectAllowed) {
        List<Executable> calls = List.of(
                () -> workflowController.getActiveWorkflowsByInstituteId(OWN, u),
                () -> workflowController.createWorkflow(dto(OWN), "u-1", u),
                () -> workflowController.updateWorkflow(WF, dto(OWN), "u-1", u),
                () -> workflowController.getWorkflowForEditing(WF, u),
                () -> workflowController.deleteWorkflow(WF, u),
                () -> workflowController.getWorkflowRaw(WF, u),
                () -> workflowController.updateNodeTemplate(WF, "nt-1", new NodeTemplateUpdateDTO(), u),
                () -> workflowController.testRunWorkflow(WF, Map.of(), u),
                () -> workflowController.triggerWorkflowNow(WF, Map.of(), u),
                () -> executionController.getExecutionSummary(WF, null, null, u),
                () -> executionController.getRunsForUser("learner-1", OWN, 0, 20, u),
                () -> executionController.retryExecution("ex-1", OWN, u),
                () -> logController.getLogsByExecutionId("ex-1", u),
                () -> logController.getLogsByExecutionIdAndNodeId("ex-1", "n-1", u),
                () -> logController.getLogsByNodeTemplateId("nt-1", u));
        for (Executable call : calls) {
            if (expectAllowed) {
                try {
                    call.execute();
                } catch (Throwable t) {
                    throw new AssertionError("staff call refused: " + t, t);
                }
            } else {
                assertRefused(call);
            }
        }
    }

    @Test
    void staffOfTheOwningInstituteReachesEveryEndpoint() {
        when(engineService.run(anyString(), anyMap())).thenReturn(Map.of("status", "ok"));
        callEveryEndpoint(user(false, "ADMIN"), true);
        callEveryEndpoint(user(false, "TEACHER"), true);
        callEveryEndpoint(user(false, "STUDENT", "COUNSELLOR"), true);
        verify(engineService, org.mockito.Mockito.times(6)).run(eq(WF), anyMap());
    }

    @Test
    void learnersAndCallersWithoutARoleAreRefused() {
        callEveryEndpoint(user(false, "STUDENT"), false);
        callEveryEndpoint(user(true, "STUDENT"), false);
        callEveryEndpoint(user(false, "STUDENT", "TEACHER"), false);
        callEveryEndpoint(user(true), false);
        callEveryEndpoint(null, false);
        verifyNoInteractions(builderService, engineService, workflowService, runService, executionLogger);
    }

    @Test
    void staffOfAnotherInstituteIsRefused() {
        clientId(OTHER);
        callEveryEndpoint(user(false, "ADMIN"), false);
        assertRefused(() -> workflowController.createWorkflow(dto(OWN), "u-1", user(false, "ADMIN")));
        assertRefused(() -> workflowController.applyTemplate("00000000-0000-0000-0000-000000000001", OWN, "u-1", null,
                user(false, "ADMIN")));
        WorkflowExecutionFilterDTO filter = new WorkflowExecutionFilterDTO();
        filter.setInstituteId(OWN);
        assertRefused(() -> executionController.getWorkflowExecutions(filter, 0, 20, user(false, "ADMIN")));
        verifyNoInteractions(builderService, engineService, workflowService, executionService, runService, executionLogger);
    }

    @Test
    void updateCannotMoveNodesToAnotherInstitute() {
        assertRefused(() -> workflowController.updateWorkflow(WF, dto(OTHER), "u-1", user(false, "ADMIN")));
        verifyNoInteractions(builderService);
    }

    @Test
    void allowListedSuperAdminReachesAnyInstitutesAutomations() {
        clientId(OTHER);
        when(engineService.run(anyString(), anyMap())).thenReturn(Map.of("status", "ok"));
        try (MockedStatic<SuperAdminAuthUtil> util = mockStatic(SuperAdminAuthUtil.class)) {
            callEveryEndpoint(user(false, "ADMIN"), true);
            logController.getLogsByTimeRange(Instant.EPOCH, Instant.now(), 0, 20, user(false));
        }
        verify(builderService).getWorkflowForEditing(WF);
    }

    @Test
    void crossInstituteLogTimeRangeIsSuperAdminOnly() {
        assertRefused(() -> logController.getLogsByTimeRange(Instant.EPOCH, Instant.now(), 0, 20, user(false, "ADMIN")));
        verifyNoInteractions(executionLogger);
    }

    @Test
    void unknownWorkflowIsNotFound() {
        RuntimeException e = assertThrows(RuntimeException.class,
                () -> workflowController.triggerWorkflowNow("missing", Map.of(), user(false, "ADMIN")));
        assertEquals("404 NOT_FOUND \"Workflow not found: missing\"", e.getMessage());
        verifyNoInteractions(engineService);
    }
}
