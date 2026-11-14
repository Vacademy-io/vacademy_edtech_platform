package vacademy.io.admin_core_service.features.offline_payment.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.offline_payment.entity.InstituteOfflinePaymentSetting;

@Repository
public interface InstituteOfflinePaymentSettingRepository extends JpaRepository<InstituteOfflinePaymentSetting, String> {
}
