package vacademy.io.admin_core_service.features.engagement.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;

import java.time.Instant;
import java.util.List;

public interface EngagementEngineRepository extends JpaRepository<EngagementEngine, String> {

    List<EngagementEngine> findByInstituteIdOrderByCreatedAtDesc(String instituteId);

    /** Live engines (the promotion of graduated tasks looks at these). */
    List<EngagementEngine> findByStatus(String status);

    /**
     * The sweep driver: O(engines), never O(due members). Ordered by next_due_at so a busy
     * engine cannot monopolize the sweep — bumping the cursor after each visit round-robins
     * fairness in the OUTER loop (a sort key with no institute predicate IS the starvation
     * mechanism; see design doc §4.1).
     */
    @Query(value = """
            SELECT * FROM engagement_engine
            WHERE status IN ('ACTIVE', 'DRY_RUN')
              AND (next_due_at IS NULL OR next_due_at <= :now)
            ORDER BY next_due_at ASC NULLS FIRST
            LIMIT :limit
            """, nativeQuery = true)
    List<EngagementEngine> findDueEngines(@Param("now") Instant now, @Param("limit") int limit);

    @Modifying
    @Transactional
    @Query("UPDATE EngagementEngine e SET e.nextDueAt = :nextDueAt, e.lastSweptAt = :now WHERE e.id = :id")
    int bumpCursor(@Param("id") String id, @Param("now") Instant now, @Param("nextDueAt") Instant nextDueAt);

    /** Engines the nightly reconcile re-resolves (running ones — DRAFT/PAUSED/ARCHIVED skipped). */
    @Query("SELECT e FROM EngagementEngine e WHERE e.status IN ('ACTIVE', 'DRY_RUN')")
    List<EngagementEngine> findReconcilable();
}
