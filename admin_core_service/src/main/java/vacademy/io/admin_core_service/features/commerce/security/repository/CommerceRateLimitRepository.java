package vacademy.io.admin_core_service.features.commerce.security.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.security.entity.CommerceRateLimit;

import java.util.Date;

public interface CommerceRateLimitRepository extends JpaRepository<CommerceRateLimit, String> {

    /**
     * Counts one hit in a fixed window and returns the count after it. One statement, so
     * concurrent hits on any pod are all counted. Needs a transaction.
     */
    @Query(value = """
            INSERT INTO commerce_rate_limit (id, institute_id, scope, subject_key, window_start, hits)
            VALUES (:id, :instituteId, :scope, :subjectKey, :windowStart, 1)
            ON CONFLICT (institute_id, scope, subject_key, window_start)
            DO UPDATE SET hits = commerce_rate_limit.hits + 1, updated_at = now()
            RETURNING hits
            """, nativeQuery = true)
    Integer hit(@Param("id") String id,
                @Param("instituteId") String instituteId,
                @Param("scope") String scope,
                @Param("subjectKey") String subjectKey,
                @Param("windowStart") Date windowStart);

    @Modifying
    @Query("DELETE FROM CommerceRateLimit r WHERE r.instituteId = :instituteId AND r.windowStart < :before")
    int deleteWindowsBefore(@Param("instituteId") String instituteId, @Param("before") Date before);

    /** Old windows of every institute; for the clean-up job. Needs a transaction. */
    @Modifying
    @Query("DELETE FROM CommerceRateLimit r WHERE r.windowStart < :before")
    int deleteAllWindowsBefore(@Param("before") Date before);
}
