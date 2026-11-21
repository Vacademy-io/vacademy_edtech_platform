package vacademy.io.admin_core_service.features.platform_billing.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.credits.repository.CreditPackRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoice;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoiceLineItem;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPayment;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentConfig;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentItem;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentDisposition;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentItemKind;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentResult;
import vacademy.io.admin_core_service.features.platform_billing.enums.TaxHead;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformInvoiceLineItemRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformInvoiceRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentItemRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.EnumSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * Generates the GST tax invoice ({@link PlatformInvoice} + {@link PlatformInvoiceLineItem}) for a
 * paid {@link PlatformPayment}. One pipeline per item kind:
 *
 * <ul>
 *   <li><b>CREDIT_PACK</b>: as before. Legacy numbering {@code INV-AICRED-yyyyMM-NNNN} unless
 *       {@code billing.invoice.series_v2.enabled}; buyer and tax from the order-time snapshot on
 *       the payment when it has one (V590), otherwise from the institute row exactly as before.
 *       A pack-less item no longer breaks the invoice (F2).</li>
 *   <li><b>AI_SUBSCRIPTION</b>: always series v2 ({@code VT/{FY}/I#####}); buyer identity, place of
 *       supply and tax head only from the payment snapshot (the institute row is never read); the
 *       buyer state is mandatory; INR only; line text from {@code description_snapshot}; the
 *       service period is stored on the invoice.</li>
 * </ul>
 *
 * <p>Tax on the invoice comes only from what was charged: per line {@code tax = total - base}
 * (inclusive-price safe), split under the frozen tax head (CGST takes floor(tax / 2), SGST the
 * rest).
 *
 * <p>Idempotent on platform_payment_id (UNIQUE on platform_invoice) and serialised per payment
 * by a transaction-scoped advisory lock, so two webhook threads can never both allocate a number.
 * Only NORMAL-disposition payments in a paid state are invoiced (critique #7): a DUPLICATE or LATE
 * payment is refunded, never invoiced.
 */
@Slf4j
@Service
public class PlatformInvoiceService {

    /** The payment states an invoice may be issued for (it was paid; refunds get credit notes). */
    static final Set<PlatformPaymentResult> INVOICEABLE_RESULTS = EnumSet.of(
            PlatformPaymentResult.PAID,
            PlatformPaymentResult.PARTIALLY_REFUNDED,
            PlatformPaymentResult.REFUNDED);

    static final String LOCK_SQL = "SELECT 1 FROM pg_advisory_xact_lock(hashtext(:k))";

    @PersistenceContext
    private EntityManager entityManager;

    private final PlatformPaymentRepository paymentRepository;
    private final PlatformPaymentItemRepository paymentItemRepository;
    private final PlatformInvoiceRepository invoiceRepository;
    private final PlatformInvoiceLineItemRepository invoiceLineItemRepository;
    private final InstituteRepository instituteRepository;
    private final CreditPackRepository packRepository;
    private final PlatformPaymentConfigService configService;

    @Autowired(required = false)
    private PlatformBillingFlags flags;
    @Autowired(required = false)
    private PlatformDocumentSequenceService sequenceService;
    @Autowired(required = false)
    private BrandModeService brandModeService;

    private Clock clock = Clock.systemDefaultZone();

    public PlatformInvoiceService(
            PlatformPaymentRepository paymentRepository,
            PlatformPaymentItemRepository paymentItemRepository,
            PlatformInvoiceRepository invoiceRepository,
            PlatformInvoiceLineItemRepository invoiceLineItemRepository,
            InstituteRepository instituteRepository,
            CreditPackRepository packRepository,
            PlatformPaymentConfigService configService) {
        this.paymentRepository = paymentRepository;
        this.paymentItemRepository = paymentItemRepository;
        this.invoiceRepository = invoiceRepository;
        this.invoiceLineItemRepository = invoiceLineItemRepository;
        this.instituteRepository = instituteRepository;
        this.packRepository = packRepository;
        this.configService = configService;
    }

    /** Test seam. */
    void setCollaborators(PlatformBillingFlags flags, PlatformDocumentSequenceService sequenceService,
                          BrandModeService brandModeService, EntityManager entityManager, Clock clock) {
        this.flags = flags;
        this.sequenceService = sequenceService;
        this.brandModeService = brandModeService;
        this.entityManager = entityManager;
        if (clock != null) {
            this.clock = clock;
        }
    }

    /** Refusal with a machine-readable code (the payment is not in an invoiceable state). */
    public static class NotInvoiceableException extends VacademyException {
        private final String code;

        public NotInvoiceableException(String code, String message) {
            super(HttpStatus.CONFLICT, message);
            this.code = code;
        }

        public String getCode() {
            return code;
        }
    }

    /** True when {@link #generateInvoice} would issue (or has issued) an invoice for this payment. */
    public static boolean isInvoiceable(PlatformPayment p) {
        if (p == null) {
            return false;
        }
        PlatformPaymentDisposition d = p.getDisposition();
        boolean normal = d == null || d.isInvoiceable();
        return normal && p.getPaymentStatus() != null && INVOICEABLE_RESULTS.contains(p.getPaymentStatus());
    }

    @Transactional
    public PlatformInvoice generateInvoice(String platformPaymentId) {
        // Idempotency at the application level — DB UNIQUE on platform_payment_id
        // is the safety net.
        Optional<PlatformInvoice> existing = invoiceRepository.findByPlatformPaymentId(platformPaymentId);
        if (existing.isPresent()) {
            log.info("Invoice already exists for platform_payment {}, returning existing", platformPaymentId);
            return existing.get();
        }

        // Serialise issuers of the same payment until this transaction ends, then re-check.
        lock("platform_invoice:" + platformPaymentId);
        existing = invoiceRepository.findByPlatformPaymentId(platformPaymentId);
        if (existing.isPresent()) {
            return existing.get();
        }

        PlatformPayment payment = paymentRepository.findById(platformPaymentId)
                .orElseThrow(() -> new VacademyException(
                        "platform_payment not found: " + platformPaymentId));

        if (payment.getDisposition() != null && !payment.getDisposition().isInvoiceable()) {
            throw new NotInvoiceableException("NOT_INVOICEABLE",
                    "platform_payment " + platformPaymentId + " is " + payment.getDisposition()
                            + " (refunded, never invoiced)");
        }
        if (payment.getPaymentStatus() == null || !INVOICEABLE_RESULTS.contains(payment.getPaymentStatus())) {
            throw new NotInvoiceableException("NOT_PAID",
                    "platform_payment " + platformPaymentId + " is not paid (" + payment.getPaymentStatus() + ")");
        }

        PlatformPaymentConfig supplier = configService.load();
        List<PlatformPaymentItem> items = paymentItemRepository.findByPlatformPaymentId(platformPaymentId);
        if (items.isEmpty()) {
            throw new VacademyException("platform_payment has no items: " + platformPaymentId);
        }
        PlatformPaymentItemKind kind = kindOf(items);
        boolean subscription = kind == PlatformPaymentItemKind.AI_SUBSCRIPTION;
        TaxHead head = TaxHead.parse(payment.getTaxHead());
        boolean snapshot = head != null;

        if (subscription) {
            if (!snapshot) {
                throw new VacademyException("AI subscription payment " + platformPaymentId
                        + " has no tax snapshot; refusing to invoice from live data");
            }
            if (isBlank(payment.getBuyerStateCode()) || isBlank(payment.getPlaceOfSupply())) {
                throw new VacademyException("AI subscription payment " + platformPaymentId
                        + " has no buyer state; refusing to invoice (BUYER_STATE_REQUIRED)");
            }
            if (!"INR".equalsIgnoreCase(payment.getCurrency())) {
                throw new VacademyException("AI subscriptions are invoiced in INR only");
            }
        }

        // ── Buyer + place of supply ──
        String buyerLegalName;
        String buyerGstin;
        String buyerStateCode;
        String buyerAddress;
        String placeOfSupply;
        boolean isExport;
        boolean intraState;
        if (snapshot) {
            Institute buyer = isBlank(payment.getBuyerLegalName())
                    ? instituteRepository.findById(payment.getInstituteId()).orElse(null) : null;
            buyerLegalName = !isBlank(payment.getBuyerLegalName()) ? payment.getBuyerLegalName()
                    : safe(buyer == null ? null : buyer.getInstituteName(), "Institute");
            buyerGstin = blankToNull(payment.getBuyerGstin());
            buyerStateCode = blankToNull(payment.getBuyerStateCode());
            buyerAddress = blankToNull(payment.getBuyerAddress());
            isExport = head == TaxHead.EXPORT;
            intraState = head == TaxHead.CGST_SGST;
            placeOfSupply = isExport ? "96"
                    : (!isBlank(payment.getPlaceOfSupply()) ? payment.getPlaceOfSupply()
                    : (buyerStateCode != null ? buyerStateCode : supplier.getSupplierStateCode()));
        } else {
            // Legacy credit-pack path: unchanged (institute row, export by currency).
            Institute buyer = instituteRepository.findById(payment.getInstituteId())
                    .orElseThrow(() -> new VacademyException(
                            "buyer institute not found: " + payment.getInstituteId()));
            buyerLegalName = safe(buyer.getInstituteName(), "Institute");
            buyerGstin = buyer.getGstin();
            buyerStateCode = buyer.getStateCode();
            buyerAddress = buildBuyerAddress(buyer);
            isExport = !"INR".equalsIgnoreCase(payment.getCurrency());
            placeOfSupply = isExport
                    ? "96"
                    : (buyer.getStateCode() != null ? buyer.getStateCode() : supplier.getSupplierStateCode());
            intraState = !isExport
                    && buyer.getStateCode() != null
                    && supplier.getSupplierStateCode().equalsIgnoreCase(buyer.getStateCode());
        }

        // ── 1. Number ──
        Instant now = clock.instant();
        boolean seriesV2 = subscription || (flags != null && flags.invoiceSeriesV2Enabled());
        String invoiceNumber;
        String fy = null;
        if (seriesV2) {
            if (sequenceService == null) {
                throw new VacademyException("Document sequence service unavailable");
            }
            invoiceNumber = sequenceService.next(PlatformDocumentSequenceService.Series.INVOICE, now);
            fy = PlatformDocumentSequenceService.financialYear(now);
        } else {
            String yyyymm = LocalDateTime.ofInstant(now, clock.getZone())
                    .format(DateTimeFormatter.ofPattern("yyyyMM"));
            int seqNo = nextInvoiceSeq(yyyymm);
            invoiceNumber = String.format("INV-AICRED-%s-%04d", yyyymm, seqNo);
        }

        // ── 2. Header (placeholder totals — patched after lines) ──
        PlatformInvoice invoice = new PlatformInvoice();
        invoice.setPlatformPaymentId(payment.getId());
        invoice.setInvoiceNumber(invoiceNumber);

        invoice.setSupplierLegalName(supplier.getSupplierLegalName());
        invoice.setSupplierGstin(supplier.getSupplierGstin());
        invoice.setSupplierStateCode(supplier.getSupplierStateCode());
        invoice.setSupplierAddress(supplier.getSupplierAddress());

        invoice.setBuyerInstituteId(payment.getInstituteId());
        invoice.setBuyerLegalName(buyerLegalName);
        invoice.setBuyerGstin(buyerGstin);
        invoice.setBuyerStateCode(buyerStateCode);
        invoice.setBuyerAddress(buyerAddress);

        invoice.setPlaceOfSupply(placeOfSupply);
        invoice.setIsExport(isExport);
        invoice.setCurrency(payment.getCurrency());
        invoice.setBaseAmountMinor(0L);
        invoice.setCgstAmountMinor(0L);
        invoice.setSgstAmountMinor(0L);
        invoice.setIgstAmountMinor(0L);
        invoice.setTotalAmountMinor(0L);
        // issued_at keeps its legacy meaning (JVM-zone wall clock, UTC on prod); the instant is
        // stored separately and is what the v2 date and FY are taken from (in Asia/Kolkata).
        invoice.setIssuedAt(LocalDateTime.ofInstant(now, clock.getZone()));
        invoice.setIssuedAtTz(now);
        invoice.setSourceKind(kind);
        invoice.setSeriesKey(seriesV2 ? PlatformDocumentSequenceService.Series.INVOICE.key() : null);
        invoice.setFy(fy);
        invoice.setBrandMode(brandModeService == null ? blankToNull(payment.getBrandMode())
                : brandModeService.resolve(payment.getInstituteId(), payment.getBrandMode()).name());
        PlatformPaymentItem first = items.get(0);
        invoice.setServicePeriodStart(first.getServicePeriodStart());
        invoice.setServicePeriodEnd(first.getServicePeriodEnd());
        invoice = invoiceRepository.saveAndFlush(invoice);

        // ── 3. Lines ──
        long baseTotal = 0L;
        long cgstTotal = 0L;
        long sgstTotal = 0L;
        long igstTotal = 0L;
        long grandTotal = 0L;
        for (PlatformPaymentItem item : items) {
            LineTax t = snapshot
                    ? snapshotLineTax(item, head)
                    : legacyLineTax(item, isExport, intraState);

            PlatformInvoiceLineItem line = new PlatformInvoiceLineItem();
            line.setPlatformInvoiceId(invoice.getId());
            line.setDescription(truncate(describe(item), 255));
            line.setHsnSacCode(isBlank(item.getHsnSacSnapshot()) && item.getItemKind() == PlatformPaymentItemKind.AI_SUBSCRIPTION
                    ? defaultSac(PlatformPaymentItemKind.AI_SUBSCRIPTION) : item.getHsnSacSnapshot());
            line.setQuantity(BigDecimal.ONE);
            line.setUnitPriceMinor(item.getBaseAmountMinor());
            line.setBaseAmountMinor(item.getBaseAmountMinor());
            line.setCgstRateBps(t.cgstBps);
            line.setCgstAmountMinor(t.cgst);
            line.setSgstRateBps(t.sgstBps);
            line.setSgstAmountMinor(t.sgst);
            line.setIgstRateBps(t.igstBps);
            line.setIgstAmountMinor(t.igst);
            line.setTotalAmountMinor(t.total);
            invoiceLineItemRepository.save(line);

            baseTotal += item.getBaseAmountMinor();
            cgstTotal += t.cgst;
            sgstTotal += t.sgst;
            igstTotal += t.igst;
            grandTotal += t.total;
        }
        if (payment.getTotalAmountMinor() != null && payment.getTotalAmountMinor() != grandTotal) {
            log.warn("Invoice {} line total {} differs from platform_payment {} total {}",
                    invoiceNumber, grandTotal, platformPaymentId, payment.getTotalAmountMinor());
        }

        // ── 4. Totals ──
        invoice.setBaseAmountMinor(baseTotal);
        invoice.setCgstAmountMinor(cgstTotal);
        invoice.setSgstAmountMinor(sgstTotal);
        invoice.setIgstAmountMinor(igstTotal);
        invoice.setTotalAmountMinor(grandTotal);
        invoice = invoiceRepository.save(invoice);

        log.info("Generated invoice {} ({}) for platform_payment {} (minor total = {})",
                invoiceNumber, kind, platformPaymentId, grandTotal);
        return invoice;
    }

    /** All invoices of an institute, newest first (no back-fill: issuing happens elsewhere). */
    public List<PlatformInvoice> listForInstitute(String instituteId) {
        return invoiceRepository.findByBuyerInstituteIdOrderByIssuedAtDesc(instituteId);
    }

    // ─────────────────────────────────────────────────────────────────
    // Line tax
    // ─────────────────────────────────────────────────────────────────

    record LineTax(int cgstBps, long cgst, int sgstBps, long sgst, int igstBps, long igst, long total) {}

    /** From the frozen tax head: tax = total - base (inclusive-price safe), never recomputed. */
    static LineTax snapshotLineTax(PlatformPaymentItem item, TaxHead head) {
        long base = nz(item.getBaseAmountMinor());
        long total = item.getTotalAmountMinor() != null ? item.getTotalAmountMinor()
                : base + nz(item.getTaxAmountMinor());
        long tax = total - base;
        if (tax < 0) {
            throw new VacademyException("Line total below taxable value on platform_payment_item " + item.getId());
        }
        int rate = item.getTaxRateBps() == null ? 0 : item.getTaxRateBps();
        return switch (head) {
            case EXPORT -> new LineTax(0, 0L, 0, 0L, 0, 0L, base);
            case CGST_SGST -> {
                long cgst = tax / 2;
                yield new LineTax(rate / 2, cgst, rate - rate / 2, tax - cgst, 0, 0L, total);
            }
            case IGST -> new LineTax(0, 0L, 0, 0L, rate, tax, total);
        };
    }

    /** The pre-V590 rule, byte-for-byte. */
    static LineTax legacyLineTax(PlatformPaymentItem item, boolean isExport, boolean intraState) {
        if (isExport) {
            return new LineTax(0, 0L, 0, 0L, 0, 0L, item.getTotalAmountMinor());
        }
        if (intraState) {
            int half = item.getTaxRateBps() / 2;
            long cgst = item.getTaxAmountMinor() / 2;
            long sgst = item.getTaxAmountMinor() - cgst;  // absorb rounding
            return new LineTax(half, cgst, half, sgst, 0, 0L, item.getTotalAmountMinor());
        }
        return new LineTax(0, 0L, 0, 0L, item.getTaxRateBps(), item.getTaxAmountMinor(), item.getTotalAmountMinor());
    }

    /** SAC when a line has none frozen: 998315 for subscriptions (owner default), 998313 for packs (V238). */
    static String defaultSac(PlatformPaymentItemKind kind) {
        return kind == PlatformPaymentItemKind.AI_SUBSCRIPTION ? SUBSCRIPTION_DEFAULT_SAC : PACK_DEFAULT_SAC;
    }

    static final String SUBSCRIPTION_DEFAULT_SAC = "998315";
    static final String PACK_DEFAULT_SAC = "998313";

    static PlatformPaymentItemKind kindOf(List<PlatformPaymentItem> items) {
        for (PlatformPaymentItem i : items) {
            if (i.getItemKind() == PlatformPaymentItemKind.AI_SUBSCRIPTION) {
                return PlatformPaymentItemKind.AI_SUBSCRIPTION;
            }
        }
        return PlatformPaymentItemKind.CREDIT_PACK;
    }

    /**
     * Line text. Packs: the live pack name (as before) + credits; a pack-less pack item (F2) uses
     * its description snapshot. Subscriptions: the description frozen at order time.
     */
    String describe(PlatformPaymentItem item) {
        if (item.getItemKind() == PlatformPaymentItemKind.AI_SUBSCRIPTION) {
            if (!isBlank(item.getDescriptionSnapshot())) {
                return item.getDescriptionSnapshot();
            }
            return "AI plan subscription" + periodSuffix(item);
        }
        String packName = null;
        if (item.getPackId() != null) {
            packName = packRepository.findById(item.getPackId()).map(p -> p.getName()).orElse(null);
        }
        if (packName == null && !isBlank(item.getDescriptionSnapshot())) {
            return item.getDescriptionSnapshot();
        }
        if (packName == null) {
            packName = item.getPackCodeSnapshot();
        }
        BigDecimal credits = item.getCredits() == null ? BigDecimal.ZERO : item.getCredits();
        return packName + " — " + credits.stripTrailingZeros().toPlainString() + " AI credits";
    }

    private static String periodSuffix(PlatformPaymentItem item) {
        if (item.getServicePeriodStart() == null || item.getServicePeriodEnd() == null) {
            return "";
        }
        DateTimeFormatter f = DateTimeFormatter.ofPattern("dd-MM-yyyy");
        ZoneId ist = PlatformDocumentSequenceService.IST;
        return ", " + item.getServicePeriodStart().atZone(ist).format(f)
                + " to " + item.getServicePeriodEnd().minusSeconds(1).atZone(ist).format(f);
    }

    /**
     * Legacy atomic next-number allocation (INV-AICRED, per UTC month):
     *   INSERT (m, 1) ON CONFLICT (m) DO UPDATE SET last_no = last_no + 1
     *   RETURNING last_no
     */
    private int nextInvoiceSeq(String yyyymm) {
        Object result = entityManager.createNativeQuery(
                "INSERT INTO ai_credit_invoice_sequence (yyyymm, last_no) VALUES (:m, 1) "
              + "ON CONFLICT (yyyymm) "
              + "DO UPDATE SET last_no = ai_credit_invoice_sequence.last_no + 1 "
              + "RETURNING last_no")
            .setParameter("m", yyyymm)
            .getSingleResult();
        return ((Number) result).intValue();
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

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private static String blankToNull(String s) {
        return isBlank(s) ? null : s.trim();
    }

    private static String truncate(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max);
    }

    private static String safe(String s, String fallback) {
        return s == null || s.isBlank() ? fallback : s;
    }

    private static String buildBuyerAddress(Institute b) {
        StringBuilder sb = new StringBuilder();
        appendIfPresent(sb, b.getAddress());
        appendIfPresent(sb, b.getCity());
        appendIfPresent(sb, b.getState());
        appendIfPresent(sb, b.getPinCode());
        appendIfPresent(sb, b.getCountry());
        String addr = sb.toString().trim();
        return addr.isEmpty() ? null : addr;
    }

    private static void appendIfPresent(StringBuilder sb, String s) {
        if (s == null || s.isBlank()) return;
        if (sb.length() > 0) sb.append(", ");
        sb.append(s.trim());
    }
}
