package vacademy.io.admin_core_service.features.admission_package.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.admission_package.dto.AdmissionPackageSummaryDTO;
import vacademy.io.admin_core_service.features.admission_package.entity.AdmissionPackage;
import vacademy.io.admin_core_service.features.admission_package.entity.AdmissionPackageCourse;
import vacademy.io.admin_core_service.features.admission_package.repository.AdmissionPackageCourseRepository;
import vacademy.io.admin_core_service.features.admission_package.repository.AdmissionPackageRepository;
import vacademy.io.admin_core_service.features.fee_management.dto.RecordOfflinePaymentRequestDTO;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;
import vacademy.io.admin_core_service.features.fee_management.dto.StopDuesRequestDTO;
import vacademy.io.admin_core_service.features.fee_management.repository.FeeBillCancellationRepository;
import vacademy.io.admin_core_service.features.fee_management.service.CpoDiscountService;
import vacademy.io.admin_core_service.features.fee_management.service.FeeBillCancellationService;
import vacademy.io.admin_core_service.features.fee_management.service.FeeStopDuesService;
import vacademy.io.admin_core_service.features.fee_management.service.CpoSideViewService;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AdmissionPackagePaymentServiceTest {

    private final AdmissionPackageRepository packages = mock(AdmissionPackageRepository.class);
    private final AdmissionPackageCourseRepository courses = mock(AdmissionPackageCourseRepository.class);
    private final StudentFeePaymentRepository bills = mock(StudentFeePaymentRepository.class);
    private final UserPlanRepository plans = mock(UserPlanRepository.class);
    private final PackageSessionRepository sessions = mock(PackageSessionRepository.class);
    private final CpoSideViewService sideView = mock(CpoSideViewService.class);
    private final InvoiceService invoices = mock(InvoiceService.class);
    private final CpoDiscountService discounts = mock(CpoDiscountService.class);
    private final FeeStopDuesService stopDues = mock(FeeStopDuesService.class);
    private final FeeBillCancellationService cancellations = mock(FeeBillCancellationService.class);
    private final FeeBillCancellationRepository stops = mock(FeeBillCancellationRepository.class);
    private final AdmissionPackagePaymentService service = new AdmissionPackagePaymentService(
            packages, courses, bills, plans, sessions, sideView, invoices, discounts, stopDues, cancellations, stops);

    private static StudentFeePayment bill(String plan, String due, String expected, String paid, String status) {
        StudentFeePayment b = new StudentFeePayment();
        b.setId(plan + "@" + due);
        b.setUserPlanId(plan);
        b.setDueDate(java.sql.Date.valueOf(due));
        b.setAmountExpected(new BigDecimal(expected));
        b.setAmountPaid(new BigDecimal(paid));
        b.setStatus(status);
        return b;
    }

    private static AdmissionPackageCourse course(String plan, int position) {
        AdmissionPackageCourse c = new AdmissionPackageCourse();
        c.setAdmissionPackageId("pkg");
        c.setUserPlanId(plan);
        c.setPackageSessionId("ps-" + plan);
        c.setPosition(position);
        return c;
    }

    /** Diploma + B&WSSC after the ₹5,000 registration: two package installments left. */
    private void givenPackage() {
        AdmissionPackage pkg = new AdmissionPackage();
        pkg.setId("pkg");
        pkg.setInstituteId("inst");
        pkg.setUserId("learner");
        pkg.setFeeTotal(new BigDecimal("80000"));
        pkg.setDiscountTotal(new BigDecimal("10000"));
        when(packages.findById("pkg")).thenReturn(Optional.of(pkg));
        when(courses.findByAdmissionPackageIdOrderByPositionAsc("pkg"))
                .thenReturn(List.of(course("diploma", 0), course("bwssc", 1)));
        when(bills.findByUserPlanId("diploma")).thenReturn(new ArrayList<>(List.of(
                bill("diploma", "2026-10-25", "3438", "3438", "PAID"),
                bill("diploma", "2026-11-10", "22344", "0", "PENDING"),
                bill("diploma", "2026-12-10", "22343", "0", "PENDING"))));
        when(bills.findByUserPlanId("bwssc")).thenReturn(new ArrayList<>(List.of(
                bill("bwssc", "2026-10-25", "1562", "1562", "PAID"),
                bill("bwssc", "2026-11-10", "10156", "0", "PENDING"),
                bill("bwssc", "2026-12-10", "10157", "0", "PENDING"))));
        when(plans.findById(anyString())).thenReturn(Optional.empty());
        when(sessions.findById(anyString())).thenReturn(Optional.empty());
        when(sideView.recordOfflinePaymentLog(anyString(), any(), any()))
                .thenAnswer(inv -> "log-" + inv.getArgument(0));
    }

    @Test
    @DisplayName("a part-payment is recorded on each course by what it owes, with one receipt")
    void recordsSharesAndOneReceipt() {
        givenPackage();
        RecordOfflinePaymentRequestDTO req = RecordOfflinePaymentRequestDTO.builder()
                .amount(10000d).reference("UTR1").generateInvoice(true).build();

        service.recordPayment("pkg", req, "admin");

        ArgumentCaptor<RecordOfflinePaymentRequestDTO> diploma = ArgumentCaptor.forClass(RecordOfflinePaymentRequestDTO.class);
        ArgumentCaptor<RecordOfflinePaymentRequestDTO> bwssc = ArgumentCaptor.forClass(RecordOfflinePaymentRequestDTO.class);
        verify(sideView).recordOfflinePaymentLog(eq("diploma"), diploma.capture(), eq("admin"));
        verify(sideView).recordOfflinePaymentLog(eq("bwssc"), bwssc.capture(), eq("admin"));
        assertEquals(6875d, diploma.getValue().getAmount());
        assertEquals(3125d, bwssc.getValue().getAmount());
        // No per-course receipts; one for the package.
        assertFalse(diploma.getValue().isGenerateInvoice());
        assertEquals("UTR1", bwssc.getValue().getReference());
        verify(invoices).generateCombinedInvoiceAfterCommit(List.of("log-diploma", "log-bwssc"), "inst");
    }

    @Test
    @DisplayName("summary: package installments add the courses' bills on each date")
    void summary() {
        givenPackage();
        AdmissionPackageSummaryDTO s = service.summary("pkg");
        assertEquals(0, s.getNetTotal().compareTo(new BigDecimal("70000")));
        assertEquals(0, s.getPaidTotal().compareTo(new BigDecimal("5000")));
        assertEquals(0, s.getOutstandingTotal().compareTo(new BigDecimal("65000")));
        assertEquals(3, s.getInstallments().size());
        assertEquals("PAID", s.getInstallments().get(0).getStatus());
        assertEquals(0, s.getNextDueAmount().compareTo(new BigDecimal("32500")));
        assertEquals("2026-11-10", s.getNextDueDate().toString());
    }

    @Test
    @DisplayName("refuses more than is owed, and records nothing")
    void refusesOverpayment() {
        givenPackage();
        RecordOfflinePaymentRequestDTO req = RecordOfflinePaymentRequestDTO.builder().amount(65001d).build();
        assertThrows(VacademyException.class, () -> service.recordPayment("pkg", req, "admin"));
        verify(sideView, never()).recordOfflinePaymentLog(anyString(), any(), any());
    }

    @Test
    @DisplayName("moving a package installment moves every course's bill on that date")
    void movesInstallmentOnEveryCourse() {
        givenPackage();
        LocalDate to = LocalDate.parse("2026-11-20");
        service.moveInstallment("pkg", LocalDate.parse("2026-11-10"), to, "admin");
        verify(discounts).setInstallmentDates("diploma@2026-11-10", null, to, "admin");
        verify(discounts).setInstallmentDates("bwssc@2026-11-10", null, to, "admin");
        verify(discounts, never()).setInstallmentDates(eq("diploma@2026-12-10"), any(), any(), any());
    }

    @Test
    @DisplayName("splitting a package installment moves each course's share of the amount")
    void splitsInstallmentByWhatEachCourseOwes() {
        givenPackage();
        LocalDate to = LocalDate.parse("2026-11-25");
        service.splitInstallment("pkg", LocalDate.parse("2026-11-10"), new BigDecimal("12500"), to, "admin");
        // 22344 + 10156 = 32500 owed; 12500 shared 8594 / 3906.
        verify(discounts).splitInstallment(eq("diploma@2026-11-10"),
                argThat(a -> a.compareTo(new BigDecimal("8594")) == 0), isNull(), eq(to), eq("admin"));
        verify(discounts).splitInstallment(eq("bwssc@2026-11-10"),
                argThat(a -> a.compareTo(new BigDecimal("3906")) == 0), isNull(), eq(to), eq("admin"));
    }

    @Test
    @DisplayName("a split refuses a date with no installment, a paid one, and more than is unpaid")
    void splitGuards() {
        givenPackage();
        LocalDate to = LocalDate.parse("2026-11-25");
        assertThrows(VacademyException.class, () ->
                service.splitInstallment("pkg", LocalDate.parse("2026-11-11"), BigDecimal.TEN, to, "admin"));
        assertThrows(VacademyException.class, () ->
                service.splitInstallment("pkg", LocalDate.parse("2026-10-25"), BigDecimal.TEN, to, "admin"));
        assertThrows(VacademyException.class, () ->
                service.splitInstallment("pkg", LocalDate.parse("2026-11-10"), new BigDecimal("32501"), to, "admin"));
        verify(discounts, never()).splitInstallment(anyString(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("stop dues from a package installment takes every course's bill on it and after")
    @SuppressWarnings("unchecked")
    void stopsDuesFromAnInstallmentOnEveryCourse() {
        givenPackage();
        StopDuesRequestDTO req = StopDuesRequestDTO.builder().dueDate(LocalDate.parse("2026-11-10"))
                .includeLater(true).reason("Dropped out").removeFromCourse(true).build();

        service.stopDues("pkg", req, "admin");

        ArgumentCaptor<List<StudentFeePayment>> picked = ArgumentCaptor.forClass(List.class);
        verify(stopDues).stop(picked.capture(), eq(req), eq("learner"), eq("inst"),
                eq(List.of("diploma", "bwssc")), eq("admin"));
        assertEquals(List.of("diploma@2026-11-10", "diploma@2026-12-10", "bwssc@2026-11-10", "bwssc@2026-12-10"),
                picked.getValue().stream().map(StudentFeePayment::getId).toList());
    }

    @Test
    @DisplayName("a package installment's new amount is shared by what each course still owes on it")
    void setsInstallmentAmountOnEveryCourse() {
        givenPackage();
        // 32500 due on 10 Nov (22344 + 10156) becomes 20000.
        service.setInstallmentAmount("pkg", LocalDate.parse("2026-11-10"), new BigDecimal("20000"), "admin");
        verify(discounts).setInstallmentNetAmount(eq("diploma@2026-11-10"),
                argThat(a -> a.compareTo(new BigDecimal("13750")) == 0), anyString(), eq("admin"));
        verify(discounts).setInstallmentNetAmount(eq("bwssc@2026-11-10"),
                argThat(a -> a.compareTo(new BigDecimal("6250")) == 0), anyString(), eq("admin"));
        assertThrows(VacademyException.class, () ->
                service.setInstallmentAmount("pkg", LocalDate.parse("2026-10-25"), new BigDecimal("4000"), "admin"));
    }
}
