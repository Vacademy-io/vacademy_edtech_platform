package vacademy.io.admin_core_service.features.engagement.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestBody;
import vacademy.io.admin_core_service.features.engagement.service.ContactResolver;
import vacademy.io.admin_core_service.features.engagement.service.EngagementAccessGuard;
import vacademy.io.admin_core_service.features.engagement.service.EngagementDispatcher;
import vacademy.io.admin_core_service.features.engagement.service.EngagementTaskQueryService;
import vacademy.io.admin_core_service.features.engagement.service.EngagementTaskQueryService.TaskFilter;
import vacademy.io.admin_core_service.features.engagement.report.EngagementActionOutcomeService.ActionOutcome;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.spi.Subject;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * The Phase 1 copilot inbox: institute-wide, unassigned (founder call, D6) — every decision
 * visible, ranked by priority, filtered in the UI. Ack / Done / Dismiss here; send-on-behalf
 * arrives with the dispatcher in Phase 1b (a send needs the at-most-once claim + Phase 0's
 * correlation stamping end-to-end).
 *
 * Outcomes recorded here (ACCEPTED / DISMISSED) are the labels Phase 2/3 learn from — which
 * is why the dismissal-rate alarm matters: past ~80% dismissals the labels are noise.
 */
@RestController
@RequestMapping("/admin-core-service/v1/engagement/tasks")
@RequiredArgsConstructor
public class EngagementTaskController {

    private final EngagementActionRepository actionRepository;
    private final EngagementAccessGuard accessGuard;
    private final EngagementDispatcher dispatcher;
    private final EngagementMemberRepository memberRepository;
    private final ContactResolver contactResolver;
    private final EngagementTaskQueryService taskQueryService;

    /** Most ids one people lookup resolves: an inbox page is at most 200 tasks. */
    private static final int MAX_PEOPLE_LOOKUP = 200;

    /**
     * The inbox, and the daily report's drill-down into it. Without any of the optional filters
     * this is the plain inbox (findInbox, ranked by priority). With them (EngagementTaskQueryService):
     * engineId (404 when not this institute's), channel EMAIL|WHATSAPP|IN_APP|AI_CALL, kind
     * TASK|REPLY|SEND|NO_OP|CRM (NO_OP rows only for kind=NO_OP; CRM = a TASK with a CRM action
     * type), date YYYY-MM-DD in the institute's zone on COALESCE(dispatched_at, created_at), newest
     * first, or from + to (a period, inclusive; wins over date; the report's rules: both or neither,
     * from ≤ to, not in the future, from today − 89), template (WhatsApp template, email subject or
     * email template), and outcome (needs date or from / to) as the report counts it.
     */
    @GetMapping
    public ResponseEntity<Page<EngagementAction>> inbox(
            @RequestParam String instituteId,
            @RequestParam(defaultValue = "OPEN,ACKED") String statuses,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size,
            @RequestParam(required = false) String engineId,
            @RequestParam(required = false) String channel,
            @RequestParam(required = false) String kind,
            @RequestParam(required = false) String date,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(required = false) String template,
            @RequestParam(required = false) String outcome,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        List<String> statusList = List.of(statuses.split(","));
        TaskFilter filter = new TaskFilter(engineId, channel, kind, date, from, to, template, outcome);
        if (filter.isEmpty()) {
            return ResponseEntity.ok(actionRepository.findInbox(
                    instituteId, statusList, null, null, null, PageRequest.of(page, Math.min(size, 200))));
        }
        return ResponseEntity.ok(taskQueryService.inbox(instituteId, statusList, filter, page, Math.min(size, 200)));
    }

    /**
     * What became of each task once it went out, for the inbox's outcome column: delivery, opens,
     * bounces, the credited reply, an AI call's result. At most 200 ids; actions of another
     * institute are left out. 503 when notification_service cannot say.
     */
    @GetMapping("/outcomes")
    public ResponseEntity<List<ActionOutcome>> outcomes(
            @RequestParam String instituteId,
            @RequestParam String actionIds,
            @RequestAttribute("user") CustomUserDetails user) {
        try {
            accessGuard.requireAdmin(user, instituteId);
        } catch (VacademyException e) {
            // The shared guard answers 510 for every refusal; this endpoint is new, so it says 403.
            throw new ForbiddenException(e.getMessage());
        }
        return ResponseEntity.ok(taskQueryService.outcomes(instituteId, actionIds));
    }

    /**
     * Who each task is for: name, phone and email of the members behind an inbox page, so the
     * admin sees the person, not just the engine. Members of another institute are left out.
     */
    @GetMapping("/people")
    public ResponseEntity<List<Subject>> people(
            @RequestParam String instituteId,
            @RequestParam String memberIds,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        List<String> ids = Arrays.stream(memberIds.split(","))
                .map(String::trim).filter(s -> !s.isEmpty()).distinct().limit(MAX_PEOPLE_LOOKUP).toList();
        if (ids.isEmpty()) return ResponseEntity.ok(List.of());
        List<EngagementMember> members = memberRepository.findAllById(ids).stream()
                .filter(m -> instituteId.equals(m.getInstituteId()))
                .toList();
        return ResponseEntity.ok(contactResolver.resolve(members));
    }

