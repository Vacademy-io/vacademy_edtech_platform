package vacademy.io.assessment_service.features.assessment.omr.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;

/**
 * OMR settings of one assessment, stored as {@code assessment.omr_config} (V60).
 *
 * <p>{@code rollDigits}, {@code density} and {@code layoutVersion} are written when the
 * sets are generated and describe the sheets that were printed; the admin sets only
 * the first three fields.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class OmrConfig {
    /** Paper sets to print (1 = a single paper, no set bubbles on the sheet). */
    private Integer setCount;
    /** Each set gets its own question order (sets after the first). */
    private Boolean shuffleQuestions;
    /** Each set gets its own option order within every question (sets after the first). */
    private Boolean shuffleOptions;

    private Integer rollDigits;
    /** LARGE (<= 100 questions) or DENSE (101 - 200). */
    private String density;
    private Integer layoutVersion;
    /** Set when the first scan of this assessment was uploaded; the sets cannot change after. */
    private Date lockedAt;

    public int setCountOrDefault() {
        return setCount == null || setCount < 1 ? 1 : setCount;
    }
}
