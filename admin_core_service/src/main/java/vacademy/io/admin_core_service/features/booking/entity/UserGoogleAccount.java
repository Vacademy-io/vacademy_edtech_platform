package vacademy.io.admin_core_service.features.booking.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

import java.time.LocalDateTime;

/** A user's own connected Google account (GoogleAccount.id) within one institute. */
@Entity
@Table(name = "user_google_account")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UserGoogleAccount {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "user_id", nullable = false)
    private String userId;

    @Column(name = "google_account_id", nullable = false)
    private String googleAccountId;

    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @PrePersist
    void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = createdAt;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
