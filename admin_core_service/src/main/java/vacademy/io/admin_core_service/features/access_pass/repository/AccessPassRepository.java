package vacademy.io.admin_core_service.features.access_pass.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.access_pass.entity.AccessPass;

import java.sql.Timestamp;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface AccessPassRepository extends JpaRepository<AccessPass, String> {

    Optional<AccessPass> findByIdAndInstituteIdAndStatusNot(String id, String instituteId, String status);

    List<AccessPass> findByInstituteIdAndStatusInOrderByDisplayOrderAscCreatedAtDesc(
            String instituteId, Collection<String> statuses);

    Optional<AccessPass> findFirstByInstituteIdAndSlugAndStatusNot(String instituteId, String slug, String status);

    Optional<AccessPass> findFirstByInstituteIdAndSlugAndStatus(String instituteId, String slug, String status);

    Optional<AccessPass> findFirstByEnrollInviteId(String enrollInviteId);

    List<AccessPass> findByEnrollInviteIdIn(Collection<String> enrollInviteIds);

    /** Passes the sync job must look at: flagged by an item change, or still live. */
    List<AccessPass> findByStatusIn(Collection<String> statuses);

    /**
     * Current holder plans that the sync still has work for. "Current" = hangs off the
     * pass invite, ACTIVE or soft CANCELED (a soft cancel stops renewal but keeps access
     * until end_date), and not run out. Work = an included course with no ledger row, a
     * COVERED course whose covering membership lapsed, or (REVOKE policy) a GRANTED
     * course the pass no longer includes. One query, so an up-to-date pass costs nothing.
     */
    @Query(value = """
            SELECT up.id FROM user_plan up
            WHERE up.enroll_invite_id = :enrollInviteId
              AND up.status IN ('ACTIVE', 'CANCELED')
              AND (up.end_date IS NULL OR up.end_date > :now)
              AND (
                EXISTS (
                  SELECT 1 FROM access_pass_item i
                  WHERE i.access_pass_id = :accessPassId
                    AND i.status = 'ACTIVE'
                    AND NOT EXISTS (
                      SELECT 1 FROM access_pass_grant g
                      WHERE g.user_plan_id = up.id
                        AND g.package_session_id = i.package_session_id
                        AND g.status = 'ACTIVE'
                    )
                )
                OR EXISTS (
                  SELECT 1 FROM access_pass_grant g
                  WHERE g.user_plan_id = up.id
                    AND g.status = 'ACTIVE'
                    AND g.grant_type = 'COVERED'
                    AND NOT EXISTS (
                      SELECT 1 FROM student_session_institute_group_mapping m
                      WHERE m.id = g.ssigm_id
                        AND m.status = 'ACTIVE'
                    )
                )
                OR (
                  :revokeRemoved = TRUE
                  AND EXISTS (
                    SELECT 1 FROM access_pass_grant g
                    WHERE g.user_plan_id = up.id
                      AND g.status = 'ACTIVE'
                      AND g.grant_type = 'GRANTED'
                      AND NOT EXISTS (
                        SELECT 1 FROM access_pass_item i
                        WHERE i.access_pass_id = :accessPassId
                          AND i.status = 'ACTIVE'
                          AND i.package_session_id = g.package_session_id
                      )
                  )
                )
              )
            ORDER BY up.id
            LIMIT :batchSize
            """, nativeQuery = true)
    List<String> findHolderPlanIdsNeedingSync(@Param("accessPassId") String accessPassId,
                                              @Param("enrollInviteId") String enrollInviteId,
                                              @Param("revokeRemoved") boolean revokeRemoved,
                                              @Param("now") Timestamp now,
                                              @Param("batchSize") int batchSize);

    /**
     * Record a finished sync. needs_sync is cleared only when the run completed AND the
     * pass was not changed after the run started (a course added mid-run re-set it).
     */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE access_pass
            SET last_synced_at = :now,
                needs_sync = CASE WHEN :complete = TRUE AND updated_at <= :startedAt THEN FALSE ELSE needs_sync END
            WHERE id = :id
            """, nativeQuery = true)
    int markSynced(@Param("id") String id,
                   @Param("complete") boolean complete,
                   @Param("startedAt") Timestamp startedAt,
                   @Param("now") Timestamp now);

    interface HolderCountRow {
        String getEnrollInviteId();

        Long getHolderCount();
    }

    @Query(value = """
            SELECT up.enroll_invite_id AS enrollInviteId, COUNT(*) AS holderCount
            FROM user_plan up
            WHERE up.enroll_invite_id IN (:enrollInviteIds)
              AND up.status IN ('ACTIVE', 'CANCELED')
              AND (up.end_date IS NULL OR up.end_date > :now)
            GROUP BY up.enroll_invite_id
            """, nativeQuery = true)
    List<HolderCountRow> countCurrentHolders(@Param("enrollInviteIds") Collection<String> enrollInviteIds,
                                             @Param("now") Timestamp now);

    interface HolderRow {
        String getUserPlanId();

        String getUserId();

        String getStatus();

        Timestamp getStartDate();

        Timestamp getEndDate();

        Boolean getAutoRenewalEnabled();

        Timestamp getCreatedAt();
    }

    @Query(value = """
            SELECT up.id AS userPlanId, up.user_id AS userId, up.status AS status,
                   up.start_date AS startDate, up.end_date AS endDate,
                   up.auto_renewal_enabled AS autoRenewalEnabled, up.created_at AS createdAt
            FROM user_plan up
            WHERE up.enroll_invite_id = :enrollInviteId
              AND up.status IN (:statuses)
            ORDER BY up.created_at DESC
            """,
            countQuery = """
            SELECT COUNT(*) FROM user_plan up
            WHERE up.enroll_invite_id = :enrollInviteId
              AND up.status IN (:statuses)
            """,
            nativeQuery = true)
    Page<HolderRow> findHolders(@Param("enrollInviteId") String enrollInviteId,
                                @Param("statuses") Collection<String> statuses,
                                Pageable pageable);
}
