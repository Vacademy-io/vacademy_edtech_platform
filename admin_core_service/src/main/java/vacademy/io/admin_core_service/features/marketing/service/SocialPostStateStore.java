package vacademy.io.admin_core_service.features.marketing.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.marketing.entity.SocialPost;

import java.time.Instant;
import java.util.List;

/**
 * The compare-and-set statements of social publishing. Every state change that races with
 * another pod or thread goes through here:
 * <ul>
 *   <li>a post enters PUBLISHING only through a claim UPDATE (the job's batch claim in
 *       SocialPostClaimDao, or {@link #claimPost} for post-now), both FOR UPDATE SKIP LOCKED;</li>
 *   <li>a target is published by exactly one worker: {@link #claimTarget} (PENDING to PUBLISHING)
 *       or {@link #leaseContainerPoll} (an Instagram container check) return true for one caller;</li>
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
     * PENDING target whose retry time has come -> PUBLISHING, attempts + 1. True for exactly one
     * caller; the caller then publishes it.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean claimTarget(String targetId) {
        int changed = entityManager.createNativeQuery("""
                        UPDATE social_post_target
                           SET status = 'PUBLISHING', attempts = attempts + 1, updated_at = now()
                         WHERE id = :id
                           AND status = 'PENDING'
                           AND (next_attempt_at IS NULL OR next_attempt_at <= now())
                        """)
                .setParameter("id", targetId)
                .executeUpdate();
        return changed == 1;
    }

    /**
     * Takes the next status check of an Instagram container (target PUBLISHING with a container):
     * pushes next_attempt_at forward by {@code leaseSeconds} (so no other worker checks it
     * meanwhile) and counts the check in attempts. True for exactly one caller.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean leaseContainerPoll(String targetId, int leaseSeconds) {
        int changed = entityManager.createNativeQuery("""
                        UPDATE social_post_target
                           SET next_attempt_at = now() + make_interval(secs => :lease),
                               attempts = attempts + 1,
                               updated_at = now()
                         WHERE id = :id
                           AND status = 'PUBLISHING'
                           AND container_id IS NOT NULL
                           AND (next_attempt_at IS NULL OR next_attempt_at <= now())
                        """)
                .setParameter("id", targetId)
                .setParameter("lease", leaseSeconds)
                .executeUpdate();
        return changed == 1;
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
