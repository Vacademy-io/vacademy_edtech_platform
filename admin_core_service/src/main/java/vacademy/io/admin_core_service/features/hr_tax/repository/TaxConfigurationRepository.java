package vacademy.io.admin_core_service.features.hr_tax.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.hr_tax.entity.TaxConfiguration;

import java.util.List;
import java.util.Optional;

@Repository
public interface TaxConfigurationRepository extends JpaRepository<TaxConfiguration, String> {

    Optional<TaxConfiguration> findByInstituteIdAndCountryCode(String instituteId, String countryCode);

    // NOTE: UNIQUE is (institute_id, country_code) — an institute may hold one config per
    // country, so the single-row finders below throw NonUniqueResult once a second country
    // is configured. Use the List forms for any lookup not keyed by country.
    Optional<TaxConfiguration> findByInstituteIdAndStatus(String instituteId, String status);

    Optional<TaxConfiguration> findByInstituteId(String instituteId);

    List<TaxConfiguration> findAllByInstituteIdAndStatus(String instituteId, String status);

    List<TaxConfiguration> findAllByInstituteId(String instituteId);
}
