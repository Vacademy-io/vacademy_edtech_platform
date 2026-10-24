package vacademy.io.admin_core_service.features.telephony.controller;

import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.telephony.publicapi.AiCallingApiException;
import vacademy.io.admin_core_service.features.telephony.publicapi.AiCallingWebhookService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The AI calling API webhook, managed from the admin dashboard (Settings → AI calling API).
 * Same operations as the API's own /v1/webhook routes, for an institute ADMIN signed in
 * with a JWT. Errors here keep the API's {"error":{…}} shape so the card can show them.
 */
@RestController
@RequestMapping("/admin-core-service/v1/telephony/ai-call/webhook")
@RequiredArgsConstructor
public class AiCallingWebhookAdminController {

    private final AiCallingWebhookService webhooks;
    private final InstituteAccessValidator instituteAccessValidator;

    @GetMapping
    public ResponseEntity<Map<String, Object>> get(@RequestParam String instituteId,
                                                   @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        return wrap(() -> webhooks.get(instituteId));
    }

    @PutMapping
    public ResponseEntity<Map<String, Object>> put(@RequestParam String instituteId, @RequestBody UrlBody body,
                                                   @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        return wrap(() -> webhooks.put(instituteId, body == null ? null : body.url, user.getUserId()));
    }

    @PostMapping("/rotate-secret")
    public ResponseEntity<Map<String, Object>> rotate(@RequestParam String instituteId,
                                                      @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        return wrap(() -> webhooks.rotateSecret(instituteId));
    }

    @PostMapping("/test")
    public ResponseEntity<Map<String, Object>> test(@RequestParam String instituteId,
                                                    @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        return wrap(() -> webhooks.sendTest(instituteId));
    }

    @DeleteMapping
    public ResponseEntity<Map<String, Object>> delete(@RequestParam String instituteId,
                                                      @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        return wrap(() -> {
            webhooks.delete(instituteId);
            return Map.of("deleted", true);
        });
    }

    private static ResponseEntity<Map<String, Object>> wrap(java.util.function.Supplier<Map<String, Object>> op) {
        try {
            return ResponseEntity.ok(op.get());
        } catch (AiCallingApiException e) {
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("code", e.getCode());
            err.put("message", e.getMessage());
            return ResponseEntity.status(e.getStatus()).body(Map.of("error", err));
        }
    }

    @Data
    public static class UrlBody {
        private String url;
    }
}
