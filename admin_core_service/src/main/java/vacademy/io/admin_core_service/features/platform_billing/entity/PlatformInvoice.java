package vacademy.io.admin_core_service.features.platform_billing.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentItemKind;

import java.time.Instant;
import java.time.LocalDateTime;

/**
 * GST-compliant invoice for an AI credit pack purchase.
 * Vacademy = supplier, institute = buyer.
 *
 * IMPORTANT: All buyer + supplier fields are SNAPSHOTTED at issue time.
 * Editing {@code institutes.gstin} or {@code platform_payment_config.supplier_gstin}
 * later must NOT mutate historical invoices (Indian GST law requires immutability).
 */
@Entity
@Table(name = "platform_invoice")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class PlatformInvoice {

    @Id
    @UuidGenerator
    private String id;

    @Column(name = "platform_payment_id", nullable = false, unique = true)
    private String platformPaymentId;

    @Column(name = "invoice_number", nullable = false, unique = true, length = 64)
    private String invoiceNumber;

    // ── Supplier (Vacademy) snapshot ─────────────────────────────────
    @Column(name = "supplier_legal_name", nullable = false, length = 255)
    private String supplierLegalName;

    @Column(name = "supplier_gstin", length = 15)
    private String supplierGstin;

    @Column(name = "supplier_state_code", nullable = false, length = 2)
    private String supplierStateCode;

    @Column(name = "supplier_address", nullable = false, columnDefinition = "TEXT")
    private String supplierAddress;

    // ── Buyer (institute) snapshot ───────────────────────────────────
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

    // ── Tax + amounts (minor units; rates inferred from line items) ──
    @Column(name = "place_of_supply", nullable = false, length = 2)
    private String placeOfSupply;

    @Column(name = "is_export", nullable = false)
    private Boolean isExport;

    @Column(name = "currency", nullable = false, length = 3)
    private String currency;

    @Column(name = "base_amount_minor", nullable = false)
    private Long baseAmountMinor;

    @Column(name = "cgst_amount_minor", nullable = false)
    private Long cgstAmountMinor;

    @Column(name = "sgst_amount_minor", nullable = false)
    private Long sgstAmountMinor;

    @Column(name = "igst_amount_minor", nullable = false)
    private Long igstAmountMinor;

    @Column(name = "total_amount_minor", nullable = false)
    private Long totalAmountMinor;

    @Column(name = "pdf_s3_url", columnDefinition = "TEXT")
    private String pdfS3Url;

    @Column(name = "issued_at", nullable = false)
    private LocalDateTime issuedAt;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private LocalDateTime createdAt;

    // ── V590 ─────────────────────────────────────────────────────────
    @Enumerated(EnumType.STRING)
    @Column(name = "source_kind", nullable = false, length = 16)
    private PlatformPaymentItemKind sourceKind = PlatformPaymentItemKind.CREDIT_PACK;

    /** 'I' for a v2-series number (VT/{FY}/I#####); NULL for legacy INV-AICRED-* numbers. */
    @Column(name = "series_key", length = 8)
    private String seriesKey;

    /** Financial year of the v2 number, e.g. "2627"; NULL for legacy numbers. */
    @Column(name = "fy", length = 4)
    private String fy;

    @Column(name = "service_period_start")
    private Instant servicePeriodStart;

    @Column(name = "service_period_end")
    private Instant servicePeriodEnd;

    /** The instant of issue; the printed date and the FY are taken from it in Asia/Kolkata. NULL on legacy rows. */
    @Column(name = "issued_at_tz")
    private Instant issuedAtTz;

    /** BrandMode name the document was rendered for; NULL on legacy rows. */
    @Column(name = "brand_mode", length = 10)
    private String brandMode;
}
