package vacademy.io.notification_service.features.classroom.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.util.Map;

/**
 * Body of {@code POST /notification-service/internal/v1/classroom/whatsapp-summary}.
 *
 * <pre>
 * { "kind": "WEEKLY_SUMMARY", "phone": "+91…", "institute_name": "…",
 *   "variables": { "hours": "31.2", "rooms_used": "17", "rooms_total": "20",
 *                  "idle_rooms": "3", "link": "https://…" } }
 * </pre>
 *
 * {@code kind} defaults to WEEKLY_SUMMARY; ALERTS carries {@code alert_count} and
 * {@code link}. toString never prints the phone number.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record ClassroomWhatsAppRequest(String kind, String phone, String instituteName,
                                       Map<String, String> variables) {

    @Override
    public String toString() {
        return "ClassroomWhatsAppRequest[kind=" + kind
                + ", phone=" + (phone == null || phone.isBlank() ? "none" : "present")
                + ", variables=" + (variables == null ? 0 : variables.size()) + "]";
    }
}
