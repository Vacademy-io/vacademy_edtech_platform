package vacademy.io.admin_core_service.features.hr_leave.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.hr_leave.entity.CompensatoryOff;

import java.util.List;

@Repository
public interface CompensatoryOffRepository extends JpaRepository<CompensatoryOff, String> {

    List<CompensatoryOff> findByEmployee_IdAndStatusOrderByWorkedOnDateDesc(String employeeId, String status);

    List<CompensatoryOff> findByEmployee_IdAndUsedFalseAndStatusOrderByExpiryDateAsc(String employeeId, String status);

    /** Expiry sweep candidates (CompOffExpiryJob): rows in this status whose expiry date is before the cutoff. */
    List<CompensatoryOff> findByStatusAndExpiryDateLessThan(String status, java.time.LocalDate cutoff);
}
