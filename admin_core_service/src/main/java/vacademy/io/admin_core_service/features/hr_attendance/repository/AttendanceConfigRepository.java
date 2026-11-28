package vacademy.io.admin_core_service.features.hr_attendance.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.hr_attendance.entity.AttendanceConfig;

import java.util.Optional;

@Repository
public interface AttendanceConfigRepository extends JpaRepository<AttendanceConfig, String> {

    Optional<AttendanceConfig> findByInstituteId(String instituteId);

    /** Institutes that opted into scheduled auto-checkout (AutoCheckoutJob fan-out). */
    java.util.List<AttendanceConfig> findByAutoCheckoutEnabledTrue();
}
