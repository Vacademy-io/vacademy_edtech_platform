package vacademy.io.admin_core_service.features.crm_dashboard.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/**
 * CRM Dashboard payload. {@code blocks} holds one entry per requested block (keys
 * already snake_case); a block that failed or timed out is absent from it and named
 * in {@code errors}, so one slow card never blanks the whole page.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CrmDashboardResponseDTO {
    private String from;
    private String to;
    /** The equal-length period before {@code from}; null when the range is too long to compare. */
    private String previousFrom;
    private String previousTo;
    /** How the caller's lead scope was decided (ADMIN, COUNSELLOR_TREE, SUB_ORG, ...). */
    private String scopeMode;
    /** True only for a whole-institute admin; the page shows money cards only then. */
    private boolean admin;
    private Map<String, Object> blocks;
    private Map<String, String> errors;
    /** When the numbers were computed; the page shows it as "Updated N min ago". */
    private String generatedAt;
}
