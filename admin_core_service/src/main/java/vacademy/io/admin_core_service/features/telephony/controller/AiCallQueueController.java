package vacademy.io.admin_core_service.features.telephony.controller;

import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.telephony.queue.AiCallQueueService;
import vacademy.io.admin_core_service.features.telephony.queue.dto.AiCallQueueDTOs.BulkRunSummary;
import vacademy.io.admin_core_service.features.telephony.queue.dto.AiCallQueueDTOs.QueueItemView;
import vacademy.io.admin_core_service.features.telephony.queue.dto.AiCallQueueDTOs.LaneView;
import vacademy.io.admin_core_service.features.telephony.queue.dto.AiCallQueueDTOs.QueueSummary;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Map;

/**
 * An institute's own view of the AI call queue: what is waiting, how long it will take,
 * and the ability to call it off.
 *
 * <p>Read and cancel only, and it discloses no capacity figures. How many lines the
 * fleet has, and how many an institute may hold, are internal operating facts that live
 * on the super-admin and internal endpoints — an institute does not need to know it is
 * sharing a small pool, only how long its own calls will wait.
 */
@RestController
@RequestMapping("/admin-core-service/v1/telephony/ai-queue")
@RequiredArgsConstructor
public class AiCallQueueController {

    private final AiCallQueueService queueService;
    private final InstituteAccessValidator instituteAccessValidator;

    /** Paged queue rows. {@code status} filters to one lifecycle state (e.g. QUEUED). */
    @GetMapping
    public ResponseEntity<Page<QueueItemView>> list(
            @RequestParam String instituteId,
            @RequestParam(value = "status", required = false) String status,
            /** Optional bulk-run (audience) id — narrows the list to one campaign. */
            @RequestParam(value = "sourceRef", required = false) String sourceRef,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "25") int size,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return ResponseEntity.ok(queueService.list(instituteId, status, sourceRef, page, size));
    }

    /**
     * Hold this institute's queue. Nothing is cancelled — the calls keep their place
     * and their order, the dialler just steps over them until the queue is resumed.
     * Scoped to the caller's own institute, so an admin can stop their own campaign
     * without needing a super-admin.
     */
    @PostMapping("/pause")
    public ResponseEntity<LaneView> pause(
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return ResponseEntity.ok(queueService.setQueuePaused(instituteId, true));
    }

    /** Release a held queue. The next drain tick picks the calls up where they left off. */
    @PostMapping("/resume")
    public ResponseEntity<LaneView> resume(
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return ResponseEntity.ok(queueService.setQueuePaused(instituteId, false));
    }

    /** Bulk runs this institute has queued, newest first — the campaign filter's options. */
    @GetMapping("/runs")
    public ResponseEntity<List<Map<String, Object>>> runs(
            @RequestParam String instituteId,
            @RequestParam(value = "limit", defaultValue = "20") int limit,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return ResponseEntity.ok(queueService.recentRuns(instituteId, limit));
    }

    /** Depth, in-flight, the lane's share of the fleet, and a rough time-to-clear. */
    @GetMapping("/summary")
    public ResponseEntity<QueueSummary> summary(
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return ResponseEntity.ok(queueService.summary(instituteId));
    }

    /**
     * Progress of one bulk run, counted from the QUEUE rather than the call log — so a
     * 100-lead run reports 100, not just the handful that have dialled so far, and a
     * lead the queue cancelled still counts toward "finished".
     */
    @GetMapping("/bulk-run")
    public ResponseEntity<BulkRunSummary> bulkRun(
            @RequestParam String instituteId,
            @RequestParam String audienceId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return ResponseEntity.ok(queueService.bulkRunSummary(instituteId, audienceId));
    }

    /** Every lead the run enqueued, in dial order — waiting ones included. */
    @GetMapping("/bulk-run/items")
    public ResponseEntity<Page<QueueItemView>> bulkRunItems(
            @RequestParam String instituteId,
            @RequestParam String audienceId,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "200") int size,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return ResponseEntity.ok(queueService.bulkRunItems(instituteId, audienceId, page, size));
    }

    @Data
    public static class CancelBody {
        /** Optional: cancel only one bulk run's items (the audience id it was started from). */
        private String sourceRef;
        private String reason;
    }

    /**
     * Cancel everything this institute still has waiting — optionally narrowed to one
     * bulk run. Only QUEUED items are affected: a call already dialling is not something
     * this can take back.
     */
    @PostMapping("/cancel")
    public ResponseEntity<Map<String, Object>> cancel(
            @RequestParam String instituteId,
            @RequestBody(required = false) CancelBody body,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        int cancelled = queueService.cancelForInstitute(instituteId,
                body == null ? null : body.getSourceRef(),
                body == null ? null : body.getReason());
        return ResponseEntity.ok(Map.of("cancelled", cancelled));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, Object>> cancelOne(
            @PathVariable String id,
            @RequestParam String instituteId,
            @RequestParam(value = "reason", required = false) String reason,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        boolean cancelled = queueService.cancelOne(instituteId, id, reason);
        return ResponseEntity.ok(Map.of("cancelled", cancelled));
    }
}
