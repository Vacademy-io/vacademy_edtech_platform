package vacademy.io.admin_core_service.features.learner_tracking.repository;

import jakarta.transaction.Transactional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.learner_tracking.dto.SlideMarksProjection;
import vacademy.io.admin_core_service.features.learner_tracking.entity.QuestionSlideTracked;

import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;

public interface QuestionSlideTrackedRepository extends JpaRepository<QuestionSlideTracked, String> {
    @Modifying
    @Transactional
    @Query("DELETE FROM VideoTracked v WHERE v.activityLog.id = :activityId")
    void deleteByActivityId(@Param("activityId") String activityId);

    /**
     * Student report v2 "Marks by Subject": per-slide QUESTION marks for a user in a date range.
     * Dated by {@code question_slide_tracked.created_at} (the attempt itself), NOT the parent
     * activity_log's created_at — same lesson as {@code AssignmentSlideTrackedRepository}.
     *
     * <p>Assumption: multiple attempts on the same slide → MAX(marks) is taken as the learner's
     * mark for that slide. Total marks = question_slide.points. Subject is resolved via the
     * standard slide→chapter→module→subject join; a slide mapped to multiple subjects is
     * collapsed to one (DISTINCT ON) to avoid fan-out duplication.
     */
    @Query(value = """
            WITH question_marks AS (
                SELECT al.slide_id AS slide_id, MAX(qst.marks) AS marks_obtained
                FROM question_slide_tracked qst
                JOIN activity_log al ON al.id = qst.activity_id
                WHERE al.user_id = :userId
                  AND al.source_type = 'QUESTION'
                  AND qst.created_at BETWEEN :start AND :end
                GROUP BY al.slide_id
            ),
            slide_info AS (
                SELECT DISTINCT ON (s.id)
                    s.id AS slide_id, s.title AS title, s.source_id AS source_id,
                    sub.subject_name AS subject_name
                FROM slide s
                LEFT JOIN chapter_to_slides cs ON cs.slide_id = s.id
                LEFT JOIN chapter c ON c.id = cs.chapter_id
                LEFT JOIN module_chapter_mapping mcm ON mcm.chapter_id = c.id
                LEFT JOIN modules m ON m.id = mcm.module_id
                LEFT JOIN subject_module_mapping smm ON smm.module_id = m.id
                LEFT JOIN subject sub ON sub.id = smm.subject_id
                WHERE s.id IN (SELECT slide_id FROM question_marks)
                ORDER BY s.id, cs.created_at ASC NULLS LAST
            )
            SELECT
                qm.slide_id AS slideId,
                si.title AS title,
                si.subject_name AS subjectName,
                qm.marks_obtained AS marksObtained,
                qs.points::float8 AS totalMarks
            FROM question_marks qm
            JOIN slide_info si ON si.slide_id = qm.slide_id
            LEFT JOIN question_slide qs ON qs.id = si.source_id
            """, nativeQuery = true)
    List<SlideMarksProjection> findQuestionMarksForUserInRange(
            @Param("userId") String userId,
            @Param("start") Timestamp start,
            @Param("end") Timestamp end);

    // ---- CBE_RESPONSE question slides (CbeSlideSubmitService) ----
    // Only rows written by the CBE submit carry these three statuses, so older answers on
    // a slide whose type later changed are never counted. Keep apostrophes out of comments
    // inside the SQL text below: Spring Data parses these strings at boot.

    /**
     * AI checks the learner has used on this slide: graded ones, plus one still being graded
     * (EVALUATING) unless it is older than the grading timeout allows, which means the pod
     * died mid-call and the check never happened.
     */
    @Query(value = """
            SELECT COUNT(*)
            FROM question_slide_tracked t
            JOIN activity_log al ON al.id = t.activity_id
            WHERE al.user_id = :userId
              AND al.slide_id = :slideId
              AND (t.response_status = 'EVALUATED'
                   OR (t.response_status = 'EVALUATING' AND t.created_at > LOCALTIMESTAMP - INTERVAL '5 minutes'))
            """, nativeQuery = true)
    long countCbeChecksUsed(@Param("userId") String userId, @Param("slideId") String slideId);

    /** Every CBE submission the learner made on this slide, graded or not. */
    @Query(value = """
            SELECT COUNT(*)
            FROM question_slide_tracked t
            JOIN activity_log al ON al.id = t.activity_id
            WHERE al.user_id = :userId
              AND al.slide_id = :slideId
              AND t.response_status IN ('EVALUATED', 'EVALUATING', 'EVALUATION_FAILED')
            """, nativeQuery = true)
    long countCbeSubmissions(@Param("userId") String userId, @Param("slideId") String slideId);

    /** The learner's latest CBE submission on this slide. */
    @Query(value = """
            SELECT t.*
            FROM question_slide_tracked t
            JOIN activity_log al ON al.id = t.activity_id
            WHERE al.user_id = :userId
              AND al.slide_id = :slideId
              AND t.response_status IN ('EVALUATED', 'EVALUATING', 'EVALUATION_FAILED')
            ORDER BY t.created_at DESC, t.attempt_number DESC
            LIMIT 1
            """, nativeQuery = true)
    Optional<QuestionSlideTracked> findLatestCbeSubmission(@Param("userId") String userId,
            @Param("slideId") String slideId);

    /** The learner's latest graded CBE submission on this slide (a later one may have failed). */
    @Query(value = """
            SELECT t.*
            FROM question_slide_tracked t
            JOIN activity_log al ON al.id = t.activity_id
            WHERE al.user_id = :userId
              AND al.slide_id = :slideId
              AND t.response_status = 'EVALUATED'
            ORDER BY t.created_at DESC, t.attempt_number DESC
            LIMIT 1
            """, nativeQuery = true)
    Optional<QuestionSlideTracked> findLatestEvaluatedCbeSubmission(@Param("userId") String userId,
            @Param("slideId") String slideId);
}
