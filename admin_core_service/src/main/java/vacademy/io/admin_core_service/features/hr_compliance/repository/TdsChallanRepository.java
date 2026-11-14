package vacademy.io.admin_core_service.features.hr_compliance.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.hr_compliance.entity.TdsChallan;

import java.util.List;
import java.util.Optional;

@Repository
public interface TdsChallanRepository extends JpaRepository<TdsChallan, String> {

    List<TdsChallan> findByInstituteIdAndFinancialYearOrderByDepositDateAsc(String instituteId, String financialYear);

    List<TdsChallan> findByInstituteIdAndFinancialYearAndQuarterOrderByDepositDateAsc(
            String instituteId, String financialYear, String quarter);

    Optional<TdsChallan> findByIdAndInstituteId(String id, String instituteId);
}
