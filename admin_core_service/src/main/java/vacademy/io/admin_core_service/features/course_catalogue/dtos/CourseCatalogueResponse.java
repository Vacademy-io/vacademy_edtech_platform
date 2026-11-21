package vacademy.io.admin_core_service.features.course_catalogue.dtos;



import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;


@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CourseCatalogueResponse {
    private String id;
    private String catalogueJson;
    private String tagName;
    private String status;
    private String source;
    private String sourceId;
    private String instituteId;
    private Boolean isDefault;
    /** /update only: an editor draft is still open (it was not discarded). */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private Integer openDraftRevisionNo;
    /** Authenticated get/by-tag only: when the live site was last published
     *  (its live revision); absent when no published revision is on record. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private Date updatedAt;
}
