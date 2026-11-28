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

import java.math.BigDecimal;
import java.util.Date;

/** One approval by manager PIN (V679), written in the transaction of the action it approves. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_approval")
public class CommerceApproval {

    @Id
    @UuidGenerator
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "action", nullable = false, length = 32)
    private String action;

    @Column(name = "reference_type", nullable = false, length = 32)
    private String referenceType;

    @Column(name = "reference_id", nullable = false, length = 64)
    private String referenceId;

    @Column(name = "requested_by", nullable = false)
    private String requestedBy;

    @Column(name = "approved_by", nullable = false)
    private String approvedBy;

    @Column(name = "amount", precision = 12, scale = 2)
    private BigDecimal amount;

    @Column(name = "reason", columnDefinition = "TEXT")
    private String reason;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Date createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Date updatedAt;
}
