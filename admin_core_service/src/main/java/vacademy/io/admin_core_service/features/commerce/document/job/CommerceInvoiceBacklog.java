package vacademy.io.admin_core_service.features.commerce.document.job;

import java.util.List;

/**
 * Orders that should have an invoice and have none. Implemented by the order work package
 * that owns {@code commerce_order}: it knows which orders have reached the
 * invoice point (PACKED or CONFIRMED by the setting; a POS sale at once) and how to build the
 * request from an order. Until that bean exists {@link CommerceInvoiceRetryJob} only redraws
 * missing PDFs.
 */
public interface CommerceInvoiceBacklog {

    /** Ids of orders past their invoice point with no live commerce document, oldest first. */
    List<String> findOrderIdsMissingInvoice(int limit);

    /**
     * Issues the invoice for one order in its own transaction, under the order row lock, through
     * {@code CommerceInvoiceService.issue}. Throws when it cannot.
     */
    void issueInvoiceFor(String orderId);
}
