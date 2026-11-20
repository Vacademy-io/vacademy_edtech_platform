package vacademy.io.admin_core_service.features.commerce.accounts.repository;

import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceSupplierLedgerEntry;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

/**
 * The supplier ledger. Append-only: this interface extends the bare {@link Repository} on purpose,
 * so it offers no save, update or delete; the one write is {@link #insertIfAbsent}.
 */
public interface CommerceSupplierLedgerRepository extends Repository<CommerceSupplierLedgerEntry, String> {

    /**
     * Inserts one row unless the institute already has a row with this idempotency key; answers 1
     * when inserted, 0 when the key was taken (the caller then reads the existing row). A concurrent
     * insert of the same key is waited for, not failed on, so the caller's transaction stays usable.
     */
    @Modifying
    @Query(value = """
            INSERT INTO commerce_supplier_ledger (id, institute_id, supplier_id, book_date, type, amount,
                reference_type, reference_id, document_number, location_id, note, actor_user_id,
                reverses_entry_id, idempotency_key)
            VALUES (:id, :instituteId, :supplierId, CAST(:bookDate AS DATE), :type, CAST(:amount AS NUMERIC),
                CAST(:referenceType AS VARCHAR), CAST(:referenceId AS VARCHAR), CAST(:documentNumber AS VARCHAR),
                CAST(:locationId AS VARCHAR), CAST(:note AS VARCHAR), CAST(:actorUserId AS VARCHAR),
                CAST(:reversesEntryId AS VARCHAR), :idempotencyKey)
            ON CONFLICT (institute_id, idempotency_key) DO NOTHING
            """, nativeQuery = true)
    int insertIfAbsent(@Param("id") String id,
                       @Param("instituteId") String instituteId,
                       @Param("supplierId") String supplierId,
                       @Param("bookDate") LocalDate bookDate,
                       @Param("type") String type,
                       @Param("amount") BigDecimal amount,
                       @Param("referenceType") String referenceType,
                       @Param("referenceId") String referenceId,
                       @Param("documentNumber") String documentNumber,
                       @Param("locationId") String locationId,
                       @Param("note") String note,
                       @Param("actorUserId") String actorUserId,
                       @Param("reversesEntryId") String reversesEntryId,
                       @Param("idempotencyKey") String idempotencyKey);

    Optional<CommerceSupplierLedgerEntry> findByInstituteIdAndIdempotencyKey(String instituteId,
                                                                            String idempotencyKey);

    Optional<CommerceSupplierLedgerEntry> findByInstituteIdAndId(String instituteId, String id);

    /** Sum of the rows that reverse {@code entryId} (0 when none). */
    @Query(value = "SELECT COALESCE(SUM(amount), 0) FROM commerce_supplier_ledger"
            + " WHERE institute_id = :instituteId AND reverses_entry_id = :entryId", nativeQuery = true)
    BigDecimal sumReversalsOf(@Param("instituteId") String instituteId, @Param("entryId") String entryId);

    /** A supplier's balance, from {@link #sumBySupplierIds}. */
    interface SupplierSum {
        String getSupplierId();

        BigDecimal getBalance();
    }

    /**
     * Balance per supplier for the given ids, one grouped query; suppliers without rows are absent
     * (the caller shows 0.00). {@code supplierIds} must not be empty.
     */
    @Query(value = "SELECT supplier_id AS \"supplierId\", SUM(amount) AS \"balance\" FROM commerce_supplier_ledger"
            + " WHERE institute_id = :instituteId AND supplier_id IN (:supplierIds) GROUP BY supplier_id",
            nativeQuery = true)
    List<SupplierSum> sumBySupplierIds(@Param("instituteId") String instituteId,
                                       @Param("supplierIds") Collection<String> supplierIds);

    /** A supplier's balance from rows dated before {@code from} (0 when none): a statement's opening. */
    @Query(value = "SELECT COALESCE(SUM(amount), 0) FROM commerce_supplier_ledger"
            + " WHERE institute_id = :instituteId AND supplier_id = :supplierId AND book_date < :from",
            nativeQuery = true)
    BigDecimal sumBefore(@Param("instituteId") String instituteId, @Param("supplierId") String supplierId,
                         @Param("from") LocalDate from);

    /**
     * A supplier's rows dated {@code from} to {@code to} (both included), oldest first, at most
     * {@code limit} rows (ask for one more than shown to know the list was cut).
     */
    @Query(value = "SELECT * FROM commerce_supplier_ledger"
            + " WHERE institute_id = :instituteId AND supplier_id = :supplierId"
            + " AND book_date >= :from AND book_date <= :to"
            + " ORDER BY book_date, created_at, id LIMIT :limit", nativeQuery = true)
    List<CommerceSupplierLedgerEntry> rowsBetween(@Param("instituteId") String instituteId,
                                                  @Param("supplierId") String supplierId,
                                                  @Param("from") LocalDate from, @Param("to") LocalDate to,
                                                  @Param("limit") int limit);
}
