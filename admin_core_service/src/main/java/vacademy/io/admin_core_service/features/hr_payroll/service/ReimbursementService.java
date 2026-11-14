package vacademy.io.admin_core_service.features.hr_payroll.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_employee.service.HrNotificationService;
import vacademy.io.admin_core_service.features.hr_payroll.dto.CreateReimbursementDTO;
import vacademy.io.admin_core_service.features.hr_payroll.dto.ReimbursementActionDTO;
import vacademy.io.admin_core_service.features.hr_payroll.dto.ReimbursementDTO;
import vacademy.io.admin_core_service.features.hr_payroll.entity.Reimbursement;
import vacademy.io.admin_core_service.features.hr_payroll.repository.ReimbursementRepository;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

@lombok.extern.slf4j.Slf4j
@Service
public class ReimbursementService {

    @Autowired
    private ReimbursementRepository reimbursementRepository;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @Autowired
    private HrNotificationService hrNotificationService;

    @Autowired
    private WorkflowTriggerService workflowTriggerService;

    @Transactional
    public String submitReimbursement(CreateReimbursementDTO dto, String instituteId, CustomUserDetails user) {
        // Resolves the employee, verifies it belongs to the validated institute, and
        // lets non-HR callers submit only for their OWN employee record
        EmployeeProfile employee = hrAccessGuard.requireSelfOrHrStaff(user, instituteId, dto.getEmployeeId());

        Reimbursement reimbursement = new Reimbursement();
        reimbursement.setEmployee(employee);
        reimbursement.setInstituteId(instituteId);
        reimbursement.setType(dto.getType());
        reimbursement.setAmount(dto.getAmount());
        reimbursement.setDescription(dto.getDescription());
        reimbursement.setReceiptFileId(dto.getReceiptFileId());
        reimbursement.setExpenseDate(dto.getExpenseDate());
        // Currency defaults to INR unless an explicit 3-letter code is supplied
        reimbursement.setCurrency(normalizeCurrency(dto.getCurrency()));
        reimbursement.setStatus("PENDING");

        reimbursement = reimbursementRepository.save(reimbursement);

        // Phase F5: HR_REIMBURSEMENT_REQUESTED workflow trigger (emit-and-forget —
        // a workflow failure must never break the submission itself)
        try {
            Map<String, Object> contextData = new HashMap<>();
            contextData.put("reimbursementId", reimbursement.getId());
            contextData.put("employeeId", employee.getId());
            contextData.put("employeeUserId", employee.getUserId());
            contextData.put("type", reimbursement.getType());
            contextData.put("amount", reimbursement.getAmount() != null
                    ? reimbursement.getAmount().toPlainString() : null);
            contextData.put("currency", reimbursement.getCurrency());
            contextData.put("expenseDate", reimbursement.getExpenseDate() != null
                    ? reimbursement.getExpenseDate().toString() : null);
            contextData.put("status", reimbursement.getStatus());
            workflowTriggerService.handleTriggerEvents(
                    WorkflowTriggerEvent.HR_REIMBURSEMENT_REQUESTED.name(),
                    reimbursement.getId(),
                    instituteId,
                    contextData);
        } catch (Exception e) {
            log.warn("Failed to trigger HR_REIMBURSEMENT_REQUESTED workflow", e);
        }

        return reimbursement.getId();
    }

    @Transactional(readOnly = true)
    public Page<ReimbursementDTO> getReimbursements(String instituteId, String status,
                                                      String employeeId, int pageNo, int pageSize) {
        Pageable pageable = PageRequest.of(pageNo, pageSize);
        Page<Reimbursement> page = reimbursementRepository.findByFilters(instituteId, status, employeeId, pageable);
        return page.map(this::toDTO);
    }

