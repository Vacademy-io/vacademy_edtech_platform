package vacademy.io.admin_core_service.features.marketing.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** Ask the AI to write a social post from a short brief. Nothing is saved. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AiDraftRequest {
    private String brief;
    /** FACEBOOK | INSTAGRAM | GOOGLE_BUSINESS | YOUTUBE; empty = all four. */
    private List<String> platforms;
    /** e.g. friendly, formal, exciting (free text, optional). */
    private String tone;
    /** e.g. English, Hindi, Hinglish (free text, optional; default English). */
    private String language;
}
