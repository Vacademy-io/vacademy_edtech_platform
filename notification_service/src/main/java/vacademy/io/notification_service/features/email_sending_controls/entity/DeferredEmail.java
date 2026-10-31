package vacademy.io.notification_service.features.email_sending_controls.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/** An email held back by a per-sender daily cap; replayed by {@code DeferredEmailDrainer}. */
@Entity
@Table(name = "deferred_email")
@Getter
@Setter
@NoArgsConstructor
public class DeferredEmail {

    @Id
    @Column(length = 255, nullable = false)
    private String id;

    @Column(name = "institute_id") private String instituteId;
    @Column(name = "email_type", length = 100) private String emailType;
    @Column(name = "sender_key", length = 512, nullable = false) private String senderKey;
    @Column(name = "to_email", nullable = false) private String toEmail;
    @Column(name = "subject", columnDefinition = "TEXT") private String subject;
    @Column(name = "body", columnDefinition = "TEXT") private String body;
    @Column(name = "service") private String service;
    @Column(name = "custom_from_email") private String customFromEmail;
    @Column(name = "custom_from_name") private String customFromName;
    @Column(name = "correlation_id") private String correlationId;
    @Column(name = "user_id") private String userId;
    @Column(name = "cc", columnDefinition = "TEXT") private String cc;
    @Column(name = "cc_mode", length = 10) private String ccMode;
    @Column(name = "send_after", nullable = false) private LocalDateTime sendAfter;
    @Column(name = "status", length = 20, nullable = false) private String status = "PENDING";
    @Column(name = "attempts", nullable = false) private int attempts = 0;
    @Column(name = "last_error", columnDefinition = "TEXT") private String lastError;

    @CreationTimestamp @Column(name = "created_at", updatable = false, nullable = false) private LocalDateTime createdAt;
    @UpdateTimestamp @Column(name = "updated_at", nullable = false) private LocalDateTime updatedAt;
}
