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

/** A recipient who opted out of an institute's email. Honoured before any promotional send. */
@Entity
@Table(name = "email_unsubscribes")
@Getter
@Setter
@NoArgsConstructor
public class EmailUnsubscribe {

    @Id
    @Column(length = 255, nullable = false)
    private String id;

    @Column(name = "email", nullable = false) private String email;
    @Column(name = "institute_id", nullable = false) private String instituteId;
    @Column(name = "source", length = 30, nullable = false) private String source;
    @Column(name = "reason", columnDefinition = "TEXT") private String reason;
    @Column(name = "is_active", nullable = false) private Boolean isActive = true;

    @CreationTimestamp @Column(name = "created_at", updatable = false, nullable = false) private LocalDateTime createdAt;
    @UpdateTimestamp @Column(name = "updated_at", nullable = false) private LocalDateTime updatedAt;
}
