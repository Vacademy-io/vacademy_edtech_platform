package vacademy.io.admin_core_service.features.catalogue_review.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Admin edit of a review (fix a typo, trim a long text) and/or a status change.
 * A null field is left as it is.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ReviewUpdateRequest {
    private Integer rating;
    private String reviewText;
    private String reviewerName;
    private String city;
    private String courseName;
    private String designation;
    private String status;
}
