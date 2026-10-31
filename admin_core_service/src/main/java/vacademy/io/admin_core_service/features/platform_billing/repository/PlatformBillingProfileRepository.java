package vacademy.io.admin_core_service.features.platform_billing.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformBillingProfile;

/** {@code platform_billing_profile}, keyed by institute id ({@code findById(instituteId)}). */
public interface PlatformBillingProfileRepository extends JpaRepository<PlatformBillingProfile, String> {
}
