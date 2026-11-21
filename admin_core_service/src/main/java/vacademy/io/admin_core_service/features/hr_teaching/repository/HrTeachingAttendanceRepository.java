package vacademy.io.admin_core_service.features.hr_teaching.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.hr_attendance.entity.AttendanceRecord;

import java.time.LocalDate;
import java.util.Optional;

/**
 * hr_teaching's own access to hr_attendance_record for the teaching →
 * attendance sync. The table has UNIQUE(employee_id, attendance_date), so the
 * sync must load-then-update instead of blindly inserting.
 */
@Repository
public interface HrTeachingAttendanceRepository extends JpaRepository<AttendanceRecord, String> {

    Optional<AttendanceRecord> findByEmployeeIdAndAttendanceDate(String employeeId, LocalDate attendanceDate);
}
