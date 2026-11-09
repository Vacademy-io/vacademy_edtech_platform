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

/**
 * A place the institute can post to: a Facebook Page, an Instagram business account, a Google
 * Business Profile location or the YouTube channel (YouTube rows have no connection; they mirror
 * institute_youtube_credentials).
 */
@Entity
@Table(name = "social_account")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SocialAccount {

    @Id
    @UuidGenerator
    @Column(length = 255, nullable = false)
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    /** NULL for YOUTUBE. */
    @Column(name = "connection_id")
    private String connectionId;

    /** FACEBOOK | INSTAGRAM | GOOGLE_BUSINESS | YOUTUBE */
    @Column(name = "platform", nullable = false, length = 32)
    private String platform;

    /** page id | ig user id | GBP location resource "locations/123" | youtube channel id */
    @Column(name = "external_id", nullable = false)
    private String externalId;

    /** IG: page id ; GBP: account resource "accounts/456" */
    @Column(name = "parent_external_id")
    private String parentExternalId;

    @Column(name = "name")
    private String name;

    @Column(name = "handle")
    private String handle;

    @Column(name = "avatar_url", columnDefinition = "TEXT")
    private String avatarUrl;

    @Column(name = "followers_count")
    private Long followersCount;

    /** Encrypted FB Page token (also used for the IG account linked to that Page). */
    @Column(name = "access_token_enc", columnDefinition = "TEXT")
    private String accessTokenEnc;

    /** ACTIVE | RECONNECT_NEEDED | DISCONNECTED */
    @Builder.Default
    @Column(name = "status", nullable = false, length = 32)
    private String status = "ACTIVE";

    @Column(name = "status_detail", columnDefinition = "TEXT")
    private String statusDetail;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
