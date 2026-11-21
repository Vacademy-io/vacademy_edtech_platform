package vacademy.io.assessment_service.features.assessment.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentCustomField;

import java.util.List;
import java.util.Optional;

public interface AssessmentCustomFieldRepository extends JpaRepository<AssessmentCustomField, String> {

    @Modifying
    @Transactional
    @Query(value = "UPDATE assessment_custom_fields SET status = 'DELETED' WHERE assessment_id = ?1 AND field_key IN ?2", nativeQuery = true)
    void softDeleteByAssessmentIdAndFieldKeys(String assessmentId, List<String> fieldKeys);

    Optional<AssessmentCustomField> findByFieldKeyAndAssessment(String fieldKey, Assessment assessment);

    // Every row of the assessment, soft-deleted ones included. field_key is UNIQUE per
    // assessment across all of them, so a save of the registration form must see them all.
    List<AssessmentCustomField> findAllByAssessment(Assessment assessment);

    // Fields still shown on the registration form, in the order the participant
    // saw them. Drives both the export-columns dialog and the CSV column order.
    // field_order ties are common (whole forms sit at 0), and nothing stops two
    // fields sharing a name, so id breaks the tie — without a total order the
    // two calls could disagree and a column header would top the wrong answers.
    @Query("""
            SELECT f FROM AssessmentCustomField f
            WHERE f.assessment.id = :assessmentId
              AND (f.status IS NULL OR f.status <> 'DELETED')
            ORDER BY f.fieldOrder ASC, f.fieldName ASC, f.id ASC
            """)
    List<AssessmentCustomField> findActiveFieldsByAssessmentId(@Param("assessmentId") String assessmentId);
}
