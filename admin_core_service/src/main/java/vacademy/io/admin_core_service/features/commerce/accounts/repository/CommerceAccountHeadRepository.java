package vacademy.io.admin_core_service.features.commerce.accounts.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceAccountHead;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

/** Account heads of an institute. Every query filters by institute. */
public interface CommerceAccountHeadRepository extends JpaRepository<CommerceAccountHead, String> {

    Optional<CommerceAccountHead> findByInstituteIdAndId(String instituteId, String id);

    boolean existsByInstituteIdAndCode(String instituteId, String code);

    /** How many of {@code codes} the institute already has (the starter-list check). */
    long countByInstituteIdAndCodeIn(String instituteId, Collection<String> codes);

    boolean existsByInstituteIdAndParentId(String instituteId, String parentId);

    boolean existsByInstituteIdAndParentIdAndStatus(String instituteId, String parentId, String status);

    /** The heads list; {@code nature} and {@code status} null = any. Ordered by nature, position, code. */
    @Query("SELECT h FROM CommerceAccountHead h WHERE h.instituteId = :instituteId"
            + " AND (:nature IS NULL OR h.nature = :nature) AND (:status IS NULL OR h.status = :status)"
            + " ORDER BY h.nature, h.position, h.code")
    List<CommerceAccountHead> findForList(@Param("instituteId") String instituteId, @Param("nature") String nature,
                                          @Param("status") String status);

    /**
     * Inserts one starter head unless the institute already has its code; answers 1 when inserted.
     * {@code nameI18nJson} is a JSON object text. Concurrent seeds insert each code once. Needs a
     * transaction.
     */
    @Modifying
    @Query(value = """
            INSERT INTO commerce_account_head (id, institute_id, code, name_i18n, nature, expense_kind,
                is_capital, is_system, position, created_by, updated_by)
            VALUES (:id, :instituteId, :code, CAST(:nameI18nJson AS JSONB), :nature,
                CAST(:expenseKind AS VARCHAR), :capital, :system, :position,
                CAST(:actor AS VARCHAR), CAST(:actor AS VARCHAR))
            ON CONFLICT (institute_id, code) DO NOTHING
            """, nativeQuery = true)
    int seedStarter(@Param("id") String id,
                    @Param("instituteId") String instituteId,
                    @Param("code") String code,
                    @Param("nameI18nJson") String nameI18nJson,
                    @Param("nature") String nature,
                    @Param("expenseKind") String expenseKind,
                    @Param("capital") boolean capital,
                    @Param("system") boolean system,
                    @Param("position") int position,
                    @Param("actor") String actor);
}
