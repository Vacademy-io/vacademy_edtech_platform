package vacademy.io.admin_core_service.features.hr_employee.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.hr_employee.dto.EmployeeBankDetailDTO;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeBankDetail;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_employee.repository.EmployeeBankDetailRepository;
import vacademy.io.admin_core_service.features.hr_employee.repository.EmployeeProfileRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

@Service
public class EmployeeBankService {

    @Autowired
    private EmployeeBankDetailRepository employeeBankDetailRepository;

    @Autowired
    private EmployeeProfileRepository employeeProfileRepository;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @Transactional
    public String addBankDetail(String employeeId, EmployeeBankDetailDTO dto, String instituteId) {
        EmployeeProfile employee = employeeProfileRepository.findById(employeeId)
                .orElseThrow(() -> new VacademyException("Employee not found"));
        hrAccessGuard.requireInstituteMatch(employee.getInstituteId(), instituteId, "Employee");

        if (!StringUtils.hasText(dto.getAccountNumber())) {
            throw new VacademyException("Account number is required");
        }
        if (dto.getAccountNumber().contains("*")) {
            throw new VacademyException("Account number appears masked; please provide the full account number");
        }

        EmployeeBankDetail bankDetail = new EmployeeBankDetail();
        bankDetail.setEmployee(employee);
        bankDetail.setAccountHolderName(dto.getAccountHolderName());
        bankDetail.setAccountNumber(dto.getAccountNumber());
        bankDetail.setBankName(dto.getBankName());
        bankDetail.setBranchName(dto.getBranchName());
        bankDetail.setIfscCode(dto.getIfscCode());
        bankDetail.setSwiftCode(dto.getSwiftCode());
        bankDetail.setRoutingNumber(dto.getRoutingNumber());
        bankDetail.setIban(dto.getIban());
        bankDetail.setStatus(StringUtils.hasText(dto.getStatus()) ? dto.getStatus() : "ACTIVE");

        // If no existing bank details, default isPrimary to true (first account should be primary)
        List<EmployeeBankDetail> existingBankDetails = employeeBankDetailRepository.findByEmployeeId(employeeId);
        if (existingBankDetails.isEmpty()) {
            bankDetail.setIsPrimary(true);
        } else if (Boolean.TRUE.equals(dto.getIsPrimary())) {
            // If this is marked as primary, unmark any existing primary account
            Optional<EmployeeBankDetail> existingPrimary = employeeBankDetailRepository
                    .findByEmployeeIdAndIsPrimaryTrue(employeeId);
            existingPrimary.ifPresent(existing -> {
                existing.setIsPrimary(false);
                employeeBankDetailRepository.save(existing);
            });
            bankDetail.setIsPrimary(true);
        } else {
            bankDetail.setIsPrimary(false);
        }

        bankDetail = employeeBankDetailRepository.save(bankDetail);
        return bankDetail.getId();
    }

    @Transactional
    public String updateBankDetail(String employeeId, String id, EmployeeBankDetailDTO dto, String instituteId) {
        EmployeeBankDetail bankDetail = employeeBankDetailRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Bank detail not found"));
        hrAccessGuard.requireInstituteMatch(bankDetail.getEmployee().getInstituteId(), instituteId, "Bank detail");
        if (!bankDetail.getEmployee().getId().equals(employeeId)) {
            throw new VacademyException("Bank detail does not belong to this employee");
        }

        if (dto.getAccountHolderName() != null) {
            bankDetail.setAccountHolderName(dto.getAccountHolderName());
        }
        if (StringUtils.hasText(dto.getAccountNumber())) {
            if (dto.getAccountNumber().contains("*")) {
                throw new VacademyException("Account number appears masked; please provide the full account number");
            }
            bankDetail.setAccountNumber(dto.getAccountNumber());
        }
        if (dto.getBankName() != null) {
            bankDetail.setBankName(dto.getBankName());
        }
        if (dto.getBranchName() != null) {
            bankDetail.setBranchName(dto.getBranchName());
        }
        if (dto.getIfscCode() != null) {
            bankDetail.setIfscCode(dto.getIfscCode());
        }
        if (dto.getSwiftCode() != null) {
            bankDetail.setSwiftCode(dto.getSwiftCode());
        }
        if (dto.getRoutingNumber() != null) {
            bankDetail.setRoutingNumber(dto.getRoutingNumber());
        }
        if (dto.getIban() != null) {
            bankDetail.setIban(dto.getIban());
        }
        if (StringUtils.hasText(dto.getStatus())) {
            bankDetail.setStatus(dto.getStatus());
        }

        // Handle primary flag change
        if (dto.getIsPrimary() != null) {
            if (Boolean.TRUE.equals(dto.getIsPrimary()) && !Boolean.TRUE.equals(bankDetail.getIsPrimary())) {
                Optional<EmployeeBankDetail> existingPrimary = employeeBankDetailRepository
                        .findByEmployeeIdAndIsPrimaryTrue(bankDetail.getEmployee().getId());
                existingPrimary.ifPresent(existing -> {
                    if (!existing.getId().equals(id)) {
                        existing.setIsPrimary(false);
                        employeeBankDetailRepository.save(existing);
                    }
                });
            }
            bankDetail.setIsPrimary(dto.getIsPrimary());
        }

        employeeBankDetailRepository.save(bankDetail);
        return bankDetail.getId();
    }

    @Transactional(readOnly = true)
    public List<EmployeeBankDetailDTO> getBankDetails(String employeeId, String instituteId) {
        EmployeeProfile employee = employeeProfileRepository.findById(employeeId)
                .orElseThrow(() -> new VacademyException("Employee not found"));
        hrAccessGuard.requireInstituteMatch(employee.getInstituteId(), instituteId, "Employee");

        List<EmployeeBankDetail> bankDetails = employeeBankDetailRepository.findByEmployeeId(employeeId);

        return bankDetails.stream()
                .map(this::toDTO)
                .collect(Collectors.toList());
    }

    private String maskSensitive(String value) {
        if (value == null || value.length() <= 4) return "****";
        return "****" + value.substring(value.length() - 4);
    }

    private EmployeeBankDetailDTO toDTO(EmployeeBankDetail bankDetail) {
        return EmployeeBankDetailDTO.builder()
                .id(bankDetail.getId())
                .employeeId(bankDetail.getEmployee().getId())
                .accountHolderName(bankDetail.getAccountHolderName())
                .accountNumber(maskSensitive(bankDetail.getAccountNumber()))
                .bankName(bankDetail.getBankName())
                .branchName(bankDetail.getBranchName())
                .ifscCode(bankDetail.getIfscCode())
                .swiftCode(bankDetail.getSwiftCode())
                .routingNumber(bankDetail.getRoutingNumber())
                .iban(bankDetail.getIban())
                .isPrimary(bankDetail.getIsPrimary())
                .status(bankDetail.getStatus())
                .build();
    }
}
