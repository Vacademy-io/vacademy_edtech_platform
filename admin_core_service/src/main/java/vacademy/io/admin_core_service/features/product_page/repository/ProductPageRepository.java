package vacademy.io.admin_core_service.features.product_page.repository;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPage;

import java.util.List;
import java.util.Optional;

@Repository
public interface ProductPageRepository extends JpaRepository<ProductPage, String> {

    List<ProductPage> findByInstituteIdAndStatusIn(String instituteId, List<String> statuses);

    /**
     * The admin list: an institute's pages in the given statuses whose name or
     * code contains the search. The pattern is already lower-cased and wrapped
     * in percent signs, with its own wildcards escaped by the exclamation mark.
     * Order comes from the Pageable.
     */
    @Query(value = "SELECT p FROM ProductPage p WHERE p.instituteId = :instituteId AND p.status IN :statuses "
            + "AND (LOWER(p.name) LIKE :pattern ESCAPE '!' OR LOWER(p.code) LIKE :pattern ESCAPE '!')",
            countQuery = "SELECT COUNT(p) FROM ProductPage p WHERE p.instituteId = :instituteId AND p.status IN :statuses "
                    + "AND (LOWER(p.name) LIKE :pattern ESCAPE '!' OR LOWER(p.code) LIKE :pattern ESCAPE '!')")
    Page<ProductPage> searchForAdmin(@Param("instituteId") String instituteId,
                                     @Param("statuses") List<String> statuses,
                                     @Param("pattern") String pattern,
                                     Pageable pageable);

    /** {@link #searchForAdmin} counted per status, as rows of status and count. */
    @Query("SELECT p.status, COUNT(p) FROM ProductPage p WHERE p.instituteId = :instituteId AND p.status IN :statuses "
            + "AND (LOWER(p.name) LIKE :pattern ESCAPE '!' OR LOWER(p.code) LIKE :pattern ESCAPE '!') "
            + "GROUP BY p.status")
    List<Object[]> countByStatusForAdmin(@Param("instituteId") String instituteId,
                                         @Param("statuses") List<String> statuses,
                                         @Param("pattern") String pattern);

    Optional<ProductPage> findByCode(String code);

    boolean existsByCode(String code);

    /**
     * The page, holding a row lock until the transaction ends. Every write to
     * a page's mappings (the editor's save and the catalogue sync) takes it
     * first, so two of them never interleave: a sync reading the rows while a
     * save replaces them would add courses the save already re-inserted.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT p FROM ProductPage p WHERE p.id = :id")
    Optional<ProductPage> lockById(@Param("id") String id);

    /**
     * {@link #lockById}, but only when the page belongs to the institute: the
     * tenant check is part of the locking statement, so a caller naming another
     * institute's page never holds a lock on that page's row.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT p FROM ProductPage p WHERE p.id = :id AND p.instituteId = :instituteId")
    Optional<ProductPage> lockByIdAndInstituteId(@Param("id") String id, @Param("instituteId") String instituteId);
}
