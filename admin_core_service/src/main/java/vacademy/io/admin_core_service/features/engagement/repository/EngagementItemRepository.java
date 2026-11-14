package vacademy.io.admin_core_service.features.engagement.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementItem;

import java.util.List;

@Repository
public interface EngagementItemRepository extends JpaRepository<EngagementItem, String> {

    @Query("SELECT i FROM EngagementItem i WHERE i.slotId = :slotId AND i.status = 'ACTIVE' " +
            "ORDER BY i.isRequired DESC, i.sortOrder")
    List<EngagementItem> findActiveBySlot(@Param("slotId") String slotId);

    @Query("SELECT i FROM EngagementItem i WHERE i.slotId IN :slotIds AND i.status = 'ACTIVE' " +
            "ORDER BY i.isRequired DESC, i.sortOrder")
    List<EngagementItem> findActiveBySlots(@Param("slotIds") List<String> slotIds);

    @Query("SELECT COUNT(i) FROM EngagementItem i WHERE i.slotId = :slotId AND i.status = 'ACTIVE'")
    long countActiveBySlot(@Param("slotId") String slotId);
}
