package vacademy.io.admin_core_service.features.packages.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategy;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * DTO for Package Suggestions in Autocomplete
 */
@Data
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
public class PackageSuggestionDTO {
    private String packageId;
    private String packageName;
    private String packageSessionId;
    private String levelId;
    private String levelName;
    private String sessionId;
    private String sessionName;
    /**
     * The batch's own name. Null when the batch was never named — the caller then
     * falls back to level + course, which is all that was ever sent before.
     */
    private String batchName;

    public PackageSuggestionDTO(String packageId, String packageName, String packageSessionId, String levelId,
            String levelName, String sessionId, String sessionName, String batchName) {
        this.packageId = packageId;
        this.packageName = packageName;
        this.packageSessionId = packageSessionId;
        this.levelId = levelId;
        this.levelName = levelName;
        this.sessionId = sessionId;
        this.sessionName = sessionName;
        this.batchName = batchName;
    }
}
