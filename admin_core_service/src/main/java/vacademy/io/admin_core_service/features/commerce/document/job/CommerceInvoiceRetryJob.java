package vacademy.io.admin_core_service.features.commerce.document.job;

import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceCreditNote;
import vacademy.io.admin_core_service.features.commerce.document.pdf.CommerceDocumentPdfService;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceCreditNoteRepository;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Covers the invoice step when it failed.
 *
 * <ol>
 *   <li>Orders that should have an invoice and have none: issued through the order work
 *       package ({@link CommerceInvoiceBacklog}), each in its own transaction, with an alert.</li>
 *   <li>Documents whose PDF was never stored (the after-commit step failed or was dropped):
 *       drawn again from the stored snapshot.</li>
 * </ol>
 * An alert is an ERROR log line that starts with {@code COMMERCE_ALERT}. Nothing is corrected
 * silently: every order found is logged, whether or not the retry worked.
 */
@Slf4j
@Component
public class CommerceInvoiceRetryJob {

    private static final int BATCH = 50;
    /** Documents younger than this may still be in the after-commit queue. */
    private static final int PDF_GRACE_MINUTES = 5;
    private static final int PDF_LOOKBACK_DAYS = 7;

    private final ObjectProvider<CommerceInvoiceBacklog> backlog;
    private final InvoiceRepository invoiceRepository;
    private final CommerceCreditNoteRepository creditNoteRepository;
    private final CommerceDocumentPdfService pdfService;

    public CommerceInvoiceRetryJob(ObjectProvider<CommerceInvoiceBacklog> backlog,
                                   InvoiceRepository invoiceRepository,
                                   CommerceCreditNoteRepository creditNoteRepository,
                                   CommerceDocumentPdfService pdfService) {
        this.backlog = backlog;
        this.invoiceRepository = invoiceRepository;
        this.creditNoteRepository = creditNoteRepository;
        this.pdfService = pdfService;
    }

    @Scheduled(cron = "0 7/15 * * * *", zone = "UTC")
    @SchedulerLock(name = "CommerceInvoiceRetryJob", lockAtMostFor = "PT10M", lockAtLeastFor = "PT30S")
    public void run() {
        try {
            runOnce();
        } catch (Exception e) {
            log.error("COMMERCE_ALERT invoice retry job failed: {}", e.getMessage(), e);
        }
    }

    /** One pass. Returns how many orders got their invoice and how many PDFs were stored. */
    public int[] runOnce() {
        return new int[] {issueMissingInvoices(), redrawMissingPdfs()};
    }

    int issueMissingInvoices() {
        CommerceInvoiceBacklog source = backlog.getIfAvailable();
        if (source == null) {
            return 0;
        }
        int issued = 0;
        for (String orderId : source.findOrderIdsMissingInvoice(BATCH)) {
            try {
                source.issueInvoiceFor(orderId);
                issued++;
                log.error("COMMERCE_ALERT order {} had no invoice; the retry job issued it", orderId);
            } catch (Exception e) {
                log.error("COMMERCE_ALERT order {} has no invoice and the retry failed: {}", orderId,
                        e.getMessage(), e);
            }
        }
        return issued;
    }

    int redrawMissingPdfs() {
        LocalDateTime until = LocalDateTime.now().minusMinutes(PDF_GRACE_MINUTES);
        LocalDateTime since = until.minusDays(PDF_LOOKBACK_DAYS);
        int stored = 0;
        List<Invoice> invoices = invoiceRepository.findCommerceDocumentsWithoutPdf(since, until,
                PageRequest.of(0, BATCH));
        for (Invoice invoice : invoices) {
            if (pdfService.storeInvoicePdfQuietly(invoice.getId())) {
                stored++;
            }
        }
        List<CommerceCreditNote> notes = creditNoteRepository.findWithoutPdf(since, until, PageRequest.of(0, BATCH));
        for (CommerceCreditNote note : notes) {
            if (pdfService.storeCreditNotePdfQuietly(note.getId())) {
                stored++;
            }
        }
        if (!invoices.isEmpty() || !notes.isEmpty()) {
            log.warn("Commerce PDF retry: {} invoice(s) and {} credit note(s) had no PDF, {} stored",
                    invoices.size(), notes.size(), stored);
        }
        return stored;
    }
}
