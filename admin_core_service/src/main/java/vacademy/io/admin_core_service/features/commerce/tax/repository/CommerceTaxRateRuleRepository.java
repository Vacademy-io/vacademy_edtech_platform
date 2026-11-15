package vacademy.io.admin_core_service.features.commerce.tax.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.commerce.tax.entity.CommerceTaxRateRule;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface CommerceTaxRateRuleRepository extends JpaRepository<CommerceTaxRateRule, String> {

    Optional<CommerceTaxRateRule> findByInstituteIdAndId(String instituteId, String id);

    List<CommerceTaxRateRule> findByInstituteIdAndTaxClassIdOrderByEffectiveFromAscMinUnitPriceAsc(
            String instituteId, String taxClassId);

    List<CommerceTaxRateRule> findByInstituteIdAndTaxClassIdInOrderByEffectiveFromAscMinUnitPriceAsc(
            String instituteId, Collection<String> taxClassIds);
}
