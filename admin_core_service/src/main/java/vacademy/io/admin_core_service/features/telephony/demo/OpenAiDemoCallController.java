package vacademy.io.admin_core_service.features.telephony.demo;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Call status for the "Try the AI call" page (telleo.ai/try-ai-call). The page creates the
 * lead with the normal open lead-submit endpoint and polls this with the returned lead id.
 * Answers only for leads in a Try-the-AI-call list and returns nothing but the status.
 */
@RestController
@RequestMapping("/admin-core-service/open/v1/ai-demo-call")
@RequiredArgsConstructor
public class OpenAiDemoCallController {

    private final AiDemoCallService service;

    @GetMapping("/lead/{leadId}/status")
    public ResponseEntity<Map<String, Object>> status(@PathVariable String leadId) {
        return service.status(leadId)
                .map(st -> ResponseEntity.ok(Map.<String, Object>of("status", st)))
                .orElseGet(() -> ResponseEntity.status(404).body(Map.of("error", "Not found")));
    }
}