    @Transactional
    public String approveRejectReimbursement(String id, ReimbursementActionDTO actionDTO, String approverUserId, String instituteId) {
        Reimbursement reimbursement = reimbursementRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Reimbursement not found"));
        hrAccessGuard.requireInstituteMatch(reimbursement.getInstituteId(), instituteId, "Reimbursement");

        // A user must not approve/reject their own reimbursement
        if (approverUserId != null && approverUserId.equals(reimbursement.getEmployee().getUserId())) {
            throw new VacademyException("You cannot action your own reimbursement");
        }

        if (!"PENDING".equals(reimbursement.getStatus())) {
            throw new VacademyException("Only PENDING reimbursements can be actioned. Current status: " + reimbursement.getStatus());
        }

        String action = actionDTO.getAction();
        if ("APPROVED".equalsIgnoreCase(action)) {
            reimbursement.setStatus("APPROVED");
            reimbursement.setApprovedBy(approverUserId);
            reimbursement.setApprovedAt(LocalDateTime.now());
        } else if ("REJECTED".equalsIgnoreCase(action)) {
            reimbursement.setStatus("REJECTED");
            reimbursement.setRejectionReason(actionDTO.getRejectionReason());
        } else {
            throw new VacademyException("Invalid action. Must be APPROVED or REJECTED");
        }

        reimbursementRepository.save(reimbursement);

        // Best-effort employee email on the decision (send failures never break the operation)
        try {
            boolean approved = "APPROVED".equals(reimbursement.getStatus());
            String currency = reimbursement.getCurrency() != null ? reimbursement.getCurrency() : "INR";
            String subject = approved
                    ? "Your reimbursement was approved"
                    : "Your reimbursement was rejected";
            String body = hrNotificationService.buildEmailBody(subject,
                    "Type", reimbursement.getType(),
                    "Amount", reimbursement.getAmount() != null
                            ? currency + " " + reimbursement.getAmount().toPlainString() : null,
                    "Expense date", reimbursement.getExpenseDate() != null
                            ? reimbursement.getExpenseDate().toString() : null,
                    "Status", reimbursement.getStatus(),
                    "Reason", approved ? null : reimbursement.getRejectionReason());
            hrNotificationService.emailEmployee(reimbursement.getEmployee(), subject, body);
        } catch (Exception e) {
            // emailEmployee already swallows send failures; this guards lazy-load surprises
        }

        // Phase F5: HR_REIMBURSEMENT_DECIDED workflow trigger (emit-and-forget —
        // a workflow failure must never break the decision itself)
        try {
            Map<String, Object> contextData = new HashMap<>();
            contextData.put("reimbursementId", reimbursement.getId());
            contextData.put("employeeId", reimbursement.getEmployee().getId());
            contextData.put("employeeUserId", reimbursement.getEmployee().getUserId());
            contextData.put("type", reimbursement.getType());
            contextData.put("amount", reimbursement.getAmount() != null
                    ? reimbursement.getAmount().toPlainString() : null);
            contextData.put("currency", reimbursement.getCurrency());
            contextData.put("expenseDate", reimbursement.getExpenseDate() != null
                    ? reimbursement.getExpenseDate().toString() : null);
            contextData.put("status", reimbursement.getStatus());
            contextData.put("approvedBy", reimbursement.getApprovedBy());
            contextData.put("rejectionReason", reimbursement.getRejectionReason());
            workflowTriggerService.handleTriggerEvents(
                    WorkflowTriggerEvent.HR_REIMBURSEMENT_DECIDED.name(),
                    reimbursement.getId(),
                    instituteId,
                    contextData);
        } catch (Exception e) {
            log.warn("Failed to trigger HR_REIMBURSEMENT_DECIDED workflow", e);
        }

        return reimbursement.getId();
    }

    /** Defaults to INR; validates the 3-letter ISO-4217 shape when provided. */
    private String normalizeCurrency(String currency) {
        if (currency == null || currency.trim().isEmpty()) {
            return "INR";
        }
        String normalized = currency.trim().toUpperCase();
        if (!normalized.matches("[A-Z]{3}")) {
            throw new VacademyException("Invalid currency code: " + currency + ". Expected a 3-letter code like INR or USD.");
        }
        return normalized;
    }

    private ReimbursementDTO toDTO(Reimbursement r) {
        return ReimbursementDTO.builder()
                .id(r.getId())
                .employeeId(r.getEmployee().getId())
                .employeeCode(r.getEmployee().getEmployeeCode())
                .instituteId(r.getInstituteId())
                .type(r.getType())
                .amount(r.getAmount())
                .description(r.getDescription())
                .receiptFileId(r.getReceiptFileId())
                .expenseDate(r.getExpenseDate())
                .status(r.getStatus())
                .approvedBy(r.getApprovedBy())
                .rejectionReason(r.getRejectionReason())
                .currency(r.getCurrency() != null ? r.getCurrency() : "INR")
                .build();
    }
}
