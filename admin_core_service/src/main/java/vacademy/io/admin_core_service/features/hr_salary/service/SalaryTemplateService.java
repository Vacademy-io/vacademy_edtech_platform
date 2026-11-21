package vacademy.io.admin_core_service.features.hr_salary.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.hr_salary.dto.SalaryTemplateComponentDTO;
import vacademy.io.admin_core_service.features.hr_salary.dto.SalaryTemplateDTO;
import vacademy.io.admin_core_service.features.hr_salary.entity.SalaryComponent;
import vacademy.io.admin_core_service.features.hr_salary.entity.SalaryTemplate;
import vacademy.io.admin_core_service.features.hr_salary.entity.SalaryTemplateComponent;
import vacademy.io.admin_core_service.features.hr_salary.enums.CalculationType;
import vacademy.io.admin_core_service.features.hr_salary.repository.SalaryComponentRepository;
import vacademy.io.admin_core_service.features.hr_salary.repository.SalaryTemplateComponentRepository;
import vacademy.io.admin_core_service.features.hr_salary.repository.SalaryTemplateRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

@Service
public class SalaryTemplateService {

    @Autowired
    private SalaryTemplateRepository salaryTemplateRepository;

    @Autowired
    private SalaryTemplateComponentRepository salaryTemplateComponentRepository;

    @Autowired
    private SalaryComponentRepository salaryComponentRepository;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @Transactional
    public String createTemplate(SalaryTemplateDTO dto, String instituteId) {
        if (!StringUtils.hasText(dto.getName())) {
            throw new VacademyException("Template name is required");
        }

        SalaryTemplate template = new SalaryTemplate();
        // Always the validated query param — never the DTO's instituteId (cross-tenant write hole).
        template.setInstituteId(instituteId);
        template.setName(dto.getName());
        template.setDescription(dto.getDescription());
        template.setIsDefault(dto.getIsDefault() != null ? dto.getIsDefault() : false);
        template.setStatus(StringUtils.hasText(dto.getStatus()) ? dto.getStatus() : "ACTIVE");

        template = salaryTemplateRepository.save(template);

        // Save template components
        if (dto.getComponents() != null && !dto.getComponents().isEmpty()) {
            List<SalaryTemplateComponent> templateComponents = buildTemplateComponents(dto.getComponents(), template, instituteId);
            salaryTemplateComponentRepository.saveAll(templateComponents);
            template.setComponents(templateComponents);
        }

        return template.getId();
    }

    @Transactional
    public String updateTemplate(String id, SalaryTemplateDTO dto, String instituteId) {
        SalaryTemplate template = salaryTemplateRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Salary template not found"));
        hrAccessGuard.requireInstituteMatch(template.getInstituteId(), instituteId, "Salary template");

        if (StringUtils.hasText(dto.getName())) {
            template.setName(dto.getName());
        }
        if (dto.getDescription() != null) {
            template.setDescription(dto.getDescription());
        }
        if (dto.getIsDefault() != null) {
            template.setIsDefault(dto.getIsDefault());
        }
        if (StringUtils.hasText(dto.getStatus())) {
            template.setStatus(dto.getStatus());
        }

        salaryTemplateRepository.save(template);

        // Replace components: delete existing, then insert new ones
        if (dto.getComponents() != null) {
            salaryTemplateComponentRepository.deleteByTemplateId(id);
            if (!dto.getComponents().isEmpty()) {
                List<SalaryTemplateComponent> templateComponents = buildTemplateComponents(dto.getComponents(), template, instituteId);
                salaryTemplateComponentRepository.saveAll(templateComponents);
            }
        }

        return template.getId();
    }

