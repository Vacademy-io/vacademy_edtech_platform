package vacademy.io.admin_core_service.features.assignment_ai_evaluation.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.service.AssignmentAiEvaluationService;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import java.util.function.Consumer;

/**
 * ai_service copy-check callbacks for assignment runs. The grade request carries
 * callback_base_url = .../assignment-ai-evaluation/hook, and ai_service appends
 * /copy-check/callback/{progress,question,complete,failed}.
 *
 * <p>No JWT (permitAll in ApplicationSecurityConfig), but not open: every call must carry
 * the shared X-Internal-Service-Token. The path avoids the word "internal" on purpose -
 * InternalAuthFilter substring-matches it and would demand an HMAC signature instead.
 */
@Slf4j
@RestController
@RequestMapping("/admin-core-service/assignment-ai-evaluation/hook/copy-check/callback")
public class AssignmentCopyCheckCallbackController {

    private final AssignmentAiEvaluationService evaluationService;
    private final String expectedToken;

    public AssignmentCopyCheckCallbackController(
            AssignmentAiEvaluationService evaluationService,
            @Value("${internal.service.token:${ai.service.internal.token:}}") String expectedToken) {
        this.evaluationService = evaluationService;
        this.expectedToken = expectedToken;
    }

    @PostMapping("/progress")
    public ResponseEntity<Void> progress(@RequestHeader(value = "X-Internal-Service-Token", required = false) String token,
                                         @RequestBody Map<String, Object> payload) {
        return handle(token, payload, evaluationService::onProgress);
    }

    @PostMapping("/question")
    public ResponseEntity<Void> question(@RequestHeader(value = "X-Internal-Service-Token", required = false) String token,
                                         @RequestBody Map<String, Object> payload) {
        return handle(token, payload, evaluationService::onQuestion);
    }

    @PostMapping("/complete")
    public ResponseEntity<Void> complete(@RequestHeader(value = "X-Internal-Service-Token", required = false) String token,
                                         @RequestBody Map<String, Object> payload) {
        return handle(token, payload, evaluationService::onComplete);
    }

    @PostMapping("/failed")
    public ResponseEntity<Void> failed(@RequestHeader(value = "X-Internal-Service-Token", required = false) String token,
                                       @RequestBody Map<String, Object> payload) {
        return handle(token, payload, evaluationService::onFailed);
    }

    private ResponseEntity<Void> handle(String token, Map<String, Object> payload, Consumer<Map<String, Object>> action) {
        if (!verify(token)) {
            return ResponseEntity.status(401).build();
        }
        action.accept(payload);
        return ResponseEntity.ok().build();
    }

    /** Constant-time comparison so the token cannot be recovered by timing. */
    private boolean verify(String token) {
        if (expectedToken == null || expectedToken.isEmpty()) {
            log.error("[assignment-ai-eval] callback rejected: internal.service.token is not configured");
            return false;
        }
        if (token == null || token.isEmpty()) {
            return false;
        }
        return MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8),
                expectedToken.getBytes(StandardCharsets.UTF_8));
    }
}
