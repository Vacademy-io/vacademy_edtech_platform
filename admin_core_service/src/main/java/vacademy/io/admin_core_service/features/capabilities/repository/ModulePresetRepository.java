package vacademy.io.admin_core_service.features.capabilities.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.capabilities.entity.ModulePreset;

import java.util.List;

public interface ModulePresetRepository extends JpaRepository<ModulePreset, String> {

    List<ModulePreset> findAllByOrderByKeyAsc();
}
