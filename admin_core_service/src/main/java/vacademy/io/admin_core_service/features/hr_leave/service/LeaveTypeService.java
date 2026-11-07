package vacademy.io.admin_core_service.features.hr_leave.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.hr_leave.dto.LeaveTypeDTO;
import vacademy.io.admin_core_service.features.hr_leave.entity.LeaveType;
import vacademy.io.admin_core_service.features.hr_leave.repository.LeaveTypeRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.stream.Collectors;

@Service
public class LeaveTypeService {

    @Autowired
    private LeaveTypeRepository leaveTypeRepository;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @Transactional
    public String createLeaveType(LeaveTypeDTO dto, String instituteId, CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        if (!StringUtils.hasText(dto.getName())) {
            throw new VacademyException("Leave type name is required");
        }
        if (!StringUtils.hasText(dto.getCode())) {
            throw new VacademyException("Leave type code is required");
        }
        if (leaveTypeRepository.existsByInstituteIdAndCode(instituteId, dto.getCode())) {
            throw new VacademyException("Leave type code already exists for this institute");
        }

        LeaveType leaveType = new LeaveType();
        leaveType.setInstituteId(instituteId);
        leaveType.setName(dto.getName());
        leaveType.setCode(dto.getCode());
        leaveType.setIsPaid(dto.getIsPaid() != null ? dto.getIsPaid() : true);
        leaveType.setIsCarryForward(dto.getIsCarryForward() != null ? dto.getIsCarryForward() : false);
        leaveType.setMaxCarryForward(dto.getMaxCarryForward());
        leaveType.setIsEncashable(dto.getIsEncashable() != null ? dto.getIsEncashable() : false);
        leaveType.setRequiresDocument(dto.getRequiresDocument() != null ? dto.getRequiresDocument() : false);
        leaveType.setMinDays(dto.getMinDays());
        leaveType.setMaxConsecutiveDays(dto.getMaxConsecutiveDays());
        leaveType.setApplicableGender(dto.getApplicableGender());
        leaveType.setDescription(dto.getDescription());
        leaveType.setStatus(StringUtils.hasText(dto.getStatus()) ? dto.getStatus() : "ACTIVE");

        leaveType = leaveTypeRepository.save(leaveType);
        return leaveType.getId();
    }

    @Transactional
    public String updateLeaveType(String id, LeaveTypeDTO dto, String instituteId, CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);

        LeaveType leaveType = leaveTypeRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Leave type not found"));
        hrAccessGuard.requireInstituteMatch(leaveType.getInstituteId(), instituteId, "Leave type");

        if (StringUtils.hasText(dto.getName())) {
            leaveType.setName(dto.getName());
        }
        if (dto.getCode() != null) {
            // Check if code is being changed and the new code already exists
            if (!dto.getCode().equals(leaveType.getCode())
                    && leaveTypeRepository.existsByInstituteIdAndCode(leaveType.getInstituteId(), dto.getCode())) {
                throw new VacademyException("Leave type code already exists for this institute");
            }
            leaveType.setCode(dto.getCode());
        }
        if (dto.getIsPaid() != null) {
            leaveType.setIsPaid(dto.getIsPaid());
        }
        if (dto.getIsCarryForward() != null) {
            leaveType.setIsCarryForward(dto.getIsCarryForward());
        }
        if (dto.getMaxCarryForward() != null) {
            leaveType.setMaxCarryForward(dto.getMaxCarryForward());
        }
        if (dto.getIsEncashable() != null) {
            leaveType.setIsEncashable(dto.getIsEncashable());
        }
        if (dto.getRequiresDocument() != null) {
            leaveType.setRequiresDocument(dto.getRequiresDocument());
        }
        if (dto.getMinDays() != null) {
            leaveType.setMinDays(dto.getMinDays());
        }
        if (dto.getMaxConsecutiveDays() != null) {
            leaveType.setMaxConsecutiveDays(dto.getMaxConsecutiveDays());
        }
        if (dto.getApplicableGender() != null) {
            leaveType.setApplicableGender(dto.getApplicableGender());
        }
        if (dto.getDescription() != null) {
            leaveType.setDescription(dto.getDescription());
        }
        if (StringUtils.hasText(dto.getStatus())) {
            leaveType.setStatus(dto.getStatus());
        }

        leaveTypeRepository.save(leaveType);
        return leaveType.getId();
    }

    @Transactional(readOnly = true)
    public List<LeaveTypeDTO> getLeaveTypes(String instituteId, CustomUserDetails user) {
        hrAccessGuard.validateMember(user, instituteId);
        List<LeaveType> leaveTypes = leaveTypeRepository.findByInstituteIdOrderByNameAsc(instituteId);
        return leaveTypes.stream()
                .map(this::toDTO)
                .collect(Collectors.toList());
    }

    private LeaveTypeDTO toDTO(LeaveType entity) {
        return LeaveTypeDTO.builder()
                .id(entity.getId())
                .instituteId(entity.getInstituteId())
                .name(entity.getName())
                .code(entity.getCode())
                .isPaid(entity.getIsPaid())
                .isCarryForward(entity.getIsCarryForward())
                .maxCarryForward(entity.getMaxCarryForward())
                .isEncashable(entity.getIsEncashable())
                .requiresDocument(entity.getRequiresDocument())
                .minDays(entity.getMinDays())
                .maxConsecutiveDays(entity.getMaxConsecutiveDays())
                .applicableGender(entity.getApplicableGender())
                .description(entity.getDescription())
                .status(entity.getStatus())
                .build();
    }
}