    @Transactional(readOnly = true)
    public List<SalaryTemplateDTO> getTemplates(String instituteId) {
        List<SalaryTemplate> templates = salaryTemplateRepository
                .findByInstituteIdOrderByNameAsc(instituteId);

        return templates.stream()
                .map(this::toDTO)
                .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public SalaryTemplateDTO getTemplateById(String id, String instituteId) {
        SalaryTemplate template = salaryTemplateRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Salary template not found"));
        hrAccessGuard.requireInstituteMatch(template.getInstituteId(), instituteId, "Salary template");

        SalaryTemplateDTO dto = toDTO(template);

        // Eagerly load components with their salary component details
        List<SalaryTemplateComponent> components = salaryTemplateComponentRepository
                .findByTemplateIdOrderByDisplayOrderAsc(id);
        dto.setComponents(components.stream()
                .map(this::toComponentDTO)
                .collect(Collectors.toList()));

        return dto;
    }

    private List<SalaryTemplateComponent> buildTemplateComponents(
            List<SalaryTemplateComponentDTO> componentDTOs, SalaryTemplate template, String instituteId) {

        List<SalaryTemplateComponent> templateComponents = new ArrayList<>();

        for (SalaryTemplateComponentDTO compDTO : componentDTOs) {
            if (!StringUtils.hasText(compDTO.getComponentId())) {
                throw new VacademyException("Component ID is required for each template component");
            }

            SalaryComponent salaryComponent = salaryComponentRepository.findById(compDTO.getComponentId())
                    .orElseThrow(() -> new VacademyException(
                            "Salary component not found with id: " + compDTO.getComponentId()));
            hrAccessGuard.requireInstituteMatch(salaryComponent.getInstituteId(), instituteId, "Salary component");

            String calcType = StringUtils.hasText(compDTO.getCalculationType())
                    ? compDTO.getCalculationType() : "FIXED_AMOUNT";
            try {
                CalculationType.valueOf(calcType);
            } catch (IllegalArgumentException e) {
                throw new VacademyException("Invalid calculation type: " + compDTO.getCalculationType());
            }

            SalaryTemplateComponent tc = new SalaryTemplateComponent();
            tc.setTemplate(template);
            tc.setComponent(salaryComponent);
            tc.setCalculationType(calcType);
            tc.setPercentageValue(compDTO.getPercentageValue());
            tc.setFixedValue(compDTO.getFixedValue());
            tc.setFormula(compDTO.getFormula());
            tc.setMinValue(compDTO.getMinValue());
            tc.setMaxValue(compDTO.getMaxValue());
            tc.setDisplayOrder(compDTO.getDisplayOrder() != null ? compDTO.getDisplayOrder() : 0);
            tc.setIsMandatory(compDTO.getIsMandatory() != null ? compDTO.getIsMandatory() : true);

            templateComponents.add(tc);
        }

        return templateComponents;
    }

    private SalaryTemplateDTO toDTO(SalaryTemplate template) {
        SalaryTemplateDTO dto = SalaryTemplateDTO.builder()
                .id(template.getId())
                .instituteId(template.getInstituteId())
                .name(template.getName())
                .description(template.getDescription())
                .isDefault(template.getIsDefault())
                .status(template.getStatus())
                .build();

        // Map components if already loaded
        if (template.getComponents() != null) {
            dto.setComponents(template.getComponents().stream()
                    .map(this::toComponentDTO)
                    .collect(Collectors.toList()));
        }

        return dto;
    }

    public SalaryTemplateComponentDTO toComponentDTO(SalaryTemplateComponent tc) {
        SalaryComponent comp = tc.getComponent();
        return SalaryTemplateComponentDTO.builder()
                .id(tc.getId())
                .componentId(comp.getId())
                .componentName(comp.getName())
                .componentCode(comp.getCode())
                .componentType(comp.getType())
                .calculationType(tc.getCalculationType())
                .percentageValue(tc.getPercentageValue())
                .fixedValue(tc.getFixedValue())
                .formula(tc.getFormula())
                .minValue(tc.getMinValue())
                .maxValue(tc.getMaxValue())
                .displayOrder(tc.getDisplayOrder())
                .isMandatory(tc.getIsMandatory())
                .build();
    }
}
