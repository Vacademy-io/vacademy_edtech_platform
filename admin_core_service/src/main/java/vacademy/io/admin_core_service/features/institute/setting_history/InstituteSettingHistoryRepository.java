package vacademy.io.admin_core_service.features.institute.setting_history;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface InstituteSettingHistoryRepository extends JpaRepository<InstituteSettingHistory, String> {

    Page<InstituteSettingHistory> findByInstituteIdOrderByCreatedAtDesc(String instituteId, Pageable pageable);

    Page<InstituteSettingHistory> findByInstituteIdAndSettingKeyOrderByCreatedAtDesc(String instituteId,
                                                                                    String settingKey,
                                                                                    Pageable pageable);

    Optional<InstituteSettingHistory> findByIdAndInstituteId(String id, String instituteId);
}
