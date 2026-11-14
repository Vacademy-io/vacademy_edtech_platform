package vacademy.io.assessment_service.features.assessment.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.assessment_service.features.assessment.entity.AiQuestionEvaluation;

import java.util.List;

@Repository
public interface AiQuestionEvaluationRepository extends JpaRepository<AiQuestionEvaluation, String> {

        List<AiQuestionEvaluation> findByEvaluationProcessIdOrderByQuestionNumberAsc(String evaluationProcessId);

        List<AiQuestionEvaluation> findByEvaluationProcessIdAndStatus(String evaluationProcessId, String status);

        List<AiQuestionEvaluation> findAllByEvaluationProcessIdAndQuestionIdOrderByCreatedAtDesc(
                        String evaluationProcessId, String questionId);

        /**
         * Question ids of this process's rows a re-dispatch keeps: the ones a teacher
         * edited (a human decision is never thrown away) and the ones an earlier run of
         * this process already finished (COMPLETED or FAILED). A re-dispatch inserts no
         * new row for these.
         *
         * <p>Finished rows are kept because a re-dispatch can land on the SAME ai_service
         * job: its claim is still alive, so /grade hands that job back instead of starting
         * a new one. Deleting its finished rows lost those verdicts for good (the job
         * never sends them again), the complete callback then found PENDING rows and the
         * attempt was left EVALUATING. A fresh job re-grades every question and simply
         * overwrites a kept row.
         */
        @Query("SELECT q.question.id FROM AiQuestionEvaluation q "
                        + "WHERE q.evaluationProcess.id = :processId "
                        + "AND (q.isEdited = true OR q.status IN ('COMPLETED', 'FAILED'))")
        List<String> findKeptQuestionIds(@Param("processId") String processId);

        /**
         * Before a re-dispatch inserts a new set of tracking rows: drop the old rows that
         * never finished, keeping the edited and the finished ones
         * ({@link #findKeptQuestionIds}) (T0.29). Without this a second dispatch of the
         * same process doubled every row - and now violates
         * UNIQUE(evaluation_process_id, question_id) (V53).
         */
        @Modifying(flushAutomatically = true)
        @Query("DELETE FROM AiQuestionEvaluation q "
                        + "WHERE q.evaluationProcess.id = :processId AND (q.isEdited = false OR q.isEdited IS NULL) "
                        + "AND (q.status IS NULL OR q.status NOT IN ('COMPLETED', 'FAILED'))")
        int deleteUnfinishedForProcess(@Param("processId") String processId);

        long countByEvaluationProcessIdAndStatus(String evaluationProcessId, String status);

        /**
         * Per-process count of questions in a given status across a whole
         * assessment, as [processId, count] rows. One query for the dashboard's
         * "needs review" badge, avoiding an N+1 count per process.
         */
        @Query("SELECT q.evaluationProcess.id, COUNT(q) FROM AiQuestionEvaluation q " +
                        "WHERE q.evaluationProcess.assessment.id = :assessmentId AND q.status = :status " +
                        "GROUP BY q.evaluationProcess.id")
        List<Object[]> countByAssessmentGroupedByProcess(@Param("assessmentId") String assessmentId,
                        @Param("status") String status);
}
