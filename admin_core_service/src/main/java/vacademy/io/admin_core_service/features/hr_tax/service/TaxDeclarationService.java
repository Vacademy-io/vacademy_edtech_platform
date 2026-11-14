package vacademy.io.admin_core_service.features.hr_tax.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_tax.dto.TaxDeclarationDTO;
import vacademy.io.admin_core_service.features.hr_tax.entity.TaxDeclaration;
import vacademy.io.admin_core_service.features.hr_tax.enums.DeclarationStatus;
import vacademy.io.admin_core_service.features.hr_tax.repository.TaxDeclarationRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.time.LocalDateTime;
import java.util.Optional;

@Service
public class TaxDeclarationService {

    @Autowired
    private TaxDeclarationRepository taxDeclarationRepository;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    /**
     * The employee is the one already resolved and institute/self-checked by
     * {@link HrAccessGuard#requireSelfOrHrStaff} in the controller — never
     * re-fetched here from an unchecked dto id.
     */
    @Transactional
    public String submitDeclaration(TaxDeclarationDTO dto, EmployeeProfile employee) {
        // Check if a declaration already exists for this employee and FY
        Optional<TaxDeclaration> existingOpt = taxDeclarationRepository
                .findByEmployee_IdAndFinancialYear(employee.getId(), dto.getFinancialYear());

        if (existingOpt.isPresent()) {
            throw new VacademyException("Tax declaration already exists for this employee and financial year. Use update instead.");
        }

        TaxDeclaration declaration = new TaxDeclaration();
        declaration.setEmployee(employee);
        declaration.setFinancialYear(dto.getFinancialYear());
        declaration.setRegime(dto.getRegime());
        declaration.setDeclarations(dto.getDeclarations());
        declaration.setProofSubmitted(dto.getProofSubmitted() != null ? dto.getProofSubmitted() : false);
        declaration.setProofVerified(false);
        declaration.setStatus(DeclarationStatus.SUBMITTED.name());

        declaration = taxDeclarationRepository.save(declaration);
        return declaration.getId();
    }

    @Transactional
    public String updateDeclaration(String id, TaxDeclarationDTO dto, String instituteId, CustomUserDetails user) {
        TaxDeclaration declaration = taxDeclarationRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Tax declaration not found"));

        // Owning employee is only known after the load: verify it belongs to the
        // validated institute and the caller is HR staff or IS that employee.
        hrAccessGuard.requireSelfOrHrStaff(user, instituteId, declaration.getEmployee().getId());

        // Only allow updates if status is DRAFT or SUBMITTED
        String status = declaration.getStatus();
        if (DeclarationStatus.VERIFIED.name().equals(status) || DeclarationStatus.LOCKED.name().equals(status)) {
            throw new VacademyException("Cannot update a " + status + " declaration");
        }

        if (dto.getRegime() != null) {
            declaration.setRegime(dto.getRegime());
        }
        if (dto.getDeclarations() != null) {
            declaration.setDeclarations(dto.getDeclarations());
        }
        if (dto.getProofSubmitted() != null) {
            declaration.setProofSubmitted(dto.getProofSubmitted());
        }

        taxDeclarationRepository.save(declaration);
        return declaration.getId();
    }

    @Transactional(readOnly = true)
    public TaxDeclarationDTO getDeclaration(String employeeId, String financialYear) {
        TaxDeclaration declaration = taxDeclarationRepository
                .findByEmployee_IdAndFinancialYear(employeeId, financialYear)
                .orElseThrow(() -> new VacademyException("Tax declaration not found for employee in FY: " + financialYear));

        return toDTO(declaration);
    }

    @Transactional
    public String verifyDeclaration(String id, String instituteId, String verifierUserId) {
        TaxDeclaration declaration = taxDeclarationRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Tax declaration not found"));
        hrAccessGuard.requireInstituteMatch(
                declaration.getEmployee().getInstituteId(), instituteId, "Tax declaration");

        if (!DeclarationStatus.SUBMITTED.name().equals(declaration.getStatus())) {
            throw new VacademyException("Only SUBMITTED declarations can be verified. Current status: " + declaration.getStatus());
        }

        declaration.setStatus(DeclarationStatus.VERIFIED.name());
        declaration.setProofVerified(true);
        declaration.setVerifiedBy(verifierUserId);
        declaration.setVerifiedAt(LocalDateTime.now());

        taxDeclarationRepository.save(declaration);
        return declaration.getId();
    }

    private TaxDeclarationDTO toDTO(TaxDeclaration d) {
        return TaxDeclarationDTO.builder()
                .id(d.getId())
                .employeeId(d.getEmployee().getId())
                .financialYear(d.getFinancialYear())
                .regime(d.getRegime())
                .declarations(d.getDeclarations())
                .proofSubmitted(d.getProofSubmitted())
                .proofVerified(d.getProofVerified())
                .status(d.getStatus())
                .build();
    }
}
