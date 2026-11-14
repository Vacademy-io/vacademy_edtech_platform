package vacademy.io.admin_core_service.features.audience.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.audience.entity.LeadScore;

import java.util.List;
import java.util.Optional;

@Repository
public interface LeadScoreRepository extends JpaRepository<LeadScore, String> {

    Optional<LeadScore> findByAudienceResponseId(String audienceResponseId);

    List<LeadScore> findByAudienceResponseIdIn(List<String> audienceResponseIds);

    List<LeadScore> findByAudienceIdOrderByRawScoreDesc(String audienceId);

    /**
     * Batch recalculate percentile ranks for all leads in a campaign.
     * Uses PERCENT_RANK window function partitioned by audience_id.
     */
    @Modifying
    @Query(value = """
        UPDATE lead_score ls SET percentile_rank = sub.pct, updated_at = NOW()
        FROM (
            SELECT id,
                   CAST(PERCENT_RANK() OVER (PARTITION BY audience_id ORDER BY raw_score) * 100 AS numeric(5,2)) as pct
            FROM lead_score
            WHERE audience_id = :audienceId
        ) sub
        WHERE ls.id = sub.id
        AND ls.audience_id = :audienceId
        AND ls.percentile_rank IS DISTINCT FROM sub.pct
        """, nativeQuery = true)
    void recalculatePercentilesForAudience(@Param("audienceId") String audienceId);

    /**
     * Every audience's percentile ranks in one statement, for the scheduled batch job.
     *
     * <p>{@link #recalculatePercentilesForAudience} already partitions by audience_id, so its
     * WHERE clause narrowed the input without changing any row's computed rank -- running the
     * same window function unfiltered therefore produces exactly the value each audience would
     * have received from its own call, in a single round trip rather than one per audience.
     *
     * <p>audience_id IS NOT NULL is deliberate. The per-audience form was driven by
     * findDistinctAudienceIds(), and a NULL id there could never match its own
     * {@code audience_id = :audienceId} predicate, so NULL-audience rows were never updated.
     * Without this filter PERCENT_RANK would treat them as one more partition and start
     * writing ranks that the old loop never wrote.
     *
     * <p>Both percentile UPDATEs skip rows whose rank is unchanged. They used to rewrite every
     * row: 111k rows per batch run (several runs per interval, see LeadScoringService), of
     * which about 10 actually changed -- 2.66 billion updates since 2026-08-03, a 1 GB table for
     * 111k rows, and a WAL segment every few seconds while it ran. The cast to numeric(5,2) is
     * the column's own rounding, so comparing against it does not report every row as changed.
     */
    @Modifying
    @Query(value = """
        UPDATE lead_score ls SET percentile_rank = sub.pct, updated_at = NOW()
        FROM (
            SELECT id,
                   CAST(PERCENT_RANK() OVER (PARTITION BY audience_id ORDER BY raw_score) * 100 AS numeric(5,2)) as pct
            FROM lead_score
            WHERE audience_id IS NOT NULL
        ) sub
        WHERE ls.id = sub.id
        AND ls.percentile_rank IS DISTINCT FROM sub.pct
        """, nativeQuery = true)
    int recalculatePercentilesForAllAudiences();

    /**
     * Batch recalculate percentile ranks for ALL leads in an institute (across all campaigns).
     */
    @Modifying
    @Query(value = """
        UPDATE lead_score ls SET percentile_rank = sub.pct, updated_at = NOW()
        FROM (
            SELECT id,
                   PERCENT_RANK() OVER (PARTITION BY audience_id ORDER BY raw_score) * 100 as pct
            FROM lead_score
            WHERE institute_id = :instituteId
        ) sub
        WHERE ls.id = sub.id
        AND ls.institute_id = :instituteId
        """, nativeQuery = true)
    void recalculatePercentilesForInstitute(@Param("instituteId") String instituteId);

    /**
     * Get all distinct audience IDs that have lead scores (for batch job).
     */
    @Query("SELECT DISTINCT ls.audienceId FROM LeadScore ls")
    List<String> findDistinctAudienceIds();
}
