package vacademy.io.admin_core_service.features.commerce.returns.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.DynamicUpdate;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

import java.math.BigDecimal;
import java.util.Date;

/**
 * A return of delivered goods (V710), created by staff. It never changes the order's status;
 * receiving it posts the stock, issues its credit note and raises the order's refund due.
 * Changed only while its order row and its own row are locked.
 */
@Getter
@Setter
@NoArgsConstructor
@DynamicUpdate
@Entity
@Table(name = "commerce_return")
public class CommerceReturn extends CommerceCatalogueEntity {

    @Column(name = "return_number", nullable = false, updatable = false, length = 32)
    private String returnNumber;

    @Column(name = "order_id", nullable = false, updatable = false, length = 36)
    private String orderId;

    @Column(name = "status", nullable = false, length = 16)
    private String status;

    @Column(name = "reason", nullable = false, length = 32)
    private String reason;

    @Column(name = "reason_note", length = 500)
    private String reasonNote;

    @Column(name = "requested_via", nullable = false, length = 16)
    private String requestedVia;

    /** Where the goods come back; the RETURN movements post here. */
    @Column(name = "location_id", nullable = false, length = 36)
    private String locationId;

    @Column(name = "requested_by", nullable = false, updatable = false, length = 36)
    private String requestedBy;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "policy_warnings_json", columnDefinition = "jsonb")
    private String policyWarningsJson;

    @Column(name = "override_reason", length = 500)
    private String overrideReason;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "photo_media_ids_json", columnDefinition = "jsonb")
    private String photoMediaIdsJson;

    @Column(name = "approved_at")
    private Date approvedAt;

    @Column(name = "approved_by", length = 36)
    private String approvedBy;

    @Column(name = "rejected_at")
    private Date rejectedAt;

    @Column(name = "rejected_by", length = 36)
    private String rejectedBy;

    @Column(name = "reject_reason", length = 500)
    private String rejectReason;

    @Column(name = "received_at")
    private Date receivedAt;

    @Column(name = "received_by", length = 36)
    private String receivedBy;

    @Column(name = "closed_at")
    private Date closedAt;

    @Column(name = "credit_note_id", length = 36)
    private String creditNoteId;

    /** The total of the return's credit note: what the return is worth to the buyer. */
    @Column(name = "credit_total", nullable = false, precision = 12, scale = 2)
    private BigDecimal creditTotal = BigDecimal.ZERO.setScale(2);

    /** The part of credit_total raised into the order's refund_due (less until a COD order is remitted). */
    @Column(name = "due_raised", nullable = false, precision = 12, scale = 2)
    private BigDecimal dueRaised = BigDecimal.ZERO.setScale(2);

    @Column(name = "note", length = 500)
    private String note;

    @Column(name = "client_request_id", nullable = false, updatable = false, length = 64)
    private String clientRequestId;

    @Column(name = "request_hash", nullable = false, updatable = false, length = 64)
    private String requestHash;

    /** V724: the counter session a return was taken in at the billing counter; null for every other return. */
    @Column(name = "pos_session_id", length = 36)
    private String posSessionId;
}
