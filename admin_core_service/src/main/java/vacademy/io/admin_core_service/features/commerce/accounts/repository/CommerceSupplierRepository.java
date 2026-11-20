package vacademy.io.admin_core_service.features.commerce.accounts.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceSupplier;

import java.util.List;
import java.util.Optional;

/** Suppliers of an institute. Every query filters by institute. */
public interface CommerceSupplierRepository extends JpaRepository<CommerceSupplier, String> {

    Optional<CommerceSupplier> findByInstituteIdAndId(String instituteId, String id);

    Optional<CommerceSupplier> findByInstituteIdAndClientRequestId(String instituteId, String clientRequestId);

    boolean existsByInstituteIdAndIdAndStatus(String instituteId, String id, String status);

    /** Other suppliers of the institute with this GSTIN (a GSTIN may repeat; the caller warns). */
    List<CommerceSupplier> findByInstituteIdAndGstinAndIdNot(String instituteId, String gstin, String id);

    /**
     * The supplier list. {@code status} null = every status; {@code group} null = every group;
     * {@code like} is a lower-case LIKE pattern on {@code search_text} with {@code %}, {@code _} and
     * {@code \} escaped by a backslash (null = no text filter); {@code hasDue} keeps suppliers whose
     * ledger adds up to more than zero. Ordered by name, then id. The page must be unsorted.
     */
    default Page<CommerceSupplier> search(String instituteId, String status, String group, String like,
                                          boolean hasDue, Pageable page) {
        return search(instituteId, status, group, like, null, hasDue, page);
    }

    /**
     * As {@link #search(String, String, String, String, boolean, Pageable)}; in addition a supplier
     * whose code or GSTIN equals {@code exact} upper-cased, or whose phone equals {@code exact}, comes
     * first (null = no ranking).
     */
    @Query(value = "SELECT s.* FROM commerce_supplier s WHERE " + SEARCH_FILTER
            + " ORDER BY CASE WHEN CAST(:exact AS VARCHAR) IS NOT NULL"
            + " AND (s.code = UPPER(CAST(:exact AS VARCHAR)) OR s.gstin = UPPER(CAST(:exact AS VARCHAR))"
            + " OR s.phone = CAST(:exact AS VARCHAR)) THEN 0 ELSE 1 END, s.name, s.id",
            countQuery = "SELECT COUNT(*) FROM commerce_supplier s WHERE " + SEARCH_FILTER,
            nativeQuery = true)
    Page<CommerceSupplier> search(@Param("instituteId") String instituteId, @Param("status") String status,
                                  @Param("group") String group, @Param("like") String like,
                                  @Param("exact") String exact, @Param("hasDue") boolean hasDue, Pageable page);

    String SEARCH_FILTER = """
            s.institute_id = :instituteId
              AND (CAST(:status AS VARCHAR) IS NULL OR s.status = CAST(:status AS VARCHAR))
              AND (CAST(:group AS VARCHAR) IS NULL OR s.group_code = CAST(:group AS VARCHAR))
              AND (CAST(:like AS VARCHAR) IS NULL OR s.search_text LIKE CAST(:like AS VARCHAR) ESCAPE '\\')
              AND (CAST(:hasDue AS BOOLEAN) IS FALSE OR s.id IN (
                   SELECT l.supplier_id FROM commerce_supplier_ledger l WHERE l.institute_id = :instituteId
                   GROUP BY l.supplier_id HAVING SUM(l.amount) > 0))""";

    /**
     * ACTIVE suppliers whose search text matches {@code like} (escaped as in {@code search}), by name;
     * the size of {@code top} caps the answer.
     */
    @Query("SELECT s FROM CommerceSupplier s WHERE s.instituteId = :instituteId AND s.status = 'ACTIVE'"
            + " AND s.searchText LIKE :like ESCAPE '\\' ORDER BY s.name, s.id")
    List<CommerceSupplier> lookup(@Param("instituteId") String instituteId, @Param("like") String like,
                                  Pageable top);

    @Query(value = "SELECT DISTINCT group_code FROM commerce_supplier WHERE institute_id = :instituteId"
            + " ORDER BY group_code", nativeQuery = true)
    List<String> distinctGroupCodes(@Param("instituteId") String instituteId);

    /**
     * Locks the supplier row until the transaction ends and answers its id; empty when the supplier
     * is not one of the institute's. Every write to a supplier's ledger takes this lock first.
     */
    @Query(value = "SELECT id FROM commerce_supplier WHERE institute_id = :instituteId AND id = :id FOR UPDATE",
            nativeQuery = true)
    Optional<String> lockForPosting(@Param("instituteId") String instituteId, @Param("id") String id);
}
