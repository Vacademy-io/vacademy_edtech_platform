package vacademy.io.assessment_service.features.assessment.omr.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.assessment_service.features.assessment.omr.entity.OmrScanBatch;

import java.util.List;

public interface OmrScanBatchRepository extends JpaRepository<OmrScanBatch, String> {

    List<OmrScanBatch> findByAssessmentIdAndInstituteIdOrderByCreatedAtDesc(String assessmentId, String instituteId);

    List<OmrScanBatch> findByStatus(String status);

    boolean existsByAssessmentId(String assessmentId);
}
