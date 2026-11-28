package vacademy.io.assessment_service.features.proctoring.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.assessment_service.features.proctoring.entity.AttemptProctorEvent;

import java.util.Collection;
import java.util.List;

@Repository
public interface AttemptProctorEventRepository extends JpaRepository<AttemptProctorEvent, String> {

    List<AttemptProctorEvent> findByAttemptIdOrderByOccurredAtAsc(String attemptId);

    long countByAttemptIdAndSeverity(String attemptId, String severity);

    long countByAttemptId(String attemptId);

    /** attempt_id, severity, count -- for the submissions table, one round trip for the page. */
    @Query(value = """
            SELECT attempt_id, severity, COUNT(*)
            FROM attempt_proctor_event
            WHERE attempt_id IN (:attemptIds) AND severity IN ('FLAG', 'WARN')
            GROUP BY attempt_id, severity
            """, nativeQuery = true)
    List<Object[]> countBySeverityForAttempts(@Param("attemptIds") Collection<String> attemptIds);
}
