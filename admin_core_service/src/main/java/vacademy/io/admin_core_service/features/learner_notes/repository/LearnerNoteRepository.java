package vacademy.io.admin_core_service.features.learner_notes.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.learner_notes.entity.LearnerNote;

import java.time.Instant;
import java.util.List;

public interface LearnerNoteRepository extends JpaRepository<LearnerNote, String> {

    List<LearnerNote> findByUserIdAndSlideIdAndDeletedAtIsNullOrderByCreatedAtAsc(String userId, String slideId);

    long countByUserIdAndDeletedAtIsNull(String userId);

    /**
     * The learner's notebook, newest first. {@code query} must already be a
     * lower-case LIKE pattern with its wildcards escaped, or empty for no search.
     */
    @Query("""
            SELECT n FROM LearnerNote n
            WHERE n.userId = :userId
              AND n.instituteId = :instituteId
              AND n.deletedAt IS NULL
              AND (:kind = '' OR n.kind = :kind)
              AND (:query = ''
                   OR LOWER(COALESCE(n.quoteText, '')) LIKE :query ESCAPE '!'
                   OR LOWER(COALESCE(n.noteText, '')) LIKE :query ESCAPE '!'
                   OR LOWER(COALESCE(n.slideTitle, '')) LIKE :query ESCAPE '!'
                   OR LOWER(COALESCE(n.chapterName, '')) LIKE :query ESCAPE '!'
                   OR LOWER(COALESCE(n.courseName, '')) LIKE :query ESCAPE '!')
            ORDER BY n.createdAt DESC
            """)
    Page<LearnerNote> searchNotebook(
            @Param("userId") String userId,
            @Param("instituteId") String instituteId,
            @Param("kind") String kind,
            @Param("query") String query,
            Pageable pageable);

    @Query("""
            SELECT n FROM LearnerNote n
            WHERE n.userId = :userId
              AND n.instituteId = :instituteId
              AND n.deletedAt IS NULL
              AND n.nextReviewAt IS NOT NULL
              AND n.nextReviewAt <= :now
            ORDER BY n.nextReviewAt ASC
            """)
    List<LearnerNote> findDue(
            @Param("userId") String userId,
            @Param("instituteId") String instituteId,
            @Param("now") Instant now,
            Pageable pageable);

    @Query("""
            SELECT COUNT(n) FROM LearnerNote n
            WHERE n.userId = :userId
              AND n.instituteId = :instituteId
              AND n.deletedAt IS NULL
              AND n.nextReviewAt IS NOT NULL
              AND n.nextReviewAt <= :now
            """)
    long countDue(
            @Param("userId") String userId,
            @Param("instituteId") String instituteId,
            @Param("now") Instant now);
}
