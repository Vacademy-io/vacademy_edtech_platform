package vacademy.io.admin_core_service.features.marketing.repository;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;

/**
 * Claims due social posts for publishing.
 *
 * <p>Not a Spring Data {@code @Query}: an UPDATE ... RETURNING produces a result set, and Spring
 * Data's {@code @Modifying} execution calls executeUpdate (which errors on a result set) and only
 * allows int/void returns. The statement therefore runs through the EntityManager, the same way
 * CertificateNumberSequenceDao allocates numbers. The method is a read-write transaction, so it
 * always runs on the primary (a read-only transaction would be routed to the replica).
 */
@Repository
public class SocialPostClaimDao {

    @PersistenceContext
    private EntityManager entityManager;

    /**
     * Moves up to {@code limit} due SCHEDULED posts to PUBLISHING and returns their ids.
     * FOR UPDATE SKIP LOCKED keeps two pods from claiming the same post.
     */
    @Transactional
    public List<String> claimDuePosts(int limit) {
        List<?> rows = entityManager.createNativeQuery("""
                        UPDATE social_post SET status = 'PUBLISHING', updated_at = now()
                         WHERE id IN (
                               SELECT id FROM social_post
                                WHERE status = 'SCHEDULED'
                                  AND deleted_at IS NULL
                                  AND scheduled_at <= now()
                                ORDER BY scheduled_at
                                LIMIT :lim
                                FOR UPDATE SKIP LOCKED)
                        RETURNING id
                        """)
                .setParameter("lim", Math.max(1, limit))
                .getResultList();
        List<String> ids = new ArrayList<>(rows.size());
        for (Object row : rows) {
            if (row != null) ids.add(row.toString());
        }
        return ids;
    }
}
