package vacademy.io.admin_core_service.features.hr_attendance.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.hr_attendance.entity.AttendanceRecord;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

@Repository
public interface AttendanceRecordRepository extends JpaRepository<AttendanceRecord, String> {

    Optional<AttendanceRecord> findByEmployeeIdAndAttendanceDate(String employeeId, LocalDate date);

    List<AttendanceRecord> findByEmployeeIdAndAttendanceDateBetweenOrderByAttendanceDateAsc(
            String employeeId, LocalDate startDate, LocalDate endDate);

    @Query("SELECT a FROM AttendanceRecord a WHERE a.instituteId = :instituteId " +
            "AND a.attendanceDate BETWEEN :startDate AND :endDate ORDER BY a.attendanceDate")
    List<AttendanceRecord> findByInstituteAndDateRange(
            @Param("instituteId") String instituteId,
            @Param("startDate") LocalDate startDate,
            @Param("endDate") LocalDate endDate);

    @Query("SELECT COUNT(a) FROM AttendanceRecord a WHERE a.employee.id = :employeeId " +
            "AND a.attendanceDate BETWEEN :startDate AND :endDate AND a.status = :status")
    long countByEmployeeAndDateRangeAndStatus(
            @Param("employeeId") String employeeId,
            @Param("startDate") LocalDate startDate,
            @Param("endDate") LocalDate endDate,
            @Param("status") String status);

    @Query("SELECT a FROM AttendanceRecord a WHERE a.instituteId = :instituteId " +
            "AND a.attendanceDate = :date ORDER BY a.employee.employeeCode")
    List<AttendanceRecord> findByInstituteIdAndDate(
            @Param("instituteId") String instituteId,
            @Param("date") LocalDate date);

    /** Open sessions for auto-checkout: checked in on this date, never checked out. */
    @Query("SELECT a FROM AttendanceRecord a WHERE a.instituteId = :instituteId " +
            "AND a.attendanceDate = :date AND a.checkInTime IS NOT NULL AND a.checkOutTime IS NULL")
    List<AttendanceRecord> findOpenCheckIns(
            @Param("instituteId") String instituteId,
            @Param("date") LocalDate date);

    /** Employee ids that already have ANY record on this date (auto-absent exclusion set). */
    @Query("SELECT a.employee.id FROM AttendanceRecord a WHERE a.instituteId = :instituteId " +
            "AND a.attendanceDate = :date")
    List<String> findEmployeeIdsWithRecordOnDate(
            @Param("instituteId") String instituteId,
            @Param("date") LocalDate date);
}
