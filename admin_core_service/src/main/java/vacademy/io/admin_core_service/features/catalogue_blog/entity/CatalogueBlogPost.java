package vacademy.io.admin_core_service.features.catalogue_blog.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;

import java.sql.Timestamp;

/**
 * One blog post of an institute, shown by the `blog` section of its catalogue
 * sites. Posts are rows rather than pages inside catalogue_json so an article
 * can be written, published and edited on its own cadence — by an admin in the
 * dashboard or by an AI app over MCP — without republishing the site. See
 * V526__Catalogue_blog_posts.sql for the full reasoning.
 */
@Entity
@Table(name = "catalogue_blog_post")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CatalogueBlogPost {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;

    @Column(name = "institute_id", nullable = false, length = 36)
    private String instituteId;

    /** URL segment under the blog page; unique per institute. */
    @Column(name = "slug", nullable = false, length = 191)
    private String slug;

    @Column(name = "title", nullable = false, length = 255)
    private String title;

    /** Plain-text teaser for cards and the default meta description. */
    @Column(name = "excerpt", columnDefinition = "TEXT")
    private String excerpt;

    /** Body HTML, stored as authored; sanitised where it is rendered. */
    @Column(name = "content_html", columnDefinition = "TEXT")
    private String contentHtml;

    @Column(name = "cover_image_url", columnDefinition = "TEXT")
    private String coverImageUrl;

    @Column(name = "author_name", length = 255)
    private String authorName;

    @Column(name = "author_user_id", length = 36)
    private String authorUserId;

    @Column(name = "category", length = 128)
    private String category;

    /** JSON array of strings. */
    @Column(name = "tags", columnDefinition = "TEXT")
    private String tags;

    /** DRAFT | PUBLISHED | ARCHIVED. */
    @Column(name = "status", nullable = false, length = 32)
    private String status;

    /** Set on first publish; a future value keeps a PUBLISHED post private until then. */
    @Column(name = "published_at")
    private Timestamp publishedAt;

    @Column(name = "seo_title", length = 255)
    private String seoTitle;

    @Column(name = "seo_description", length = 512)
    private String seoDescription;

    /** EDITOR | MCP | AI — who authored the row. */
    @Column(name = "source", nullable = false, length = 32)
    private String source;

    @Column(name = "reading_minutes")
    private Integer readingMinutes;

    /** CLASSIC | SIDEBAR_TOC | MAGAZINE | FOCUS — the article layout on the learner site. */
    @Column(name = "template", nullable = false, length = 32)
    @Builder.Default
    private String template = "CLASSIC";

    /** JSON array of course (package) ids shown as cards under the article, in order. */
    @Column(name = "recommended_course_ids", columnDefinition = "TEXT")
    private String recommendedCourseIds;

    @Column(name = "created_by", length = 36)
    private String createdBy;

    @Column(name = "updated_by", length = 36)
    private String updatedBy;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Timestamp createdAt;

    /** Hibernate-managed: the admin list sorts by this, so it must move on every save. */
    @UpdateTimestamp
    @Column(name = "updated_at")
    private Timestamp updatedAt;
}
