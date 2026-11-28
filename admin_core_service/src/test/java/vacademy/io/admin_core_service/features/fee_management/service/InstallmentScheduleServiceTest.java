package vacademy.io.admin_core_service.features.fee_management.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.fee_management.dto.FlexibleScheduleDefaultsDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.InstallmentScheduleDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.InstallmentSchedulePreviewDTO;
import vacademy.io.admin_core_service.features.fee_management.entity.AssignedFeeValue;
import vacademy.io.admin_core_service.features.fee_management.entity.ComplexPaymentOption;
import vacademy.io.admin_core_service.features.fee_management.entity.FeeType;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.repository.AftInstallmentRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.AssignedFeeValueRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.FeeTypeRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;
import vacademy.io.admin_core_service.features.user_account.service.UserAccountLedgerService;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class InstallmentScheduleServiceTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 10, 14);

    private static InstallmentScheduleService.FeePart split(String id, String amount) {
        return new InstallmentScheduleService.FeePart("ft-" + id, "Fee " + id, false, "afv-" + id,
                new BigDecimal(amount), true);
    }

    private static InstallmentScheduleService.FeePart upfront(String id, String amount) {
        return new InstallmentScheduleService.FeePart("ft-" + id, "Fee " + id, false, "afv-" + id,
                new BigDecimal(amount), false);
    }

    private static InstallmentScheduleDTO rule(int count, String unit, int value, LocalDate first) {
        return InstallmentScheduleDTO.builder()
                .count(count)
                .interval(InstallmentScheduleDTO.IntervalDTO.builder().unit(unit).value(value).build())
                .firstDueDate(first)
                .build();
    }

    private static InstallmentScheduleDTO.RowDTO row(String date, String amount) {
        return InstallmentScheduleDTO.RowDTO.builder()
                .dueDate(LocalDate.parse(date))
                .amount(amount != null ? new BigDecimal(amount) : null)
                .build();
    }

    // ---------------- maths ----------------

    @Test
    @DisplayName("Equal split uses whole units and puts the remainder on installment #1")
    void equalSplitRemainderOnFirst() {
        assertEquals(List.of(new BigDecimal("13334"), new BigDecimal("13333"), new BigDecimal("13333")),
                InstallmentScheduleService.equalSplit(new BigDecimal("40000"), 3));
        List<BigDecimal> fractional = InstallmentScheduleService.equalSplit(new BigDecimal("1000.50"), 2);
        assertEquals(0, fractional.get(0).compareTo(new BigDecimal("500.50")));
        assertEquals(0, fractional.get(1).compareTo(new BigDecimal("500")));
    }

    @Test
    @DisplayName("Every 30 days counts from the first due date")
    void daysInterval() {
        List<LocalDate> dates = InstallmentScheduleService.resolveDueDates(
                rule(4, "DAYS", 30, LocalDate.of(2026, 10, 15)));
        assertEquals(List.of(LocalDate.of(2026, 10, 15), LocalDate.of(2026, 11, 14),
                LocalDate.of(2026, 12, 14), LocalDate.of(2027, 1, 13)), dates);
    }

    @Test
    @DisplayName("Monthly keeps the day of month and clamps short months without drifting")
    void monthsIntervalDoesNotDrift() {
        List<LocalDate> dates = InstallmentScheduleService.resolveDueDates(
                rule(4, "months", 1, LocalDate.of(2026, 1, 31)));
        assertEquals(List.of(LocalDate.of(2026, 1, 31), LocalDate.of(2026, 2, 28),
                LocalDate.of(2026, 3, 31), LocalDate.of(2026, 4, 30)), dates);
    }

    @Test
    @DisplayName("A single installment needs no gap")
    void singleInstallmentNeedsNoInterval() {
        InstallmentScheduleDTO s = InstallmentScheduleDTO.builder().count(1).firstDueDate(TODAY).build();
        assertEquals(List.of(TODAY), InstallmentScheduleService.resolveDueDates(s));
    }

    @Test
    @DisplayName("Rejects bad rules with an admin-readable message")
    void rejectsBadRules() {
        assertThrows(VacademyException.class, () -> InstallmentScheduleService.resolveDueDates(
                rule(0, "DAYS", 30, TODAY)));
        assertThrows(VacademyException.class, () -> InstallmentScheduleService.resolveDueDates(
                rule(InstallmentScheduleService.MAX_INSTALLMENTS + 1, "DAYS", 30, TODAY)));
        assertThrows(VacademyException.class, () -> InstallmentScheduleService.resolveDueDates(
                rule(3, "WEEKS", 1, TODAY)));
        assertThrows(VacademyException.class, () -> InstallmentScheduleService.resolveDueDates(
                rule(3, "DAYS", 0, TODAY)));
        assertThrows(VacademyException.class, () -> InstallmentScheduleService.resolveDueDates(
                rule(3, "DAYS", 30, null)));
        InstallmentScheduleDTO backwards = InstallmentScheduleDTO.builder()
                .rows(List.of(row("2026-11-01", null), row("2026-10-01", null))).build();
        assertThrows(VacademyException.class, () -> InstallmentScheduleService.resolveDueDates(backwards));
    }

    // ---------------- layout ----------------

    @Test
    @DisplayName("One split fee: bills per installment, start = previous due date")
    void singleSplitFeeLayout() {
        InstallmentScheduleService.SchedulePlan plan = InstallmentScheduleService.buildPlan(
                List.of(split("a", "40000")), rule(4, "DAYS", 30, LocalDate.of(2026, 10, 15)), TODAY);

        assertEquals(4, plan.bills().size());
        assertEquals(new BigDecimal("10000"), plan.bills().get(0).amount());
        assertEquals(1, plan.bills().get(0).installmentNumber());
        assertEquals(TODAY, plan.bills().get(0).startDate());
        assertEquals(LocalDate.of(2026, 10, 15), plan.bills().get(1).startDate());

        InstallmentSchedulePreviewDTO preview = plan.toPreview();
        assertEquals(0, preview.getTotalAmount().compareTo(new BigDecimal("40000")));
        assertEquals(4, preview.getInstallments().size());
        assertTrue(preview.getUpfrontFees().isEmpty());
    }

    @Test
    @DisplayName("A back-dated first installment starts on its own due date")
    void backDatedStart() {
        InstallmentScheduleService.SchedulePlan plan = InstallmentScheduleService.buildPlan(
                List.of(split("a", "3000")), rule(3, "MONTHS", 1, LocalDate.of(2026, 9, 1)), TODAY);
        assertEquals(LocalDate.of(2026, 9, 1), plan.bills().get(0).startDate());
    }

    @Test
    @DisplayName("Fees that are not split become one bill due on the first date")
    void upfrontFeeDueOnFirstDate() {
        InstallmentScheduleService.SchedulePlan plan = InstallmentScheduleService.buildPlan(
                List.of(split("tuition", "30000"), upfront("admission", "5000")),
                rule(3, "MONTHS", 1, LocalDate.of(2026, 11, 1)), TODAY);

        assertEquals(4, plan.bills().size());
        InstallmentScheduleService.PlannedBill admission = plan.bills().get(3);
        assertNull(admission.installmentNumber());
        assertEquals(LocalDate.of(2026, 11, 1), admission.dueDate());
        assertEquals(new BigDecimal("5000"), admission.amount());

        InstallmentSchedulePreviewDTO preview = plan.toPreview();
        assertEquals(0, preview.getTotalAmount().compareTo(new BigDecimal("35000")));
        assertEquals(1, preview.getUpfrontFees().size());
        assertEquals(0, preview.getInstallments().get(0).getAmount().compareTo(new BigDecimal("10000")));
    }

    @Test
    @DisplayName("Several split fees: each is split on its own; preview sums them per installment")
    void multipleSplitFees() {
        InstallmentScheduleService.SchedulePlan plan = InstallmentScheduleService.buildPlan(
                List.of(split("tuition", "30000"), split("transport", "6000")),
                rule(3, "MONTHS", 1, LocalDate.of(2026, 11, 1)), TODAY);
        assertEquals(6, plan.bills().size());
        assertEquals(0, plan.toPreview().getInstallments().get(1).getAmount().compareTo(new BigDecimal("12000")));
    }

    @Test
    @DisplayName("Edited row amounts are used as given when they add up to the fee")
    void explicitRowsUsed() {
        InstallmentScheduleDTO s = InstallmentScheduleDTO.builder()
                .rows(List.of(row("2026-10-15", "20000"), row("2026-11-15", "10000"), row("2026-12-15", "10000")))
                .build();
        InstallmentScheduleService.SchedulePlan plan = InstallmentScheduleService.buildPlan(
                List.of(split("a", "40000")), s, TODAY);
        assertEquals(new BigDecimal("20000"), plan.bills().get(0).amount());
        assertEquals(LocalDate.of(2026, 12, 15), plan.bills().get(2).dueDate());
    }

    @Test
    @DisplayName("Edited amounts must add up to the fee; a price change goes through the discount")
    void explicitRowsMustAddUp() {
        InstallmentScheduleDTO s = InstallmentScheduleDTO.builder()
                .rows(List.of(row("2026-10-15", "20000"), row("2026-11-15", "10000")))
                .build();
        VacademyException e = assertThrows(VacademyException.class, () -> InstallmentScheduleService.buildPlan(
                List.of(split("a", "40000")), s, TODAY));
        assertTrue(e.getMessage().contains("discount"));
    }

    @Test
    @DisplayName("Amounts must be given for every row or none")
    void mixedRowAmountsRejected() {
        InstallmentScheduleDTO s = InstallmentScheduleDTO.builder()
                .rows(List.of(row("2026-10-15", "20000"), row("2026-11-15", null)))
                .build();
        assertThrows(VacademyException.class, () -> InstallmentScheduleService.buildPlan(
                List.of(split("a", "40000")), s, TODAY));
    }

    @Test
    @DisplayName("Several split fees: dates can be edited, amounts cannot")
    void multipleSplitFeesRejectAmountEdits() {
        List<InstallmentScheduleService.FeePart> parts = List.of(split("t", "30000"), split("x", "6000"));
        InstallmentScheduleDTO datesOnly = InstallmentScheduleDTO.builder()
                .rows(List.of(row("2026-10-20", null), row("2026-11-20", null), row("2026-12-20", null)))
                .build();
        assertEquals(6, InstallmentScheduleService.buildPlan(parts, datesOnly, TODAY).bills().size());

        InstallmentScheduleDTO edited = InstallmentScheduleDTO.builder()
                .rows(List.of(row("2026-10-20", "16000"), row("2026-11-20", "10000"), row("2026-12-20", "10000")))
                .build();
        assertThrows(VacademyException.class, () -> InstallmentScheduleService.buildPlan(parts, edited, TODAY));
    }

    @Test
    @DisplayName("A fee too small for the chosen count is rejected instead of writing zero bills")
    void feeTooSmallToSplit() {
        VacademyException e = assertThrows(VacademyException.class, () -> InstallmentScheduleService.buildPlan(
                List.of(split("a", "2")), rule(3, "MONTHS", 1, TODAY), TODAY));
        assertTrue(e.getMessage().contains("too small"));
    }

    @Test
    @DisplayName("Edited rows must all be above zero")
    void zeroRowRejected() {
        InstallmentScheduleDTO s = InstallmentScheduleDTO.builder()
                .rows(List.of(row("2026-10-15", "40000"), row("2026-11-15", "0")))
                .build();
        assertThrows(VacademyException.class, () -> InstallmentScheduleService.buildPlan(
                List.of(split("a", "40000")), s, TODAY));
    }

    @Test
    @DisplayName("A plan with no splittable fee is rejected")
    void nothingToSplit() {
        assertThrows(VacademyException.class, () -> InstallmentScheduleService.buildPlan(
                List.of(upfront("a", "5000")), rule(3, "DAYS", 30, TODAY), TODAY));
    }

    // ---------------- persistence ----------------

    @Test
    @DisplayName("generateFromSchedule writes template-less numbered bills and one accrual each")
    void generateWritesBillsAndAccruals() {
        FeeTypeRepository feeTypes = mock(FeeTypeRepository.class);
        AssignedFeeValueRepository values = mock(AssignedFeeValueRepository.class);
        AftInstallmentRepository installments = mock(AftInstallmentRepository.class);
        StudentFeePaymentRepository bills = mock(StudentFeePaymentRepository.class);
        UserAccountLedgerService ledger = mock(UserAccountLedgerService.class);
        InstallmentScheduleService service =
                new InstallmentScheduleService(feeTypes, values, installments, bills, ledger);

        FeeType ft = new FeeType();
        ft.setId("ft-1");
        ft.setName("Course fee");
        ft.setStatus("ACTIVE");
        AssignedFeeValue afv = new AssignedFeeValue();
        afv.setId("afv-1");
        afv.setAmount(new BigDecimal("9000"));
        afv.setHasInstallment(true);
        afv.setStatus("ACTIVE");
        when(feeTypes.findByCpoId("cpo-1")).thenReturn(List.of(ft));
        when(values.findByFeeTypeIdAndStatusNot("ft-1", "DELETED")).thenReturn(List.of(afv));
        when(installments.findByAssignedFeeValueIdOrderByInstallmentNumberAsc("afv-1")).thenReturn(List.of());
        when(bills.saveAll(any())).thenAnswer(inv -> {
            List<StudentFeePayment> in = new ArrayList<>(inv.getArgument(0));
            for (int i = 0; i < in.size(); i++) in.get(i).setId("sfp-" + (i + 1));
            return in;
        });

        List<String> ids = service.generateFromSchedule("up-1", "cpo-1", "user-1", "inst-1", "INR",
                rule(3, "MONTHS", 1, LocalDate.of(2026, 11, 5)));

        assertEquals(List.of("sfp-1", "sfp-2", "sfp-3"), ids);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<StudentFeePayment>> saved = ArgumentCaptor.forClass(List.class);
        verify(bills).saveAll(saved.capture());
        StudentFeePayment second = saved.getValue().get(1);
        assertNull(second.getIId());
        assertEquals(2, second.getInstallmentNumber());
        assertEquals("afv-1", second.getAsvId());
        assertEquals("ft-1", second.getFeeTypeId());
        assertEquals(new BigDecimal("3000"), second.getAmountExpected());
        assertEquals(new BigDecimal("3000"), second.getOriginalAmount());
        assertEquals("PENDING", second.getStatus());
        verify(ledger, times(3)).recordDebitAccrual(eq("user-1"), eq("inst-1"), eq(new BigDecimal("3000")),
                eq("INR"), any(LocalDate.class), eq("STUDENT_FEE_PAYMENT"), anyString(), any(), anyString());
    }

    // ---------------- flexible defaults ----------------

    @Test
    @DisplayName("Flexible defaults round-trip through metadata_json without losing other keys")
    void flexibleDefaultsRoundTrip() {
        ComplexPaymentOption cpo = new ComplexPaymentOption();
        cpo.setMetadataJson("{\"system\":\"X\"}");
        CpoFlexibleDefaults.write(cpo, FlexibleScheduleDefaultsDTO.builder()
                .count(4)
                .interval(InstallmentScheduleDTO.IntervalDTO.builder().unit("DAYS").value(30).build())
                .maxCount(6)
                .build());
        assertTrue(cpo.getMetadataJson().contains("\"system\":\"X\""));
        assertTrue(cpo.getMetadataJson().contains("\"max_count\":6"));

        InstallmentScheduleService service = new InstallmentScheduleService(null, null, null, null, null);
        InstallmentScheduleDTO s = service.defaultScheduleFor(cpo, TODAY);
        assertEquals(4, s.getCount());
        assertEquals("DAYS", s.getInterval().getUnit());
        assertEquals(30, s.getInterval().getValue());
        assertEquals(TODAY, s.getFirstDueDate());
        assertEquals(6, service.maxCountFor(cpo));
    }

    @Test
    @DisplayName("A plan with no defaults falls back to one installment due on the first date")
    void defaultsFallback() {
        InstallmentScheduleService service = new InstallmentScheduleService(null, null, null, null, null);
        InstallmentScheduleDTO s = service.defaultScheduleFor(new ComplexPaymentOption(), TODAY);
        assertEquals(1, s.getCount());
        assertEquals(InstallmentScheduleService.MAX_INSTALLMENTS, service.maxCountFor(new ComplexPaymentOption()));
    }

    @Test
    @DisplayName("Invalid defaults are rejected")
    void invalidDefaultsRejected() {
        ComplexPaymentOption cpo = new ComplexPaymentOption();
        assertThrows(VacademyException.class, () -> CpoFlexibleDefaults.write(cpo,
                FlexibleScheduleDefaultsDTO.builder().count(3)
                        .interval(InstallmentScheduleDTO.IntervalDTO.builder().unit("DAYS").value(5000).build())
                        .build()));
        assertThrows(VacademyException.class, () -> CpoFlexibleDefaults.write(cpo,
                FlexibleScheduleDefaultsDTO.builder().count(10).maxCount(6).build()));
        assertThrows(VacademyException.class, () -> CpoFlexibleDefaults.write(cpo,
                FlexibleScheduleDefaultsDTO.builder().count(3)
                        .interval(InstallmentScheduleDTO.IntervalDTO.builder().unit("YEARS").value(1).build())
                        .build()));
    }

    // ---------------- per-installment discounts ----------------

    private static InstallmentScheduleDTO.RowDTO row(String date, String amount, String discount) {
        InstallmentScheduleDTO.RowDTO r = row(date, amount);
        r.setDiscount(discount != null ? new BigDecimal(discount) : null);
        return r;
    }

    @Test
    void rowDiscountsAreReadAndChecked() {
        InstallmentScheduleDTO ok = InstallmentScheduleDTO.builder().rows(List.of(
                row("2026-10-15", "2334", "334"), row("2026-11-15", "833", "333"), row("2026-12-15", "833", null)))
                .build();
        assertEquals(List.of(new BigDecimal("334.00"), new BigDecimal("333.00"), new BigDecimal("0.00")),
                InstallmentScheduleService.rowDiscounts(ok));
        InstallmentScheduleService.buildPlan(List.of(split("a", "4000")), ok, TODAY);

        InstallmentScheduleDTO none = InstallmentScheduleDTO.builder().rows(List.of(
                row("2026-10-15", "2000", null), row("2026-11-15", "2000", "0"))).build();
        assertNull(InstallmentScheduleService.rowDiscounts(none));

        InstallmentScheduleDTO tooMuch = InstallmentScheduleDTO.builder().rows(List.of(
                row("2026-10-15", "3000", "0"), row("2026-11-15", "1000", "1000.01"))).build();
        assertThrows(VacademyException.class,
                () -> InstallmentScheduleService.buildPlan(List.of(split("a", "4000")), tooMuch, TODAY));
        InstallmentScheduleDTO negative = InstallmentScheduleDTO.builder().rows(List.of(
                row("2026-10-15", "3000", "-1"), row("2026-11-15", "1000", "0"))).build();
        assertThrows(VacademyException.class,
                () -> InstallmentScheduleService.buildPlan(List.of(split("a", "4000")), negative, TODAY));
    }
}
