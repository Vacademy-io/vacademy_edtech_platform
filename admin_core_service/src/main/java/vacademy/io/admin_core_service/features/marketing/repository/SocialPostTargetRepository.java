package vacademy.io.admin_core_service.features.marketing.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.marketing.entity.SocialPostTarget;

import java.time.Instant;
import java.util.Collection;
import java.util.List;

@Repository
public interface SocialPostTargetRepository extends JpaRepository<SocialPostTarget, String> {

    List<SocialPostTarget> findByPostId(String postId);

    List<SocialPostTarget> findByPostIdIn(Collection<String> postIds);

    @Modifying
    @Transactional
    @Query(value = "DELETE FROM social_post_target WHERE post_id = :postId", nativeQuery = true)
    int deleteByPostIdNative(@Param("postId") String postId);

    /**
     * Ids of PUBLISHING posts that have a target due for another attempt: PENDING (retry backoff) or
     * PUBLISHING with an Instagram container waiting, whose next_attempt_at has passed.
     */
    @Query(value = """
            SELECT DISTINCT t.post_id
              FROM social_post_target t
              JOIN social_post p ON p.id = t.post_id
             WHERE p.status = 'PUBLISHING'
               AND p.deleted_at IS NULL
               AND (t.status = 'PENDING'
                    OR (t.status = 'PUBLISHING' AND t.container_id IS NOT NULL))
               AND (t.next_attempt_at IS NULL OR t.next_attempt_at <= :now)
            """, nativeQuery = true)
    List<String> findPostIdsWithDueTargets(@Param("now") Instant now);

    /**
     * Targets left PUBLISHING without a container (pod died mid-call) become FAILED. YouTube
     * targets get a longer grace period because a large upload can legitimately run that long.
     */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE social_post_target
               SET status = 'FAILED', error_message = :message, updated_at = now()
             WHERE status = 'PUBLISHING'
               AND container_id IS NULL
               AND updated_at < :staleBefore
               AND (platform <> 'YOUTUBE' OR updated_at < :youtubeStaleBefore)
            """, nativeQuery = true)
    int failStalePublishing(@Param("staleBefore") Instant staleBefore,
                            @Param("youtubeStaleBefore") Instant youtubeStaleBefore,
                            @Param("message") String message);
}
