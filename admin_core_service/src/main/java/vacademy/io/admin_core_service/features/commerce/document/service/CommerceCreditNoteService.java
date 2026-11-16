package vacademy.io.admin_core_service.features.commerce.document.service;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteDTO;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteLineDTO;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteLineRequest;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteRequest;
import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceCreditNote;
import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceCreditNoteLine;
import vacademy.io.admin_core_service.features.commerce.document.enums.DocumentType;
import vacademy.io.admin_core_service.features.commerce.document.pdf.CommerceDocumentPdfService;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceCreditNoteLineRepository;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceCreditNoteRepository;
import vacademy.io.admin_core_service.features.commerce.tax.calc.CommerceTaxCalculator;
import vacademy.io.admin_core_service.features.commerce.tax.calc.CreditLineInput;
import vacademy.io.admin_core_service.features.commerce.tax.calc.CreditLineResult;
import vacademy.io.admin_core_service.features.commerce.tax.calc.CreditResult;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxHead;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.entity.InvoiceLineItem;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceLineItemRepository;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules.require;
import static vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules.trimToNull;

/**
 * Credit notes (the reversal rule). Once issued, a commerce invoice
 * is reversed only by a credit note, full or part. A note copies the HSN code, rate and tax
 * split of the invoice lines it credits and takes its number from the CREDIT_NOTE series.
 *
 * <p>The sum of the credit notes of an invoice can never pass the invoice: the invoice row is
 * locked while a note is worked out, and the calculator refuses a quantity above what is left.
 */
@Service
@RequiredArgsConstructor
public class CommerceCreditNoteService {

    private static final BigDecimal ZERO = BigDecimal.ZERO.setScale(2);

    private final CommerceCreditNoteRepository creditNoteRepository;
    private final CommerceCreditNoteLineRepository creditNoteLineRepository;
    private final InvoiceRepository invoiceRepository;
    private final InvoiceLineItemRepository invoiceLineItemRepository;
    private final CommerceDocumentNumberService numberService;
    private final CommerceTaxSettingService taxSettingService;
    private final DocumentClock clock;
    private final CommerceAuditService auditService;
    private final CommerceDocumentPdfService pdfService;

    private final CommerceTaxCalculator calculator = new CommerceTaxCalculator();

    // ------------------------------------------------------------------ reads

    @Transactional(readOnly = true)
    public Page<CreditNoteDTO> list(String instituteId, String invoiceId, int page, int size) {
        var pageable = CommerceInputRules.page(page, size, Sort.by(Sort.Order.desc("createdAt")));
        Page<CommerceCreditNote> notes = trimToNull(invoiceId) == null
                ? creditNoteRepository.findByInstituteId(instituteId, pageable)
                : creditNoteRepository.findByInstituteIdAndInvoiceId(instituteId, invoiceId.trim(), pageable);
        return notes.map(note -> toDto(note, null, List.of()));
    }

    @Transactional(readOnly = true)
    public CreditNoteDTO get(String instituteId, String creditNoteId) {
        CommerceCreditNote note = creditNoteRepository.findByInstituteIdAndId(instituteId, creditNoteId)
                .orElseThrow(() -> new ResourceNotFoundException("Credit note not found"));
        String invoiceNumber = invoiceRepository.findById(note.getInvoiceId())
                .map(Invoice::getInvoiceNumber).orElse(null);
        return toDto(note, invoiceNumber,
                creditNoteLineRepository.findByInstituteIdAndCreditNoteIdOrderByCreatedAtAsc(instituteId, note.getId()));
    }

    /** Total of the credit notes against an invoice. */
    @Transactional(readOnly = true)
    public BigDecimal creditedTotal(String instituteId, String invoiceId) {
        return creditNoteRepository.findByInstituteIdAndInvoiceIdOrderByCreatedAtAsc(instituteId, invoiceId).stream()
                .map(CommerceCreditNote::getTotal).reduce(ZERO, BigDecimal::add);
    }

    @Transactional(readOnly = true)
    public boolean hasCreditNotes(String instituteId, String invoiceId) {
        return !creditNoteRepository.findByInstituteIdAndInvoiceIdOrderByCreatedAtAsc(instituteId, invoiceId)
                .isEmpty();
    }

    // ------------------------------------------------------------------ issue

