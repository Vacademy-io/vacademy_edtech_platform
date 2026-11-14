package vacademy.io.admin_core_service.features.hr_payroll.repository;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollRun;

import java.util.List;
import java.util.Optional;

@Repository
public interface PayrollRunRepository extends JpaRepository<PayrollRun, String> {

    Optional<PayrollRun> findByInstituteIdAndMonthAndYear(String instituteId, Integer month, Integer year);

    Optional<PayrollRun> findByIdAndInstituteId(String id, String instituteId);

    /** Duplicate check for creating a run: CANCELLED runs don't block the month (V480 partial unique). */
    boolean existsByInstituteIdAndMonthAndYearAndRunTypeAndStatusNot(
            String instituteId, Integer month, Integer year, String runType, String status);

    /** Month-lock check: a REGULAR run past DRAFT locks that month's attendance/leave. */
    boolean existsByInstituteIdAndMonthAndYearAndRunTypeAndStatusIn(
            String instituteId, Integer month, Integer year, String runType, List<String> statuses);

    /** Row-locks the run so two concurrent /process calls serialize instead of double-calculating. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT r FROM PayrollRun r WHERE r.id = :id AND r.instituteId = :instituteId")
    Optional<PayrollRun> findByIdAndInstituteIdForUpdate(@Param("id") String id, @Param("instituteId") String instituteId);

    List<PayrollRun> findByInstituteIdAndYearOrderByMonthDesc(String instituteId, Integer year);

    List<PayrollRun> findByInstituteIdOrderByYearDescMonthDesc(String instituteId);
}
