package vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/** One finding on one cell of an import file: an error blocks the product, a warning does not. */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonIgnoreProperties(ignoreUnknown = true)
public class ImportIssue {

    public static final String ERROR = "ERROR";
    public static final String WARNING = "WARNING";

    /** Row in the spreadsheet; the header is row 1. */
    private int row;
    /** Template column, or null when the finding is about the product as a whole. */
    private String column;
    private String severity;
    /** Stable code for the screen, for example DUPLICATE_SKU. */
    private String code;
    private String message;
    private String handle;

    @JsonIgnore
    public boolean isError() {
        return ERROR.equals(severity);
    }
}
