package vacademy.io.admin_core_service.features.doubts.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.doubts.manager.DoubtsManager;

import java.util.Map;

/**
 * Internal (service-to-service) doubt creation for the learner AI chatbot: when the tutor cannot
 * resolve something and the learner agrees, ai_service hands the question to a teacher through
 * the regular doubt pipeline (routing, notifications, workflow).
 *
 * <p>Guarded by {@code InternalAuthFilter} (HMAC clientName/Signature) via the
 * {@code /admin-core-service/internal/**} matcher — never reachable with a learner token.
 */
@RestController
@RequestMapping("/admin-core-service/internal/doubts/v1")
@RequiredArgsConstructor
@Slf4j
public class InternalDoubtsController {

    private final DoubtsManager doubtsManager;

    /**
     * Body: {@code {user_id, institute_id, batch_id?, slide_id?, type?, text}}.
     * Returns {@code {doubt_id}}.
     */
    @PostMapping("/learner-create")
    public ResponseEntity<Map<String, String>> createForLearner(@RequestBody Map<String, String> body) {
        String doubtId = doubtsManager.createDoubtForLearner(
                body.get("user_id"),
                body.get("institute_id"),
                body.get("batch_id"),
                body.get("slide_id"),
                body.get("type"),
                body.get("text"));
        log.info("internal/doubts/learner-create: doubt {} for user {} in institute {}",
                doubtId, body.get("user_id"), body.get("institute_id"));
        return ResponseEntity.ok(Map.of("doubt_id", doubtId));
    }
}
