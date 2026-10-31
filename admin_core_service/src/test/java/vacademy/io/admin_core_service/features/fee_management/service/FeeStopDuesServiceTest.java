package vacademy.io.admin_core_service.features.fee_management.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.admission_package.entity.AdmissionPackageCourse;
import vacademy.io.admin_core_service.features.admission_package.repository.AdmissionPackageCourseRepository;
import vacademy.io.admin_core_service.features.fee_management.dto.StopDuesRequestDTO;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.learner_management.service.BulkDeassignmentService;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Stop dues on one course: which installments it reaches, and when it is refused. */
class FeeStopDuesServiceTest {

    private final StudentFeePaymentRepository bills = mock(StudentFeePaymentRepository.class);
    private final FeeBillCancellationService cancellations = mock(FeeBillCancellationService.class);
    private final UserPlanRepository plans = mock(UserPlanRepository.class);
    private final AdmissionPackageCourseRepository packageCourses = mock(AdmissionPackageCourseRepository.class);
    private final BulkDeassignmentService deassign = mock(BulkDeassignmentService.class);
    private final FeeStopDuesService service = new FeeStopDuesService(bills, cancellations, plans,
            mock(StudentSessionRepository.class), deassign, packageCourses);

    private static StudentFeePayment bill(String id, String due, String status) {
        StudentFeePayment b = new StudentFeePayment();
        b.setId(id);
        b.setUserId("u1");
        b.setUserPlanId("plan");
        b.setDueDate(java.sql.Date.valueOf(due));
        b.setAmountExpected(new BigDecimal("10000"));
        b.setAmountPaid(BigDecimal.ZERO);
        b.setStatus(status);
        return b;
    }

    @Test
    @DisplayName("'and later' stops the open installments from this one on; earlier and paid ones stay")
    @SuppressWarnings("unchecked")
    void stopsThisAndLater() {
        StudentFeePayment first = bill("i1", "2026-10-01", "PAID");
        StudentFeePayment second = bill("i2", "2026-11-01", "OVERDUE");
        StudentFeePayment third = bill("i3", "2026-12-01", "PENDING");
        StudentFeePayment fourth = bill("i4", "2027-01-01", "PENDING");
        when(bills.findById("i3")).thenReturn(Optional.of(third));
        when(bills.findByUserPlanId("plan")).thenReturn(List.of(fourth, first, third, second));
        when(cancellations.stopDues(anyList(), anyString(), anyString())).thenReturn(2);

        service.stopForInstallment("i3", StopDuesRequestDTO.builder().includeLater(true).reason("Left").build(),
                "inst", "admin");

        ArgumentCaptor<List<StudentFeePayment>> stopped = ArgumentCaptor.forClass(List.class);
        verify(cancellations).stopDues(stopped.capture(), eq("Left"), eq("admin"));
        assertEquals(List.of("i3", "i4"), stopped.getValue().stream().map(StudentFeePayment::getId).toList());
        verify(deassign, never()).bulkDeassign(any(), any());
    }

    @Test
    @DisplayName("needs a reason, refuses a package course, and will not reopen once the learner is removed")
    void guards() {
        StudentFeePayment open = bill("i1", "2026-11-01", "PENDING");
        when(bills.findById("i1")).thenReturn(Optional.of(open));
        assertThrows(VacademyException.class, () ->
                service.stopForInstallment("i1", StopDuesRequestDTO.builder().reason(" ").build(), "inst", "a"));

        when(packageCourses.findByUserPlanId("plan")).thenReturn(Optional.of(new AdmissionPackageCourse()));
        assertThrows(VacademyException.class, () ->
                service.stopForInstallment("i1", StopDuesRequestDTO.builder().reason("Left").build(), "inst", "a"));

        UserPlan removed = new UserPlan();
        removed.setStatus("TERMINATED");
        when(plans.findById("plan")).thenReturn(Optional.of(removed));
        assertThrows(VacademyException.class, () -> service.reopen(List.of(bill("i2", "2026-11-01", "CANCELLED")), "a"));
        verify(cancellations, never()).stopDues(anyList(), anyString(), anyString());
        verify(cancellations, never()).reopen(anyList(), anyString());
    }
}
