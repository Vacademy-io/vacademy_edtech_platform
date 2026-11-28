package vacademy.io.admin_core_service.features.telephony.persistence.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiCallResult;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface AiCallResultRepository extends JpaRepository<AiCallResult, String> {

    /** Recent results for one agent (campaign_id == agent id) — feedback grounding. */
    java.util.List<AiCallResult> findTop12ByCampaignIdAndInstituteIdOrderByCreatedAtDesc(
            String campaignId, String instituteId);

    /** The human follow-up verdict of one call, corrected after the analyser wrote it. */
    @Modifying
    @Transactional
    @Query(value = "UPDATE ai_call_result SET follow_up = :followUp, follow_up_gist = :gist, updated_at = now() WHERE id = :id",
            nativeQuery = true)
    int updateFollowUp(@Param("id") String id, @Param("followUp") String followUp, @Param("gist") String gist);

    /** Idempotency lookup: a re-POST of the same call updates the existing row. */
    Optional<AiCallResult> findByProviderAndCallUuid(String provider, String callUuid);

    /** Batch read-time join for Call History: fetch AI results for a page of call-log ids (avoids N+1). */
    List<AiCallResult> findByCallLogIdIn(Collection<String> callLogIds);

    /**
     * Atomic claim for outcome processing. Providers retry report POSTs (our own
     * bot retries after a 10s client timeout while the first request may still be
     * mid-flight), and the webhook runs {@code process()} synchronously — without
     * this claim two requests can both pass the PROCESSED check and double-assign.
     * Same-transaction semantics make it self-healing: a duplicate blocks on the
     * row lock and re-evaluates after commit (sees PROCESSED → 0 rows → no-op),
     * while a rollback restores the previous status so a genuine retry processes.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("UPDATE AiCallResult r SET r.processingStatus = 'PROCESSING' "
            + "WHERE r.id = :id AND r.processingStatus NOT IN ('PROCESSED', 'PROCESSING')")
    int claimForProcessing(@Param("id") String id);

    /** Stamp a successful AI-minutes charge — guarded so it never un-stamps. */
    @Modifying
    @Transactional
    @Query("UPDATE AiCallResult r SET r.creditsBilledAt = :at WHERE r.id = :id AND r.creditsBilledAt IS NULL")
    int markCreditsBilled(@Param("id") String id, @Param("at") java.time.Instant at);
}
