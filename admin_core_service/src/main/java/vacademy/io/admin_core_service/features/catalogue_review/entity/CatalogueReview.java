package vacademy.io.admin_core_service.features.catalogue_review.entity;

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
 * One review a site visitor left through a `reviewCollector` block. PENDING
 * until an admin approves (public) or rejects it. See V620__Catalogue_reviews.sql.
 */
@Entity
@Table(name = "catalogue_review")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CatalogueReview {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;

    @Column(name = "institute_id", nullable = false, length = 36)
    private String instituteId;

    /** Site the review was written on. */
    @Column(name = "catalogue_tag", length = 191)
    private String catalogueTag;

    @Column(name = "page_route", length = 255)
    private String pageRoute;

    /** 1 to 5 stars. */
    @Column(name = "rating", nullable = false)
    private Integer rating;

    @Column(name = "review_text", columnDefinition = "TEXT")
    private String reviewText;

    @Column(name = "reviewer_name", nullable = false, length = 120)
    private String reviewerName;

    @Column(name = "city", length = 120)
    private String city;

    @Column(name = "course_name", length = 255)
    private String courseName;

    /** Occupation, designation or current post. */
    @Column(name = "designation", length = 255)
    private String designation;

    /** PENDING | APPROVED | REJECTED. */
    @Column(name = "status", nullable = false, length = 16)
    private String status;

    /** JSON array of {key, label, value}: answers to the form's custom fields (V621). */
    @Column(name = "answers", columnDefinition = "TEXT")
    private String answers;

    @Column(name = "visitor_key", length = 64)
    private String visitorKey;

    @Column(name = "reviewed_by", length = 36)
    private String reviewedBy;

    @Column(name = "reviewed_at")
    private Timestamp reviewedAt;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Timestamp createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Timestamp updatedAt;
}
