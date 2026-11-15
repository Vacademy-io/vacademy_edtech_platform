package vacademy.io.admin_core_service.features.telephony.demo;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Anonymous endpoints behind the "Try the AI call" page (telleo.ai/try-ai-call), reached
 * from an exhibition QR code. Open by design (/open/** is permitAll); abuse is bounded by
 * {@link AiDemoCallRateLimiter} and a request is only useful from the phone it names.
 * Voices, prompts and the agent id are never exposed.
 */
@RestController
@RequestMapping("/admin-core-service/open/v1/ai-demo-call/{instituteId}")
@RequiredArgsConstructor
public class OpenAiDemoCallController {

    private final AiDemoCallService service;
    private final AiDemoCallRateLimiter rateLimiter;

    @GetMapping("/config")
    public ResponseEntity<Map<String, Object>> config(@PathVariable String instituteId) {
        Map<String, Object> out = new LinkedHashMap<>();
        AiDemoCallSettings s = service.settings(instituteId).orElse(null);
        out.put("enabled", s != null && s.isEnabled());
        if (s == null) return ResponseEntity.ok(out);
        out.put("dialNumber", s.getDialNumber());
        out.put("displayNumber", s.getDisplayNumber() != null ? s.getDisplayNumber() : s.getDialNumber());
        List<Map<String, String>> langs = s.effectiveLanguages().stream()
                .map(l -> Map.of("code", l.getCode(), "label", l.getLabel(), "nativeLabel", l.getNativeLabel()))
                .toList();
        out.put("languages", langs);
        out.put("ttlMinutes", s.ttlMinutesOrDefault());
        return ResponseEntity.ok(out);
    }

    public record CreateRequest(String name, String organisation, String phone, String language, String source) { }

    @PostMapping("/request")
    public ResponseEntity<Map<String, Object>> create(@PathVariable String instituteId,
                                                      @RequestBody CreateRequest body,
                                                      HttpServletRequest http) {
        if (body == null) return error(400, "Please fill in the form.");
        String ip = clientIp(http);
        String phone = AiDemoCallService.indianMobile(body.phone());
        if (phone != null && !rateLimiter.tryAcquire(instituteId, phone, ip)) {
            return error(429, "Too many tries. Please wait a minute and try again.");
        }
        try {
            AiDemoCallRequest r = service.createRequest(instituteId, body.name(), body.organisation(),
                    body.phone(), body.language(), body.source(), ip);
            AiDemoCallSettings s = service.enabledSettings(instituteId).orElseThrow();
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("requestId", r.getId());
            out.put("status", r.getStatus());
            out.put("dialNumber", s.getDialNumber());
            out.put("displayNumber", s.getDisplayNumber() != null ? s.getDisplayNumber() : s.getDialNumber());
            out.put("telUri", "tel:" + (s.getDialNumber() == null ? "" : s.getDialNumber().replaceAll("[^+0-9]", "")));
            out.put("expiresAt", r.getExpiresAt().toInstant().toString());
            return ResponseEntity.ok(out);
        } catch (AiDemoCallService.DemoCallException e) {
            return error(e.getStatus(), e.getMessage());
        }
    }

    @GetMapping("/request/{requestId}")
    public ResponseEntity<Map<String, Object>> status(@PathVariable String instituteId,
                                                      @PathVariable String requestId) {
        return service.status(instituteId, requestId)
                .map(st -> ResponseEntity.ok(Map.<String, Object>of("status", st)))
                .orElseGet(() -> error(404, "Request not found."));
    }

    private static ResponseEntity<Map<String, Object>> error(int status, String message) {
        return ResponseEntity.status(status).body(Map.of("error", message));
    }

    /** Real client IP behind the ingress/CDN: the left-most X-Forwarded-For entry. */
    private static String clientIp(HttpServletRequest request) {
        String xff = request.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) return xff.split(",")[0].trim();
        String real = request.getHeader("X-Real-IP");
        return (real != null && !real.isBlank()) ? real.trim() : request.getRemoteAddr();
    }
}
