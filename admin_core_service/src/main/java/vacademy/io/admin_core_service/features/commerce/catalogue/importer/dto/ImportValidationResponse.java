package vacademy.io.admin_core_service.features.commerce.catalogue.importer.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportIssue;

import java.util.List;

/** Result of mode=validate. Nothing was written. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ImportValidationResponse {

    private String fileName;
    private String fileFormat;
    /** Data rows read (blank rows not counted). */
    private Integer rowsTotal;
    /** Blank rows that were skipped. */
    private Integer rowsSkipped;
    private Integer productsTotal;
    private Integer productsToCreate;
    private Integer productsToUpdate;
    private Integer variantsToCreate;
    private Integer variantsToUpdate;
    /** Products with at least one error; a commit leaves them out and writes the others. */
    private Integer productsWithErrors;
    /** Rows of those products. */
    private Integer rowsWithErrors;
    private Integer errorCount;
    private Integer warningCount;
    /** Errors first, then warnings, in file order; capped, see issues_truncated. */
    private List<ImportIssue> issues;
    private Boolean issuesTruncated;
}
