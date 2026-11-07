package vacademy.io.admin_core_service.features.learner_tracking.repository;

import jakarta.transaction.Transactional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.learner_tracking.dto.SlideMarksProjection;
import vacademy.io.admin_core_service.features.learner_tracking.entity.QuizSlideQuestionTracked;

import java.sql.Timestamp;
import java.util.List;

public interface QuizSlideQuestionTrackedRepository extends JpaRepository<QuizSlideQuestionTracked, String> {
    @Modifying
    @Transactional
    @Query("DELETE FROM QuizSlideQuestionTracked qz WHERE qz.activityLog.id = :activityId")
    void deleteByActivityId(@Param("activityId") String activityId);

    long countByActivityLogId(String activityLogId);

    /**
     * Student report v2 "Marks by Subject": per-slide QUIZ marks for a user in a date range.
     *
     * <p>Assumption: to avoid double-counting across multiple quiz attempts, only the LATEST
     * activity_log per (user, slide) in the window is used (see reference impl:
     * LLMActivityAnalyticsService#buildQuizQuestionData). Per-question marks come from
     * quiz_slide_question.marks; obtained = sum of marks where response_status='CORRECT',
     * total = sum of marks over all tracked questions for that attempt. Subject is resolved
     * via the standard slide→chapter→module→subject join, aggregated separately from the
     * marks CTE to avoid fan-out double-counting when a slide maps to multiple subjects/chapters.
     */
    @Query(value = """
            WITH latest_activity AS (
                SELECT DISTINCT ON (a2.slide_id) a2.id AS activity_id, a2.slide_id AS slide_id
                FROM activity_log a2
                WHERE a2.user_id = :userId
                  AND a2.source_type = 'QUIZ'
                  AND a2.created_at BETWEEN :start AND :end
                ORDER BY a2.slide_id, a2.created_at DESC
            ),
            quiz_marks AS (
                SELECT
                    la.slide_id AS slide_id,
                    SUM(CASE WHEN qsqt.response_status = 'CORRECT' THEN qsq.marks ELSE 0 END) AS marks_obtained,
                    SUM(qsq.marks) AS total_marks
                FROM latest_activity la
                JOIN quiz_slide_question_tracked qsqt ON qsqt.activity_id = la.activity_id
                JOIN quiz_slide_question qsq ON qsq.id = qsqt.question_id
                GROUP BY la.slide_id
            ),
            slide_info AS (
                SELECT DISTINCT ON (s.id)
                    s.id AS slide_id, s.title AS title, sub.subject_name AS subject_name
                FROM slide s
                LEFT JOIN chapter_to_slides cs ON cs.slide_id = s.id
                LEFT JOIN chapter c ON c.id = cs.chapter_id
                LEFT JOIN module_chapter_mapping mcm ON mcm.chapter_id = c.id
                LEFT JOIN modules m ON m.id = mcm.module_id
                LEFT JOIN subject_module_mapping smm ON smm.module_id = m.id
                LEFT JOIN subject sub ON sub.id = smm.subject_id
                WHERE s.id IN (SELECT slide_id FROM quiz_marks)
                ORDER BY s.id, cs.created_at ASC NULLS LAST
            )
            SELECT
                qm.slide_id AS slideId,
                si.title AS title,
                si.subject_name AS subjectName,
                qm.marks_obtained AS marksObtained,
                qm.total_marks AS totalMarks
            FROM quiz_marks qm
            JOIN slide_info si ON si.slide_id = qm.slide_id
            """, nativeQuery = true)
    List<SlideMarksProjection> findQuizMarksForUserInRange(
            @Param("userId") String userId,
            @Param("start") Timestamp start,
            @Param("end") Timestamp end);
}
