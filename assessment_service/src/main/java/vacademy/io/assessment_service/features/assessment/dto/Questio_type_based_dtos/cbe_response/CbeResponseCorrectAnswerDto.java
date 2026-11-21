package vacademy.io.assessment_service.features.assessment.dto.Questio_type_based_dtos.cbe_response;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.List;

/**
 * auto_evaluation_json of a CBE_RESPONSE question (docs/CBE_RESPONSE_QUESTION.md §3).
 * Templates, solutions and marking schemes are kept as raw JSON: the server never
 * interprets a sheet, it only stores, redacts and forwards it to the AI.
 */
@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class CbeResponseCorrectAnswerDto {
    private String type;
    private DataFields data;

    @Getter
    @Setter
    @AllArgsConstructor
    @NoArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class DataFields {
        private Integer version;
        private List<Part> parts;
        /** SECRET */
        private String gradingNotes;
    }

    @Getter
    @Setter
    @AllArgsConstructor
    @NoArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Part {
        private String id;
        private String label;
        private String promptHtml;
        /** SPREADSHEET | DOCUMENT */
        private String kind;
        private Double marks;
        private JsonNode template;
        /** SECRET */
        private JsonNode solution;
        /** SECRET */
        private JsonNode markingScheme;
        /** SECRET */
        private String solutionFileId;
    }
}
