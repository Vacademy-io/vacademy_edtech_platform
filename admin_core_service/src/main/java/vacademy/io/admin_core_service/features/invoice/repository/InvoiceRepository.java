package vacademy.io.admin_core_service.features.invoice.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceExportRow;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface InvoiceRepository extends JpaRepository<Invoice, String> {

       // NOTE: there is deliberately no lookup by bare invoice_number. Since V432 the number
       // is unique per (institute_id, invoice_number), so a global lookup can match several
       // rows and would throw NonUniqueResultException. Always scope by institute.

       /** Institute-scoped number lookup. */
       Optional<Invoice> findByInstituteIdAndInvoiceNumber(String instituteId, String invoiceNumber);

       boolean existsByInstituteIdAndInvoiceNumber(String instituteId, String invoiceNumber);

       /** Drives the "N existing invoices keep their numbers" line in the change warning. */
       long countByInstituteId(String instituteId);

       /** Most recently issued number, shown as the "current" example in the change warning. */
       Optional<Invoice> findTopByInstituteIdOrderByCreatedAtDesc(String instituteId);

       /**
        * Highest sequence position issued by this institute in this reset window, or 0 if
        * none — so the next number is {@code highestSeqNo(...) + 1}.
        *
        * <p>Invoices issued before V432 have {@code seq_no = NULL} and are skipped, which is
        * why the caller must treat a collision by INCREMENTING its candidate rather than
        * recomputing this value: a clash against a legacy number would otherwise return the
        * same MAX forever and loop.
        *
        * <p>Served by {@code idx_invoice_seq_allocation (institute_id, seq_scope_key, seq_no DESC)}.
        */
       @Query("SELECT COALESCE(MAX(i.seqNo), 0) FROM Invoice i "
                     + "WHERE i.instituteId = :instituteId AND i.seqScopeKey = :scopeKey")
       long highestSeqNo(@Param("instituteId") String instituteId, @Param("scopeKey") String scopeKey);

       List<Invoice> findByUserIdOrderByCreatedAtDesc(String userId);

       List<Invoice> findByInstituteIdOrderByCreatedAtDesc(String instituteId);

       /**
        * Find invoices by user plan ID via payment log mapping
        * Since Invoice no longer has direct userPlanId, we query through the mapping
        * table
        */
       @Query("SELECT DISTINCT i FROM Invoice i " +
                     "JOIN i.paymentLogMappings m " +
                     "JOIN m.paymentLog pl " +
                     "WHERE pl.userPlan.id = :userPlanId " +
                     "ORDER BY i.createdAt DESC")
       List<Invoice> findByUserPlanIdOrderByCreatedAtDesc(@Param("userPlanId") String userPlanId);

       @Query("SELECT i FROM Invoice i WHERE i.userId = :userId AND i.instituteId = :instituteId ORDER BY i.createdAt DESC")
       List<Invoice> findByUserIdAndInstituteIdOrderByCreatedAtDesc(@Param("userId") String userId,
                     @Param("instituteId") String instituteId);

       @Query("SELECT COUNT(i) FROM Invoice i WHERE i.instituteId = :instituteId AND DATE(i.invoiceDate) = DATE(:date)")
       Long countByInstituteIdAndInvoiceDate(@Param("instituteId") String instituteId,
                     @Param("date") LocalDateTime date);

       @Query("SELECT i FROM Invoice i WHERE i.instituteId = :instituteId AND i.invoiceDate >= :startDate AND i.invoiceDate <= :endDate ORDER BY i.createdAt DESC")
       Page<Invoice> findByInstituteIdAndDateRange(@Param("instituteId") String instituteId,
                     @Param("startDate") LocalDateTime startDate,
                     @Param("endDate") LocalDateTime endDate,
                     Pageable pageable);

       @Query("SELECT i FROM Invoice i WHERE i.userId = :userId AND i.instituteId = :instituteId " +
                     "AND i.status = 'PENDING_PAYMENT' AND i.source = 'ADMIN_MANUAL' " +
                     "ORDER BY i.createdAt ASC")
       List<Invoice> findPendingAdminManualInvoices(@Param("userId") String userId,
                     @Param("instituteId") String instituteId);

       /** Sum of non-REJECTED admin invoices with no DEBIT_ACCRUAL ledger entry (pre-ledger-integration invoices). */
       @Query(value = "SELECT COALESCE(SUM(i.total_amount), 0) FROM invoice i " +
                     "WHERE i.user_id = :userId AND i.institute_id = :instituteId " +
                     "AND i.source = 'ADMIN_MANUAL' AND i.status != 'REJECTED' " +
                     "AND NOT EXISTS (SELECT 1 FROM user_account_ledger l " +
                     "WHERE l.source_type = 'ADMIN_INVOICE' AND l.source_id = i.id " +
                     "AND l.event_type = 'DEBIT_ACCRUAL')", nativeQuery = true)
       BigDecimal sumUnledgeredAdminInvoiceAccruals(@Param("userId") String userId,
                     @Param("instituteId") String instituteId);

       /** Sum of PAID admin invoices with no credit ledger entry (pre-ledger-integration payments). */
       @Query(value = "SELECT COALESCE(SUM(i.total_amount), 0) FROM invoice i " +
                     "WHERE i.user_id = :userId AND i.institute_id = :instituteId " +
                     "AND i.source = 'ADMIN_MANUAL' AND i.status = 'PAID' " +
                     "AND NOT EXISTS (SELECT 1 FROM user_account_ledger l " +
                     "WHERE l.source_type = 'ADMIN_INVOICE' AND l.source_id = i.id " +
                     "AND l.event_type IN ('CREDIT_PAYMENT', 'CREDIT_WAIVER', 'CREDIT_ADJUSTMENT'))", nativeQuery = true)
       BigDecimal sumUnledgeredAdminInvoicePayments(@Param("userId") String userId,
                     @Param("instituteId") String instituteId);

       /**
        * Live (non-REJECTED) invoices issued in the window, oldest first — the bulk ZIP export.
        * The caller passes a page one larger than its cap so it can tell "exactly the cap"
        * from "too many" without a separate count.
        *
        * <p>Both bounds are required — an open end is passed as a far-past / far-future date.
        * A {@code :startDate IS NULL} guard leaves Postgres unable to type the parameter
        * ("could not determine data type of parameter $2").
        */
       @Query("SELECT i.id AS id, i.invoiceNumber AS invoiceNumber, i.invoiceDate AS invoiceDate, " +
                     "i.userId AS userId, i.status AS status, i.source AS source, " +
                     "i.totalAmount AS totalAmount, i.currency AS currency, i.createdAt AS createdAt " +
                     "FROM Invoice i WHERE i.instituteId = :instituteId " +
                     "AND i.status <> 'REJECTED' " +
                     "AND i.invoiceDate >= :startDate AND i.invoiceDate <= :endDate " +
                     "ORDER BY i.invoiceDate ASC, i.createdAt ASC")
       List<InvoiceExportRow> findForBulkExport(
                     @Param("instituteId") String instituteId,
                     @Param("startDate") LocalDateTime startDate,
                     @Param("endDate") LocalDateTime endDate,
                     Pageable pageable);

       @Query("SELECT i FROM Invoice i WHERE i.instituteId = :instituteId " +
                     "AND (:userId IS NULL OR i.userId = :userId) " +
                     "AND (:status IS NULL OR i.status = :status) " +
                     "AND (:startDate IS NULL OR i.invoiceDate >= :startDate) " +
                     "AND (:endDate IS NULL OR i.invoiceDate <= :endDate) " +
                     "ORDER BY i.createdAt DESC")
       Page<Invoice> findByInstituteIdWithFilters(
                     @Param("instituteId") String instituteId,
                     @Param("userId") String userId,
                     @Param("status") String status,
                     @Param("startDate") LocalDateTime startDate,
                     @Param("endDate") LocalDateTime endDate,
                     Pageable pageable);
}
