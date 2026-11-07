package vacademy.io.admin_core_service.features.hr_salary.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.hr_salary.dto.SalaryComponentDTO;
import vacademy.io.admin_core_service.features.hr_salary.entity.SalaryComponent;
import vacademy.io.admin_core_service.features.hr_salary.enums.ComponentCategory;
import vacademy.io.admin_core_service.features.hr_salary.enums.ComponentType;
import vacademy.io.admin_core_service.features.hr_salary.repository.SalaryComponentRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.stream.Collectors;

@Service
public class SalaryComponentService {

    @Autowired
    private SalaryComponentRepository salaryComponentRepository;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @Transactional
    public String createComponent(SalaryComponentDTO dto, String instituteId) {
        if (!StringUtils.hasText(dto.getName())) {
            throw new VacademyException("Component name is required");
        }
        if (!StringUtils.hasText(dto.getCode())) {
            throw new VacademyException("Component code is required");
        }
        if (!StringUtils.hasText(dto.getType())) {
            throw new VacademyException("Component type is required");
        }

        try {
            ComponentType.valueOf(dto.getType());
        } catch (IllegalArgumentException e) {
            throw new VacademyException("Invalid component type: " + dto.getType());
        }
        if (dto.getCategory() != null) {
            try {
                ComponentCategory.valueOf(dto.getCategory());
            } catch (IllegalArgumentException e) {
                throw new VacademyException("Invalid component category: " + dto.getCategory());
            }
        }

        if (salaryComponentRepository.existsByInstituteIdAndCode(instituteId, dto.getCode())) {
            throw new VacademyException("Component with code '" + dto.getCode() + "' already exists for this institute");
        }

        SalaryComponent component = new SalaryComponent();
        component.setInstituteId(instituteId);
        component.setName(dto.getName());
        component.setCode(dto.getCode());
        component.setType(dto.getType());
        component.setCategory(dto.getCategory());
        component.setIsTaxable(dto.getIsTaxable() != null ? dto.getIsTaxable() : true);
        component.setIsStatutory(dto.getIsStatutory() != null ? dto.getIsStatutory() : false);
        component.setIsActive(dto.getIsActive() != null ? dto.getIsActive() : true);
        component.setDisplayOrder(dto.getDisplayOrder() != null ? dto.getDisplayOrder() : 0);
        component.setDescription(dto.getDescription());

        component = salaryComponentRepository.save(component);
        return component.getId();
    }

    @Transactional
    public String updateComponent(String id, SalaryComponentDTO dto, String instituteId) {
        SalaryComponent component = salaryComponentRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Salary component not found"));
        hrAccessGuard.requireInstituteMatch(component.getInstituteId(), instituteId, "Salary component");

        if (StringUtils.hasText(dto.getName())) {
            component.setName(dto.getName());
        }
        if (dto.getCode() != null) {
            // Check uniqueness if code is being changed
            if (!dto.getCode().equals(component.getCode())
                    && salaryComponentRepository.existsByInstituteIdAndCode(component.getInstituteId(), dto.getCode())) {
                throw new VacademyException("Component with code '" + dto.getCode() + "' already exists for this institute");
            }
            component.setCode(dto.getCode());
        }
        if (dto.getType() != null) {
            try {
                ComponentType.valueOf(dto.getType());
            } catch (IllegalArgumentException e) {
                throw new VacademyException("Invalid component type: " + dto.getType());
            }
            component.setType(dto.getType());
        }
        if (dto.getCategory() != null) {
            try {
                ComponentCategory.valueOf(dto.getCategory());
            } catch (IllegalArgumentException e) {
                throw new VacademyException("Invalid component category: " + dto.getCategory());
            }
            component.setCategory(dto.getCategory());
        }
        if (dto.getIsTaxable() != null) {
            component.setIsTaxable(dto.getIsTaxable());
        }
        if (dto.getIsStatutory() != null) {
            component.setIsStatutory(dto.getIsStatutory());
        }
        if (dto.getIsActive() != null) {
            component.setIsActive(dto.getIsActive());
        }
        if (dto.getDisplayOrder() != null) {
            component.setDisplayOrder(dto.getDisplayOrder());
        }
        if (dto.getDescription() != null) {
            component.setDescription(dto.getDescription());
        }

        salaryComponentRepository.save(component);
        return component.getId();
    }

    @Transactional(readOnly = true)
    public List<SalaryComponentDTO> getComponents(String instituteId) {
        List<SalaryComponent> components = salaryComponentRepository
                .findByInstituteIdOrderByDisplayOrderAsc(instituteId);

        return components.stream()
                .map(this::toDTO)
                .collect(Collectors.toList());
    }

    public SalaryComponentDTO toDTO(SalaryComponent component) {
        return SalaryComponentDTO.builder()
                .id(component.getId())
                .instituteId(component.getInstituteId())
                .name(component.getName())
                .code(component.getCode())
                .type(component.getType())
                .category(component.getCategory())
                .isTaxable(component.getIsTaxable())
                .isStatutory(component.getIsStatutory())
                .isActive(component.getIsActive())
                .displayOrder(component.getDisplayOrder())
                .description(component.getDescription())
                .build();
    }
}
