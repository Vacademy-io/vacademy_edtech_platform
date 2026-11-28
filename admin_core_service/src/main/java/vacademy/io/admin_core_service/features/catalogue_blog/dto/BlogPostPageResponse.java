package vacademy.io.admin_core_service.features.catalogue_blog.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** A page of post summaries (no bodies) plus the categories in use, so a list UI needs one call. */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class BlogPostPageResponse {
    private List<BlogPostResponse> content;
    private int page;
    private int size;
    private long totalElements;
    private int totalPages;
    private List<String> categories;
}
