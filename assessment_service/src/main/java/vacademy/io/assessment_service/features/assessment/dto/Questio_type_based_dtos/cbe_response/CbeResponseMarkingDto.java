package vacademy.io.assessment_service.features.assessment.dto.Questio_type_based_dtos.cbe_response;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** marking_json of a CBE_RESPONSE question in a section (same shape as the other types). */
@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class CbeResponseMarkingDto {
    private String type;
    private DataFields data;

    @Getter
    @Setter
    @AllArgsConstructor
    @NoArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class DataFields {
        private double totalMark;
        private double negativeMark;
    }
}
