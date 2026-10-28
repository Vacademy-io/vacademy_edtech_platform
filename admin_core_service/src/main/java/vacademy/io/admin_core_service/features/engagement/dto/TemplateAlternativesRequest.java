package vacademy.io.admin_core_service.features.engagement.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * "Give me other options." Carries the human's steer (or a Meta rejection reason) so the next
 * round's proposals are genuinely different, not a re-roll. count is clamped to 1–3 by the service.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TemplateAlternativesRequest {
    private String feedback;
    private Integer count;
    /** What the templates are for ("first touch", "missed class"); optional. */
    private String purpose;
    /** en | hi | hinglish; null = the engine's language. */
    private String language;
    /** For REGENERATE / MORE_LIKE_THIS: the proposal to replace or imitate. */
    private String basedOnId;
    /** NEW (default) | REGENERATE (replace one draft) | MORE_LIKE_THIS. */
    private String mode;
}
