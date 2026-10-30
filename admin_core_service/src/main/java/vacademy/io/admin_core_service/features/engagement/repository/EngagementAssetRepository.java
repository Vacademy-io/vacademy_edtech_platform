package vacademy.io.admin_core_service.features.engagement.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAsset;

import java.util.Collection;
import java.util.List;

public interface EngagementAssetRepository extends JpaRepository<EngagementAsset, String> {

    List<EngagementAsset> findByEngineIdOrderByCreatedAtAsc(String engineId);

    List<EngagementAsset> findByEngineIdAndIdIn(String engineId, Collection<String> ids);

    long countByEngineId(String engineId);
}
