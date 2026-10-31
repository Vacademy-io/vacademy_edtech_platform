package vacademy.io.admin_core_service.features.hr_employee.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.hr_employee.dto.DesignationDTO;
import vacademy.io.admin_core_service.features.hr_employee.entity.Designation;
import vacademy.io.admin_core_service.features.hr_employee.repository.DesignationRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.stream.Collectors;

@Service
public class DesignationService {

    @Autowired
    private DesignationRepository designationRepository;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @Transactional
    public String addDesignation(DesignationDTO dto, String instituteId) {
        if (!StringUtils.hasText(dto.getName())) {
            throw new VacademyException("Designation name is required");
        }

        if (StringUtils.hasText(dto.getCode()) && designationRepository.existsByInstituteIdAndCode(instituteId, dto.getCode())) {
            throw new VacademyException("Designation code already exists for this institute");
        }

        Designation designation = new Designation();
        designation.setInstituteId(instituteId);
        designation.setName(dto.getName());
        designation.setCode(dto.getCode());
        designation.setLevel(dto.getLevel());
        designation.setGrade(dto.getGrade());
        designation.setDescription(dto.getDescription());
        designation.setStatus(StringUtils.hasText(dto.getStatus()) ? dto.getStatus() : "ACTIVE");

        designation = designationRepository.save(designation);
        return designation.getId();
    }

    @Transactional
    public String updateDesignation(String id, DesignationDTO dto, String instituteId) {
        Designation designation = designationRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Designation not found"));
        hrAccessGuard.requireInstituteMatch(designation.getInstituteId(), instituteId, "Designation");

        if (StringUtils.hasText(dto.getName())) {
            designation.setName(dto.getName());
        }
        if (dto.getCode() != null) {
            designation.setCode(dto.getCode());
        }
        if (dto.getLevel() != null) {
            designation.setLevel(dto.getLevel());
        }
        if (dto.getGrade() != null) {
            designation.setGrade(dto.getGrade());
        }
        if (dto.getDescription() != null) {
            designation.setDescription(dto.getDescription());
        }
        if (StringUtils.hasText(dto.getStatus())) {
            designation.setStatus(dto.getStatus());
        }

        designationRepository.save(designation);
        return designation.getId();
    }

    @Transactional(readOnly = true)
    public List<DesignationDTO> getDesignations(String instituteId) {
        List<Designation> designations = designationRepository.findByInstituteIdOrderByLevelAscNameAsc(instituteId);

        return designations.stream()
                .map(this::toDTO)
                .collect(Collectors.toList());
    }

    private DesignationDTO toDTO(Designation designation) {
        return DesignationDTO.builder()
                .id(designation.getId())
                .name(designation.getName())
                .code(designation.getCode())
                .level(designation.getLevel())
                .grade(designation.getGrade())
                .description(designation.getDescription())
                .status(designation.getStatus())
                .build();
    }
}
