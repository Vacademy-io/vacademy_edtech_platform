package vacademy.io.admin_core_service.features.catalogue_blog.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * One post. `content_html` is only filled by the single-post endpoints — list
 * endpoints leave it null so a page of 20 posts is not 20 articles of HTML.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class BlogPostResponse {
    private String id;
    private String instituteId;
    private String slug;
    private String title;
    private String excerpt;
    private String contentHtml;
    private String coverImageUrl;
    private String authorName;
    private String authorUserId;
    private String category;
    private List<String> tags;
    private String status;
    private String publishedAt;
    private String seoTitle;
    private String seoDescription;
    private String source;
    private Integer readingMinutes;
    private String template;
    private List<String> recommendedCourseIds;
    private String createdBy;
    private String updatedBy;
    private String createdAt;
    private String updatedAt;
}
