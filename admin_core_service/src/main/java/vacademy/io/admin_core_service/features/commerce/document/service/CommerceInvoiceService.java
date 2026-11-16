package vacademy.io.admin_core_service.features.commerce.document.service;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.document.dto.CommerceInvoiceDTO;
import vacademy.io.admin_core_service.features.commerce.document.dto.CommerceInvoiceLineExtra;
import vacademy.io.admin_core_service.features.commerce.document.dto.CommerceInvoiceRequest;
import vacademy.io.admin_core_service.features.commerce.document.dto.CommerceInvoiceSnapshot;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteRequest;
import vacademy.io.admin_core_service.features.commerce.document.dto.ReissueB2bRequest;
import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceDocumentSeries;
import vacademy.io.admin_core_service.features.commerce.document.enums.DocumentChannel;
import vacademy.io.admin_core_service.features.commerce.document.enums.DocumentType;
import vacademy.io.admin_core_service.features.commerce.document.enums.SeriesKind;
import vacademy.io.admin_core_service.features.commerce.document.enums.SeriesStatus;
import vacademy.io.admin_core_service.features.commerce.document.pdf.CommerceDocumentPdfService;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceDocumentSeriesRepository;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxLineResult;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxResult;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxHead;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxLineType;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxContext;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;
import vacademy.io.admin_core_service.features.commerce.tax.service.GstinValidator;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.entity.InvoiceLineItem;
import vacademy.io.admin_core_service.features.invoice.entity.InvoicePaymentLogMapping;
import vacademy.io.admin_core_service.features.invoice.repository.InvoicePaymentLogMappingRepository;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules.enumValue;
import static vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules.require;
import static vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules.trimToNull;

