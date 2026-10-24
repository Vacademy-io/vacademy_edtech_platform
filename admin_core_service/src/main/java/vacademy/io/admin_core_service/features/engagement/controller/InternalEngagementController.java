package vacademy.io.admin_core_service.features.engagement.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.engagement.service.EngagementLearnerService;
import vacademy.io.admin_core_service.features.points_ledger.service.PointsLedgerService;
import vacademy.io.admin_core_service.features.points_ledger.service.TutorQuizPointsService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Internal (service-to-service) read of a learner's Daily Engagement state for the learner AI
 * chatbot: the same feed the learner app's Today module shows (answer keys redacted exactly as
 * there) plus the server-side points summary and streak.
 *
 * <p>Guarded by {@code InternalAuthFilter} (HMAC clientName/Signature) via the
 * {@code /admin-core-service/internal/**} matcher. The caller passes the learner identity from its
 * own authenticated chat session. Read-only.
 */
@RestController
@RequestMapping("/admin-core-service/internal/engagement/v1")
@RequiredArgsConstructor
@Slf4j
public class InternalEngagementController {

    private final EngagementLearnerService learnerService;
    private final PointsLedgerService pointsLedgerService;
    private final TutorQuizPointsService tutorQuizPointsService;

    @GetMapping("/learner-snapshot")
    public ResponseEntity<Map<String, Object>> learnerSnapshot(
            @RequestParam String userId,
            @RequestParam String instituteId) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("feed", learnerService.getFeed(instituteId, userId));
        try {
            out.put("points", pointsLedgerService.getSummary(instituteId, userId));
        } catch (Exception e) {
            // Gamification-off institutes and summary hiccups must not hide the tasks.
            log.warn("learner-snapshot: points summary unavailable for {}: {}", userId, e.getMessage());
            out.put("points", null);
        }
        return ResponseEntity.ok(out);
    }

    /**
     * Points for a passed AI-tutor practice quiz (small, once per quiz, capped per day; see
     * {@link TutorQuizPointsService}). Body: {@code {user_id, institute_id, quiz_id, percentage}}.
     */
    @PostMapping("/tutor-quiz-points")
    public ResponseEntity<Map<String, Object>> tutorQuizPoints(@RequestBody Map<String, Object> body) {
        double pct;
        try {
            pct = Double.parseDouble(String.valueOf(body.getOrDefault("percentage", "0")));
        } catch (NumberFormatException e) {
            pct = 0;
        }
        return ResponseEntity.ok(tutorQuizPointsService.award(
                (String) body.get("user_id"), (String) body.get("institute_id"),
                (String) body.get("quiz_id"), pct));
    }
}
