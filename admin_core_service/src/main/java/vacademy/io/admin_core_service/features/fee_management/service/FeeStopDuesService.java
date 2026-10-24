package vacademy.io.admin_core_service.features.fee_management.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.admission_package.repository.AdmissionPackageCourseRepository;
import vacademy.io.admin_core_service.features.fee_management.dto.StopDuesRequestDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.StopDuesResultDTO;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.learner_management.dto.BulkDeassignRequestDTO;
import vacademy.io.admin_core_service.features.learner_management.dto.BulkDeassignResponseDTO;
import vacademy.io.admin_core_service.features.learner_management.dto.DeassignOptionsDTO;
import vacademy.io.admin_core_service.features.learner_management.service.BulkDeassignmentService;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Stop dues on a learner who dropped out or stopped paying: an installment, or it and every later
 * one, stops being owed (cancelled, see {@link FeeBillCancellationService#stopDues}) so it is no
 * longer due, overdue or reminded; optionally the learner is also removed from the course. Reopen
 * undoes a stop while the learner is still enrolled. A course of an admission package is stopped on
 * the package, so its courses stay on one schedule.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FeeStopDuesService {

    private final StudentFeePaymentRepository studentFeePaymentRepository;
    private final FeeBillCancellationService feeBillCancellationService;
    private final UserPlanRepository userPlanRepository;
    private final StudentSessionRepository studentSessionRepository;
    private final BulkDeassignmentService bulkDeassignmentService;
    private final AdmissionPackageCourseRepository admissionPackageCourseRepository;

    public StudentFeePayment bill(String sfpId) {
        return studentFeePaymentRepository.findById(sfpId)
                .orElseThrow(() -> new VacademyException("Installment not found: " + sfpId));
    }

    /** Stop dues from one installment of a course (not part of a package). */
    public StopDuesResultDTO stopForInstallment(String sfpId, StopDuesRequestDTO req, String instituteId,
                                                String adminUserId) {
        StudentFeePayment bill = bill(sfpId);
        refusePackageCourse(bill.getUserPlanId());
        List<StudentFeePayment> bills = req.isIncludeLater()
                ? onAndAfter(studentFeePaymentRepository.findByUserPlanId(bill.getUserPlanId()), dueOf(bill))
                : List.of(bill);
        return stop(bills, req, bill.getUserId(), instituteId, List.of(bill.getUserPlanId()), adminUserId);
    }

    /** Reopens what one Stop dues on this course stopped together with {@code sfpId}. */
    public StopDuesResultDTO reopenForInstallment(String sfpId, String adminUserId) {
        StudentFeePayment bill = bill(sfpId);
        refusePackageCourse(bill.getUserPlanId());
        return reopen(feeBillCancellationService.stoppedWith(bill), adminUserId);
    }

    /**
     * Stops the open ones of {@code bills}, then — when asked — removes the learner from the
     * courses of {@code userPlanIds}. The removal runs after the stop is saved: a course that
     * cannot be removed is reported, and its dues stay stopped.
     */
    public StopDuesResultDTO stop(List<StudentFeePayment> bills, StopDuesRequestDTO req, String userId,
                                  String instituteId, Collection<String> userPlanIds, String adminUserId) {
        if (req == null || !StringUtils.hasText(req.getReason())) {
            throw new VacademyException("Say why the dues are stopped");
        }
        List<StudentFeePayment> open = bills.stream().filter(FeeBillCancellationService::isOpen).toList();
        if (open.isEmpty() && !req.isRemoveFromCourse()) {
            throw new VacademyException("Nothing is owed on this installment");
        }
        int stopped = open.isEmpty() ? 0 : feeBillCancellationService.stopDues(open, req.getReason(), adminUserId);
        StopDuesResultDTO result = StopDuesResultDTO.builder().stopped(stopped).removalErrors(new ArrayList<>()).build();
        if (req.isRemoveFromCourse()) {
            removeFromCourses(userId, instituteId, userPlanIds, req.getReason(), adminUserId, result);
        }
        return result;
    }

    /** Reopens stopped bills, while the learner is still enrolled in their course. */
    public StopDuesResultDTO reopen(List<StudentFeePayment> bills, String adminUserId) {
        if (bills.isEmpty()) {
            throw new VacademyException("Nothing was stopped here to reopen");
        }
        for (String planId : bills.stream().map(StudentFeePayment::getUserPlanId).distinct().toList()) {
            UserPlan plan = planId == null ? null : userPlanRepository.findById(planId).orElse(null);
            if (plan != null && ("TERMINATED".equalsIgnoreCase(plan.getStatus())
                    || "CANCELED".equalsIgnoreCase(plan.getStatus()))) {
                throw new VacademyException("The learner was removed from this course, so its dues cannot be "
                        + "reopened. Enrol them again to charge for it.");
            }
        }
        return StopDuesResultDTO.builder()
                .reopened(feeBillCancellationService.reopen(bills, adminUserId))
                .removalErrors(List.of())
                .build();
    }

    /** The bills due on or after {@code from} (all of them when it is null), earliest first. */
    public static List<StudentFeePayment> onAndAfter(List<StudentFeePayment> bills, LocalDate from) {
        return bills.stream()
                .filter(b -> from == null || dueOf(b) == null || !dueOf(b).isBefore(from))
                .sorted(Comparator.comparing(FeeStopDuesService::dueOf,
                        Comparator.nullsLast(Comparator.naturalOrder())))
                .toList();
    }

    public static LocalDate dueOf(StudentFeePayment bill) {
        return bill.getDueDate() == null ? null : new java.sql.Date(bill.getDueDate().getTime()).toLocalDate();
    }

    private void refusePackageCourse(String userPlanId) {
        if (userPlanId != null && admissionPackageCourseRepository.findByUserPlanId(userPlanId).isPresent()) {
            throw new VacademyException("This course is part of an admission package: stop or reopen its "
                    + "dues on the package, so all its courses stay on one schedule");
        }
    }

    /** Hard-terminates the learner from each course, as Remove from Course → Hard terminate does. */
    private void removeFromCourses(String userId, String instituteId, Collection<String> userPlanIds, String reason,
                                   String adminUserId, StopDuesResultDTO result) {
        Set<String> sessions = new LinkedHashSet<>();
        for (String planId : userPlanIds) {
            for (StudentSessionInstituteGroupMapping m :
                    studentSessionRepository.findAllByUserPlanIdAndStatusIn(planId, List.of("ACTIVE"))) {
                if (m.getPackageSession() != null) sessions.add(m.getPackageSession().getId());
            }
        }
        if (sessions.isEmpty()) {
            result.getRemovalErrors().add("The learner is not enrolled in the course any more");
            return;
        }
        BulkDeassignRequestDTO request = BulkDeassignRequestDTO.builder()
                .instituteId(instituteId)
                .userIds(List.of(userId))
                .packageSessionIds(new ArrayList<>(sessions))
                .options(DeassignOptionsDTO.builder().mode("HARD").reason(reason).build())
                .build();
        BulkDeassignResponseDTO response = bulkDeassignmentService.bulkDeassign(request, adminUserId);
        for (BulkDeassignResponseDTO.DeassignResultItemDTO item : response.getResults()) {
            if ("SUCCESS".equals(item.getStatus())) {
                result.setRemovedFromCourses(result.getRemovedFromCourses() + 1);
            } else {
                result.getRemovalErrors().add(item.getMessage() != null ? item.getMessage() : item.getStatus());
            }
        }
        log.info("Stop dues removed user {} from {} of {} course(s)", userId, result.getRemovedFromCourses(),
                sessions.size());
    }
}
