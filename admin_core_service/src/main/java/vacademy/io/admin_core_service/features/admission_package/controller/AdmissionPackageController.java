package vacademy.io.admin_core_service.features.admission_package.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.admission_package.dto.AdmissionPackageInstallmentChangeDTO;
import vacademy.io.admin_core_service.features.admission_package.dto.AdmissionPackagePaymentPreviewDTO;
import vacademy.io.admin_core_service.features.admission_package.dto.AdmissionPackageSummaryDTO;
import vacademy.io.admin_core_service.features.admission_package.service.AdmissionPackagePaymentService;
import vacademy.io.admin_core_service.features.fee_management.dto.RecordOfflinePaymentRequestDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.StopDuesRequestDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.StopDuesResultDTO;
import vacademy.io.admin_core_service.features.fee_management.service.FeeAccessGuard;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.util.List;

/**
 * Admission packages in the learner side view: the package totals, a payment recorded against
 * the whole package with one receipt, and changes to a package installment made on every course
 * at once. Staff of the package's institute only.
 */
@RestController
@RequestMapping("/admin-core-service/v1/fee-management")
@RequiredArgsConstructor
public class AdmissionPackageController {

    private final AdmissionPackagePaymentService admissionPackagePaymentService;
    private final FeeAccessGuard feeAccessGuard;

    @GetMapping("/user/{userId}/admission-packages")
    public ResponseEntity<List<AdmissionPackageSummaryDTO>> listForUser(
            @PathVariable String userId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        feeAccessGuard.requireStaff(user, instituteId);
        return ResponseEntity.ok(admissionPackagePaymentService.listForUser(userId, instituteId));
    }

    /** How a payment would be shared between the package's courses. Saves nothing. */
    @PostMapping("/admission-package/{packageId}/record-offline-payment/preview")
    public ResponseEntity<AdmissionPackagePaymentPreviewDTO> previewPayment(
            @PathVariable String packageId,
            @RequestBody RecordOfflinePaymentRequestDTO request,
            @RequestAttribute("user") CustomUserDetails user) {
        feeAccessGuard.requireStaff(user, admissionPackagePaymentService.instituteOf(packageId));
        if (request == null || request.getAmount() == null) {
            throw new VacademyException("Enter an amount");
        }
        return ResponseEntity.ok(admissionPackagePaymentService.previewPayment(
                packageId, BigDecimal.valueOf(request.getAmount())));
    }

    @PostMapping("/admission-package/{packageId}/record-offline-payment")
    @Auditable(
            entityType = "PAYMENT",
            action = "CREATE",
            entityIdExpr = "#packageId",
            descriptionExpr = "'recorded an offline payment of ' + #request?.amount + ' on admission package ' + #packageId")
    public ResponseEntity<AdmissionPackageSummaryDTO> recordPayment(
            @PathVariable String packageId,
            @RequestBody RecordOfflinePaymentRequestDTO request,
            @RequestAttribute("user") CustomUserDetails user) {
        feeAccessGuard.requireStaff(user, admissionPackagePaymentService.instituteOf(packageId));
        return ResponseEntity.ok(admissionPackagePaymentService.recordPayment(
                packageId, request, user != null ? user.getUserId() : null));
    }

    /** Moves a package installment (every course's bill due that day) to a new due date. */
    @PutMapping("/admission-package/{packageId}/installment")
    @Auditable(
            entityType = "FEE_PLAN",
            action = "UPDATE",
            entityIdExpr = "#packageId",
            descriptionExpr = "'moved the ' + #request?.dueDate + ' installment of admission package ' + #packageId + ' to ' + #request?.newDueDate")
    public ResponseEntity<AdmissionPackageSummaryDTO> moveInstallment(
            @PathVariable String packageId,
            @RequestBody AdmissionPackageInstallmentChangeDTO request,
            @RequestAttribute("user") CustomUserDetails user) {
        feeAccessGuard.requireStaff(user, admissionPackagePaymentService.instituteOf(packageId));
        if (request == null) throw new VacademyException("Say which installment to move");
        return ResponseEntity.ok(admissionPackagePaymentService.moveInstallment(
                packageId, request.getDueDate(), request.getNewDueDate(), user != null ? user.getUserId() : null));
    }

