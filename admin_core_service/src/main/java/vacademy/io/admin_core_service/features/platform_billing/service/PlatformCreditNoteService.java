package vacademy.io.admin_core_service.features.platform_billing.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformCreditNote;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoice;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoiceLineItem;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPayment;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentItemKind;
import vacademy.io.admin_core_service.features.platform_billing.enums.TaxHead;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformCreditNoteRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformInvoiceLineItemRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformInvoiceRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;

/**
 * Issues GST credit notes (Section 34 CGST Act; V590 {@code platform_credit_note}) against a
 * platform tax invoice:
 *
 * <ul>
 *   <li>{@link #issueForRefund}: one note per Razorpay refund, idempotent on the refund id (the
 *       {@code refund.created} and {@code refund.processed} webhooks both arrive).</li>
 *   <li>{@link #issueStaffCreditNote}: a waiver or correction after invoicing, no refund id.</li>
 * </ul>
 *
 * <p>Rules:
 * <ul>
 *   <li>Only NORMAL-disposition payments that have an invoice get notes: a DUPLICATE or LATE
 *       payment was never invoiced, so its refund has nothing to credit (critique #7).</li>
 *   <li>The notes on one invoice never add up to more than the invoice total.</li>
 *   <li>A partial amount is split back into taxable value and tax in the invoice's own ratio
 *       (base rounded half-up, tax = amount - base, CGST = floor(tax / 2), SGST the rest). The note
 *       that brings the credited total to the invoice total takes exactly the remainder of every
 *       component, so a full refund reverses the invoice to the paisa.</li>
 *   <li>Every party field, the place of supply, the tax head, SAC and the line text are copied
 *       from the original invoice (never re-read from live data).</li>
 *   <li>Numbering {@code VT/{FY}/C#####} (FY in Asia/Kolkata), allocated in this transaction.</li>
 * </ul>
 * Notes on the same invoice are serialised with a transaction-scoped advisory lock (safe under
 * pgbouncer transaction pooling).
 */
@Slf4j
@Service
public class PlatformCreditNoteService {

    static final String LOCK_SQL = "SELECT 1 FROM pg_advisory_xact_lock(hashtext(:k))";

    @PersistenceContext
    private EntityManager entityManager;

    private final PlatformCreditNoteRepository creditNoteRepository;
    private final PlatformInvoiceRepository invoiceRepository;
    private final PlatformInvoiceLineItemRepository lineItemRepository;
    private final PlatformPaymentRepository paymentRepository;
    private final PlatformDocumentSequenceService sequenceService;
    private final BrandModeService brandModeService;

    private Clock clock = Clock.systemUTC();

    public PlatformCreditNoteService(
            PlatformCreditNoteRepository creditNoteRepository,
            PlatformInvoiceRepository invoiceRepository,
            PlatformInvoiceLineItemRepository lineItemRepository,
            PlatformPaymentRepository paymentRepository,
            PlatformDocumentSequenceService sequenceService,
            BrandModeService brandModeService) {
        this.creditNoteRepository = creditNoteRepository;
        this.invoiceRepository = invoiceRepository;
        this.lineItemRepository = lineItemRepository;
        this.paymentRepository = paymentRepository;
        this.sequenceService = sequenceService;
        this.brandModeService = brandModeService;
    }

    /** Test seam. */
    void setTestHooks(EntityManager entityManager, Clock clock) {
        this.entityManager = entityManager;
        if (clock != null) {
            this.clock = clock;
        }
    }

    /** Refusal with a machine-readable code. */
    public static class CreditNoteException extends VacademyException {
        private final String code;

        public CreditNoteException(String code, String message) {
            super(HttpStatus.UNPROCESSABLE_ENTITY, message);
            this.code = code;
        }

        public String getCode() {
            return code;
        }
    }

    public static final String EXCEEDS_INVOICE = "CREDIT_EXCEEDS_INVOICE";
    public static final String INVALID_AMOUNT = "INVALID_AMOUNT";

