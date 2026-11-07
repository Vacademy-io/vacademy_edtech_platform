package vacademy.io.assessment_service.features.assessment.repository;

import jakarta.transaction.Transactional;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.CrudRepository;
import org.springframework.data.repository.query.Param;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;

import java.util.Date;
import java.util.List;
import java.util.Optional;

public interface QuestionAssessmentSectionMappingRepository extends CrudRepository<QuestionAssessmentSectionMapping, String> {

    /**
     * Flat row for the marks-calculation hot path: everything scoring needs
     * (marking scheme + the question's auto-evaluation config) in one query,
     * with no entity hydration — the mapping entity eagerly loads Question,
     * which made per-question lookups a cascade of selects during live exams.
     */
    interface MarkingSchemeRow {
        String getQuestionId();

        String getSectionId();

        String getMarkingJson();

        String getAutoEvaluationJson();

        Date getCreatedAt();
    }

    @Query(value = """
            SELECT qasm.question_id AS "questionId", qasm.section_id AS "sectionId",
                   qasm.marking_json AS "markingJson", qasm.created_at AS "createdAt",
                   q.auto_evaluation_json AS "autoEvaluationJson"
            FROM question_assessment_section_mapping qasm
            JOIN question q ON q.id = qasm.question_id
            WHERE qasm.section_id IN (:sectionIds)
            """, nativeQuery = true)
    List<MarkingSchemeRow> findMarkingSchemeRowsBySectionIds(@Param("sectionIds") List<String> sectionIds);

    /** Whether the live paper has at least one question of these types. */
    @Query(value = """
            SELECT EXISTS (
                SELECT 1
                FROM question_assessment_section_mapping qasm
                JOIN section s ON s.id = qasm.section_id
                JOIN question q ON q.id = qasm.question_id
                WHERE s.assessment_id = :assessmentId
                  AND s.status <> 'DELETED'
                  AND (qasm.status IS NULL OR qasm.status <> 'DELETED')
                  AND q.question_type IN (:questionTypes)
            )
            """, nativeQuery = true)
    boolean existsQuestionOfTypesInAssessment(@Param("assessmentId") String assessmentId,
                                              @Param("questionTypes") List<String> questionTypes);


    @Modifying
    @Transactional
    @Query(value = "UPDATE question_assessment_section_mapping SET status = 'DELETED' WHERE question_id IN ?1 AND section_id = ?2", nativeQuery = true)
    void softDeleteByQuestionIdsAndSectionId(List<String> questionIds, String sectionId);


    @Modifying
    @Transactional
    @Query(value = "DELETE FROM question_assessment_section_mapping WHERE question_id IN ?1 AND section_id = ?2", nativeQuery = true)
    void hardDeleteByQuestionIdsAndSectionId(List<String> questionIds, String sectionId);

    @Query(value = "SELECT * FROM question_assessment_section_mapping WHERE section_id IN ?1", nativeQuery = true)
    List<QuestionAssessmentSectionMapping> getQuestionAssessmentSectionMappingBySectionIds(List<String> sectionIds);

    @Query(value = "SELECT qasm.* FROM question_assessment_section_mapping qasm " +
            "LEFT JOIN section s ON qasm.section_id = s.id " +
            "WHERE s.assessment_id = ?1 and s.status != 'DELETED' ", nativeQuery = true)
    List<QuestionAssessmentSectionMapping> getQuestionAssessmentSectionMappingByAssessmentId(String assessmentId);

    @Query(value = """
            SELECT qasm.* FROM question_assessment_section_mapping qasm
            WHERE qasm.question_id = :questionId
            AND qasm.section_id = :sectionId ORDER BY qasm.created_at DESC LIMIT 1
            """, nativeQuery = true)
    Optional<QuestionAssessmentSectionMapping> findByQuestionIdAndSectionId(@Param("questionId") String questionId,
                                                                            @Param("sectionId") String sectionId);

    @Query(value = """
            SELECT qasm.* FROM question_assessment_section_mapping qasm
            WHERE qasm.section_id = :sectionId
            AND qasm.status NOT IN (:statusList)
            """, nativeQuery = true)
    List<QuestionAssessmentSectionMapping> findBySectionIdAndStatusNotIn(@Param("sectionId") String sectionId,
                                                                         @Param("statusList") List<String> statusList);

    boolean existsBySection_Assessment_IdAndSection_IdAndQuestion_Id(String assessmentId, String sectionId, String questionId);

    @Query("SELECT qasm FROM QuestionAssessmentSectionMapping qasm WHERE qasm.section.id = :sectionId")
    List<QuestionAssessmentSectionMapping> findBySectionId(@Param("sectionId") String sectionId);
}