    /**
     * Issues a credit note. Joins the caller's transaction when there is one (a return, an RTO,
     * a line cancel), so the note commits or rolls back with the action it documents. Lock
     * order: the invoice row, then the series row last. A repeat of a request (same
     * {@code client_request_id}, same content) returns the note the first one issued.
     */
    @Transactional
    public CreditNoteDTO issue(String instituteId, String actorUserId, CreditNoteRequest request) {
        require(request != null, "request body is required");
        String invoiceId = trimToNull(request.getInvoiceId());
        require(invoiceId != null, "invoice_id is required");
        String clientRequestId = request.getClientRequestId() == null ? "" : request.getClientRequestId().trim();
        require(!clientRequestId.isEmpty() && clientRequestId.length() <= 64
                        && clientRequestId.matches("[A-Za-z0-9._:-]+"),
                "client_request_id is required: up to 64 letters, digits, . _ : or -");
        String requestHash = requestHash(invoiceId, request);

        if (invoiceRepository.lockForCredit(instituteId, invoiceId) == null) {
            throw new ResourceNotFoundException("Invoice not found");
        }
        // After the invoice lock: a twin of this request has committed or has not started.
        // Without this a retried "1 unit of 3" is a valid second note for one more unit.
        Optional<CommerceCreditNote> first = creditNoteRepository
                .findByInstituteIdAndClientRequestId(instituteId, clientRequestId);
        if (first.isPresent()) {
            if (!invoiceId.equals(first.get().getInvoiceId()) || !requestHash.equals(first.get().getRequestHash())) {
                throw new ConflictException("REQUEST_KEY_REUSED: client_request_id was already used for "
                        + "another credit note");
            }
            return get(instituteId, first.get().getId());
        }
        Invoice invoice = invoiceRepository.findById(invoiceId)
                .orElseThrow(() -> new ResourceNotFoundException("Invoice not found"));
        if (!instituteId.equals(invoice.getInstituteId()) || !CommerceDocumentGuard.isCommerceDocument(invoice)) {
            throw new ResourceNotFoundException("Invoice not found");
        }
        if (invoice.getCancelledAt() != null) {
            throw new ConflictException("INVOICE_CANCELLED: a cancelled invoice cannot take a credit note");
        }

        List<InvoiceLineItem> invoiceLines = invoiceLineItemRepository.findByInvoiceId(invoiceId);
        List<CommerceCreditNote> earlierNotes = creditNoteRepository
                .findByInstituteIdAndInvoiceIdOrderByCreatedAtAsc(instituteId, invoiceId);
        Map<String, Earlier> earlier = earlierByInvoiceLine(instituteId, earlierNotes);

        boolean full = Boolean.TRUE.equals(request.getFull());
        Map<String, CreditNoteLineRequest> wanted = new HashMap<>();
        if (!full) {
            require(request.getLines() != null && !request.getLines().isEmpty(),
                    "name the lines to credit, or ask for a full credit note");
            for (CreditNoteLineRequest line : request.getLines()) {
                require(line != null && trimToNull(line.getInvoiceLineItemId()) != null,
                        "a line needs invoice_line_item_id");
                require(line.getQuantity() != null && line.getQuantity() > 0, "a line needs a quantity above zero");
                require(wanted.put(line.getInvoiceLineItemId().trim(), line) == null,
                        "an invoice line is named twice");
            }
        }

        List<CreditLineInput> inputs = new ArrayList<>();
        Map<String, InvoiceLineItem> byId = new LinkedHashMap<>();
        for (InvoiceLineItem line : invoiceLines) {
            byId.put(line.getId(), line);
            Earlier before = earlier.getOrDefault(line.getId(), new Earlier());
            int quantity = line.getQuantity() == null ? 1 : line.getQuantity();
            int toCredit = full ? quantity - before.quantity
                    : wanted.containsKey(line.getId()) ? wanted.get(line.getId()).getQuantity() : 0;
            inputs.add(CreditLineInput.builder()
                    .lineRef(line.getId())
                    .quantity(quantity)
                    .net(line.getAmount())
                    .taxableValue(nz(line.getTaxableValue()))
                    .cgst(nz(line.getCgst())).sgst(nz(line.getSgst())).igst(nz(line.getIgst())).cess(nz(line.getCess()))
                    .ratePercent(line.getTaxRate())
                    .cessPercent(cessRate(line))
                    .quantityCreditedBefore(before.quantity)
                    .netCreditedBefore(before.net)
                    .taxableCreditedBefore(before.taxable)
                    .cgstCreditedBefore(before.cgst).sgstCreditedBefore(before.sgst)
                    .igstCreditedBefore(before.igst).cessCreditedBefore(before.cess)
                    .quantityToCredit(toCredit)
                    .build());
        }
        for (String lineId : wanted.keySet()) {
            require(byId.containsKey(lineId), "invoice_line_item_id is not a line of this invoice");
        }

        TaxHead head = invoice.getTaxHead() == null ? TaxHead.NONE : TaxHead.valueOf(invoice.getTaxHead());
        BigDecimal roundOffBefore = earlierNotes.stream().map(CommerceCreditNote::getRoundOff)
                .reduce(ZERO, BigDecimal::add);
        CreditResult result = calculator.credit(inputs, head, nz(invoice.getRoundOff()), roundOffBefore);

        LocalDate documentDate = request.getDocumentDate() != null ? request.getDocumentDate()
                : clock.today(instituteId);
        require(invoice.getDocumentDate() == null || !documentDate.isBefore(invoice.getDocumentDate()),
                "a credit note cannot be dated before its invoice");
        // A date ahead would open a later year's series and take its first number.
        require(!documentDate.isAfter(clock.today(instituteId)), "a credit note cannot be dated after today");

        // The series row is the last lock taken.
        String financialYear = FinancialYear.of(documentDate, taxSettingService.context(instituteId).getFyStartMonth());
        DocumentNumberAllocator.Allocation number = numberService.allocate(instituteId, DocumentType.CREDIT_NOTE,
                financialYear, invoice.getSellerGstin(), invoice.getLocationId(), null, invoice.getChannel());

        CommerceCreditNote note = new CommerceCreditNote();
        note.setInstituteId(instituteId);
        note.setCreditNoteNumber(number.number());
        note.setSeriesId(number.seriesId());
        note.setInvoiceId(invoiceId);
        note.setCommerceOrderId(invoice.getCommerceOrderId());
        note.setReturnId(trimToNull(request.getReturnId()));
        note.setReason(trimToNull(request.getReason()));
        note.setDocumentDate(documentDate);
        note.setSellerGstin(invoice.getSellerGstin());
        note.setSellerStateCode(invoice.getSellerStateCode());
        note.setBuyerGstin(invoice.getBuyerGstin());
        note.setPlaceOfSupplyState(invoice.getPlaceOfSupplyState());
        note.setTaxHead(head.name());
        note.setTaxableValue(result.getTaxableValue());
        note.setCgst(result.getCgst());
        note.setSgst(result.getSgst());
        note.setIgst(result.getIgst());
        note.setCess(result.getCess());
        note.setTaxAmount(result.getTaxAmount());
        note.setRoundOff(result.getRoundOff());
        note.setTotal(result.getTotal());
        note.setCurrency(invoice.getCurrency());
        note.setCreatedBy(actorUserId);
        note.setClientRequestId(clientRequestId);
        note.setRequestHash(requestHash);
        note = creditNoteRepository.saveAndFlush(note);

        List<CommerceCreditNoteLine> lines = new ArrayList<>();
        for (CreditLineResult credited : result.getLines()) {
            InvoiceLineItem source = byId.get(credited.getLineRef());
            CommerceCreditNoteLine line = new CommerceCreditNoteLine();
            line.setInstituteId(instituteId);
            line.setCreditNoteId(note.getId());
            line.setInvoiceLineItemId(source.getId());
            line.setDescription(source.getDescription());
            line.setHsnCode(source.getHsnCode());
            line.setUnit(source.getUnit());
            line.setQuantity(credited.getQuantity());
            line.setUnitPrice(source.getUnitPrice());
            line.setTaxRate(credited.getRatePercent());
            line.setTaxableValue(credited.getTaxableValue());
            line.setCgst(credited.getCgst());
            line.setSgst(credited.getSgst());
            line.setIgst(credited.getIgst());
            line.setCess(credited.getCess());
            line.setAmount(credited.getNet());
            CreditNoteLineRequest asked = wanted.get(source.getId());
            line.setCostTotal(asked == null ? null : asked.getCostTotal());
            line.setPackageSessionId(source.getPackageSessionId());
            line.setPieceId(source.getPieceId());
            lines.add(line);
        }
        lines = creditNoteLineRepository.saveAll(lines);

        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("credit_note_number", note.getCreditNoteNumber());
        detail.put("invoice_number", invoice.getInvoiceNumber());
        detail.put("total", String.valueOf(note.getTotal()));
        detail.put("full", result.isCompletesInvoice());
        auditService.record(instituteId, actorUserId, invoice.getLocationId(), "CREDIT_NOTE_ISSUED", "CREDIT_NOTE",
                note.getId(), null, CommerceInputRules.json(detail), note.getReason());

        pdfService.storeCreditNotePdfAfterCommit(note.getId());
        return toDto(note, invoice.getInvoiceNumber(), lines);
    }