    @Auditable(
            entityType = "ENGAGEMENT_TASK",
            action = "ACK",
            entityIdExpr = "#taskId",
            descriptionExpr = "'acknowledged an engagement task'")
    @PostMapping("/{taskId}/ack")
    public ResponseEntity<Void> ack(@PathVariable String taskId,
                                    @RequestParam String instituteId,
                                    @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        transition(taskId, instituteId, "ACKED", null);
        return ResponseEntity.ok().build();
    }

    /** Handled outside the system (called them, spoke in person, sent manually). */
    @Auditable(
            entityType = "ENGAGEMENT_TASK",
            action = "DONE",
            entityIdExpr = "#taskId",
            descriptionExpr = "'marked an engagement task done'")
    @PostMapping("/{taskId}/done")
    public ResponseEntity<Void> done(@PathVariable String taskId,
                                     @RequestParam String instituteId,
                                     @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        transition(taskId, instituteId, "DONE", "ACCEPTED");
        return ResponseEntity.ok().build();
    }

    @Auditable(
            entityType = "ENGAGEMENT_TASK",
            action = "DISMISS",
            entityIdExpr = "#taskId",
            descriptionExpr = "'dismissed an engagement task'")
    @PostMapping("/{taskId}/dismiss")
    public ResponseEntity<Void> dismiss(@PathVariable String taskId,
                                        @RequestParam String instituteId,
                                        @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        transition(taskId, instituteId, "DISMISSED", "DISMISSED");
        return ResponseEntity.ok().build();
    }

    /**
     * Send-on-behalf: the human reviews the AI draft, optionally edits it, and sends. The claim
     * (OPEN/ACKED → DISPATCHING) is atomic so two admins can't double-send; then the dispatcher
     * settles to SENT/FAILED. Body {"editedBody": "..."} is optional; absent = send the draft as-is.
     */
    @Auditable(
            entityType = "ENGAGEMENT_TASK",
            action = "SEND",
            entityIdExpr = "#taskId",
            descriptionExpr = "'sent an engagement message (' + (#result?.body?.channel ?: '?') + ', ' + (#result?.body?.status ?: '?') + ')'")
    @PostMapping("/{taskId}/send")
    public ResponseEntity<EngagementAction> send(@PathVariable String taskId,
                                                 @RequestParam String instituteId,
                                                 @RequestBody(required = false) Map<String, String> body,
                                                 @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        int claimed = actionRepository.claimForDispatch(taskId, instituteId, Instant.now());
        if (claimed == 0) {
            throw new VacademyException("Task not found, not sendable, or already being handled");
        }
        EngagementAction action = actionRepository.findById(taskId)
                .orElseThrow(() -> new VacademyException("Task vanished after claim"));
        String editedBody = body != null ? body.get("editedBody") : null;
        return ResponseEntity.ok(dispatcher.dispatchClaimed(action, editedBody, user.getUserId()));
    }

    /**
     * Reopen a FAILED task after the human has confirmed it did NOT actually land (the send may
     * have succeeded with a lost response — check the ledger by correlation_id before reopening).
     * FAILED → OPEN so it re-enters the inbox and can be re-sent.
     */
    @Auditable(
            entityType = "ENGAGEMENT_TASK",
            action = "REOPEN",
            entityIdExpr = "#taskId",
            descriptionExpr = "'reopened a failed engagement task'")
    @PostMapping("/{taskId}/reopen")
    public ResponseEntity<Void> reopen(@PathVariable String taskId,
                                       @RequestParam String instituteId,
                                       @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        Instant now = Instant.now();
        int updated = actionRepository.reopenFailed(taskId, instituteId, now, now.plus(java.time.Duration.ofHours(72)));
        if (updated == 0) throw new VacademyException("Task not found or not in a FAILED state");
        return ResponseEntity.ok().build();
    }

    /** Undo Done / Dismiss: the task goes back to the inbox as OPEN. */
    @Auditable(
            entityType = "ENGAGEMENT_TASK",
            action = "RESTORE",
            entityIdExpr = "#taskId",
            descriptionExpr = "'restored a handled engagement task'")
    @PostMapping("/{taskId}/restore")
    public ResponseEntity<Void> restore(@PathVariable String taskId,
                                        @RequestParam String instituteId,
                                        @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        Instant now = Instant.now();
        int updated = actionRepository.restoreHandled(taskId, instituteId, now, now.plus(java.time.Duration.ofHours(72)));
        if (updated == 0) throw new VacademyException("Task not found or not marked done or dismissed");
        return ResponseEntity.ok().build();
    }

    private void transition(String taskId, String instituteId, String toStatus, String outcome) {
        int updated = actionRepository.transitionTask(taskId, instituteId, toStatus, outcome, Instant.now());
        if (updated == 0) {
            throw new VacademyException("Task not found, not open, or already handled by someone else");
        }
    }
}
