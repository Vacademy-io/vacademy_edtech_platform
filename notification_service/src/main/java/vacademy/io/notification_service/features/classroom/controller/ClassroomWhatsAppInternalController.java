package vacademy.io.notification_service.features.classroom.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.notification_service.features.classroom.dto.ClassroomWhatsAppRequest;
import vacademy.io.notification_service.features.classroom.service.ClassroomWhatsAppService;

import java.util.Map;

/**
 * Classroom panel WhatsApp messages, for admin_core's classroom notify job.
 *
 * Service-to-service only: it sits under "/notification-service/internal/**",
 * which callers reach with the internal client signature. While
 * {@code classroom.whatsapp.enabled} is off it answers 404 FEATURE_OFF.
 */
@RestController
@RequestMapping("/notification-service/internal/v1/classroom")
@RequiredArgsConstructor
public class ClassroomWhatsAppInternalController {

    private final ClassroomWhatsAppService service;

    @PostMapping("/whatsapp-summary")
    public ResponseEntity<Map<String, String>> whatsappSummary(
            @RequestBody(required = false) ClassroomWhatsAppRequest request) {
        ClassroomWhatsAppService.Outcome outcome = service.send(request);
        return switch (outcome) {
            case SENT -> ResponseEntity.ok(Map.of("status", "SENT"));
            case DISABLED -> error(HttpStatus.NOT_FOUND, "FEATURE_OFF", "Classroom WhatsApp is switched off");
            case INVALID -> error(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "Phone number or kind is not valid");
            case NOT_CONFIGURED -> error(HttpStatus.SERVICE_UNAVAILABLE, "NOT_CONFIGURED",
                    "The WhatsApp template for this message is not configured");
            case FAILED -> error(HttpStatus.BAD_GATEWAY, "SEND_FAILED", "The message was not accepted");
        };
    }

    private static ResponseEntity<Map<String, String>> error(HttpStatus status, String code, String message) {
        return ResponseEntity.status(status).body(Map.of("code", code, "message", message));
    }
}
