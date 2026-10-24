package vacademy.io.admin_core_service.features.engagement.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestBody;
import vacademy.io.admin_core_service.features.engagement.service.EngagementAccessGuard;
import vacademy.io.admin_core_service.features.engagement.service.EngagementDispatcher;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Instant;
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

    @GetMapping
    public ResponseEntity<Page<EngagementAction>> inbox(
            @RequestParam String instituteId,
            @RequestParam(defaultValue = "OPEN,ACKED") String statuses,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        List<String> statusList = List.of(statuses.split(","));
        return ResponseEntity.ok(actionRepository.findInbox(
                instituteId, statusList, PageRequest.of(page, Math.min(size, 200))));
    }

    @PostMapping("/{taskId}/ack")
    public ResponseEntity<Void> ack(@PathVariable String taskId,
                                    @RequestParam String instituteId,
                                    @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        transition(taskId, instituteId, "ACKED", null);
        return ResponseEntity.ok().build();
    }

    /** Handled outside the system (called them, spoke in person, sent manually). */
    @PostMapping("/{taskId}/done")
    public ResponseEntity<Void> done(@PathVariable String taskId,
                                     @RequestParam String instituteId,
                                     @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        transition(taskId, instituteId, "DONE", "ACCEPTED");
        return ResponseEntity.ok().build();
    }

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

    private void transition(String taskId, String instituteId, String toStatus, String outcome) {
        int updated = actionRepository.transitionTask(taskId, instituteId, toStatus, outcome, Instant.now());
        if (updated == 0) {
            throw new VacademyException("Task not found, not open, or already handled by someone else");
        }
    }
}
