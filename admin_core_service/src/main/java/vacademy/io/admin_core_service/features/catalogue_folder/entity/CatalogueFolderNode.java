package vacademy.io.admin_core_service.features.catalogue_folder.entity;

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
 * One node of a folder library: a FOLDER (which may hold children) or a
 * PRODUCT_PAGE leaf whose courses open inside its parent folder.
 */
@Entity
@Table(name = "catalogue_folder_node")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CatalogueFolderNode {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;

    @Column(name = "library_id", nullable = false, length = 36)
    private String libraryId;

    @Column(name = "institute_id", nullable = false, length = 36)
    private String instituteId;

    /** Null = top level of the library. */
    @Column(name = "parent_id", length = 36)
    private String parentId;

    /** FOLDER | PRODUCT_PAGE. */
    @Column(name = "node_type", nullable = false, length = 32)
    private String nodeType;

    @Column(name = "title", length = 255)
    private String title;

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    @Column(name = "image_url", columnDefinition = "TEXT")
    private String imageUrl;

    @Column(name = "product_page_id", length = 255)
    private String productPageId;

    @Column(name = "display_order", nullable = false)
    private Integer displayOrder;

    /** ACTIVE | HIDDEN. */
    @Column(name = "status", nullable = false, length = 32)
    private String status;

    /** JSON object of child-display overrides; null = inherit the section's. */
    @Column(name = "view_json", columnDefinition = "TEXT")
    private String viewJson;

    /*
     * Knowledge-stream fields (V560). All optional; see the migration for what
     * each one drives on the public site.
     */

    /** URL key used in links (?stream=shiksha): [a-z0-9-], unique per library when set. */
    @Column(name = "slug", length = 120)
    private String slug;

    /** The course tag this folder filters the Courses page by; null = the slug. */
    @Column(name = "course_tag", length = 191)
    private String courseTag;

    /** Second line under the title, e.g. the English caption under a Hindi title. */
    @Column(name = "subtitle", length = 255)
    private String subtitle;

    /** Headline when the folder is featured (mega menu detail panel). */
    @Column(name = "tagline", length = 255)
    private String tagline;

    @Column(name = "cta_label", length = 120)
    private String ctaLabel;

    /** A site route ("/courses?stream=x") or an http(s) URL; null = the default stream link. */
    @Column(name = "link_url", columnDefinition = "TEXT")
    private String linkUrl;

    /** #rgb, #rrggbb or #rrggbbaa. */
    @Column(name = "accent_color", length = 9)
    private String accentColor;

    /**
     * Shown but not open yet. Primitive on purpose: the column is NOT NULL, and
     * Hibernate writes every column on insert, so a null wrapper would fail.
     */
    @Column(name = "coming_soon", nullable = false)
    private boolean comingSoon;

    /** Lead campaign (audience) that collects "notify me" sign-ups for a coming-soon folder. */
    @Column(name = "audience_id", length = 255)
    private String audienceId;

    @Column(name = "created_by", length = 36)
    private String createdBy;

    @Column(name = "updated_by", length = 36)
    private String updatedBy;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Timestamp createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Timestamp updatedAt;
}
