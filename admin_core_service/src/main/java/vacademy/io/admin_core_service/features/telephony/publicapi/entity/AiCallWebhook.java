package vacademy.io.admin_core_service.features.telephony.publicapi.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;

/** An institute's webhook endpoint for the public AI calling API. See V572. */
@Entity
@Table(name = "ai_call_webhook")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiCallWebhook {

    @Id
    @Column(name = "institute_id")
    private String instituteId;

    @Column(name = "url", nullable = false, length = 2048)
    private String url;

    /** Signs every delivery (HMAC-SHA256). Shown to the client once, when set or rotated. */
    @Column(name = "secret", nullable = false, length = 128)
    private String secret;

    @Column(name = "enabled", nullable = false)
    private boolean enabled;

    @Column(name = "created_by")
    private String createdBy;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        if (createdAt == null) createdAt = now;
        updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }
}
