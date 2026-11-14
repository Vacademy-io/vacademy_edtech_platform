package vacademy.io.admin_core_service.features.hr_leave.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.hr_leave.dto.LeavePolicyDTO;
import vacademy.io.admin_core_service.features.hr_leave.entity.LeavePolicy;
import vacademy.io.admin_core_service.features.hr_leave.entity.LeaveType;
import vacademy.io.admin_core_service.features.hr_leave.repository.LeavePolicyRepository;
import vacademy.io.admin_core_service.features.hr_leave.repository.LeaveTypeRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.stream.Collectors;

@Service
public class LeavePolicyService {

    @Autowired
    private LeavePolicyRepository leavePolicyRepository;

    @Autowired
    private LeaveTypeRepository leaveTypeRepository;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @Transactional
    public String createLeavePolicy(LeavePolicyDTO dto, String instituteId, CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        if (!StringUtils.hasText(dto.getLeaveTypeId())) {
            throw new VacademyException("Leave type ID is required");
        }
        if (dto.getAnnualQuota() == null) {
            throw new VacademyException("Annual quota is required");
        }
        if (dto.getEffectiveFrom() == null) {
            throw new VacademyException("Effective from date is required");
        }

        LeaveType leaveType = leaveTypeRepository.findById(dto.getLeaveTypeId())
                .orElseThrow(() -> new VacademyException("Leave type not found"));
        hrAccessGuard.requireInstituteMatch(leaveType.getInstituteId(), instituteId, "Leave type");

        LeavePolicy policy = new LeavePolicy();
        policy.setInstituteId(instituteId);
        policy.setLeaveType(leaveType);
        policy.setAnnualQuota(dto.getAnnualQuota());
        policy.setAccrualType(StringUtils.hasText(dto.getAccrualType()) ? dto.getAccrualType() : "YEARLY");
        policy.setAccrualAmount(dto.getAccrualAmount());
        policy.setProRataEnabled(dto.getProRataEnabled() != null ? dto.getProRataEnabled() : false);
        policy.setApplicableAfterDays(dto.getApplicableAfterDays());
        policy.setApplicableEmploymentTypes(dto.getApplicableEmploymentTypes());
        policy.setEffectiveFrom(dto.getEffectiveFrom());
        policy.setEffectiveTo(dto.getEffectiveTo());
        policy.setStatus(StringUtils.hasText(dto.getStatus()) ? dto.getStatus() : "ACTIVE");

        policy = leavePolicyRepository.save(policy);
        return policy.getId();
    }

    @Transactional
    public String updateLeavePolicy(String id, LeavePolicyDTO dto, String instituteId, CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);

        LeavePolicy policy = leavePolicyRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Leave policy not found"));
        hrAccessGuard.requireInstituteMatch(policy.getInstituteId(), instituteId, "Leave policy");

        if (StringUtils.hasText(dto.getLeaveTypeId())) {
            LeaveType leaveType = leaveTypeRepository.findById(dto.getLeaveTypeId())
                    .orElseThrow(() -> new VacademyException("Leave type not found"));
            hrAccessGuard.requireInstituteMatch(leaveType.getInstituteId(), instituteId, "Leave type");
            policy.setLeaveType(leaveType);
        }
        if (dto.getAnnualQuota() != null) {
            policy.setAnnualQuota(dto.getAnnualQuota());
        }
        if (StringUtils.hasText(dto.getAccrualType())) {
            policy.setAccrualType(dto.getAccrualType());
        }
        if (dto.getAccrualAmount() != null) {
            policy.setAccrualAmount(dto.getAccrualAmount());
        }
        if (dto.getProRataEnabled() != null) {
            policy.setProRataEnabled(dto.getProRataEnabled());
        }
        if (dto.getApplicableAfterDays() != null) {
            policy.setApplicableAfterDays(dto.getApplicableAfterDays());
        }
        if (dto.getApplicableEmploymentTypes() != null) {
            policy.setApplicableEmploymentTypes(dto.getApplicableEmploymentTypes());
        }
        if (dto.getEffectiveFrom() != null) {
            policy.setEffectiveFrom(dto.getEffectiveFrom());
        }
        if (dto.getEffectiveTo() != null) {
            policy.setEffectiveTo(dto.getEffectiveTo());
        }
        if (StringUtils.hasText(dto.getStatus())) {
            policy.setStatus(dto.getStatus());
        }

        leavePolicyRepository.save(policy);
        return policy.getId();
    }

    @Transactional(readOnly = true)
    public List<LeavePolicyDTO> getLeavePolicies(String instituteId, CustomUserDetails user) {
        hrAccessGuard.validateMember(user, instituteId);
        List<LeavePolicy> policies = leavePolicyRepository.findByInstituteIdAndStatus(instituteId, "ACTIVE");
        return policies.stream()
                .map(this::toDTO)
                .collect(Collectors.toList());
    }

    private LeavePolicyDTO toDTO(LeavePolicy entity) {
        return LeavePolicyDTO.builder()
                .id(entity.getId())
                .instituteId(entity.getInstituteId())
                .leaveTypeId(entity.getLeaveType().getId())
                .leaveTypeName(entity.getLeaveType().getName())
                .annualQuota(entity.getAnnualQuota())
                .accrualType(entity.getAccrualType())
                .accrualAmount(entity.getAccrualAmount())
                .proRataEnabled(entity.getProRataEnabled())
                .applicableAfterDays(entity.getApplicableAfterDays())
                .applicableEmploymentTypes(entity.getApplicableEmploymentTypes())
                .effectiveFrom(entity.getEffectiveFrom())
                .effectiveTo(entity.getEffectiveTo())
                .status(entity.getStatus())
                .build();
    }
}