    /**
     * Credit note for a processed Razorpay refund.
     *
     * @return the note (new, or the one already issued for this refund id); empty when the payment
     *         is not NORMAL or has no invoice, i.e. there is nothing to credit
     */
    @Transactional
    public Optional<PlatformCreditNote> issueForRefund(
            String platformPaymentId, String vendorRefundId, long amountMinor, String reason, String actor) {
        if (vendorRefundId == null || vendorRefundId.isBlank()) {
            throw new CreditNoteException(INVALID_AMOUNT, "vendorRefundId is required for a refund credit note");
        }
        Optional<PlatformCreditNote> existing = creditNoteRepository.findByVendorRefundId(vendorRefundId);
        if (existing.isPresent()) {
            return existing;
        }
        PlatformPayment payment = paymentRepository.findById(platformPaymentId).orElse(null);
        if (payment == null) {
            log.warn("Credit note skipped: platform_payment {} not found (refund {})", platformPaymentId, vendorRefundId);
            return Optional.empty();
        }
        if (payment.getDisposition() != null && !payment.getDisposition().isInvoiceable()) {
            log.info("Credit note skipped: platform_payment {} is {} (never invoiced; refund {})",
                    platformPaymentId, payment.getDisposition(), vendorRefundId);
            return Optional.empty();
        }
        Optional<PlatformInvoice> invoice = invoiceRepository.findByPlatformPaymentId(platformPaymentId);
        if (invoice.isEmpty()) {
            log.error("Credit note skipped: platform_payment {} has no invoice yet (refund {})",
                    platformPaymentId, vendorRefundId);
            return Optional.empty();
        }
        return Optional.of(issue(invoice.get(), payment, vendorRefundId, amountMinor,
                reason == null || reason.isBlank() ? "Refund" : reason, actor));
    }

