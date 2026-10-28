package vacademy.io.admin_core_service.features.catalogue_review.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** One review. The public list leaves the moderation fields out (null). */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ReviewResponse {
    private String id;
    private Integer rating;
    private String reviewText;
    private String reviewerName;
    private String city;
    private String courseName;
    private String designation;
    private String createdAt;
    /* admin only */
    private String status;
    private String catalogueTag;
    private String pageRoute;
    private String reviewedAt;
    /** Custom-field answers (admin only). */
    private List<ReviewAnswer> answers;
}
