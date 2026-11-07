package vacademy.io.admin_core_service.features.hr_tax.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.hr_tax.dto.TaxConfigurationDTO;
import vacademy.io.admin_core_service.features.hr_tax.entity.TaxConfiguration;
import vacademy.io.admin_core_service.features.hr_tax.repository.TaxConfigurationRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Optional;

@Service
public class TaxConfigurationService {

    @Autowired
    private TaxConfigurationRepository taxConfigurationRepository;

    @Transactional
    public String saveConfig(TaxConfigurationDTO dto, String instituteId) {
        // Upsert by validated instituteId + countryCode — never the DTO's
        // instituteId (cross-tenant write hole: a user could overwrite another
        // institute's tax config by putting its id in the body).
        Optional<TaxConfiguration> existingOpt = taxConfigurationRepository
                .findByInstituteIdAndCountryCode(instituteId, dto.getCountryCode());

        TaxConfiguration config;
        if (existingOpt.isPresent()) {
            config = existingOpt.get();
        } else {
            config = new TaxConfiguration();
            config.setInstituteId(instituteId);
            config.setCountryCode(dto.getCountryCode());
        }

        config.setStateCode(dto.getStateCode());
        config.setFinancialYearStartMonth(dto.getFinancialYearStartMonth());
        config.setTaxRules(dto.getTaxRules());
        config.setEmployerContributions(dto.getEmployerContributions());
        config.setStatutorySettings(dto.getStatutorySettings());
        config.setStatus(dto.getStatus() != null ? dto.getStatus() : "ACTIVE");

        config = taxConfigurationRepository.save(config);
        return config.getId();
    }

    @Transactional(readOnly = true)
    public TaxConfigurationDTO getConfig(String instituteId) {
        // List form: (institute_id, country_code) is the unique key, so the
        // single-row finder throws NonUniqueResult once a second country is
        // configured. No countryCode at hand here — take the first active config.
        List<TaxConfiguration> configs = taxConfigurationRepository
                .findAllByInstituteIdAndStatus(instituteId, "ACTIVE");
        if (configs.isEmpty()) {
            throw new VacademyException("Tax configuration not found for institute");
        }

        return toDTO(configs.get(0));
    }

    private TaxConfigurationDTO toDTO(TaxConfiguration config) {
        return TaxConfigurationDTO.builder()
                .id(config.getId())
                .instituteId(config.getInstituteId())
                .countryCode(config.getCountryCode())
                .stateCode(config.getStateCode())
                .financialYearStartMonth(config.getFinancialYearStartMonth())
                .taxRules(config.getTaxRules())
                .employerContributions(config.getEmployerContributions())
                .statutorySettings(config.getStatutorySettings())
                .status(config.getStatus())
                .build();
    }
}
