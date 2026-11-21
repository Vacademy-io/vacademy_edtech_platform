package vacademy.io.admin_core_service.features.invoice.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.fee_management.entity.AftInstallment;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.repository.AftInstallmentRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * On-demand "send installment reminder" trigger. Mirrors the context the scheduled
 * job ({@code QueryServiceImpl.getUpcomingFeeInstallments}) builds, so any workflow
 * authored against {@link WorkflowTriggerEvent#INSTALLMENT_DUE_REMINDER} fires the
 * same way regardless of whether it was the cron OR an institute admin clicking the
 * "Remind" button on a single invoice row.
 *
 * <p>Single-SFP scope means the {@code feePaymentList} context key always has exactly
 * one entry. {@code reminderType} is computed from days-to-due ({@code BEFORE_DUE},
 * {@code DUE_TODAY}, {@code OVERDUE}) — same buckets the scheduled job uses, so an
 * existing template that branches on {@code reminderType} keeps working unmodified.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ManualReminderService {

    private final StudentFeePaymentRepository studentFeePaymentRepository;
    private final AftInstallmentRepository aftInstallmentRepository;
    private final AuthService authService;
    private final WorkflowTriggerService workflowTriggerService;

    public Map<String, Object> triggerReminderForSfp(String sfpId, String triggeredByUserId) {
        if (sfpId == null || sfpId.isBlank()) {
            throw new VacademyException("student_fee_payment_id is required");
        }
        StudentFeePayment sfp = studentFeePaymentRepository.findById(sfpId)
                .orElseThrow(() -> new VacademyException("StudentFeePayment not found: " + sfpId));

        if (sfp.getDueDate() == null) {
            throw new VacademyException(
                    "Cannot send a reminder for an installment with no due date");
        }
        String instituteId = sfp.getInstituteId();
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException(
                    "Cannot resolve institute for SFP " + sfpId + "; skipping reminder");
        }

        // Look up student + parent (parent is preferred recipient if linked, same as the cron).
        UserDTO student = null;
        UserDTO parent = null;
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(sfp.getUserId()));
            if (users != null && !users.isEmpty()) student = users.get(0);
        } catch (Exception e) {
            log.warn("[ManualReminder] Could not fetch student for SFP {}: {}", sfpId, e.getMessage());
        }
        if (student != null && student.getLinkedParentId() != null
                && !student.getLinkedParentId().isBlank()) {
            try {
                List<UserDTO> parents = authService
                        .getUsersFromAuthServiceByUserIds(List.of(student.getLinkedParentId()));
                if (parents != null && !parents.isEmpty()) parent = parents.get(0);
            } catch (Exception e) {
                log.warn("[ManualReminder] Could not fetch parent for student {}: {}",
                        student.getId(), e.getMessage());
            }
        }
        UserDTO recipient = parent != null ? parent : student;

        AftInstallment installment = sfp.getIId() != null
                ? aftInstallmentRepository.findById(sfp.getIId()).orElse(null)
                : null;

        LocalDate dueDate = sfp.getDueDate().toInstant().atZone(ZoneId.systemDefault()).toLocalDate();
        LocalDate today = LocalDate.now();
        long daysDiff = ChronoUnit.DAYS.between(today, dueDate);
        String reminderType = resolveReminderType(daysDiff);

        BigDecimal expected = sfp.getAmountExpected() != null ? sfp.getAmountExpected() : BigDecimal.ZERO;
        BigDecimal paid = sfp.getAmountPaid() != null ? sfp.getAmountPaid() : BigDecimal.ZERO;
        BigDecimal remaining = expected.subtract(paid);

        Map<String, Object> item = new LinkedHashMap<>();
        item.put("email", recipient != null && recipient.getEmail() != null
                ? recipient.getEmail()
                : (student != null && student.getEmail() != null ? student.getEmail() : ""));
        item.put("recipientName", recipient != null && recipient.getFullName() != null
                ? recipient.getFullName()
                : (student != null && student.getFullName() != null ? student.getFullName() : ""));
        item.put("studentName", student != null && student.getFullName() != null
                ? student.getFullName() : "");
        item.put("mobileNumber", recipient != null && recipient.getMobileNumber() != null
                ? recipient.getMobileNumber()
                : (student != null && student.getMobileNumber() != null ? student.getMobileNumber() : ""));
        // Bills generated from a learner's installment schedule carry their own number
        // (they have no template installment); template bills fall back to the template's.
        item.put("installmentNumber",
                sfp.getInstallmentNumber() != null ? sfp.getInstallmentNumber()
                        : installment != null && installment.getInstallmentNumber() != null
                                ? installment.getInstallmentNumber() : "");
        item.put("remainingAmount", remaining.toPlainString());
        item.put("amountExpected", expected.toPlainString());
        item.put("amountPaid", paid.toPlainString());
        item.put("dueDate", dueDate.toString());
        item.put("daysDifference", String.valueOf(daysDiff));
        // reminderType: bucket name when in the cron's window, "MANUAL" when outside it
        // (so admins can still re-send even for installments far from due date). Workflow
        // templates that branch on reminderType keep working — they just need to handle MANUAL
        // (or fall through to a default branch).
        item.put("reminderType", reminderType != null ? reminderType : "MANUAL");
        item.put("userId", sfp.getUserId());
        item.put("studentFeePaymentId", sfp.getId());
        item.put("instituteId", instituteId);

        Map<String, Object> ctx = new HashMap<>();
        ctx.put("feePaymentList", List.of(item));
        ctx.put("triggerSource", "MANUAL_ADMIN");
        if (triggeredByUserId != null) ctx.put("triggeredBy", triggeredByUserId);

        log.info("[ManualReminder] Firing INSTALLMENT_DUE_REMINDER for SFP={}, institute={}, recipient={}",
                sfpId, instituteId, item.get("email"));
        Map<String, Object> wfResult = workflowTriggerService.handleTriggerEvents(
                WorkflowTriggerEvent.INSTALLMENT_DUE_REMINDER.name(),
                null, instituteId, ctx);

        Map<String, Object> out = new HashMap<>();
        out.put("student_fee_payment_id", sfpId);
        out.put("reminder_type", item.get("reminderType"));
        out.put("recipient_email", item.get("email"));
        out.put("workflow_result", wfResult);
        return out;
    }

    /** Same bucketing the scheduled fee-reminder job uses. */
    private String resolveReminderType(long daysDiff) {
        if (daysDiff > 7) return "BEFORE_DUE";
        if (daysDiff > 0) return "DUE_SOON";
        if (daysDiff == 0) return "DUE_TODAY";
        return "OVERDUE";
    }
}
