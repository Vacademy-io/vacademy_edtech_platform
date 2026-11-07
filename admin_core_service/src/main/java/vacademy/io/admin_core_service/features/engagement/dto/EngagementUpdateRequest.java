package vacademy.io.admin_core_service.features.engagement.dto;

import lombok.Data;

import java.time.Instant;

/** A new update or offer for an engine. No start means it starts now. */
@Data
public class EngagementUpdateRequest {
    private String message;
    private String templateName;
    private Instant startsAt;
    private Instant endsAt;
}
