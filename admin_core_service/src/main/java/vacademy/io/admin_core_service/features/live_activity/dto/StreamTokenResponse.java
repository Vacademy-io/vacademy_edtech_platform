package vacademy.io.admin_core_service.features.live_activity.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.List;

/**
 * Short-lived credential for the SSE stream. EventSource cannot send an Authorization
 * header, so the authenticated caller mints this and passes it as a query param.
 *
 * <p>{@code allowedCategories} is echoed back purely so the UI knows which tabs to render --
 * it is NOT the enforcement point. The signed token carries the same set and the server
 * filters every event against it before writing to the emitter.
 */
@Data
@AllArgsConstructor
public class StreamTokenResponse {
    private String token;
    private long expiresAtEpochMillis;
    private List<String> allowedCategories;
}