    // ------------------------------------------------------------------ helpers

    /** What makes two requests "the same": the invoice, full or not, and the lines with their quantities. */
    private static String requestHash(String invoiceId, CreditNoteRequest request) {
        StringBuilder text = new StringBuilder(invoiceId).append('|');
        if (Boolean.TRUE.equals(request.getFull())) {
            text.append("FULL");
        } else if (request.getLines() != null) {
            List<String> parts = new ArrayList<>();
            for (CreditNoteLineRequest line : request.getLines()) {
                if (line != null) {
                    parts.add(trimToNull(line.getInvoiceLineItemId()) + ":" + line.getQuantity());
                }
            }
            parts.sort(null);
            text.append(String.join(",", parts));
        }
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(text.toString().getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }

    /** What earlier credit notes already took from each invoice line. */
    private Map<String, Earlier> earlierByInvoiceLine(String instituteId, List<CommerceCreditNote> notes) {
        Map<String, Earlier> out = new HashMap<>();
        if (notes.isEmpty()) {
            return out;
        }
        List<String> noteIds = notes.stream().map(CommerceCreditNote::getId).toList();
        for (CommerceCreditNoteLine line : creditNoteLineRepository
                .findByInstituteIdAndCreditNoteIdIn(instituteId, noteIds)) {
            Earlier sum = out.computeIfAbsent(line.getInvoiceLineItemId(), k -> new Earlier());
            sum.quantity += line.getQuantity();
            sum.net = sum.net.add(line.getAmount());
            sum.taxable = sum.taxable.add(line.getTaxableValue());
            sum.cgst = sum.cgst.add(line.getCgst());
            sum.sgst = sum.sgst.add(line.getSgst());
            sum.igst = sum.igst.add(line.getIgst());
            sum.cess = sum.cess.add(line.getCess());
        }
        return out;
    }

    /**
     * The cess rate of an invoice line. The invoice stores the GST rate and the cess amount, not
     * the cess rate, so it is read back from the stored amounts for a part credit.
     */
    private static BigDecimal cessRate(InvoiceLineItem line) {
        BigDecimal cess = nz(line.getCess());
        BigDecimal taxable = nz(line.getTaxableValue());
        if (cess.signum() == 0 || taxable.signum() == 0) {
            return BigDecimal.ZERO;
        }
        return cess.multiply(BigDecimal.valueOf(100)).divide(taxable, 3, java.math.RoundingMode.HALF_UP);
    }

    private static BigDecimal nz(BigDecimal value) {
        return value == null ? ZERO : value;
    }

    private static CreditNoteDTO toDto(CommerceCreditNote note, String invoiceNumber,
                                       List<CommerceCreditNoteLine> lines) {
        List<CreditNoteLineDTO> lineDtos = new ArrayList<>();
        for (CommerceCreditNoteLine line : lines) {
            lineDtos.add(CreditNoteLineDTO.builder()
                    .id(line.getId())
                    .invoiceLineItemId(line.getInvoiceLineItemId())
                    .description(line.getDescription())
                    .hsnCode(line.getHsnCode())
                    .unit(line.getUnit())
                    .quantity(line.getQuantity())
                    .unitPrice(line.getUnitPrice())
                    .taxRate(line.getTaxRate())
                    .taxableValue(line.getTaxableValue())
                    .cgst(line.getCgst()).sgst(line.getSgst()).igst(line.getIgst()).cess(line.getCess())
                    .amount(line.getAmount())
                    .build());
        }
        return CreditNoteDTO.builder()
                .id(note.getId())
                .creditNoteNumber(note.getCreditNoteNumber())
                .invoiceId(note.getInvoiceId())
                .invoiceNumber(invoiceNumber)
                .commerceOrderId(note.getCommerceOrderId())
                .returnId(note.getReturnId())
                .reason(note.getReason())
                .documentDate(note.getDocumentDate())
                .sellerGstin(note.getSellerGstin())
                .buyerGstin(note.getBuyerGstin())
                .placeOfSupplyState(note.getPlaceOfSupplyState())
                .taxHead(note.getTaxHead())
                .taxableValue(note.getTaxableValue())
                .cgst(note.getCgst()).sgst(note.getSgst()).igst(note.getIgst()).cess(note.getCess())
                .taxAmount(note.getTaxAmount())
                .roundOff(note.getRoundOff())
                .total(note.getTotal())
                .currency(note.getCurrency())
                .pdfReady(note.getPdfFileId() != null)
                .lines(lineDtos)
                .build();
    }

    private static final class Earlier {
        private int quantity;
        private BigDecimal net = ZERO;
        private BigDecimal taxable = ZERO;
        private BigDecimal cgst = ZERO;
        private BigDecimal sgst = ZERO;
        private BigDecimal igst = ZERO;
        private BigDecimal cess = ZERO;
    }
}