    /** Moves part of a package installment's unpaid balance onto a new date, on every course. */
    @PostMapping("/admission-package/{packageId}/installment/split")
    @Auditable(
            entityType = "FEE_PLAN",
            action = "SPLIT",
            entityIdExpr = "#packageId",
            descriptionExpr = "'split ' + #request?.amount + ' of the ' + #request?.dueDate + ' installment of admission package ' + #packageId + ', due ' + #request?.newDueDate")
    public ResponseEntity<AdmissionPackageSummaryDTO> splitInstallment(
            @PathVariable String packageId,
            @RequestBody AdmissionPackageInstallmentChangeDTO request,
            @RequestAttribute("user") CustomUserDetails user) {
        feeAccessGuard.requireStaff(user, admissionPackagePaymentService.instituteOf(packageId));
        if (request == null) throw new VacademyException("Say which installment to split");
        return ResponseEntity.ok(admissionPackagePaymentService.splitInstallment(packageId, request.getDueDate(),
                request.getAmount(), request.getNewDueDate(), user != null ? user.getUserId() : null));
    }

    /** Changes a package installment's amount on every course (the package total moves by the difference). */
    @PutMapping("/admission-package/{packageId}/installment/amount")
    @Auditable(
            entityType = "FEE_PLAN",
            action = "UPDATE",
            entityIdExpr = "#packageId",
            descriptionExpr = "'set the ' + #request?.dueDate + ' installment of admission package ' + #packageId + ' to ' + #request?.amount")
    public ResponseEntity<AdmissionPackageSummaryDTO> setInstallmentAmount(
            @PathVariable String packageId,
            @RequestBody AdmissionPackageInstallmentChangeDTO request,
            @RequestAttribute("user") CustomUserDetails user) {
        feeAccessGuard.requireStaff(user, admissionPackagePaymentService.instituteOf(packageId));
        if (request == null) throw new VacademyException("Say which installment to change");
        return ResponseEntity.ok(admissionPackagePaymentService.setInstallmentAmount(packageId, request.getDueDate(),
                request.getAmount(), user != null ? user.getUserId() : null));
    }

    /**
     * Stop dues from a package installment (or it and every later one) on every course — a learner
     * who dropped out or stopped paying; optionally removes them from the package's courses.
     */
    @PostMapping("/admission-package/{packageId}/installment/stop-dues")
    @Auditable(
            entityType = "FEE_PLAN",
            action = "CANCEL",
            entityIdExpr = "#packageId",
            descriptionExpr = "'stopped dues on the ' + #request?.dueDate + ' installment' + (#request?.includeLater ? ' and later ones' : '')"
                    + " + ' of admission package ' + #packageId + (#request?.removeFromCourse ? ', removed from its courses' : '')"
                    + " + ': ' + #request?.reason")
    public ResponseEntity<StopDuesResultDTO> stopDues(
            @PathVariable String packageId,
            @RequestBody StopDuesRequestDTO request,
            @RequestAttribute("user") CustomUserDetails user) {
        feeAccessGuard.requireStaff(user, admissionPackagePaymentService.instituteOf(packageId));
        return ResponseEntity.ok(admissionPackagePaymentService.stopDues(packageId, request,
                user != null ? user.getUserId() : null));
    }

    /** Reopens what was stopped together with a package installment. */
    @PostMapping("/admission-package/{packageId}/installment/reopen")
    @Auditable(
            entityType = "FEE_PLAN",
            action = "UPDATE",
            entityIdExpr = "#packageId",
            descriptionExpr = "'reopened the stopped dues of the ' + #request?.dueDate + ' installment of admission package ' + #packageId")
    public ResponseEntity<StopDuesResultDTO> reopenDues(
            @PathVariable String packageId,
            @RequestBody AdmissionPackageInstallmentChangeDTO request,
            @RequestAttribute("user") CustomUserDetails user) {
        feeAccessGuard.requireStaff(user, admissionPackagePaymentService.instituteOf(packageId));
        if (request == null) throw new VacademyException("Say which installment to reopen");
        return ResponseEntity.ok(admissionPackagePaymentService.reopenDues(packageId, request.getDueDate(),
                user != null ? user.getUserId() : null));
    }
}
