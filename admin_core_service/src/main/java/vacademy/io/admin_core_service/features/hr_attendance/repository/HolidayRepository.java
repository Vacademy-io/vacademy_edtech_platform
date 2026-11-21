package vacademy.io.admin_core_service.features.hr_attendance.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.hr_attendance.entity.Holiday;

import java.time.LocalDate;
import java.util.List;

@Repository
public interface HolidayRepository extends JpaRepository<Holiday, String> {

    List<Holiday> findByInstituteIdAndYearOrderByDateAsc(String instituteId, Integer year);

    @Query("SELECT h FROM Holiday h WHERE h.instituteId = :instituteId " +
            "AND h.date BETWEEN :startDate AND :endDate ORDER BY h.date")
    List<Holiday> findByInstituteIdAndDateRange(
            @Param("instituteId") String instituteId,
            @Param("startDate") LocalDate startDate,
            @Param("endDate") LocalDate endDate);

    boolean existsByInstituteIdAndDate(String instituteId, LocalDate date);

    List<Holiday> findByInstituteIdAndDateIn(String instituteId, List<LocalDate> dates);

    @Query("SELECT COUNT(h) FROM Holiday h WHERE h.instituteId = :instituteId " +
            "AND h.date BETWEEN :startDate AND :endDate AND h.isOptional = false")
    long countMandatoryHolidays(@Param("instituteId") String instituteId,
                                 @Param("startDate") LocalDate startDate,
                                 @Param("endDate") LocalDate endDate);
}
