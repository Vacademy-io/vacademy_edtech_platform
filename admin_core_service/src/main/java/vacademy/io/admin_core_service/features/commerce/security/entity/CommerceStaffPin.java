package vacademy.io.admin_core_service.features.commerce.security.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;

import java.util.Date;

/** A manager's personal approval PIN, stored hashed (V679). One row per institute and user. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_staff_pin")
public class CommerceStaffPin {

    @Id
    @UuidGenerator
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "user_id", nullable = false)
    private String userId;

    @Column(name = "pin_hash", nullable = false, length = 100)
    private String pinHash;

    /** Wrong tries in a row since the last success, new PIN or passed lock. */
    @Column(name = "failed_attempts", nullable = false)
    private Integer failedAttempts = 0;

    @Column(name = "locked_until")
    private Date lockedUntil;

    /** Locks since the PIN was last set. Each lock is longer than the one before. */
    @Column(name = "lock_count", nullable = false)
    private Integer lockCount = 0;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Date createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Date updatedAt;
}