    /** Staff credit note (waiver or correction after invoicing); no refund id. */
    @Transactional
    public PlatformCreditNote issueStaffCreditNote(String invoiceId, long amountMinor, String reason, String actor) {
        if (reason == null || reason.isBlank()) {
            throw new CreditNoteException(INVALID_AMOUNT, "A reason is required");
        }
        PlatformInvoice invoice = invoiceRepository.findById(invoiceId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Invoice not found: " + invoiceId));
        PlatformPayment payment = paymentRepository.findById(invoice.getPlatformPaymentId()).orElse(null);
        return issue(invoice, payment, null, amountMinor, reason, actor);
    }

    /** Sum of the credit notes already issued against an invoice. */
    public long creditedTotal(String invoiceId) {
        return creditNoteRepository.findByInvoiceIdOrderByIssuedAtAsc(invoiceId).stream()
                .mapToLong(n -> nz(n.getTotalAmountMinor())).sum();
    }

    public List<PlatformCreditNote> listForInstitute(String instituteId) {
        return creditNoteRepository.findByBuyerInstituteIdOrderByIssuedAtDesc(instituteId);
    }

    public Optional<PlatformCreditNote> find(String creditNoteId) {
        return creditNoteRepository.findById(creditNoteId);
    }

    // ─────────────────────────────────────────────────────────────────

    PlatformCreditNote issue(PlatformInvoice inv, PlatformPayment payment, String vendorRefundId,
                             long amountMinor, String reason, String actor) {
        if (amountMinor <= 0) {
            throw new CreditNoteException(INVALID_AMOUNT, "Credit note amount must be positive");
        }
        lock("platform_credit_note:" + inv.getId());
        if (vendorRefundId != null) {
            // refund.created and refund.processed may race: re-check under the lock.
            Optional<PlatformCreditNote> again = creditNoteRepository.findByVendorRefundId(vendorRefundId);
            if (again.isPresent()) {
                return again.get();
            }
        }

        List<PlatformCreditNote> prior = creditNoteRepository.findByInvoiceIdOrderByIssuedAtAsc(inv.getId());
        Split split = split(inv, prior, amountMinor);

        List<PlatformInvoiceLineItem> lines = lineItemRepository.findByPlatformInvoiceId(inv.getId());
        PlatformInvoiceLineItem firstLine = lines.isEmpty() ? null : lines.get(0);
        TaxHead head = headOf(inv, payment);

        Instant now = clock.instant();
        PlatformCreditNote cn = new PlatformCreditNote();
        cn.setCreditNoteNumber(sequenceService.next(PlatformDocumentSequenceService.Series.CREDIT_NOTE, now));
        cn.setSeriesKey(PlatformDocumentSequenceService.Series.CREDIT_NOTE.key());
        cn.setFy(PlatformDocumentSequenceService.financialYear(now));
        cn.setInvoiceId(inv.getId());
        cn.setInvoiceNumber(inv.getInvoiceNumber());
        cn.setInvoiceIssuedAt(inv.getIssuedAtTz() != null ? inv.getIssuedAtTz()
                : (inv.getIssuedAt() != null ? inv.getIssuedAt().toInstant(ZoneOffset.UTC) : now));
        cn.setPlatformPaymentId(inv.getPlatformPaymentId());
        cn.setVendorRefundId(vendorRefundId);
        PlatformPaymentItemKind kind = inv.getSourceKind() == null ? PlatformPaymentItemKind.CREDIT_PACK : inv.getSourceKind();
        cn.setItemKind(kind);
        String brand = inv.getBrandMode();
        if ((brand == null || brand.isBlank()) && brandModeService != null) {
            brand = brandModeService.resolve(inv.getBuyerInstituteId(),
                    payment == null ? null : payment.getBrandMode()).name();
        }
        cn.setBrandMode(brand);
        cn.setReason(truncate(reason, 255));

        cn.setSupplierLegalName(inv.getSupplierLegalName());
        cn.setSupplierGstin(inv.getSupplierGstin());
        cn.setSupplierStateCode(inv.getSupplierStateCode());
        cn.setSupplierAddress(inv.getSupplierAddress());
        cn.setBuyerInstituteId(inv.getBuyerInstituteId());
        cn.setBuyerLegalName(inv.getBuyerLegalName());
        cn.setBuyerGstin(inv.getBuyerGstin());
        cn.setBuyerStateCode(inv.getBuyerStateCode());
        cn.setBuyerAddress(inv.getBuyerAddress());
        cn.setPlaceOfSupply(inv.getPlaceOfSupply());
        cn.setTaxHead(head.name());
        cn.setCurrency(inv.getCurrency());
        cn.setDescription(truncate(firstLine != null ? firstLine.getDescription() : "As per original invoice", 255));
        cn.setHsnSacCode(firstLine != null && firstLine.getHsnSacCode() != null && !firstLine.getHsnSacCode().isBlank()
                ? firstLine.getHsnSacCode() : PlatformInvoiceService.defaultSac(kind));

        cn.setBaseAmountMinor(split.base);
        cn.setCgstAmountMinor(split.cgst);
        cn.setSgstAmountMinor(split.sgst);
        cn.setIgstAmountMinor(split.igst);
        cn.setTotalAmountMinor(split.total());
        if (head == TaxHead.CGST_SGST) {
            int half = firstLine != null && firstLine.getCgstRateBps() != null && firstLine.getCgstRateBps() > 0
                    ? firstLine.getCgstRateBps() : 900;
            cn.setCgstRateBps(half);
            cn.setSgstRateBps(firstLine != null && firstLine.getSgstRateBps() != null && firstLine.getSgstRateBps() > 0
                    ? firstLine.getSgstRateBps() : half);
            cn.setIgstRateBps(0);
        } else if (head == TaxHead.IGST) {
            cn.setCgstRateBps(0);
            cn.setSgstRateBps(0);
            cn.setIgstRateBps(firstLine != null && firstLine.getIgstRateBps() != null && firstLine.getIgstRateBps() > 0
                    ? firstLine.getIgstRateBps() : 1800);
        } else {
            cn.setCgstRateBps(0);
            cn.setSgstRateBps(0);
            cn.setIgstRateBps(0);
        }
        cn.setCreatedBy(actor);
        cn.setIssuedAt(now);
        cn = creditNoteRepository.saveAndFlush(cn);
        log.info("Issued credit note {} for {} against invoice {} (refund {})",
                cn.getCreditNoteNumber(), cn.getTotalAmountMinor(), inv.getInvoiceNumber(), vendorRefundId);
        return cn;
    }

    record Split(long base, long cgst, long sgst, long igst) {
        long total() {
            return base + cgst + sgst + igst;
        }
    }

    /**
     * Splits {@code amount} against what is still uncredited on the invoice. Pure, for tests.
     *
     * @throws CreditNoteException when the amount exceeds the uncredited total
     */
    static Split split(PlatformInvoice inv, List<PlatformCreditNote> prior, long amount) {
        long invBase = nz(inv.getBaseAmountMinor());
        long invCgst = nz(inv.getCgstAmountMinor());
        long invSgst = nz(inv.getSgstAmountMinor());
        long invIgst = nz(inv.getIgstAmountMinor());
        long invTotal = nz(inv.getTotalAmountMinor());

        long usedBase = 0, usedCgst = 0, usedSgst = 0, usedIgst = 0, usedTotal = 0;
        for (PlatformCreditNote n : prior) {
            usedBase += nz(n.getBaseAmountMinor());
            usedCgst += nz(n.getCgstAmountMinor());
            usedSgst += nz(n.getSgstAmountMinor());
            usedIgst += nz(n.getIgstAmountMinor());
            usedTotal += nz(n.getTotalAmountMinor());
        }
        long remBase = invBase - usedBase;
        long remCgst = invCgst - usedCgst;
        long remSgst = invSgst - usedSgst;
        long remIgst = invIgst - usedIgst;
        long remTotal = invTotal - usedTotal;
        if (amount > remTotal) {
            throw new CreditNoteException(EXCEEDS_INVOICE, "Credit of " + amount + " exceeds the uncredited "
                    + remTotal + " on invoice " + inv.getInvoiceNumber());
        }
        if (amount == remTotal) {
            return new Split(remBase, remCgst, remSgst, remIgst);
        }

        long remTax = remCgst + remSgst + remIgst;
        long base = invTotal == 0 ? amount : roundHalfUp(amount * invBase, invTotal);
        long tax = amount - base;
        if (tax > remTax) {
            tax = remTax;
            base = amount - tax;
        }
        if (base > remBase) {
            base = remBase;
            tax = amount - base;
        }
        if (tax < 0) {
            tax = 0;
            base = amount;
        }
        if (invIgst > 0) {
            return new Split(base, 0, 0, tax);
        }
        if (invCgst > 0 || invSgst > 0) {
            long cgst = tax / 2;
            long sgst = tax - cgst;
            if (sgst > remSgst) {
                sgst = remSgst;
                cgst = tax - sgst;
            }
            if (cgst > remCgst) {
                cgst = remCgst;
                sgst = tax - cgst;
            }
            return new Split(base, cgst, sgst, 0);
        }
        // Zero-tax invoice (export): everything is taxable value.
        return new Split(amount, 0, 0, 0);
    }

    static TaxHead headOf(PlatformInvoice inv, PlatformPayment payment) {
        TaxHead frozen = payment == null ? null : TaxHead.parse(payment.getTaxHead());
        if (frozen != null) {
            return frozen;
        }
        if (Boolean.TRUE.equals(inv.getIsExport())) {
            return TaxHead.EXPORT;
        }
        if (nz(inv.getCgstAmountMinor()) > 0 || nz(inv.getSgstAmountMinor()) > 0) {
            return TaxHead.CGST_SGST;
        }
        return TaxHead.IGST;
    }

    /** round-half-up(numerator / denominator) for non-negative values. */
    static long roundHalfUp(long numerator, long denominator) {
        return (numerator * 2 + denominator) / (denominator * 2);
    }

    private void lock(String key) {
        if (entityManager == null) {
            return;
        }
        entityManager.createNativeQuery(LOCK_SQL).setParameter("k", key).getSingleResult();
    }

    private static long nz(Long v) {
        return v == null ? 0L : v;
    }

    private static String truncate(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max);
    }
}
