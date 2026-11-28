package vacademy.io.admin_core_service.features.commerce.tax.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.commerce.tax.entity.CommerceTaxSetting;

import java.util.Optional;

public interface CommerceTaxSettingRepository extends JpaRepository<CommerceTaxSetting, String> {

    Optional<CommerceTaxSetting> findByInstituteId(String instituteId);
}
