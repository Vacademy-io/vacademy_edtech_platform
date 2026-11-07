package vacademy.io.admin_core_service.features.invoice.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

@AllArgsConstructor
@NoArgsConstructor
@Getter
@Setter
@Entity
// Since V432 an invoice number is unique per INSTITUTE, not globally: institutes
// configure their own number formats (INVOICE_SETTING.numbering), so two of them
// legitimately issue "INV/2026/0001" on the same day.
@Table(name = "invoice", uniqueConstraints = {
        @UniqueConstraint(name = "uq_invoice_institute_number",
                columnNames = {"institute_id", "invoice_number"})
})
public class Invoice {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    // NOTE: deliberately NOT unique = true — see the @Table constraint above.
    @Column(name = "invoice_number", nullable = false, length = 100)
    private String invoiceNumber;

    /**
     * Sequence position behind {@code invoiceNumber}, within {@link #seqScopeKey}. The next
     * number an institute issues is {@code MAX(seq_no) + 1} for that (institute, window) —
     * the counter lives here rather than in a side table so it can never drift from the
     * invoices themselves, and so a number is only ever consumed by an invoice that exists.
     *
     * <p>NULL for invoices issued before V432.
     */
    @Column(name = "seq_no")
    private Long seqNo;

    /** Reset window this number was allocated in: {@code ALL | YYYY | YYYYMM | YYYYMMDD}. */
    @Column(name = "seq_scope_key", length = 32)
    private String seqScopeKey;

    // Multiple payment logs supported via InvoicePaymentLogMapping
    // UserPlan can be accessed via: paymentLogMappings -> paymentLog -> userPlan
    @OneToMany(mappedBy = "invoice", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    private List<InvoicePaymentLogMapping> paymentLogMappings;

    @Column(name = "user_id", nullable = false)
    private String userId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "invoice_date", nullable = false)
    private LocalDateTime invoiceDate;

    @Column(name = "due_date", nullable = false)
    private LocalDateTime dueDate;

    @Column(name = "subtotal", nullable = false, precision = 10, scale = 2)
    private BigDecimal subtotal;

    @Column(name = "discount_amount", precision = 10, scale = 2)
    private BigDecimal discountAmount;

    /** Admin who applied a discount on an admin-created invoice (V557). */
    @Column(name = "discount_granted_by_user_id")
    private String discountGrantedByUserId;

    @Column(name = "tax_amount", precision = 10, scale = 2)
    private BigDecimal taxAmount;

    @Column(name = "total_amount", nullable = false, precision = 10, scale = 2)
    private BigDecimal totalAmount;

    @Column(name = "currency", nullable = false, length = 10)
    private String currency;

    @Column(name = "status", nullable = false, length = 50)
    private String status; // GENERATED, SENT, VIEWED

    @Column(name = "pdf_file_id", length = 255)
    private String pdfFileId;

    @Column(name = "invoice_data_json", columnDefinition = "TEXT")
    private String invoiceDataJson;

    @Column(name = "tax_included")
    private Boolean taxIncluded;

    // Which business entity triggered this invoice.
    // Values: USER_PLAN, STUDENT_FEE_PAYMENT, ADMIN_MANUAL
    @Column(name = "source", length = 50)
    private String source;

    // ID of the source entity (user_plan.id, student_fee_payment.id, or user_id for ADMIN_MANUAL)
    @Column(name = "source_id", length = 255)
    private String sourceId;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private LocalDateTime updatedAt;

    @OneToMany(mappedBy = "invoice", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    private List<InvoiceLineItem> lineItems;
}


