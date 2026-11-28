package vacademy.io.admin_core_service.features.commerce.order.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceShippingRule;

import java.util.Optional;

public interface CommerceShippingRuleRepository extends JpaRepository<CommerceShippingRule, String> {

    Optional<CommerceShippingRule> findFirstByInstituteIdAndStatusOrderByCreatedAtDesc(String instituteId,
                                                                                      String status);

    /** Retires the live rule of an institute; runs at once, before the new row is inserted. */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            UPDATE CommerceShippingRule r
            SET r.status = 'ARCHIVED'
            WHERE r.instituteId = :instituteId AND r.status = 'ACTIVE'
            """)
    int archiveActive(@Param("instituteId") String instituteId);
}
