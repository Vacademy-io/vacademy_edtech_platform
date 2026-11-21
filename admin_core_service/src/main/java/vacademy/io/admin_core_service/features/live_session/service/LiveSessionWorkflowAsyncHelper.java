package vacademy.io.admin_core_service.features.live_session.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Fires the {@code LIVE_SESSION_CREATE} workflow trigger off the request
 * thread. Used by the bulk endpoint so creating N sessions doesn't pay the
 * cost of N synchronous workflow runs (each one fetches attendance reports,
 * renders HTML, and POSTs to the notification service).
 *
 * <p>Single-class flow continues to fire the workflow synchronously inside
 * {@link Step1Service#step1AddService}; only the bulk path opts out and uses
 * this helper.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class LiveSessionWorkflowAsyncHelper {

    private final WorkflowTriggerService workflowTriggerService;

    /**
     * Field-injected and {@code @Lazy}: the CRM {@link AudienceService} is a large bean
     * with a wide dependency graph, so a lazy proxy here keeps a stray back-reference
     * from ever forming a startup bean cycle through this helper.
     */
    @Autowired
    @Lazy
    private AudienceService audienceService;

    /**
     * Fire-and-forget workflow trigger. Errors are logged and swallowed —
     * never propagated back to the request thread.
     */
    @Async
    public void fireLiveSessionCreateWorkflow(LiveSession session,
                                              String createdBy,
                                              String instituteId) {
        if (session == null || instituteId == null) return;
        try {
            Map<String, Object> contextData = new HashMap<>();
            contextData.put("liveSession", session);
            contextData.put("createdBy", createdBy);
            workflowTriggerService.handleTriggerEvents(
                    WorkflowTriggerEvent.LIVE_SESSION_CREATE.name(),
                    session.getId(),
                    instituteId,
                    contextData);
        } catch (Exception e) {
            log.warn("Async LIVE_SESSION_CREATE workflow failed for sessionId={}: {}",
                    session.getId(), e.getMessage(), e);
        }
    }

    /**
     * Fires {@code LIVE_SESSION_FORM_SUBMISSION} after a guest submits a session's
     * public registration form. Scoped by session id, so a trigger can be configured
     * for one webinar without firing for every public session in the institute.
     *
     * <p>Async because the caller is an unauthenticated public form POST: the guest
     * should not wait on a WhatsApp/email round-trip, and a notification failure must
     * never fail a registration that is already committed. Pinned to the bounded
     * {@code workflowTaskExecutor} (not the default unbounded SimpleAsyncTaskExecutor)
     * so a burst of registrations for a popular webinar cannot spawn unbounded threads.
     */
    @Async("workflowTaskExecutor")
    public void fireLiveSessionFormSubmissionWorkflow(String sessionId,
                                                      String instituteId,
                                                      Map<String, Object> contextData) {
        if (sessionId == null || instituteId == null) return;
        try {
            workflowTriggerService.handleTriggerEvents(
                    WorkflowTriggerEvent.LIVE_SESSION_FORM_SUBMISSION.name(),
                    sessionId,
                    instituteId,
                    contextData);
        } catch (Exception e) {
            log.warn("Async LIVE_SESSION_FORM_SUBMISSION workflow failed for sessionId={}: {}",
                    sessionId, e.getMessage(), e);
        }
    }

    /**
     * Turns a public live-class registration into a CRM lead off the request thread.
     *
     * <p>Every public live-class registrant should surface in Audience Manager → Recent
     * Leads. {@link AudienceService#submitLiveClassLead} creates the auth-service user and
     * the {@code audience_response} without firing any workflow, so the registrant is not
     * double-messaged on top of their seat-confirmation. Pinned to the same bounded
     * {@code workflowTaskExecutor} as form-submission so a webinar burst cannot spawn
     * unbounded threads; fire-and-forget, errors logged and swallowed.
     *
     * <p>{@code extraAudienceIds} — the session's "save registrants to audience list(s)"
     * selection (empty/null when the toggle is off). The registrant is pushed into each,
     * on top of the session's own list; each push is isolated so one bad list cannot block
     * the others.
     *
     * <p>{@code sessionTitle} names the session's own list ("&lt;title&gt; - Public Live
     * Session"), created on its first registration.
     */
    @Async("workflowTaskExecutor")
    public void createLiveClassLeadAsync(String instituteId, String fullName, String email,
                                         String mobileNumber, Map<String, String> extraFieldsById,
                                         String sessionId, String sessionTitle, List<String> extraAudienceIds) {
        if (instituteId == null || email == null || email.isBlank()) return;
        try {
            audienceService.submitLiveClassLead(instituteId, fullName, email, mobileNumber,
                    extraFieldsById, sessionId, sessionTitle);
        } catch (Exception e) {
            log.warn("Async live-class lead capture failed for institute={} session={}: {}",
                    instituteId, sessionId, e.getMessage(), e);
        }
        if (extraAudienceIds == null) return;
        for (String audienceId : extraAudienceIds) {
            try {
                audienceService.submitLiveClassLeadToAudienceId(audienceId, instituteId, fullName,
                        email, mobileNumber, extraFieldsById, sessionId);
            } catch (Exception e) {
                log.warn("Async live-class lead push to audience {} failed for institute={} session={}: {}",
                        audienceId, instituteId, sessionId, e.getMessage(), e);
            }
        }
    }
}
