package vacademy.io.admin_core_service.features.catalogue_review.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/** A page of reviews. `counts` (per status) is filled for the admin list only. */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ReviewPageResponse {
    private List<ReviewResponse> content;
    private int page;
    private int size;
    private long totalElements;
    private int totalPages;
    private Map<String, Long> counts;
    /** Public list: average stars and count of every approved review. */
    private Double averageRating;
    private Long approvedCount;
}
