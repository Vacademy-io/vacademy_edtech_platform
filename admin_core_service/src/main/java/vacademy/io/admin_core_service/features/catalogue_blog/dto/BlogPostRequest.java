package vacademy.io.admin_core_service.features.catalogue_blog.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Create / update payload. Every field is optional on update: a null field is
 * "leave as is", so a client that only wants to change the title sends the
 * title. `slug` is derived from the title when absent on create.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class BlogPostRequest {
    private String title;
    private String slug;
    private String excerpt;
    private String contentHtml;
    private String coverImageUrl;
    private String authorName;
    private String category;
    private List<String> tags;
    /** DRAFT | PUBLISHED | ARCHIVED. Publishing through this field is allowed for dashboard callers. */
    private String status;
    /** ISO-8601; sets/backdates/schedules the publish time. */
    private String publishedAt;
    private String seoTitle;
    private String seoDescription;
    /** EDITOR (default) | MCP | AI — who is writing. */
    private String source;
    /** CLASSIC | SIDEBAR_TOC | MAGAZINE | FOCUS. */
    private String template;
    /** Course (package) ids to recommend under the article, in order; an empty list clears them. */
    private List<String> recommendedCourseIds;
}
