package vacademy.io.admin_core_service.features.invoice.dto;

import java.time.LocalDateTime;

/**
 * A live invoice issued against a payment log. Used to spot a payment that carries more than
 * one invoice (concurrent generation for a single payment), so a bulk export can keep the
 * first-issued one and leave the accidental extras out.
 */
public interface InvoiceIssueOnPaymentLog {
    String getPaymentLogId();

    String getInvoiceId();

    String getInvoiceNumber();

    LocalDateTime getInvoiceDate();

    LocalDateTime getCreatedAt();
}
