package vacademy.io.admin_core_service.features.admission_package.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.admission_package.repository.AdmissionPackageCourseRepository;
import vacademy.io.admin_core_service.features.admission_package.repository.AdmissionPackageRepository;
import vacademy.io.admin_core_service.features.fee_management.dto.InstallmentScheduleDTO;
import vacademy.io.admin_core_service.features.fee_management.service.InstallmentScheduleService;
import vacademy.io.admin_core_service.features.learner_management.dto.AdmissionPackageDTO;
import vacademy.io.admin_core_service.features.learner_management.dto.AssignmentItemDTO;
import vacademy.io.admin_core_service.features.learner_management.dto.CpoEnrollmentConfigDTO;
import vacademy.io.admin_core_service.features.learner_management.service.DefaultInviteResolver;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AdmissionPackageServiceTest {

    private static DefaultInviteResolver.ResolvedConfig cpo(String cpoId) {
        PaymentOption po = new PaymentOption();
        po.setType("CPO");
        po.setComplexPaymentOptionId(cpoId);
        return new DefaultInviteResolver.ResolvedConfig(null, po, null, null, null, false);
    }

    private static DefaultInviteResolver.ResolvedConfig oneTime(double price) {
        PaymentOption po = new PaymentOption();
        po.setType("ONE_TIME");
        PaymentPlan plan = new PaymentPlan();
        plan.setActualPrice(price);
        return new DefaultInviteResolver.ResolvedConfig(null, po, plan, null, null, false);
    }

    private static AssignmentItemDTO course(String ps) {
        AssignmentItemDTO a = new AssignmentItemDTO();
        a.setPackageSessionId(ps);
        return a;
    }

    private static InstallmentScheduleDTO.RowDTO row(String date, String amount, String off) {
        return InstallmentScheduleDTO.RowDTO.builder().dueDate(LocalDate.parse(date))
                .amount(new BigDecimal(amount)).discount(new BigDecimal(off)).build();
    }

    @Test
    @DisplayName("each course gets its share as cpo_config: rows, discount name, payment at admission")
    void writesPerCourseConfig() {
        InstallmentScheduleService schedules = mock(InstallmentScheduleService.class);
        when(schedules.packageFee(eq("cpo-diploma"), any())).thenReturn(new BigDecimal("55000"));
        AdmissionPackageService svc = new AdmissionPackageService(schedules,
                mock(AdmissionPackageRepository.class), mock(AdmissionPackageCourseRepository.class));
        List<AssignmentItemDTO> courses = List.of(course("ps-diploma"), course("ps-bwssc"));
        AdmissionPackageDTO pkg = AdmissionPackageDTO.builder()
                .rows(List.of(row("2026-10-17", "5000", "0"), row("2026-10-19", "30000", "5000"),
                        row("2026-11-02", "30000", "5000")))
                .paymentMode("OFFLINE").paymentAmount(5000d).paymentReference("UPI-1")
                .build();

        AdmissionPackageService.Plan plan = svc.prepare(courses, List.of(cpo("cpo-diploma"), oneTime(10000)), pkg);

        CpoEnrollmentConfigDTO diploma = courses.get(0).getCpoConfig();
        CpoEnrollmentConfigDTO addOn = courses.get(1).getCpoConfig();
        assertEquals(3, diploma.getInstallmentSchedule().getRows().size());
        assertEquals("OFFLINE", diploma.getPaymentMode());
        assertEquals(4231d, diploma.getPaymentAmount());
        assertEquals(769d, addOn.getPaymentAmount());
        assertEquals("UPI-1", addOn.getPaymentReference());
        assertEquals(8462d, diploma.getCpoDiscount().getValue());
        assertEquals(0, new BigDecimal("55000").compareTo(plan.preview().getNetTotal()));
        assertEquals(0, new BigDecimal("5000").compareTo(plan.preview().getPaidAtAdmission()));
    }

    @Test
    @DisplayName("refuses a course that brings its own discount or schedule, and free courses")
    void guards() {
        InstallmentScheduleService schedules = mock(InstallmentScheduleService.class);
        AdmissionPackageService svc = new AdmissionPackageService(schedules,
                mock(AdmissionPackageRepository.class), mock(AdmissionPackageCourseRepository.class));
        AdmissionPackageDTO pkg = AdmissionPackageDTO.builder()
                .rows(List.of(row("2026-10-17", "20000", "0"))).build();
        AssignmentItemDTO own = course("a");
        own.setCpoConfig(CpoEnrollmentConfigDTO.builder().build());
        assertThrows(VacademyException.class, () -> svc.prepare(List.of(own, course("b")),
                List.of(oneTime(10000), oneTime(10000)), pkg));
        assertThrows(VacademyException.class, () -> svc.prepare(List.of(course("a"), course("b")),
                List.of(oneTime(10000), oneTime(0)), pkg));
        assertThrows(VacademyException.class, () -> svc.prepare(List.of(course("a")),
                List.of(oneTime(10000)), pkg));
        // No payment at admission: every course is SKIP with no amount.
        List<AssignmentItemDTO> two = List.of(course("a"), course("b"));
        svc.prepare(two, List.of(oneTime(10000), oneTime(10000)), pkg);
        assertEquals("SKIP", two.get(0).getCpoConfig().getPaymentMode());
        assertNull(two.get(0).getCpoConfig().getPaymentAmount());
    }
}
