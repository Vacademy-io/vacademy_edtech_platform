package vacademy.io.admin_core_service.features.commerce.parallelrun.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.commerce.parallelrun.entity.CommerceParallelRunDay;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

/** Saved parallel-run days. Every query filters by institute and location. */
public interface CommerceParallelRunDayRepository extends JpaRepository<CommerceParallelRunDay, String> {

    Optional<CommerceParallelRunDay> findByInstituteIdAndLocationIdAndBusinessDate(
            String instituteId, String locationId, LocalDate businessDate);

    /** Saved days from {@code from} to {@code to}, both included, oldest first. */
    List<CommerceParallelRunDay> findByInstituteIdAndLocationIdAndBusinessDateBetweenOrderByBusinessDateAsc(
            String instituteId, String locationId, LocalDate from, LocalDate to);

    /** The latest saved day of the location (where the clean-day streak ends). */
    Optional<CommerceParallelRunDay> findFirstByInstituteIdAndLocationIdOrderByBusinessDateDesc(
            String instituteId, String locationId);
}