/**
 * The only writer of GST documents for shop orders.
 *
 * <p>It writes the same {@code invoice}, {@code invoice_line_item} and
 * {@code invoice_payment_log_mapping} tables as the course invoices, with a document type, a
 * per-line tax snapshot and a number from {@code commerce_document_series}. The legacy
 * generators skip commerce payments, so a shop order never gets a number from the institute's
 * course series.
 *
 * <p>Rules that keep numbers gapless and consecutive:
 * <ul>
 *   <li>{@link #issue} never opens a transaction ({@code MANDATORY}): the number, the invoice
 *       rows and the caller's own change (PACKED, the POS sale) commit or roll back together.</li>
 *   <li>The number is taken last, after everything that can fail has been checked and after
 *       every other lock of the flow, so the series row is held for the shortest time.</li>
 *   <li>Nothing remote runs here. The PDF is drawn and uploaded after the commit.</li>
 * </ul>
 *
 * <p>Two invoices for one order are stopped here, not by the caller: {@link #issue} locks the
 * order's payment-log rows before it looks for a live document, and returns that document when
 * there is one. A caller that also holds the {@code commerce_order} row lock takes
 * it first.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CommerceInvoiceService {

    public static final String SOURCE_COMMERCE_ORDER = "COMMERCE_ORDER";
    public static final String STATUS_GENERATED = "GENERATED";
    public static final String STATUS_CANCELLED = "CANCELLED";
    public static final String ITEM_TYPE_PREFIX = "COMMERCE_";

    private static final ObjectMapper JSON = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
            .configure(com.fasterxml.jackson.databind.SerializationFeature.WRITE_DATES_AS_TIMESTAMPS, false);
    private static final BigDecimal ZERO = BigDecimal.ZERO.setScale(2);

    private final InvoiceRepository invoiceRepository;
    private final InvoicePaymentLogMappingRepository mappingRepository;
    private final PaymentLogRepository paymentLogRepository;
    private final CommerceDocumentSeriesRepository seriesRepository;
    private final CommerceDocumentNumberService numberService;
    private final CommerceTaxSettingService taxSettingService;
    private final CommerceSellerLookup sellerLookup;
    private final CommerceCreditNoteService creditNoteService;
    private final DocumentClock clock;
    private final CommerceAuditService auditService;
    private final CommerceDocumentPdfService pdfService;

    /** The result of {@link #issue}. */
    public record Issued(Invoice invoice, boolean alreadyExisted) {
    }

    // ------------------------------------------------------------------ issue

    /**
     * Issues the document for an order: a tax invoice in REGULAR mode, a bill of supply in
     * COMPOSITION mode, a plain invoice in UNREGISTERED mode. Idempotent per order: when a live
     * document already covers the order's payment logs, that one is returned.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public Issued issue(String instituteId, CommerceInvoiceRequest request) {
        require(trimToNull(instituteId) != null, "institute id is required");
        require(request != null, "request is required");
        List<String> logIds = cleanIds(request.getPaymentLogIds());
        require(!logIds.isEmpty(), "an order has at least one payment log");

        // The order's payment logs are the one thing every caller passes (the pack step, the
        // counter sale, the retry job). Locking them here makes "is there a live document" and
        // "write one" a single step per order, whatever the caller locked itself.
        List<String> locked = paymentLogRepository.lockIdsInOrder(logIds);
        require(locked != null && locked.size() == logIds.size(), "a payment log of the order was not found");

        boolean creditedInFull = false;
        for (Invoice invoice : documentsOf(instituteId, logIds)) {
            if (!isFullyCredited(instituteId, invoice)) {
                return new Issued(invoice, true);
            }
            creditedInFull = true;
        }
        if (creditedInFull && !request.isAllowAfterFullCredit()) {
            // A full credit note closes the order's document for good (a return, an RTO). The
            // new invoices that may follow a full credit are the B2B reissue, which does not
            // come through here, and the re-pack of an unpacked order (allowAfterFullCredit).
            throw new ConflictException("INVOICE_FULLY_CREDITED: the invoice of this order was credited in full; "
                    + "a new sale needs a new order");
        }
        return new Issued(issueNew(instituteId, request, logIds, null), false);
    }

    /** The document of an order that is neither cancelled nor fully credited, if there is one. */
    @Transactional(readOnly = true)
    public Optional<Invoice> liveDocument(String instituteId, List<String> paymentLogIds) {
        List<String> logIds = cleanIds(paymentLogIds);
        if (logIds.isEmpty()) {
            return Optional.empty();
        }
        for (Invoice invoice : documentsOf(instituteId, logIds)) {
            if (!isFullyCredited(instituteId, invoice)) {
                return Optional.of(invoice);
            }
        }
        return Optional.empty();
    }

    /** The order's commerce documents of this institute that were not cancelled, newest first. */
    private List<Invoice> documentsOf(String instituteId, List<String> logIds) {
        List<Invoice> out = new ArrayList<>();
        for (Invoice invoice : mappingRepository.findCommerceDocumentsByPaymentLogIds(logIds)) {
            if (instituteId.equals(invoice.getInstituteId()) && invoice.getCancelledAt() == null) {
                out.add(invoice);
            }
        }
        return out;
    }

    private boolean isFullyCredited(String instituteId, Invoice invoice) {
        return creditNoteService.hasCreditNotes(instituteId, invoice.getId())
                && creditNoteService.creditedTotal(instituteId, invoice.getId())
                        .compareTo(invoice.getTotalAmount()) >= 0;
    }

    private Invoice issueNew(String instituteId, CommerceInvoiceRequest request, List<String> logIds,
                             String replacesInvoiceNumber) {
        TaxResult tax = request.getTax();
        require(tax != null && tax.getLines() != null && !tax.getLines().isEmpty(), "the tax snapshot is required");
        require(tax.getMode() != null && tax.getTaxHead() != null, "the tax snapshot has no mode or tax head");
        require(trimToNull(request.getUserId()) != null, "the buyer user id is required");
        requireConsistent(tax);

        CommerceTaxContext settings = taxSettingService.context(instituteId);
        if (!settings.isConfigured()) {
            throw new ConflictException("TAX_NOT_CONFIGURED: save the tax settings before issuing documents");
        }
        DocumentChannel channel = enumValue(DocumentChannel.class, request.getChannel(), "channel");
        require(channel != null && channel != DocumentChannel.ALL, "channel must be ONLINE, POS or ADMIN");
        String locationId = trimToNull(request.getLocationId());
        CommerceSellerLookup.Seller seller = sellerLookup.resolve(instituteId, locationId, settings);

        DocumentType documentType = documentTypeFor(tax.getMode());
        if (tax.getMode() == TaxMode.REGULAR) {
            if (seller.getGstin() == null || seller.getStateCode() == null) {
                throw new ConflictException("SELLER_GSTIN_MISSING: a tax invoice needs the seller GSTIN and state");
            }
            if (!seller.getStateCode().equals(tax.getSellerStateCode())) {
                throw new ConflictException("TAX_SNAPSHOT_STALE: the order was taxed for seller state "
                        + tax.getSellerStateCode() + " but the selling location is in " + seller.getStateCode());
            }
        }
        String buyerGstin = GstinValidator.normalise(request.getBuyerGstin());
        require(buyerGstin == null || GstinValidator.isValid(buyerGstin), "buyer_gstin is not a valid GSTIN");

        LocalDate documentDate = request.getDocumentDate() != null ? request.getDocumentDate()
                : clock.today(instituteId);
        List<PaymentLog> paymentLogs = requirePaymentLogs(instituteId, logIds);

        Map<String, CommerceInvoiceLineExtra> extras = new HashMap<>();
        if (request.getLineExtras() != null) {
            for (CommerceInvoiceLineExtra extra : request.getLineExtras()) {
                if (extra != null && extra.getLineRef() != null) {
                    extras.put(extra.getLineRef(), extra);
                }
            }
        }

        Invoice invoice = new Invoice();
        invoice.setUserId(request.getUserId().trim());
        invoice.setInstituteId(instituteId);
        LocalDateTime now = LocalDateTime.now();
        invoice.setInvoiceDate(now);
        invoice.setDueDate(now);
        invoice.setSubtotal(tax.getTaxableValue());
        invoice.setDiscountAmount(tax.getDiscount());
        invoice.setTaxAmount(tax.getTaxAmount());
        invoice.setTotalAmount(tax.getTotal());
        invoice.setRoundOff(tax.getRoundOff());
        invoice.setCurrency(trimToNull(request.getCurrency()) != null ? request.getCurrency().trim() : "INR");
        invoice.setStatus(STATUS_GENERATED);
        invoice.setTaxIncluded(Boolean.TRUE);
        invoice.setSource(SOURCE_COMMERCE_ORDER);
        invoice.setSourceId(trimToNull(request.getCommerceOrderId()));
        invoice.setDocumentType(documentType.name());
        invoice.setDocumentDate(documentDate);
        invoice.setSellerGstin(seller.getGstin());
        invoice.setSellerStateCode(seller.getStateCode());
        invoice.setPlaceOfSupplyState(tax.getPlaceOfSupplyState() != null ? tax.getPlaceOfSupplyState()
                : seller.getStateCode());
        invoice.setTaxHead(tax.getTaxHead().name());
        invoice.setBuyerGstin(buyerGstin);
        invoice.setLocationId(locationId);
        invoice.setChannel(channel.name());
        invoice.setCommerceOrderId(trimToNull(request.getCommerceOrderId()));
        invoice.setInvoiceDataJson(writeSnapshot(CommerceInvoiceSnapshot.builder()
                .version(CommerceInvoiceSnapshot.CURRENT_VERSION)
                .commerce(true)
                .orderNumber(trimToNull(request.getOrderNumber()))
                .sellerLegalName(seller.getLegalName())
                .sellerAddress(seller.getAddress())
                .sellerGstin(seller.getGstin())
                .sellerStateCode(seller.getStateCode())
                .buyerName(trimToNull(request.getBuyerName()))
                .buyerPhone(trimToNull(request.getBuyerPhone()))
                .buyerEmail(trimToNull(request.getBuyerEmail()))
                .buyerGstin(buyerGstin)
                .billingAddress(trimToNull(request.getBillingAddress()))
                .shippingAddress(trimToNull(request.getShippingAddress()))
                .tax(tax)
                .lineExtras(request.getLineExtras())
                .replacesInvoiceNumber(replacesInvoiceNumber)
                .build()));

        List<InvoiceLineItem> lineItems = new ArrayList<>();
        for (TaxLineResult line : tax.getLines()) {
            CommerceInvoiceLineExtra extra = extras.get(line.getLineRef());
            InvoiceLineItem item = new InvoiceLineItem();
            item.setInvoice(invoice);
            item.setItemType(ITEM_TYPE_PREFIX + (line.getLineType() == null ? TaxLineType.ITEM : line.getLineType()).name());
            item.setDescription(line.getDescription());
            item.setQuantity(line.getQuantity());
            item.setUnitPrice(line.getUnitPrice());
            item.setAmount(line.getNet());
            item.setSourceId(line.getLineRef());
            item.setHsnCode(line.getHsnCode());
            item.setUnit(line.getUnit());
            item.setTaxRate(line.getRatePercent());
            item.setTaxableValue(line.getTaxableValue());
            item.setCgst(line.getCgst());
            item.setSgst(line.getSgst());
            item.setIgst(line.getIgst());
            item.setCess(line.getCess());
            item.setDiscount(nz(line.getLineDiscount()).add(nz(line.getOrderDiscount())));
            item.setPackageSessionId(extra != null ? trimToNull(extra.getPackageSessionId()) : null);
            item.setPieceId(extra != null ? trimToNull(extra.getPieceId()) : null);
            lineItems.add(item);
        }
        invoice.setLineItems(lineItems);

        List<InvoicePaymentLogMapping> mappings = new ArrayList<>();
        for (PaymentLog paymentLog : paymentLogs) {
            InvoicePaymentLogMapping mapping = new InvoicePaymentLogMapping();
            mapping.setInvoice(invoice);
            mapping.setPaymentLog(paymentLog);
            mappings.add(mapping);
        }
        invoice.setPaymentLogMappings(mappings);

        // The number comes last: nothing after this line can refuse the document.
        String externalNumber = trimToNull(request.getExternalInvoiceNumber());
        if (externalNumber != null) {
            numberFromBillBook(instituteId, invoice, documentType, locationId, externalNumber);
        } else {
            String financialYear = FinancialYear.of(documentDate, settings.getFyStartMonth());
            DocumentNumberAllocator.Allocation number = numberService.allocate(instituteId, documentType,
                    financialYear, seller.getGstin(), locationId, trimToNull(request.getRegisterId()),
                    channel.name());
            invoice.setInvoiceNumber(number.number());
            invoice.setSeriesId(number.seriesId());
        }
        invoice = invoiceRepository.saveAndFlush(invoice);

        log.info("Commerce document {} ({}) issued for order {} in institute {}", invoice.getInvoiceNumber(),
                documentType, invoice.getCommerceOrderId(), instituteId);
        pdfService.storeInvoicePdfAfterCommit(invoice.getId());
        return invoice;
    }

    /**
     * A bill-book entry: the paper number must fall inside a registered book of
     * the location and be unused. No system number is issued and no counter moves.
     */
    private void numberFromBillBook(String instituteId, Invoice invoice, DocumentType documentType,
                                    String locationId, String externalNumber) {
        require(locationId != null, "a bill-book entry needs its location");
        require(externalNumber.matches("^[0-9]{1,9}$"), "external_invoice_number is the number printed on the paper bill");
        long page = Long.parseLong(externalNumber);
        CommerceDocumentSeries book = seriesRepository
                .findByInstituteIdAndDocumentTypeAndStatus(instituteId, documentType.name(), SeriesStatus.ACTIVE.name())
                .stream()
                .filter(s -> SeriesKind.MANUAL_BOOK.name().equals(s.getKind()))
                .filter(s -> locationId.equals(s.getLocationId()))
                .filter(s -> s.getBookFrom() != null && s.getBookTo() != null
                        && page >= s.getBookFrom() && page <= s.getBookTo())
                .findFirst()
                .orElseThrow(() -> new ConflictException("BILL_BOOK_NOT_REGISTERED: number " + externalNumber
                        + " is not inside a registered bill book of this location"));
        String number = DocumentNumberAllocator.format(book.getPrefix(), book.getFinancialYear(), page);
        if (invoiceRepository.existsByInstituteIdAndInvoiceNumber(instituteId, number)) {
            throw new ConflictException("BILL_BOOK_NUMBER_USED: bill number " + externalNumber
                    + " has already been entered");
        }
        invoice.setInvoiceNumber(number);
        invoice.setExternalInvoiceNumber(externalNumber);
        invoice.setSeriesId(book.getId());
    }

    // ------------------------------------------------------------------ cancel, reissue

    /**
     * The one case where an invoice is cancelled instead of credited: a POS bill voided in the
     * same open session (the reversal rule). The row and its number stay.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public Invoice cancel(String instituteId, String actorUserId, String invoiceId, String reason) {
        Invoice invoice = requireDocument(instituteId, invoiceId);
        if (invoice.getCancelledAt() != null) {
            return invoice;
        }
        if (creditNoteService.hasCreditNotes(instituteId, invoiceId)) {
            throw new ConflictException("INVOICE_CREDITED: an invoice with a credit note cannot be cancelled");
        }
        invoice.setCancelledAt(LocalDateTime.now());
        invoice.setCancelReason(trimToNull(reason));
        invoice.setStatus(STATUS_CANCELLED);
        invoice = invoiceRepository.save(invoice);
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("invoice_number", invoice.getInvoiceNumber());
        auditService.record(instituteId, actorUserId, invoice.getLocationId(), "INVOICE_CANCELLED", "INVOICE",
                invoice.getId(), null, CommerceInputRules.json(detail), trimToNull(reason));
        return invoice;
    }

    /**
     * A buyer asks for a GSTIN invoice after a B2C one: a full credit note against
     * the first invoice, then a new invoice with the buyer GSTIN and the same lines and tax.
     */
    @Transactional
    public CommerceInvoiceDTO reissueAsB2b(String instituteId, String actorUserId, String invoiceId,
                                           ReissueB2bRequest request) {
        require(request != null, "request body is required");
        String buyerGstin = GstinValidator.normalise(request.getBuyerGstin());
        require(buyerGstin != null && GstinValidator.isValid(buyerGstin), "buyer_gstin is not a valid GSTIN");

        if (invoiceRepository.lockForCredit(instituteId, invoiceId) == null) {
            throw new ResourceNotFoundException("Invoice not found");
        }
        Invoice original = requireDocument(instituteId, invoiceId);
        if (!DocumentType.TAX_INVOICE.name().equals(original.getDocumentType())) {
            throw new ConflictException("NOT_A_TAX_INVOICE: only a tax invoice can be reissued with a buyer GSTIN");
        }
        if (original.getCancelledAt() != null) {
            throw new ConflictException("INVOICE_CANCELLED: a cancelled invoice cannot be reissued");
        }
        if (original.getBuyerGstin() != null) {
            throw new ConflictException("ALREADY_B2B: this invoice already carries a buyer GSTIN");
        }
        if (creditNoteService.hasCreditNotes(instituteId, invoiceId)) {
            throw new ConflictException("INVOICE_CREDITED: an invoice with a credit note cannot be reissued");
        }
        CommerceInvoiceSnapshot snapshot = readSnapshot(original);
        List<String> logIds = mappingRepository.findPaymentLogIdsByInvoiceId(invoiceId);
        require(snapshot.getTax() != null && !logIds.isEmpty(), "the invoice cannot be reissued: its snapshot is incomplete");

        creditNoteService.issue(instituteId, actorUserId, CreditNoteRequest.builder()
                .invoiceId(invoiceId)
                .full(true)
                .reason("Reissued with buyer GSTIN " + buyerGstin)
                .clientRequestId("REISSUE:" + invoiceId)
                .build());

        Invoice reissued = issueNew(instituteId, CommerceInvoiceRequest.builder()
                .commerceOrderId(original.getCommerceOrderId())
                .orderNumber(snapshot.getOrderNumber())
                .channel(original.getChannel())
                .locationId(original.getLocationId())
                .userId(original.getUserId())
                .buyerName(trimToNull(request.getBuyerName()) != null ? request.getBuyerName() : snapshot.getBuyerName())
                .buyerPhone(snapshot.getBuyerPhone())
                .buyerEmail(snapshot.getBuyerEmail())
                .buyerGstin(buyerGstin)
                .billingAddress(trimToNull(request.getBillingAddress()) != null ? request.getBillingAddress()
                        : snapshot.getBillingAddress())
                .shippingAddress(snapshot.getShippingAddress())
                .currency(original.getCurrency())
                .tax(snapshot.getTax())
                .lineExtras(snapshot.getLineExtras())
                .paymentLogIds(logIds)
                .actorUserId(actorUserId)
                .build(), logIds, original.getInvoiceNumber());

        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("from_invoice_number", original.getInvoiceNumber());
        detail.put("to_invoice_number", reissued.getInvoiceNumber());
        auditService.record(instituteId, actorUserId, original.getLocationId(), "INVOICE_REISSUED_B2B", "INVOICE",
                reissued.getId(), null, CommerceInputRules.json(detail), null);
        return toDto(reissued, ZERO);
    }

    // ------------------------------------------------------------------ reads

    @Transactional(readOnly = true)
    public CommerceInvoiceDTO get(String instituteId, String invoiceId) {
        Invoice invoice = requireDocument(instituteId, invoiceId);
        return toDto(invoice, creditNoteService.creditedTotal(instituteId, invoiceId));
    }

    /** A commerce document of this institute, or 404. Other invoices are not visible here. */
    @Transactional(readOnly = true)
    public Invoice requireDocument(String instituteId, String invoiceId) {
        Invoice invoice = invoiceId == null ? null : invoiceRepository.findById(invoiceId).orElse(null);
        if (invoice == null || !instituteId.equals(invoice.getInstituteId())
                || !CommerceDocumentGuard.isCommerceDocument(invoice)) {
            throw new ResourceNotFoundException("Invoice not found");
        }
        return invoice;
    }

    public static CommerceInvoiceSnapshot readSnapshot(Invoice invoice) {
        try {
            return JSON.readValue(invoice.getInvoiceDataJson(), CommerceInvoiceSnapshot.class);
        } catch (Exception e) {
            throw new IllegalStateException("commerce invoice " + invoice.getId() + " has no readable snapshot", e);
        }
    }

    static String writeSnapshot(CommerceInvoiceSnapshot snapshot) {
        try {
            return JSON.writeValueAsString(snapshot);
        } catch (Exception e) {
            throw new IllegalStateException("commerce invoice snapshot is not serialisable", e);
        }
    }

    // ------------------------------------------------------------------ helpers

    static DocumentType documentTypeFor(TaxMode mode) {
        return switch (mode) {
            case REGULAR -> DocumentType.TAX_INVOICE;
            case COMPOSITION -> DocumentType.BILL_OF_SUPPLY;
            case UNREGISTERED -> DocumentType.INVOICE;
        };
    }

    /** A snapshot that does not add up is refused before a number is spent on it. */
    static void requireConsistent(TaxResult tax) {
        BigDecimal net = ZERO;
        for (TaxLineResult line : tax.getLines()) {
            require(line.getNet() != null && line.getTaxableValue() != null, "a tax line has no amounts");
            BigDecimal parts = line.getTaxableValue().add(nz(line.getCgst())).add(nz(line.getSgst()))
                    .add(nz(line.getIgst())).add(nz(line.getCess()));
            require(parts.compareTo(line.getNet()) == 0, "a tax line does not add up to its amount");
            if (tax.getTaxHead() == TaxHead.NONE) {
                require(parts.compareTo(line.getTaxableValue()) == 0, "a document without tax cannot carry tax lines");
            }
            net = net.add(line.getNet());
        }
        require(tax.getTotal() != null && net.add(nz(tax.getRoundOff())).compareTo(tax.getTotal()) == 0,
                "the lines and the round-off do not add up to the total");
        require(tax.getTotal().signum() >= 0, "the total cannot be negative");
    }

    /** Every log must exist, carry a plan and belong to the institute. */
    private List<PaymentLog> requirePaymentLogs(String instituteId, List<String> logIds) {
        List<PaymentLog> logs = paymentLogRepository.findAllById(logIds);
        require(logs.size() == logIds.size(), "a payment log of the order was not found");
        for (PaymentLog paymentLog : logs) {
            require(paymentLog.getUserPlan() != null, "a payment log of the order has no plan");
            if (paymentLog.getUserPlan().getEnrollInvite() != null) {
                require(instituteId.equals(paymentLog.getUserPlan().getEnrollInvite().getInstituteId()),
                        "a payment log does not belong to this institute");
            }
        }
        return logs;
    }

    private static List<String> cleanIds(List<String> ids) {
        Set<String> out = new LinkedHashSet<>();
        if (ids != null) {
            for (String id : ids) {
                if (trimToNull(id) != null) {
                    out.add(id.trim());
                }
            }
        }
        return new ArrayList<>(out);
    }

    private static BigDecimal nz(BigDecimal value) {
        return value == null ? ZERO : value;
    }

    private static CommerceInvoiceDTO toDto(Invoice invoice, BigDecimal credited) {
        return CommerceInvoiceDTO.builder()
                .id(invoice.getId())
                .invoiceNumber(invoice.getInvoiceNumber())
                .externalInvoiceNumber(invoice.getExternalInvoiceNumber())
                .documentType(invoice.getDocumentType())
                .documentDate(invoice.getDocumentDate())
                .commerceOrderId(invoice.getCommerceOrderId())
                .channel(invoice.getChannel())
                .locationId(invoice.getLocationId())
                .sellerGstin(invoice.getSellerGstin())
                .buyerGstin(invoice.getBuyerGstin())
                .placeOfSupplyState(invoice.getPlaceOfSupplyState())
                .taxHead(invoice.getTaxHead())
                .taxableValue(invoice.getSubtotal())
                .taxAmount(invoice.getTaxAmount())
                .roundOff(invoice.getRoundOff())
                .total(invoice.getTotalAmount())
                .currency(invoice.getCurrency())
                .status(invoice.getStatus())
                .cancelledAt(invoice.getCancelledAt())
                .cancelReason(invoice.getCancelReason())
                .credited(credited)
                .pdfReady(invoice.getPdfFileId() != null)
                .build();
    }
}
