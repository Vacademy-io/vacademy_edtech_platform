package vacademy.io.admin_core_service.features.discussion.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.discussion.entity.DiscussionReport;

import java.util.Collection;
import java.util.List;

public interface DiscussionReportRepository extends JpaRepository<DiscussionReport, String> {

    /** Insert unless this person already reported the post. Returns 1 when added. */
    @Modifying
    @Query(value = """
            INSERT INTO discussion_report (id, post_id, user_id, reason, created_at)
            VALUES (:id, :postId, :userId, :reason, now())
            ON CONFLICT (post_id, user_id) DO NOTHING
            """, nativeQuery = true)
    int insertIfAbsent(@Param("id") String id, @Param("postId") String postId, @Param("userId") String userId,
            @Param("reason") String reason);

    List<DiscussionReport> findByPostIdIn(Collection<String> postIds);

    List<DiscussionReport> findByUserIdAndPostIdIn(String userId, Collection<String> postIds);

    @Modifying
    @Query(value = "DELETE FROM discussion_report WHERE post_id = :postId", nativeQuery = true)
    int deleteByPost(@Param("postId") String postId);
}
