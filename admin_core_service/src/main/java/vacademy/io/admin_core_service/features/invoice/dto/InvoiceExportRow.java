package vacademy.io.admin_core_service.features.invoice.dto;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * One invoice in a bulk ZIP export. A projection rather than the entity so listing a whole
 * period never touches line items, payment-log mappings or the media service — the PDF is
 * resolved one invoice at a time while the archive is written.
 */
public interface InvoiceExportRow {
    String getId();

    String getInvoiceNumber();

    LocalDateTime getInvoiceDate();

    String getUserId();

    String getStatus();

    String getSource();

    BigDecimal getTotalAmount();

    String getCurrency();

    LocalDateTime getCreatedAt();
}
