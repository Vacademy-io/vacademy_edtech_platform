package vacademy.io.assessment_service.features.assessment.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentBatchRegistration;

import java.util.List;

public interface AssessmentBatchRegistrationRepository extends JpaRepository<AssessmentBatchRegistration, String> {

    @Modifying
    @Transactional
    @Query(value = "INSERT INTO assessment_batch_registration (id, assessment_id, batch_id, institute_id, registration_time, status, created_at, updated_at) VALUES ?1", nativeQuery = true)
    void bulkInsert(List<Object[]> batch);

    @Modifying
    @Transactional
    @Query(value = "UPDATE assessment_batch_registration SET status = 'DELETED' WHERE id IN ?1 AND institute_id = ?2 AND assessment_id = ?3", nativeQuery = true)
    void softDeleteByIds(List<String> ids, String instituteId, String assessmentId);


    @Modifying
    @Transactional
    @Query(value = "DELETE FROM assessment_batch_registration WHERE batch_id IN :ids AND institute_id = :instituteId AND assessment_id = :assessmentId", nativeQuery = true)
    void hardDeleteByIds(
            @Param("ids") List<String> ids,
            @Param("instituteId") String instituteId,
            @Param("assessmentId") String assessmentId
    );

    @Query("SELECT COUNT(DISTINCT abr.assessment.id) " +
            "FROM AssessmentBatchRegistration abr " +
            "WHERE abr.batchId IN :batchIds " +
            "AND abr.instituteId = :instituteId " +
            "AND abr.status IN :statusList " +
            "AND abr.assessment.status IN :assessmentStatus " +
            "AND (abr.assessment.boundEndTime IS NULL OR abr.assessment.boundEndTime >= CURRENT_TIMESTAMP)")
    Integer countDistinctAssessmentsByBatchAndFilters(
            @Param("batchIds") List<String> batchIds,
            @Param("instituteId") String instituteId,
            @Param("statusList") List<String> statusList,
            @Param("assessmentStatus") List<String> assessmentStatus
    );


    /**
     * Batches this assessment was assigned to. Needed by the "enrolled but has not
     * attempted" list, which starts from batch membership rather than from any row in
     * this database — batch learners get no registration row until they actually start.
     */
    @Query("SELECT abr.batchId FROM AssessmentBatchRegistration abr " +
            "WHERE abr.assessment.id = :assessmentId " +
            "AND abr.instituteId = :instituteId " +
            "AND abr.status IN :statuses")
    List<String> findBatchIdsByAssessmentAndInstitute(@Param("assessmentId") String assessmentId,
                                                      @Param("instituteId") String instituteId,
                                                      @Param("statuses") List<String> statuses);

    boolean existsByInstituteIdAndAssessmentIdAndBatchId(String instituteId, String assessmentId, String batchId);
}
