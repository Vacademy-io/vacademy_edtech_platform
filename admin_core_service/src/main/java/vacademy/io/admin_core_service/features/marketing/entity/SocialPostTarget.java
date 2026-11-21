package vacademy.io.admin_core_service.features.marketing.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;

import java.time.Instant;

/** One (post, social account) pair and its publishing state. */
@Entity
@Table(name = "social_post_target")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SocialPostTarget {

    @Id
    @UuidGenerator
    @Column(length = 255, nullable = false)
    private String id;

    @Column(name = "post_id", nullable = false)
    private String postId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "social_account_id", nullable = false)
    private String socialAccountId;

    @Column(name = "platform", nullable = false, length = 32)
    private String platform;

    /** PENDING | PUBLISHING | POSTED | FAILED | SKIPPED */
    @Builder.Default
    @Column(name = "status", nullable = false, length = 32)
    private String status = "PENDING";

    @Column(name = "external_post_id")
    private String externalPostId;

    @Column(name = "permalink", columnDefinition = "TEXT")
    private String permalink;

    /** IG media container awaiting processing (video/reel). */
    @Column(name = "container_id")
    private String containerId;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    @Builder.Default
    @Column(name = "attempts", nullable = false)
    private Integer attempts = 0;

    @Column(name = "next_attempt_at")
    private Instant nextAttemptAt;

    @Column(name = "posted_at")
    private Instant postedAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
