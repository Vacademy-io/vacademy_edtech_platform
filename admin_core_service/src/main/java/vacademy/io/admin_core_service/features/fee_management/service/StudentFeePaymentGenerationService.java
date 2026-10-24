package vacademy.io.admin_core_service.features.fee_management.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.fee_management.entity.AftInstallment;
import vacademy.io.admin_core_service.features.fee_management.entity.AssignedFeeValue;
import vacademy.io.admin_core_service.features.fee_management.entity.FeeType;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.repository.AftInstallmentRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.AssignedFeeValueRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.FeeTypeRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.sql.Date;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

@Service
@Slf4j
public class StudentFeePaymentGenerationService {

    @Autowired
    private FeeTypeRepository feeTypeRepository;

    @Autowired
    private AssignedFeeValueRepository assignedFeeValueRepository;

    @Autowired
    private AftInstallmentRepository aftInstallmentRepository;

    @Autowired
    private StudentFeePaymentRepository studentFeePaymentRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.user_account.service.UserAccountLedgerService userAccountLedgerService;

    @Autowired
    private vacademy.io.admin_core_service.features.fee_management.repository.ComplexPaymentOptionRepository complexPaymentOptionRepository;

    @Autowired
    private InstallmentScheduleService installmentScheduleService;

    /**
     * Generates StudentFeePayment rows from the CPO template chain:
     * CPO -> FeeType -> AssignedFeeValue -> AftInstallment
     * 
     * Creates one StudentFeePayment per AftInstallment row.
     *
     * @param userPlanId The student's UserPlan ID
     * @param cpoId      The ComplexPaymentOption ID
     * @param userId     The student's User ID (required for DB NOT NULL constraint)
     * @return List of created StudentFeePayment IDs
     */
    @Transactional
    public List<String> generateFeeBills(String userPlanId, String cpoId, String userId, String instituteId) {
        log.info("Generating fee bills for UserPlan: {}, CPO: {}, User: {}, Institute: {}", userPlanId, cpoId, userId, instituteId);

        // A FLEXIBLE plan has no fixed template: use its default schedule (count and gap
        // from metadata_json.flexible_defaults, first installment due today). Admin
        // enrollments that choose a schedule call InstallmentScheduleService directly.
        vacademy.io.admin_core_service.features.fee_management.entity.ComplexPaymentOption cpo =
                complexPaymentOptionRepository.findById(cpoId).orElse(null);
        if (cpo != null && vacademy.io.admin_core_service.features.fee_management.enums.CpoScheduleMode
                .isFlexible(cpo.getScheduleMode())) {
            log.info("CPO {} is FLEXIBLE; generating bills from its default schedule", cpoId);
            return installmentScheduleService.generateFromSchedule(
                    userPlanId, cpoId, userId, instituteId, null,
                    installmentScheduleService.defaultScheduleFor(cpo, LocalDate.now()));
        }

        // Step 1: Fetch all FeeTypes for this CPO
        List<FeeType> feeTypes = feeTypeRepository.findByCpoId(cpoId);
        if (feeTypes.isEmpty()) {
            throw new VacademyException("No fee types found for CPO: " + cpoId);
        }

        List<String> createdPaymentIds = new ArrayList<>();

        for (FeeType feeType : feeTypes) {
            // Step 2: Fetch AssignedFeeValues for each FeeType
            List<AssignedFeeValue> assignedFeeValues = assignedFeeValueRepository.findByFeeTypeId(feeType.getId());

            for (AssignedFeeValue afv : assignedFeeValues) {
                // Step 3: Fetch AftInstallments for each AssignedFeeValue
                List<AftInstallment> installments = aftInstallmentRepository
                        .findByAssignedFeeValueIdOrderByInstallmentNumberAsc(afv.getId());

                if (installments.isEmpty()) {
                    // If no installments defined, create a single bill for the full amount
                    log.info("No installments defined for AFV: {}. Creating single bill for amount: {}",
                            afv.getId(), afv.getAmount());

                    StudentFeePayment payment = new StudentFeePayment();
                    payment.setUserId(userId);
                    payment.setUserPlanId(userPlanId);
                    payment.setCpoId(cpoId);
                    payment.setAsvId(afv.getId());
                    // No AftInstallment exists for a one-off fee. i_id is a FK to
                    // aft_installments (fk_sfp_installment), so the previous "use the AFV id
                    // as a sentinel" trick could only ever violate it — and since Hibernate
                    // batches these inserts, that one row aborted the entire batch and took
                    // the sibling installment rows down with it. Leave it null (V452 drops
                    // the NOT NULL); asv_id already carries the link to the fee value.
                    payment.setIId(null);
                    payment.setAmountExpected(afv.getAmount());
                    payment.setAmountPaid(BigDecimal.ZERO);
                    // A schedule-less fee is payable from enrollment day. Without a due date
                    // it never enters the "dues now" calculation, so the side-view offers
                    // nothing to collect against and an admin can't record a payment for it.
                    payment.setDueDate(Date.valueOf(LocalDate.now()));
                    payment.setStatus("PENDING");
                    payment.setInstituteId(instituteId);

                    StudentFeePayment saved = studentFeePaymentRepository.save(payment);
                    createdPaymentIds.add(saved.getId());
                    userAccountLedgerService.recordDebitAccrual(
                            userId, instituteId,
                            afv.getAmount(), "INR", null,
                            "STUDENT_FEE_PAYMENT", saved.getId(),
                            null, "Fee bill generated");
                } else {
                    // Step 4: Create one StudentFeePayment per AftInstallment
                    for (AftInstallment installment : installments) {
                        StudentFeePayment payment = new StudentFeePayment();
                        payment.setUserId(userId);
                        payment.setUserPlanId(userPlanId);
                        payment.setCpoId(cpoId);
                        payment.setAsvId(afv.getId());
                        payment.setIId(installment.getId());
                        payment.setAmountExpected(installment.getAmount());
                        payment.setAmountPaid(BigDecimal.ZERO);
                        payment.setDueDate(Date.valueOf(installment.getDueDate()));
                        // Copy start_date from template when present so the side-view's
                        // "Start" column reflects the installment window instead of
                        // being blank. Admins overriding the dates at enrollment time
                        // overwrite this via CpoEnrollmentConfigApplier.
                        if (installment.getStartDate() != null) {
                            payment.setStartDate(Date.valueOf(installment.getStartDate()));
                        }
                        payment.setStatus("PENDING");
                        payment.setInstituteId(instituteId);

                        StudentFeePayment saved = studentFeePaymentRepository.save(payment);
                        createdPaymentIds.add(saved.getId());
                        userAccountLedgerService.recordDebitAccrual(
                                userId, instituteId,
                                installment.getAmount(), "INR",
                                installment.getDueDate(),
                                "STUDENT_FEE_PAYMENT", saved.getId(),
                                null, "Fee installment generated");

                        log.info("Created StudentFeePayment {} for installment #{}, amount: {}, due: {}",
                                saved.getId(), installment.getInstallmentNumber(),
                                installment.getAmount(), installment.getDueDate());
                    }
                }
            }
        }

        log.info("Generated {} fee bills for UserPlan: {}", createdPaymentIds.size(), userPlanId);
        return createdPaymentIds;
    }
}
