package vacademy.io.admin_core_service.features.marketing.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import jakarta.persistence.PersistenceContext;
import org.hibernate.query.TypedParameterValue;
import org.hibernate.type.StandardBasicTypes;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.marketing.entity.SocialPost;
import vacademy.io.admin_core_service.features.marketing.entity.SocialPostTarget;

import java.time.Instant;
import java.util.List;

/**
 * The compare-and-set statements of social publishing. Every state change that races with
 * another pod or thread goes through here:
 * <ul>
 *   <li>a post enters PUBLISHING only through a claim UPDATE (the job's batch claim in
 *       SocialPostClaimDao, or {@link #claimPost} for post-now), both FOR UPDATE SKIP LOCKED;</li>
 *   <li>a target is published by exactly one worker: {@link #claimTarget} (PENDING to PUBLISHING)
 *       or {@link #leaseContainerPoll} (an Instagram container check) return the claimed attempt
 *       count to one caller (null to everyone else), straight from the primary;</li>
 *   <li>the outcome of a publish is written with {@link #saveTargetOutcome}, a targeted UPDATE that
 *       never overwrites the claim's attempt count with a stale copy;</li>
 *   <li>API edits lock the post row ({@link #lockPost}) so they never overwrite a claim that won.</li>
 * </ul>
 * Native statements run through the EntityManager (UPDATE ... RETURNING returns a result set,
 * which Spring Data modifying queries cannot read). All are read-write transactions, so they run
 * on the primary.
 */
@Component
public class SocialPostStateStore {

    @PersistenceContext
    private EntityManager entityManager;

