package vacademy.io.assessment_service.features.assessment.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.assessment_service.features.assessment.entity.EvaluationLogs;

import java.util.List;

public interface EvaluationLogsRepository extends JpaRepository<EvaluationLogs, String> {


    List<EvaluationLogs> findAllBySourceAndSourceIdOrderByDateAndTimeDesc(String source, String sourceId);

    /** Whether the attempt was ever marked on the answer sheet (manual evaluation). */
    boolean existsBySourceIdAndType(String sourceId, String type);

    List<EvaluationLogs> findAllBySourceIdOrderByDateAndTimeDesc(String sourceId);

}
