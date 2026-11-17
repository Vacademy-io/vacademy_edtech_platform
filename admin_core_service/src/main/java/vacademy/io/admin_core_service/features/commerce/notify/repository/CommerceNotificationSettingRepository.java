package vacademy.io.admin_core_service.features.commerce.notify.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.commerce.notify.entity.CommerceNotificationSetting;
import vacademy.io.admin_core_service.features.commerce.notify.entity.CommerceNotificationSettingId;

import java.util.List;
import java.util.Optional;

public interface CommerceNotificationSettingRepository
        extends JpaRepository<CommerceNotificationSetting, CommerceNotificationSettingId> {

    List<CommerceNotificationSetting> findByInstituteId(String instituteId);

    Optional<CommerceNotificationSetting> findByInstituteIdAndTriggerCode(String instituteId, String triggerCode);
}
