package vacademy.io.assessment_service.features.assessment.omr.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * The saved paper of one OMR set, stored in {@code assessment_set_mapping.json}.
 *
 * <p>This is the single source of truth for that set: the question paper and the
 * answer key are rendered from it, the OMR sheet is drawn from it, and every scanned
 * sheet of the set is graded through it (bubble letter -> {@code optionIds} index).
 * It is never re-derived from the assessment, so editing the assessment after
 * printing cannot silently change what an already printed sheet means.
 *
 * <p>Other features also keep rows in assessment_set_mapping with their own free-form
 * json; only rows whose {@code kind} is {@link #KIND} belong to OMR.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class OmrSetJson {

    public static final String KIND = "OMR";
    public static final int VERSION = 1;

    private String kind;
    private Integer v;
    /** A, B, C ... (also the bubble value on the sheet). */
    private String setCode;
    /** The shuffle seed, kept so the order can be explained / reproduced. */
    private Long seed;
    /** Sheet geometry used when this set was generated. */
    private String density;
    private Integer rollDigits;
    private Integer layoutVersion;
    /** One entry per printed question, in printed order. */
    private List<Item> items;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Item {
        /** The printed question number, 1..N across all sections. */
        private Integer no;
        private String questionId;
        private String sectionId;
        /** Option ids in printed order: optionIds[0] is bubble A, [1] is B, ... */
        private List<String> optionIds;
    }
}
