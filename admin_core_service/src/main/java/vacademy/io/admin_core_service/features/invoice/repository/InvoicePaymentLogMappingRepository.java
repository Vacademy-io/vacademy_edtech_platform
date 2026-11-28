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

    // ---------------------------------------------------------------- commerce (WP-04)
    // A commerce document is an invoice with a document type; no other invoice has one, so
    // these find nothing for a course payment.

    /** Whether the payment log is covered by a commerce GST document. */
    @Query("SELECT COUNT(m) > 0 FROM InvoicePaymentLogMapping m "
            + "WHERE m.paymentLog.id = :paymentLogId AND m.invoice.documentType IS NOT NULL")
    boolean existsCommerceDocumentByPaymentLogId(@Param("paymentLogId") String paymentLogId);

    /** The commerce documents that cover any of the payment logs, newest first. */
    @Query("SELECT DISTINCT i FROM InvoicePaymentLogMapping m JOIN m.invoice i "
            + "WHERE m.paymentLog.id IN :paymentLogIds AND i.documentType IS NOT NULL "
            + "ORDER BY i.createdAt DESC")
    List<Invoice> findCommerceDocumentsByPaymentLogIds(@Param("paymentLogIds") Collection<String> paymentLogIds);

    /** Payment log ids behind one invoice, without loading the logs. */
    @Query("SELECT m.paymentLog.id FROM InvoicePaymentLogMapping m WHERE m.invoice.id = :invoiceId")
    List<String> findPaymentLogIdsByInvoiceId(@Param("invoiceId") String invoiceId);

    /**
     * Whether the payment log settles an invoice of the given source (ADMIN_MANUAL for an admin
     * invoice). An admin invoice payment can carry the membership it paid for, so the plan
     * column alone no longer tells it apart from an enrolment payment.
     */
    @Query("SELECT COUNT(m) > 0 FROM InvoicePaymentLogMapping m "
            + "WHERE m.paymentLog.id = :paymentLogId AND m.invoice.source = :source")
    boolean existsByPaymentLogIdAndInvoiceSource(@Param("paymentLogId") String paymentLogId,
                                                 @Param("source") String source);
}

