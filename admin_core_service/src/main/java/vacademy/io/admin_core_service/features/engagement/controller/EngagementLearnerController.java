package vacademy.io.admin_core_service.features.engagement.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementFeedDTO;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementHistoryDTO;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementItemDTO;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementSubmitRequest;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementSubmitResponse;
import vacademy.io.admin_core_service.features.engagement.service.EngagementLearnerService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * The learner side of daily engagement.
 *
 * The learner is ALWAYS taken from the JWT, never from a parameter, and every read
 * re-checks batch enrollment — an item id alone must never be enough to open or
 * submit someone else's task.
 */
@RestController
@RequestMapping("/admin-core-service/engagement/learner/v1")
@RequiredArgsConstructor
@Slf4j
public class EngagementLearnerController {

    private final EngagementLearnerService learnerService;

    /** Today's items across every batch, already ordered and capped. */
    @GetMapping("/feed")
    public ResponseEntity<EngagementFeedDTO> feed(
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(learnerService.getFeed(instituteId, user.getUserId()));
    }

    /** Past occurrences — done, missed, or still catchable — newest first. */
    @GetMapping("/history")
    public ResponseEntity<EngagementHistoryDTO> history(
            @RequestParam String instituteId,
            @RequestParam(defaultValue = "30") int days,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(learnerService.getHistory(instituteId, user.getUserId(), days));
    }

    /** Full payload for an item that is open (or still catchable) for this learner. */
    @GetMapping("/item/{itemId}")
    public ResponseEntity<EngagementItemDTO> item(
            @PathVariable String itemId,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(learnerService.getItem(itemId, instituteId, user.getUserId()));
    }

    @PostMapping("/item/{itemId}/submit")
    public ResponseEntity<EngagementSubmitResponse> submit(
            @PathVariable String itemId,
            @RequestParam String instituteId,
            @RequestBody EngagementSubmitRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(
                learnerService.submit(itemId, instituteId, user.getUserId(), request));
    }
}
