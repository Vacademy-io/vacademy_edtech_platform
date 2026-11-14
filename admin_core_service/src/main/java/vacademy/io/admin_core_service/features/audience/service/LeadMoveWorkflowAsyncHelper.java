package vacademy.io.admin_core_service.features.audience.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;

import java.util.List;
import java.util.Map;

/**
 * Fires the destination list's {@code AUDIENCE_LEAD_SUBMISSION} workflows for leads that were
 * just MOVED into it, off the request thread.
 *
 * <p>Separate bean (not a method on {@link AudienceService}) so Spring's {@code @Async} proxy
 * actually applies — a self-call inside AudienceService would run inline. Pinned to the bounded
 * {@code workflowTaskExecutor}: a move can carry hundreds of leads and each one runs a full
 * workflow graph (an AI-call list dials and pauses per lead), which must not hold the admin's
 * HTTP request open or spawn unbounded threads. Fire-and-forget; one failing lead never blocks
 * the rest.
 *
 * <p>Called only AFTER the move transaction committed (see {@code AudienceService.migrateLeads}),
 * so every workflow sees the lead already sitting in the target list.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LeadMoveWorkflowAsyncHelper {

    private final WorkflowTriggerService workflowTriggerService;

    @Async("workflowTaskExecutor")
    public void fireDestinationLeadSubmission(String targetAudienceId, String instituteId,
                                              List<Map<String, Object>> leadContexts) {
        if (targetAudienceId == null || instituteId == null || leadContexts == null || leadContexts.isEmpty()) {
            return;
        }
        int fired = 0;
        for (Map<String, Object> ctx : leadContexts) {
            try {
                workflowTriggerService.handleTriggerEvents(
                        WorkflowTriggerEvent.AUDIENCE_LEAD_SUBMISSION.name(),
                        targetAudienceId,
                        instituteId,
                        ctx);
                fired++;
            } catch (Exception e) {
                log.warn("Moved-lead AUDIENCE_LEAD_SUBMISSION workflow failed for response {} → audience {}: {}",
                        ctx.get("responseId"), targetAudienceId, e.getMessage(), e);
            }
        }
        log.info("Moved-lead automations: fired {}/{} AUDIENCE_LEAD_SUBMISSION run(s) on audience {}",
                fired, leadContexts.size(), targetAudienceId);
    }
}
