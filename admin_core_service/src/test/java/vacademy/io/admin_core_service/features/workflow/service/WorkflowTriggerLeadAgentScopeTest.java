package vacademy.io.admin_core_service.features.workflow.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowTriggerRepository;

import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Leads the Lead Agent delivers run only the workflows of their own list, never institute-wide ones. */
class WorkflowTriggerLeadAgentScopeTest {

    private static final String EVENT = "AUDIENCE_LEAD_SUBMISSION";

    private WorkflowTriggerRepository repo;
    private WorkflowTriggerService service;

    @BeforeEach
    void setUp() {
        repo = mock(WorkflowTriggerRepository.class);
        when(repo.findSpecificTriggers(any(), any(), any(), anyList())).thenReturn(List.of());
        when(repo.findGlobalTriggers(any(), any(), anyList())).thenReturn(List.of());
        service = new WorkflowTriggerService();
        ReflectionTestUtils.setField(service, "workflowTriggerRepository", repo);
    }

    @Test
    void aLeadAgentLeadNeverFallsBackToInstituteWideTriggers() {
        service.handleTriggerEvents(EVENT, "list-1", "inst-1", Map.of("sourceType", "LEAD_AGENT"));
        verify(repo).findSpecificTriggers(eq("inst-1"), eq("list-1"), eq(EVENT), anyList());
        verify(repo, never()).findGlobalTriggers(any(), any(), anyList());
    }

    @Test
    void anyOtherLeadStillFallsBackToInstituteWideTriggers() {
        service.handleTriggerEvents(EVENT, "list-1", "inst-1", Map.of("sourceType", "WEBSITE"));
        verify(repo).findGlobalTriggers(eq("inst-1"), eq(EVENT), anyList());
    }
}