    /**
     * Claims one due SCHEDULED post for publishing (post-now / approve / retry). False when it is
     * not SCHEDULED or not due, or another worker holds or already took it. "Due" allows 30 s of
     * clock difference: scheduled_at was set to the app server's now, compared with the database's.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean claimPost(String postId) {
        List<?> rows = entityManager.createNativeQuery("""
                        UPDATE social_post SET status = 'PUBLISHING', updated_at = now()
                         WHERE id IN (
                               SELECT id FROM social_post
                                WHERE id = :id
                                  AND status = 'SCHEDULED'
                                  AND deleted_at IS NULL
                                  AND scheduled_at <= now() + interval '30 seconds'
                                FOR UPDATE SKIP LOCKED)
                        RETURNING id
                        """)
                .setParameter("id", postId)
                .getResultList();
        return !rows.isEmpty();
    }

    /**
     * PENDING target whose retry time has come -> PUBLISHING, attempts + 1. Returns the new
     * attempt count to exactly one caller (null when not claimed); the caller then publishes it.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Integer claimTarget(String targetId) {
        List<?> rows = entityManager.createNativeQuery("""
                        UPDATE social_post_target
                           SET status = 'PUBLISHING', attempts = attempts + 1, updated_at = now()
                         WHERE id = :id
                           AND status = 'PENDING'
                           AND (next_attempt_at IS NULL OR next_attempt_at <= now())
                        RETURNING attempts
                        """)
                .setParameter("id", targetId)
                .getResultList();
        return firstInt(rows);
    }

    /**
     * Takes the next status check of an Instagram container (target PUBLISHING with a container):
     * pushes next_attempt_at forward by {@code leaseSeconds} (so no other worker checks it
     * meanwhile) and counts the check in attempts. Returns the new attempt count to exactly one
     * caller (null when not claimed).
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Integer leaseContainerPoll(String targetId, int leaseSeconds) {
        List<?> rows = entityManager.createNativeQuery("""
                        UPDATE social_post_target
                           SET next_attempt_at = now() + make_interval(secs => :lease),
                               attempts = attempts + 1,
                               updated_at = now()
                         WHERE id = :id
                           AND status = 'PUBLISHING'
                           AND container_id IS NOT NULL
                           AND (next_attempt_at IS NULL OR next_attempt_at <= now())
                        RETURNING attempts
                        """)
                .setParameter("id", targetId)
                .setParameter("lease", leaseSeconds)
                .getResultList();
        return firstInt(rows);
    }

    /**
     * Writes the outcome of one publish attempt of a target this worker claimed: status, container,
     * next attempt, error, and (when posted) the post id, link and time. A targeted UPDATE, not an
     * entity merge, so the claim's attempt count is never overwritten; attempts change only when
     * {@code resetAttempts} is given (the first PENDING_CONTAINER, which starts the poll count).
     * Applies only while the target is still PUBLISHING; a late POSTED also corrects a target the
     * reaper failed meanwhile. False when nothing was written.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean saveTargetOutcome(SocialPostTarget target, Integer resetAttempts) {
        int changed = entityManager.createNativeQuery("""
                        UPDATE social_post_target
                           SET status = :status,
                               container_id = CAST(:containerId AS varchar),
                               next_attempt_at = CAST(:nextAttemptAt AS timestamptz),
                               error_message = CAST(:errorMessage AS text),
                               external_post_id = COALESCE(CAST(:externalPostId AS varchar), external_post_id),
                               permalink = COALESCE(CAST(:permalink AS text), permalink),
                               posted_at = COALESCE(CAST(:postedAt AS timestamptz), posted_at),
                               attempts = COALESCE(CAST(:resetAttempts AS integer), attempts),
                               updated_at = now()
                         WHERE id = :id
                           AND (status = 'PUBLISHING'
                                OR (status = 'FAILED' AND CAST(:status AS varchar) = 'POSTED'))
                        """)
                .setParameter("id", target.getId())
                .setParameter("status", target.getStatus())
                // Typed so a null binds as a typed NULL (Hibernate binds an untyped null in a native
                // query in a way Postgres can not always cast).
                .setParameter("containerId", new TypedParameterValue<>(StandardBasicTypes.STRING, target.getContainerId()))
                .setParameter("nextAttemptAt", new TypedParameterValue<>(StandardBasicTypes.INSTANT, target.getNextAttemptAt()))
                .setParameter("errorMessage", new TypedParameterValue<>(StandardBasicTypes.STRING, target.getErrorMessage()))
                .setParameter("externalPostId", new TypedParameterValue<>(StandardBasicTypes.STRING, target.getExternalPostId()))
                .setParameter("permalink", new TypedParameterValue<>(StandardBasicTypes.STRING, target.getPermalink()))
                .setParameter("postedAt", new TypedParameterValue<>(StandardBasicTypes.INSTANT, target.getPostedAt()))
                .setParameter("resetAttempts", new TypedParameterValue<>(StandardBasicTypes.INTEGER, resetAttempts))
                .executeUpdate();
        return changed == 1;
    }

    private static Integer firstInt(List<?> rows) {
        if (rows == null || rows.isEmpty() || rows.get(0) == null) return null;
        return ((Number) rows.get(0)).intValue();
    }


    /**
     * Writes the final roll-up of a post. Applies only while the post is PUBLISHING, or already
     * finalised as FAILED/PARTIAL by the reaper (a late success then corrects it). Never touches a
     * post that was re-scheduled, cancelled, edited or deleted meanwhile.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean finishPost(String postId, String status, String lastError, Instant publishedAt) {
        int changed = entityManager.createNativeQuery("""
                        UPDATE social_post
                           SET status = :status,
                               last_error = :lastError,
                               published_at = COALESCE(published_at, CAST(:publishedAt AS timestamptz)),
                               updated_at = now()
                         WHERE id = :id
                           AND deleted_at IS NULL
                           AND status IN ('PUBLISHING', 'FAILED', 'PARTIAL')
                        """)
                .setParameter("id", postId)
                .setParameter("status", status)
                .setParameter("lastError", lastError)
                .setParameter("publishedAt", publishedAt == null ? null : java.sql.Timestamp.from(publishedAt))
                .executeUpdate();
        return changed == 1;
    }

    /**
     * Flags an ACTIVE social account RECONNECT_NEEDED after the platform rejected its token.
     * A targeted UPDATE (not an entity save) so a reconnect that stored a new token meanwhile is
     * never overwritten.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean markAccountReconnect(String accountId, String detail) {
        int changed = entityManager.createNativeQuery("""
                        UPDATE social_account
                           SET status = 'RECONNECT_NEEDED', status_detail = :detail, updated_at = now()
                         WHERE id = :id
                           AND status = 'ACTIVE'
                        """)
                .setParameter("id", accountId)
                .setParameter("detail", detail)
                .executeUpdate();
        return changed == 1;
    }

    /**
     * The post row locked FOR UPDATE inside the caller's transaction (null when it does not
     * exist). A concurrent claim (FOR UPDATE SKIP LOCKED) skips a locked row, and a claim that
     * committed first is seen here as PUBLISHING, so the caller's status check is race-free.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public SocialPost lockPost(String postId) {
        SocialPost post = entityManager.find(SocialPost.class, postId, LockModeType.PESSIMISTIC_WRITE);
        if (post != null) {
            // A copy cached earlier in this persistence context could be stale; lock + reload.
            entityManager.refresh(post, LockModeType.PESSIMISTIC_WRITE);
        }
        return post;
    }
}
