package vacademy.io.admin_core_service.features.commerce.document.service;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.common.CommercePlans;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.repository.InvoicePaymentLogMappingRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.common.exceptions.VacademyException;

/**
 * Keeps the legacy invoice and payment code off shop money.
 *
 * <p>A payment log is a commerce log when its plan is a shop order line (the plan's invite sells
 * a variant, {@link CommercePlans}) or when a commerce document already covers it. An invoice is
 * a commerce document when it has a document type; only {@code CommerceInvoiceService} writes
 * one. Neither test reads the package type. For a course payment both tests are false and the
 * legacy code runs exactly as before.
 *
 * <p>The order work package adds the third arm when order tables exist: the log's payment group belongs to a
 * {@code commerce_order} (this is what covers shipping and COD-charge lines before the invoice).
 */
@Component
public class CommerceDocumentGuard {

    private final CommercePlans commercePlans;
    private final InvoicePaymentLogMappingRepository mappingRepository;

    public CommerceDocumentGuard(CommercePlans commercePlans, InvoicePaymentLogMappingRepository mappingRepository) {
        this.commercePlans = commercePlans;
        this.mappingRepository = mappingRepository;
    }

    public boolean isCommerceLog(PaymentLog paymentLog) {
        if (paymentLog == null) {
            return false;
        }
        if (paymentLog.getUserPlan() != null && commercePlans.isCommercePlan(paymentLog.getUserPlan())) {
            return true;
        }
        return paymentLog.getId() != null
                && mappingRepository.existsCommerceDocumentByPaymentLogId(paymentLog.getId());
    }

    public static boolean isCommerceDocument(Invoice invoice) {
        return invoice != null && invoice.getDocumentType() != null;
    }

    /** Throws 400 when the payment belongs to a shop order. {@code action} completes "Cannot ...". */
    public void refuseCommerceLog(PaymentLog paymentLog, String action) {
        if (isCommerceLog(paymentLog)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Cannot " + action
                    + ": this payment belongs to a shop order and is managed in Commerce.");
        }
    }

    /** Throws 400 when the invoice is a commerce GST document: those are reversed by a credit note. */
    public static void refuseCommerceDocument(Invoice invoice, String action) {
        if (isCommerceDocument(invoice)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Cannot " + action
                    + ": this is a shop tax document. It is reversed by a credit note in Commerce, never deleted.");
        }
    }
}
