package vacademy.io.admin_core_service.features.fee_management.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class AdmissionPackageSplitterTest {

    private static BigDecimal d(String v) { return new BigDecimal(v); }

    private static AdmissionPackageSplitter.PackageRow row(String date, String amount, String off) {
        return new AdmissionPackageSplitter.PackageRow(LocalDate.parse(date), d(amount), d(off));
    }

    private static void assertMoney(String expected, BigDecimal actual) {
        assertEquals(0, d(expected).compareTo(actual), "expected " + expected + " but was " + actual);
    }

    /** I2CAN's usual bundle: PG Diploma ₹55,000 + B&WSSC ₹10,000, ₹10,000 off, ₹5,000 at admission. */
    @Test
    @DisplayName("splits each installment and the discount by fee; every course and every installment adds up")
    void diplomaPlusAddOn() {
        List<AdmissionPackageSplitter.CourseShare> shares = AdmissionPackageSplitter.split(
                List.of(d("55000"), d("10000")),
                List.of(row("2026-10-17", "5000", "0"), row("2026-10-19", "30000", "5000"),
                        row("2026-11-02", "30000", "5000")),
                d("5000"));

        AdmissionPackageSplitter.CourseShare diploma = shares.get(0);
        AdmissionPackageSplitter.CourseShare addOn = shares.get(1);
        assertMoney("8462", diploma.discount());
        assertMoney("1538", addOn.discount());
        assertMoney("46538", diploma.net());
        assertMoney("8462", addOn.net());
        // Every course's rows add up to its fee and its discount.
        for (AdmissionPackageSplitter.CourseShare s : shares) {
            assertMoney(s.fee().toPlainString(), s.rows().stream().map(AdmissionPackageSplitter.CourseRow::amount)
                    .reduce(BigDecimal.ZERO, BigDecimal::add));
            assertMoney(s.discount().toPlainString(), s.rows().stream().map(AdmissionPackageSplitter.CourseRow::discount)
                    .reduce(BigDecimal.ZERO, BigDecimal::add));
        }
        // Every package installment's parts add up to what the student pays for it.
        String[] toPay = {"5000", "25000", "25000"};
        for (int r = 0; r < 3; r++) {
            final int rr = r;
            assertMoney(toPay[r], shares.stream().flatMap(s -> s.rows().stream())
                    .filter(cr -> cr.packageRowIndex() == rr)
                    .map(AdmissionPackageSplitter.CourseRow::net).reduce(BigDecimal.ZERO, BigDecimal::add));
        }
        // Registration: no discount; the ₹5,000 paid covers it exactly, split by fee.
        assertMoney("4231", diploma.rows().get(0).amount());
        assertMoney("769", addOn.rows().get(0).amount());
        assertMoney("4231", diploma.paidAtAdmission());
        assertMoney("769", addOn.paidAtAdmission());
        // Whole rupees throughout.
        shares.forEach(s -> s.rows().forEach(cr -> assertEquals(0, cr.amount().stripTrailingZeros().scale() > 0 ? 1 : 0)));
    }

    @Test
    @DisplayName("three courses, no discount, a payment covering more than the first installment")
    void threeCourses() {
        List<AdmissionPackageSplitter.CourseShare> shares = AdmissionPackageSplitter.split(
                List.of(d("45000"), d("35000"), d("10000")),
                List.of(row("2026-10-21", "30000", "0"), row("2026-11-21", "30000", "0"), row("2026-12-21", "30000", "0")),
                d("40000"));
        BigDecimal paid = shares.stream().map(AdmissionPackageSplitter.CourseShare::paidAtAdmission)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        assertMoney("40000", paid);
        // The largest course absorbs the rounding: a rupee either way per installment.
        assertMoney("14999", shares.get(0).rows().get(0).net());
        assertMoney("15001", shares.get(0).rows().get(2).net());
        // The first installment is covered across all courses (14999 + 11667 + 3334); the other
        // 10000 is shared on the second in proportion to 15000 / 11667 / 3333.
        assertMoney("19999", shares.get(0).paidAtAdmission());
        assertMoney("15556", shares.get(1).paidAtAdmission());
        assertMoney("4445", shares.get(2).paidAtAdmission());
    }

    @Test
    @DisplayName("package payment: earliest date first, a part-payment shared by what each course owes")
    void allocatePayment() {
        List<AdmissionPackageSplitter.OpenBill> bills = List.of(
                new AdmissionPackageSplitter.OpenBill(0, LocalDate.parse("2026-11-10"), d("22344")),
                new AdmissionPackageSplitter.OpenBill(1, LocalDate.parse("2026-11-10"), d("10156")),
                new AdmissionPackageSplitter.OpenBill(0, LocalDate.parse("2026-12-10"), d("22343")),
                new AdmissionPackageSplitter.OpenBill(1, LocalDate.parse("2026-12-10"), d("10157")));
        // Exactly the next installment: each course's bill on that date.
        BigDecimal[] next = AdmissionPackageSplitter.allocatePayment(2, bills, d("32500"));
        assertMoney("22344", next[0]);
        assertMoney("10156", next[1]);
        // Part of it: shared 22344 : 10156.
        BigDecimal[] part = AdmissionPackageSplitter.allocatePayment(2, bills, d("10000"));
        assertMoney("6875", part[0]);
        assertMoney("3125", part[1]);
        // Into the next date: the first is paid off, the rest shared on the second.
        BigDecimal[] more = AdmissionPackageSplitter.allocatePayment(2, bills, d("42500"));
        assertMoney("29219", more[0]);
        assertMoney("13281", more[1]);
        assertEquals(0, more[0].add(more[1]).compareTo(d("42500")));
        // More than is owed, or nothing.
        assertThrows(VacademyException.class, () -> AdmissionPackageSplitter.allocatePayment(2, bills, d("65001")));
        assertThrows(VacademyException.class, () -> AdmissionPackageSplitter.allocatePayment(2, bills, d("0")));
    }

    @Test
    @DisplayName("refuses schedules that do not add up, a payment above the total, and a single course")
    void guards() {
        assertThrows(VacademyException.class, () -> AdmissionPackageSplitter.split(List.of(d("55000"), d("10000")),
                List.of(row("2026-10-17", "60000", "0")), null));
        assertThrows(VacademyException.class, () -> AdmissionPackageSplitter.split(List.of(d("55000"), d("10000")),
                List.of(row("2026-10-17", "65000", "10000")), d("55001")));
        assertThrows(VacademyException.class, () -> AdmissionPackageSplitter.split(List.of(d("55000")),
                List.of(row("2026-10-17", "55000", "0")), null));
        assertThrows(VacademyException.class, () -> AdmissionPackageSplitter.split(List.of(d("55000"), d("10000")),
                List.of(row("2026-11-17", "30000", "0"), row("2026-10-17", "35000", "0")), null));
    }

    @Test
    @DisplayName("apportion: largest remainder, exact total")
    void apportion() {
        BigDecimal[] parts = AdmissionPackageSplitter.apportion(d("100"), List.of(d("1"), d("1"), d("1")), 0);
        assertMoney("34", parts[0]);
        assertMoney("33", parts[1]);
        assertMoney("33", parts[2]);
    }

    @Test
    @DisplayName("part of a package installment is shared by what each bill still owes")
    void shareOfInstallment() {
        BigDecimal[] whole = AdmissionPackageSplitter.shareOfInstallment(
                List.of(new BigDecimal("22344"), new BigDecimal("10156")), new BigDecimal("12500"));
        assertEquals(0, whole[0].compareTo(new BigDecimal("8594")));
        assertEquals(0, whole[1].compareTo(new BigDecimal("3906")));

        BigDecimal[] paise = AdmissionPackageSplitter.shareOfInstallment(
                List.of(new BigDecimal("100.50"), new BigDecimal("99.50")), new BigDecimal("50"));
        assertEquals(0, paise[0].add(paise[1]).compareTo(new BigDecimal("50")));
        assertEquals(0, paise[0].compareTo(new BigDecimal("25.13")));

        assertThrows(VacademyException.class, () -> AdmissionPackageSplitter.shareOfInstallment(
                List.of(new BigDecimal("100")), BigDecimal.ZERO));
        assertThrows(VacademyException.class, () -> AdmissionPackageSplitter.shareOfInstallment(
                List.of(new BigDecimal("100")), new BigDecimal("100.01")));
    }
}
