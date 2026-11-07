package vacademy.io.admin_core_service.features.platform_billing.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentItemKind;

import java.time.Instant;

/**
 * GST credit note against a {@link PlatformInvoice} (V590 {@code platform_credit_note}), one per
 * refund (Section 34 CGST Act). Number {@code VT/{FY}/C#####} from the credit-note series of
 * {@code platform_document_sequence}; at most 16 characters (DB CHECK).
 *
 * <p>Like the invoice, every supplier / buyer / tax field is a snapshot: copy it from the original
 * invoice (which was built from the payment snapshot), never from live rows. Single-line document:
 * {@link #description} / {@link #hsnSacCode} and the per-head rates and amounts are on the header.
 * DB checks: {@code total = base + cgst + sgst + igst}, total &gt; 0, no negative amounts.
 * {@link #vendorRefundId} is unique when set (one credit note per Razorpay refund).
 */
@Entity
@Table(name = "platform_credit_note")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class PlatformCreditNote {

    @Id
    @UuidGenerator
    private String id;

    @Column(name = "credit_note_number", nullable = false, unique = true, length = 16)
    private String creditNoteNumber;

    @Column(name = "series_key", nullable = false, length = 8)
    private String seriesKey = "C";

    @Column(name = "fy", nullable = false, length = 4)
    private String fy;

    @Column(name = "invoice_id", nullable = false, length = 255)
    private String invoiceId;

    @Column(name = "invoice_number", nullable = false, length = 64)
    private String invoiceNumber;

    @Column(name = "invoice_issued_at", nullable = false)
    private Instant invoiceIssuedAt;

    @Column(name = "platform_payment_id", nullable = false, length = 255)
    private String platformPaymentId;

    /** Razorpay refund id (rfnd_...); NULL for a staff-issued note with no refund. */
    @Column(name = "vendor_refund_id", length = 64)
    private String vendorRefundId;

    @Enumerated(EnumType.STRING)
    @Column(name = "item_kind", nullable = false, length = 16)
    private PlatformPaymentItemKind itemKind = PlatformPaymentItemKind.CREDIT_PACK;

    /** BrandMode name the note is rendered for; NULL = resolve like the invoice. */
    @Column(name = "brand_mode", length = 10)
    private String brandMode;

    @Column(name = "reason", nullable = false, length = 255)
    private String reason;

    // ── Supplier snapshot ────────────────────────────────────────────
    @Column(name = "supplier_legal_name", nullable = false, length = 255)
    private String supplierLegalName;

    @Column(name = "supplier_gstin", length = 15)
    private String supplierGstin;

    @Column(name = "supplier_state_code", nullable = false, length = 2)
    private String supplierStateCode;

    @Column(name = "supplier_address", nullable = false, columnDefinition = "TEXT")
    private String supplierAddress;

    // ── Buyer snapshot ───────────────────────────────────────────────
    @Column(name = "buyer_institute_id", nullable = false, length = 255)
    private String buyerInstituteId;

    @Column(name = "buyer_legal_name", nullable = false, length = 255)
    private String buyerLegalName;

    @Column(name = "buyer_gstin", length = 15)
    private String buyerGstin;

    @Column(name = "buyer_state_code", length = 2)
    private String buyerStateCode;

    @Column(name = "buyer_address", columnDefinition = "TEXT")
    private String buyerAddress;

    // ── Tax + amounts (minor units) ──────────────────────────────────
    @Column(name = "place_of_supply", nullable = false, length = 2)
    private String placeOfSupply;

    /** TaxHead name: CGST_SGST | IGST | EXPORT (as on the original invoice). */
    @Column(name = "tax_head", nullable = false, length = 12)
    private String taxHead;

    @Column(name = "currency", nullable = false, length = 3)
    private String currency;

    @Column(name = "description", nullable = false, length = 255)
    private String description;

    @Column(name = "hsn_sac_code", nullable = false, length = 8)
    private String hsnSacCode;

    @Column(name = "base_amount_minor", nullable = false)
    private Long baseAmountMinor;

    @Column(name = "cgst_rate_bps", nullable = false)
    private Integer cgstRateBps = 0;

    @Column(name = "cgst_amount_minor", nullable = false)
    private Long cgstAmountMinor = 0L;

    @Column(name = "sgst_rate_bps", nullable = false)
    private Integer sgstRateBps = 0;

    @Column(name = "sgst_amount_minor", nullable = false)
    private Long sgstAmountMinor = 0L;

    @Column(name = "igst_rate_bps", nullable = false)
    private Integer igstRateBps = 0;

    @Column(name = "igst_amount_minor", nullable = false)
    private Long igstAmountMinor = 0L;

    @Column(name = "total_amount_minor", nullable = false)
    private Long totalAmountMinor;

    @Column(name = "pdf_s3_url", columnDefinition = "TEXT")
    private String pdfS3Url;

    @Column(name = "created_by", length = 255)
    private String createdBy;

    /** Instant of issue; the printed date and the FY are taken from it in Asia/Kolkata. */
    @Column(name = "issued_at", nullable = false)
    private Instant issuedAt;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;
}
