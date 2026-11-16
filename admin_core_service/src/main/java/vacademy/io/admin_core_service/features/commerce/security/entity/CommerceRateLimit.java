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

/** One fixed window of the shared limiter for public commerce endpoints (V679). */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_rate_limit")
public class CommerceRateLimit {

    @Id
    @UuidGenerator
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "scope", nullable = false, length = 32)
    private String scope;

    /** An IP, an order number, or the SHA-256 of a phone number. */
    @Column(name = "subject_key", nullable = false, length = 128)
    private String subjectKey;

    @Column(name = "window_start", nullable = false)
    private Date windowStart;

    @Column(name = "hits", nullable = false)
    private Integer hits = 0;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Date createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Date updatedAt;
}
