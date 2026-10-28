package vacademy.io.admin_core_service.features.catalogue_review.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * What a visitor sends from a `reviewCollector` block. `website` is a honeypot
 * field the form hides from people: a filled one marks a bot.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ReviewSubmitRequest {
    private String instituteId;
    private String catalogueTag;
    private String pageRoute;
    private Integer rating;
    private String reviewText;
    private String reviewerName;
    private String city;
    private String courseName;
    private String designation;
    private String visitorKey;
    private String website;
}
