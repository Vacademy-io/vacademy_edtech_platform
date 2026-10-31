package vacademy.io.admin_core_service.features.invoice.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceIssueOnPaymentLog;
import vacademy.io.admin_core_service.features.invoice.dto.PaymentLogInvoiceProjection;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.entity.InvoicePaymentLogMapping;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface InvoicePaymentLogMappingRepository extends JpaRepository<InvoicePaymentLogMapping, String> {
    
    List<InvoicePaymentLogMapping> findByInvoice(Invoice invoice);
    
    List<InvoicePaymentLogMapping> findByInvoiceId(String invoiceId);
    
    List<InvoicePaymentLogMapping> findByPaymentLog(PaymentLog paymentLog);
    
    @Query("SELECT iplm.paymentLog FROM InvoicePaymentLogMapping iplm WHERE iplm.invoice.id = :invoiceId")
    List<PaymentLog> findPaymentLogsByInvoiceId(@Param("invoiceId") String invoiceId);
    
    boolean existsByPaymentLogId(String paymentLogId);

    Optional<InvoicePaymentLogMapping> findFirstByPaymentLogId(String paymentLogId);

    List<InvoicePaymentLogMapping> findAllByPaymentLogId(String paymentLogId);

    /**
     * One lookup for a whole installment ledger. Walking it a payment at a time issued a query
     * per ledger row, and a learner paying in instalments has one row per part-payment.
     */
    List<InvoicePaymentLogMapping> findAllByPaymentLogIdIn(Collection<String> paymentLogIds);

    /**
     * Bulk (payment log -> invoice) lookup for a page of the Manage Payments table.
     *
     * <p>Scoped by institute so a caller cannot probe another tenant's invoice numbers by
     * guessing payment log ids — ids outside the institute just drop out of the result.
     *
     * <p>Returns one row per mapping, so a payment log covered by more than one invoice
     * (re-issue, correction) comes back more than once; the caller picks the one to show.
     */
    @Query("SELECT m.paymentLog.id AS paymentLogId, i.id AS invoiceId, "
            + "i.invoiceNumber AS invoiceNumber, i.invoiceDate AS invoiceDate, "
            + "i.status AS status, i.totalAmount AS totalAmount, i.currency AS currency, "
            + "i.pdfFileId AS pdfFileId, i.createdAt AS createdAt "
            + "FROM InvoicePaymentLogMapping m JOIN m.invoice i "
            + "WHERE i.instituteId = :instituteId AND m.paymentLog.id IN :paymentLogIds")
    List<PaymentLogInvoiceProjection> findInvoiceSummariesByPaymentLogIds(
            @Param("instituteId") String instituteId,
            @Param("paymentLogIds") Collection<String> paymentLogIds);

    /**
     * Every live invoice on any payment log the given invoices cover — including invoices
     * issued outside the export window, so a duplicate is recognised even when its first-issued
     * twin falls in an earlier period.
     */
    @Query("SELECT m.paymentLog.id AS paymentLogId, i.id AS invoiceId, "
            + "i.invoiceNumber AS invoiceNumber, i.invoiceDate AS invoiceDate, i.createdAt AS createdAt "
            + "FROM InvoicePaymentLogMapping m JOIN m.invoice i "
            + "WHERE i.instituteId = :instituteId AND i.status <> 'REJECTED' "
            + "AND m.paymentLog.id IN (SELECT m2.paymentLog.id FROM InvoicePaymentLogMapping m2 "
            + "WHERE m2.invoice.id IN :invoiceIds)")
    List<InvoiceIssueOnPaymentLog> findLiveInvoicesSharingPaymentLogs(
            @Param("instituteId") String instituteId,
            @Param("invoiceIds") Collection<String> invoiceIds);
}

