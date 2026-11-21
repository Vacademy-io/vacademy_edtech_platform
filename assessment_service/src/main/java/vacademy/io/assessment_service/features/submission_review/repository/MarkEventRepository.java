package vacademy.io.assessment_service.features.submission_review.repository;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.assessment_service.features.submission_review.entity.MarkEvent;

import java.util.Date;
import java.util.List;

@Repository
public interface MarkEventRepository extends JpaRepository<MarkEvent, String> {

    List<MarkEvent> findByAttemptIdOrderByCreatedAtDesc(String attemptId, Pageable pageable);

    /** One answer's history plus the submission-level events, newest first. */
    @Query(value = """
            SELECT e.* FROM mark_event e
            WHERE e.attempt_id = :attemptId
            AND ((e.section_id = :sectionId AND e.question_id = :questionId) OR e.question_id IS NULL)
            ORDER BY e.created_at DESC
            LIMIT :lim
            """, nativeQuery = true)
    List<MarkEvent> findQuestionHistory(@Param("attemptId") String attemptId,
                                        @Param("sectionId") String sectionId,
                                        @Param("questionId") String questionId,
                                        @Param("lim") int limit);

    /** Per answer - how many events, and whether any was written after the given release (never null). */
    @Query(value = """
            SELECT e.section_id AS sectionId, e.question_id AS questionId, COUNT(*) AS eventCount,
                   BOOL_OR(e.after_release AND e.created_at > CAST(:since AS TIMESTAMP)) AS changedAfterRelease
            FROM mark_event e
            WHERE e.attempt_id = :attemptId AND e.question_id IS NOT NULL
            GROUP BY e.section_id, e.question_id
            """, nativeQuery = true)
    List<KeyEventCount> countPerKey(@Param("attemptId") String attemptId, @Param("since") Date since);

    interface KeyEventCount {
        String getSectionId();

        String getQuestionId();

        Long getEventCount();

        Boolean getChangedAfterRelease();
    }
}
