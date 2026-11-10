package vacademy.io.admin_core_service.features.discussion.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.discussion.entity.DiscussionReaction;

import java.util.Collection;
import java.util.List;

public interface DiscussionReactionRepository extends JpaRepository<DiscussionReaction, String> {

    List<DiscussionReaction> findByPostIdIn(Collection<String> postIds);

    List<DiscussionReaction> findByPostId(String postId);

    @Modifying
    @Query(value = """
            DELETE FROM discussion_reaction
            WHERE post_id = :postId AND user_id = :userId AND reaction = :reaction
            """, nativeQuery = true)
    int deleteOne(@Param("postId") String postId, @Param("userId") String userId, @Param("reaction") String reaction);

    /** Insert unless it is already there. Returns 1 when added, 0 when it already existed. */
    @Modifying
    @Query(value = """
            INSERT INTO discussion_reaction (id, post_id, user_id, reaction, created_at)
            VALUES (:id, :postId, :userId, :reaction, now())
            ON CONFLICT (post_id, user_id, reaction) DO NOTHING
            """, nativeQuery = true)
    int insertIfAbsent(@Param("id") String id, @Param("postId") String postId, @Param("userId") String userId,
            @Param("reaction") String reaction);
}
