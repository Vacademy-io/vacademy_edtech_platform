package vacademy.io.admin_core_service.features.commerce.document.pdf;

import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.document.dto.CommerceInvoiceLineExtra;
import vacademy.io.admin_core_service.features.commerce.document.dto.CommerceInvoiceSnapshot;
import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceCreditNote;
import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceCreditNoteLine;
import vacademy.io.admin_core_service.features.commerce.document.enums.DocumentType;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceCreditNoteLineRepository;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceCreditNoteRepository;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceDocumentGuard;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceInvoiceService;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxLineResult;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxRateRow;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxResult;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxHead;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.entity.InvoiceLineItem;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceLineItemRepository;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.common.exceptions.ResourceNotFoundException;
import vacademy.io.common.media.dto.FileDetailsDTO;
import vacademy.io.common.media.dto.InMemoryMultipartFile;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * Draws and stores the PDF of a commerce invoice or credit note.
 *
 * <p>Never inside the document's transaction: drawing takes time
 * and the upload is a remote call, and the document transaction holds the series row lock. The
 * issuers call {@link #storeInvoicePdfAfterCommit} and {@link #storeCreditNotePdfAfterCommit};
 * the work then runs on a small background pool once the document has committed. A PDF that
 * fails or is dropped is drawn later by {@code CommerceInvoiceRetryJob} or on the first
 * download. The PDF is drawn from the stored snapshot only, so it is the same whenever it is
 * drawn.
 */
@Slf4j
@Service
public class CommerceDocumentPdfService {

    private static final BigDecimal ZERO = BigDecimal.ZERO.setScale(2);

    private final InvoiceRepository invoiceRepository;
    private final InvoiceLineItemRepository invoiceLineItemRepository;
    private final CommerceCreditNoteRepository creditNoteRepository;
    private final CommerceCreditNoteLineRepository creditNoteLineRepository;
    private final CommercePdfRenderer renderer;
    private final MediaService mediaService;
    private final TransactionTemplate readTransaction;
    private final TransactionTemplate writeTransaction;

    /** Two threads and a short queue: a burst beyond it is left to the retry job, never to the caller. */
    private final ExecutorService executor = new ThreadPoolExecutor(1, 2, 60, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(200), runnable -> {
                Thread thread = new Thread(runnable, "commerce-document-pdf");
                thread.setDaemon(true);
                return thread;
            }, new ThreadPoolExecutor.DiscardPolicy());

    public CommerceDocumentPdfService(InvoiceRepository invoiceRepository,
                                      InvoiceLineItemRepository invoiceLineItemRepository,
                                      CommerceCreditNoteRepository creditNoteRepository,
                                      CommerceCreditNoteLineRepository creditNoteLineRepository,
                                      CommercePdfRenderer renderer,
                                      MediaService mediaService,
                                      PlatformTransactionManager transactionManager) {
        this.invoiceRepository = invoiceRepository;
        this.invoiceLineItemRepository = invoiceLineItemRepository;
        this.creditNoteRepository = creditNoteRepository;
        this.creditNoteLineRepository = creditNoteLineRepository;
        this.renderer = renderer;
        this.mediaService = mediaService;
        this.readTransaction = new TransactionTemplate(transactionManager);
        this.readTransaction.setReadOnly(true);
        this.writeTransaction = new TransactionTemplate(transactionManager);
    }

    @PreDestroy
    void shutdown() {
        executor.shutdown();
    }

    // ------------------------------------------------------------------ after commit

    public void storeInvoicePdfAfterCommit(String invoiceId) {
        afterCommit(() -> storeInvoicePdfQuietly(invoiceId));
    }

    public void storeCreditNotePdfAfterCommit(String creditNoteId) {
        afterCommit(() -> storeCreditNotePdfQuietly(creditNoteId));
    }

    private void afterCommit(Runnable work) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            executor.execute(work);
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                try {
                    executor.execute(work);
                } catch (RuntimeException e) {
                    // Never let a full or stopped pool reach the caller: the document is committed.
                    log.warn("Commerce PDF was not queued; the retry job will draw it: {}", e.getMessage());
                }
            }
        });
    }

    /** For the after-commit hook and the retry job: a failure is logged and never thrown. */
    public boolean storeInvoicePdfQuietly(String invoiceId) {
        try {
            return storeInvoicePdf(invoiceId) != null;
        } catch (Exception e) {
            log.error("Commerce invoice PDF failed for invoice {}; it will be retried: {}", invoiceId,
                    e.getMessage(), e);
            return false;
        }
    }

    public boolean storeCreditNotePdfQuietly(String creditNoteId) {
        try {
            return storeCreditNotePdf(creditNoteId) != null;
        } catch (Exception e) {
            log.error("Commerce credit note PDF failed for credit note {}; it will be retried: {}", creditNoteId,
                    e.getMessage(), e);
            return false;
        }
    }

    // ------------------------------------------------------------------ store

    /** Draws and stores the PDF when the invoice has none. Returns the file id, or null when it is not a commerce document. */
    public String storeInvoicePdf(String invoiceId) {
        Object[] loaded = readTransaction.execute(status -> {
            Invoice invoice = invoiceRepository.findById(invoiceId).orElse(null);
            if (invoice == null || !CommerceDocumentGuard.isCommerceDocument(invoice)) {
                return null;
            }
            if (invoice.getPdfFileId() != null) {
                return new Object[] {invoice.getPdfFileId(), null, null};
            }
            return new Object[] {null, invoiceView(invoice), invoice.getInvoiceNumber()};
        });
        if (loaded == null) {
            return null;
        }
        if (loaded[0] != null) {
            return (String) loaded[0];
        }
        String fileId = upload(renderer.render(CommerceDocumentHtml.build((DocumentView) loaded[1])),
                "invoice_" + loaded[2]);
        writeTransaction.executeWithoutResult(status -> invoiceRepository.setPdfFileIdIfMissing(invoiceId, fileId));
        return fileId;
    }

    public String storeCreditNotePdf(String creditNoteId) {
        Object[] loaded = readTransaction.execute(status -> {
            CommerceCreditNote note = creditNoteRepository.findById(creditNoteId).orElse(null);
            if (note == null) {
                return null;
            }
            if (note.getPdfFileId() != null) {
                return new Object[] {note.getPdfFileId(), null, null};
            }
            return new Object[] {null, creditNoteView(note), note.getCreditNoteNumber()};
        });
        if (loaded == null) {
            return null;
        }
        if (loaded[0] != null) {
            return (String) loaded[0];
        }
        String fileId = upload(renderer.render(CommerceDocumentHtml.build((DocumentView) loaded[1])),
                "credit_note_" + loaded[2]);
        writeTransaction.executeWithoutResult(
                status -> creditNoteRepository.setPdfFileIdIfMissing(creditNoteId, fileId));
        return fileId;
    }

    // ------------------------------------------------------------------ download

    /** A link to the PDF of a commerce invoice of this institute, drawing it first when it is missing. */
    public String invoicePdfUrl(String instituteId, String invoiceId) {
        Boolean visible = readTransaction.execute(status -> invoiceRepository.findById(invoiceId)
                .map(i -> instituteId.equals(i.getInstituteId()) && CommerceDocumentGuard.isCommerceDocument(i))
                .orElse(false));
        if (!Boolean.TRUE.equals(visible)) {
            throw new ResourceNotFoundException("Invoice not found");
        }
        return mediaService.getFilePublicUrlById(storeInvoicePdf(invoiceId));
    }

    public String creditNotePdfUrl(String instituteId, String creditNoteId) {
        Boolean visible = readTransaction.execute(status ->
                creditNoteRepository.findByInstituteIdAndId(instituteId, creditNoteId).isPresent());
        if (!Boolean.TRUE.equals(visible)) {
            throw new ResourceNotFoundException("Credit note not found");
        }
        return mediaService.getFilePublicUrlById(storeCreditNotePdf(creditNoteId));
    }

    // ------------------------------------------------------------------ views

    /**
     * The printable view of an invoice, read only. Public so the measured-goods proof can render
     * the HTML ({@link CommerceDocumentHtml#build}) without storing a PDF.
     */
    public DocumentView invoiceView(Invoice invoice) {
        CommerceInvoiceSnapshot snapshot = CommerceInvoiceService.readSnapshot(invoice);
        TaxResult tax = snapshot.getTax();
        Map<String, CommerceInvoiceLineExtra> extras = extrasByRef(snapshot);
        List<DocumentView.Line> lines = new ArrayList<>();
        for (TaxLineResult line : tax.getLines()) {
            CommerceInvoiceLineExtra extra = extras.get(line.getLineRef());
            lines.add(DocumentView.Line.builder()
                    .description(line.getDescription())
                    .sku(extra == null ? null : extra.getSku())
                    .hsnCode(line.getHsnCode())
                    .quantity(line.getQuantity())
                    .qtyScale(line.getQtyScale())
                    .unit(line.getUnit())
                    .unitPrice(line.getUnitPrice())
                    .discount(nz(line.getLineDiscount()).add(nz(line.getOrderDiscount())))
                    .taxableValue(line.getTaxableValue())
                    .ratePercent(line.getRatePercent())
                    .amount(line.getNet())
                    .build());
        }
        return DocumentView.builder()
                .documentType(DocumentType.valueOf(invoice.getDocumentType()))
                .number(invoice.getExternalInvoiceNumber() != null
                        ? invoice.getExternalInvoiceNumber() + " (" + invoice.getInvoiceNumber() + ")"
                        : invoice.getInvoiceNumber())
                .date(invoice.getDocumentDate())
                .orderNumber(snapshot.getOrderNumber())
                .replacesInvoiceNumber(snapshot.getReplacesInvoiceNumber())
                .cancelled(invoice.getCancelledAt() != null)
                .sellerName(snapshot.getSellerLegalName())
                .sellerAddress(snapshot.getSellerAddress())
                .sellerGstin(invoice.getSellerGstin())
                .sellerStateCode(invoice.getSellerStateCode())
                .buyerName(snapshot.getBuyerName())
                .buyerPhone(snapshot.getBuyerPhone())
                .buyerEmail(snapshot.getBuyerEmail())
                .buyerGstin(invoice.getBuyerGstin())
                .billingAddress(snapshot.getBillingAddress())
                .shippingAddress(snapshot.getShippingAddress())
                .placeOfSupplyState(invoice.getPlaceOfSupplyState())
                .taxHead(tax.getTaxHead())
                .currency(invoice.getCurrency())
                .lines(lines)
                .rateRows(tax.getRateRows() == null ? List.of() : tax.getRateRows())
                .hsnRows(tax.getHsnRows() == null ? List.of() : tax.getHsnRows())
                .taxableValue(tax.getTaxableValue())
                .cgst(tax.getCgst()).sgst(tax.getSgst()).igst(tax.getIgst()).cess(tax.getCess())
                .roundOff(tax.getRoundOff())
                .total(tax.getTotal())
                .build();
    }

    /**
     * The printable view of a credit note, read only. Public so the measured-goods proof can render
     * the HTML ({@link CommerceDocumentHtml#build}) without storing a PDF.
     */
    public DocumentView creditNoteView(CommerceCreditNote note) {
        Invoice invoice = invoiceRepository.findById(note.getInvoiceId())
                .orElseThrow(() -> new IllegalStateException("credit note " + note.getId() + " has no invoice"));
        CommerceInvoiceSnapshot snapshot = CommerceInvoiceService.readSnapshot(invoice);
        Map<String, CommerceInvoiceLineExtra> extras = extrasByRef(snapshot);
        Map<String, Integer> scaleByRef = new HashMap<>();
        if (snapshot.getTax() != null && snapshot.getTax().getLines() != null) {
            snapshot.getTax().getLines().forEach(l -> scaleByRef.putIfAbsent(l.getLineRef(), l.getQtyScale()));
        }
        Map<String, String> refByInvoiceLine = new HashMap<>();
        for (InvoiceLineItem item : invoiceLineItemRepository.findByInvoiceId(invoice.getId())) {
            refByInvoiceLine.put(item.getId(), item.getSourceId());
        }

        TaxHead head = TaxHead.valueOf(note.getTaxHead());
        List<DocumentView.Line> lines = new ArrayList<>();
        Map<String, TaxRateRow> rateRows = new TreeMap<>();
        Map<String, TaxRateRow> hsnRows = new TreeMap<>();
        for (CommerceCreditNoteLine line : creditNoteLineRepository
                .findByInstituteIdAndCreditNoteIdOrderByCreatedAtAsc(note.getInstituteId(), note.getId())) {
            String ref = refByInvoiceLine.get(line.getInvoiceLineItemId());
            CommerceInvoiceLineExtra extra = ref == null ? null : extras.get(ref);
            lines.add(DocumentView.Line.builder()
                    .description(line.getDescription())
                    .sku(extra == null ? null : extra.getSku())
                    .hsnCode(line.getHsnCode())
                    .quantity(line.getQuantity())
                    .qtyScale(ref == null ? 1 : scaleByRef.getOrDefault(ref, 1))
                    .unit(line.getUnit())
                    .unitPrice(line.getUnitPrice())
                    .taxableValue(line.getTaxableValue())
                    .ratePercent(line.getTaxRate())
                    .amount(line.getAmount())
                    .build());
            if (head != TaxHead.NONE) {
                addTo(rateRows, String.format("%012.3f", line.getTaxRate()), null, line);
                String hsn = line.getHsnCode() == null ? "" : line.getHsnCode();
                addTo(hsnRows, String.format("%012.3f|%s", line.getTaxRate(), hsn), line.getHsnCode(), line);
            }
        }
        return DocumentView.builder()
                .documentType(DocumentType.CREDIT_NOTE)
                .number(note.getCreditNoteNumber())
                .date(note.getDocumentDate())
                .orderNumber(snapshot.getOrderNumber())
                .againstInvoiceNumber(invoice.getInvoiceNumber())
                .againstInvoiceDate(invoice.getDocumentDate())
                .reason(note.getReason())
                .sellerName(snapshot.getSellerLegalName())
                .sellerAddress(snapshot.getSellerAddress())
                .sellerGstin(note.getSellerGstin())
                .sellerStateCode(note.getSellerStateCode())
                .buyerName(snapshot.getBuyerName())
                .buyerPhone(snapshot.getBuyerPhone())
                .buyerEmail(snapshot.getBuyerEmail())
                .buyerGstin(note.getBuyerGstin())
                .billingAddress(snapshot.getBillingAddress())
                .shippingAddress(snapshot.getShippingAddress())
                .placeOfSupplyState(note.getPlaceOfSupplyState())
                .taxHead(head)
                .currency(note.getCurrency())
                .lines(lines)
                .rateRows(new ArrayList<>(rateRows.values()))
                .hsnRows(new ArrayList<>(hsnRows.values()))
                .taxableValue(note.getTaxableValue())
                .cgst(note.getCgst()).sgst(note.getSgst()).igst(note.getIgst()).cess(note.getCess())
                .roundOff(note.getRoundOff())
                .total(note.getTotal())
                .build();
    }

    private static void addTo(Map<String, TaxRateRow> rows, String key, String hsnCode, CommerceCreditNoteLine line) {
        TaxRateRow row = rows.computeIfAbsent(key, k -> TaxRateRow.builder()
                .hsnCode(hsnCode)
                .ratePercent(line.getTaxRate())
                .taxableValue(ZERO).cgst(ZERO).sgst(ZERO).igst(ZERO).cess(ZERO).taxAmount(ZERO)
                .build());
        row.setTaxableValue(row.getTaxableValue().add(line.getTaxableValue()));
        row.setCgst(row.getCgst().add(line.getCgst()));
        row.setSgst(row.getSgst().add(line.getSgst()));
        row.setIgst(row.getIgst().add(line.getIgst()));
        row.setCess(row.getCess().add(line.getCess()));
        row.setTaxAmount(row.getTaxAmount().add(line.getCgst()).add(line.getSgst()).add(line.getIgst())
                .add(line.getCess()));
    }

    private static Map<String, CommerceInvoiceLineExtra> extrasByRef(CommerceInvoiceSnapshot snapshot) {
        Map<String, CommerceInvoiceLineExtra> extras = new HashMap<>();
        if (snapshot.getLineExtras() != null) {
            for (CommerceInvoiceLineExtra extra : snapshot.getLineExtras()) {
                if (extra != null && extra.getLineRef() != null) {
                    extras.put(extra.getLineRef(), extra);
                }
            }
        }
        return extras;
    }

    private String upload(byte[] pdf, String baseName) {
        String fileName = baseName.replaceAll("[^A-Za-z0-9_-]", "_") + ".pdf";
        try {
            FileDetailsDTO file = mediaService.uploadFileV2(
                    new InMemoryMultipartFile(fileName, fileName, "application/pdf", pdf));
            if (file == null || file.getId() == null) {
                throw new IllegalStateException("the media service returned no file id");
            }
            return file.getId();
        } catch (Exception e) {
            throw new IllegalStateException("commerce document PDF could not be stored: " + e.getMessage(), e);
        }
    }

    private static BigDecimal nz(BigDecimal value) {
        return value == null ? ZERO : value;
    }
}
