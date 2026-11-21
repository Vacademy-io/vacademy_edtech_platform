package vacademy.io.admin_core_service.features.marketing.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.marketing.entity.SocialPost;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

@Repository
public interface SocialPostRepository extends JpaRepository<SocialPost, String> {

    Optional<SocialPost> findByIdAndInstituteIdAndDeletedAtIsNull(String id, String instituteId);

    /**
     * Posts of an institute whose COALESCE(scheduled_at, created_at) is in [from, to), not deleted,
     * sorted by scheduled_at ascending with unscheduled posts last.
     */
    @Query(value = """
            SELECT * FROM social_post
             WHERE institute_id = :instituteId
               AND deleted_at IS NULL
               AND COALESCE(scheduled_at, created_at) >= :fromTs
               AND COALESCE(scheduled_at, created_at) < :toTs
             ORDER BY scheduled_at ASC NULLS LAST, created_at ASC
            """, nativeQuery = true)
    List<SocialPost> findForRange(@Param("instituteId") String instituteId,
                                  @Param("fromTs") Instant fromTs,
                                  @Param("toTs") Instant toTs);

    /** Ids of posts still PUBLISHING whose last update is older than {@code staleBefore}. */
    @Query(value = """
            SELECT id FROM social_post
             WHERE status = 'PUBLISHING'
               AND deleted_at IS NULL
               AND updated_at < :staleBefore
            """, nativeQuery = true)
    List<String> findStalePublishingIds(@Param("staleBefore") Instant staleBefore);
}
