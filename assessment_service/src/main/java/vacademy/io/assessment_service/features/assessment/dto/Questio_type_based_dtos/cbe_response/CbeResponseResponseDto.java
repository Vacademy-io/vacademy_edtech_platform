package vacademy.io.assessment_service.features.assessment.dto.Questio_type_based_dtos.cbe_response;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * One CBE_RESPONSE question node of the attempt JSON. {@code responseData.answer} is
 * {@code {parts: {<partId>: {kind, sheet | html}}}} and stays raw JSON.
 */
@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class CbeResponseResponseDto {
    private String questionId;
    private Integer questionDurationLeftInSeconds;
    private Integer timeTakenInSeconds;
    private Boolean isMarkedForReview;
    private Boolean isVisited;
    private ResponseData responseData;

    @Getter
    @Setter
    @AllArgsConstructor
    @NoArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class ResponseData {
        private String type;
        private JsonNode answer;
    }
}
