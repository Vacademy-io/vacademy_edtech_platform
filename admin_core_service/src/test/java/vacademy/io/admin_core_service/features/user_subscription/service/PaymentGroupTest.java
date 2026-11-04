package vacademy.io.admin_core_service.features.user_subscription.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.data.repository.query.SpelQueryContext;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.faculty.repository.FacultySubjectPackageSessionMappingRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeeAllocationLedgerRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;
import vacademy.io.admin_core_service.features.invoice.repository.InvoicePaymentLogMappingRepository;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.user_account.repository.UserAccountLedgerRepository;
import vacademy.io.admin_core_service.features.user_account.service.UserAccountLedgerService;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentLogDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentLogWithUserPlanDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentVoidResultDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentGroupSql;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.lang.reflect.Field;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * One payment stored as several payment_log rows, one per course (payment_log.payment_group_id,
 * V642): listed and counted once, voided as a whole, and never moved between payments.
 */
class PaymentGroupTest {

    private static final String INSTITUTE = "inst-1";

    private static PaymentLog row(String id, String group, String vendor, String status, double amount) {
        EnrollInvite invite = new EnrollInvite();
        invite.setInstituteId(INSTITUTE);
        UserPlan plan = new UserPlan();
        plan.setId("plan-" + id);
        plan.setEnrollInvite(invite);
        PaymentLog log = new PaymentLog();
        log.setId(id);
        log.setPaymentGroupId(group);
        log.setVendor(vendor);
        log.setStatus("SUCCESS");
        log.setPaymentStatus(status);
        log.setPaymentAmount(amount);
        log.setCurrency("INR");
        log.setUserPlan(plan);
        return log;
    }

    @Nested
    @DisplayName("void")
    class Void {
        private PaymentLogRepository paymentLogRepository;
        private InvoiceService invoiceService;
        private UserAccountLedgerService ledgerService;
        private PaymentVoidService service;
        private final Map<String, PaymentLog> rows = new HashMap<>();

        @BeforeEach
        void setUp() {
            paymentLogRepository = mock(PaymentLogRepository.class);
            StudentFeeAllocationLedgerRepository allocationRepository = mock(StudentFeeAllocationLedgerRepository.class);
            InvoicePaymentLogMappingRepository mappingRepository = mock(InvoicePaymentLogMappingRepository.class);
            invoiceService = mock(InvoiceService.class);
            ledgerService = mock(UserAccountLedgerService.class);
            FacultySubjectPackageSessionMappingRepository facultyRepository =
                    mock(FacultySubjectPackageSessionMappingRepository.class);

            when(allocationRepository.findByPaymentLogId(anyString())).thenReturn(List.of());
            when(mappingRepository.findAllByPaymentLogId(anyString())).thenReturn(List.of());
            when(invoiceService.unwindInvoicesForVoidedPayment(anyString(), any(), any())).thenReturn(1);
            when(ledgerService.reverseCreditsForVoidedPayment(anyString(), anyString())).thenReturn(new BigDecimal("100"));
            when(facultyRepository.findDistinctSubOrgIdsByUserAndLinkage(anyString(), any())).thenReturn(List.of());
            when(paymentLogRepository.findById(anyString()))
                    .thenAnswer(inv -> Optional.ofNullable(rows.get(inv.<String>getArgument(0))));
            when(paymentLogRepository.findByPaymentGroupIdOrderByCreatedAtAsc(anyString()))
                    .thenAnswer(inv -> rows.values().stream()
                            .filter(r -> inv.<String>getArgument(0).equals(r.getPaymentGroupId()))
                            .sorted((a, b) -> a.getId().compareTo(b.getId()))
                            .toList());

            service = new PaymentVoidService(paymentLogRepository, allocationRepository,
                    mock(StudentFeePaymentRepository.class), mappingRepository, invoiceService, ledgerService,
                    facultyRepository, mock(UserAccountLedgerRepository.class));
        }

        private PaymentLog put(PaymentLog r) {
            rows.put(r.getId(), r);
            return r;
        }

        @Test
        @DisplayName("voiding one course's share voids every paid share of the payment, and reports their sum")
        void voidsTheWholePayment() {
            PaymentLog a = put(row("a", "g1", "MANUAL", "PAID", 3000));
            PaymentLog b = put(row("b", "g1", "MANUAL", "PAID", 2000));
            PaymentLog other = put(row("c", "g2", "MANUAL", "PAID", 999));

            PaymentVoidResultDTO result = service.voidPayment("b", INSTITUTE, "wrong entry", "admin");

            assertEquals("VOIDED", a.getPaymentStatus());
            assertEquals("VOIDED", b.getPaymentStatus());
            assertEquals("PAID", other.getPaymentStatus(), "another payment is never touched");
            assertEquals("b", result.getPaymentLogId());
            assertEquals(5000d, result.getAmount());
            assertEquals(2, result.getPaymentsVoided());
            assertEquals(2, result.getInvoicesUpdated());
            assertEquals(0, new BigDecimal("200").compareTo(result.getCreditReversed()));
            verify(ledgerService).reverseCreditsForVoidedPayment(org.mockito.ArgumentMatchers.eq("a"), anyString());
            verify(ledgerService).reverseCreditsForVoidedPayment(org.mockito.ArgumentMatchers.eq("b"), anyString());
        }

        @Test
        @DisplayName("a share already voided is left as it is; a payment on its own voids alone")
        void skipsWhatIsNotPaid() {
            PaymentLog a = put(row("a", "g1", "MANUAL", "VOIDED", 3000));
            PaymentLog b = put(row("b", "g1", "MANUAL", "PAID", 2000));
            PaymentLog single = put(row("s", null, "OFFLINE", "PAID", 700));

            PaymentVoidResultDTO r1 = service.voidPayment("b", INSTITUTE, null, "admin");
            assertEquals(1, r1.getPaymentsVoided());
            assertEquals(2000d, r1.getAmount());
            assertEquals("VOIDED", a.getPaymentStatus());

            PaymentVoidResultDTO r2 = service.voidPayment("s", INSTITUTE, null, "admin");
            assertEquals(1, r2.getPaymentsVoided());
            assertEquals("VOIDED", single.getPaymentStatus());
            verify(paymentLogRepository, never()).findByPaymentGroupIdOrderByCreatedAtAsc(null);
        }

        @Test
        @DisplayName("regression: a checkout's planless parent is left alone, so a manual order can still be voided")
        void leavesTheCheckoutParentAlone() {
            PaymentLog parent = put(row("parent", "parent", "MANUAL", "PAID", 300));
            parent.setUserPlan(null);
            PaymentLog child = put(row("child", "parent", "MANUAL", "PAID", 300));

            PaymentVoidResultDTO result = service.voidPayment("child", INSTITUTE, null, "admin");

            assertEquals("VOIDED", child.getPaymentStatus());
            assertEquals("PAID", parent.getPaymentStatus(), "reports skip it because its child holds the money");
            assertEquals(1, result.getPaymentsVoided());
            assertEquals(300d, result.getAmount());
        }

        @Test
        @DisplayName("voidSingleRow touches that row only, for a caller removing one course")
        void singleRowDoesNotCascade() {
            PaymentLog a = put(row("a", "g1", "MANUAL", "PAID", 3000));
            PaymentLog b = put(row("b", "g1", "MANUAL", "PAID", 2000));

            PaymentVoidResultDTO result = service.voidSingleRow("a", INSTITUTE, null, "admin");

            assertEquals("VOIDED", a.getPaymentStatus());
            assertEquals("PAID", b.getPaymentStatus());
            assertEquals(1, result.getPaymentsVoided());
            assertEquals(3000d, result.getAmount());
        }

        @Test
        @DisplayName("describeRows says what a void and a delete would take, without changing anything")
        void describesWithoutChanging() {
            PaymentLog parent = put(row("parent", "g1", "MANUAL", "PAID", 5000));
            parent.setUserPlan(null);
            PaymentLog a = put(row("a", "g1", "MANUAL", "PAID", 3000));
            PaymentLog b = put(row("b", "g1", "MANUAL", "PAID", 1500));
            put(row("c", "g1", "MANUAL", "VOIDED", 500));
            put(row("d", "g1", "MANUAL", "FAILED", 999));

            var rows = service.describeRows("a", INSTITUTE);

            assertEquals(2, rows.getVoidRows());
            assertEquals(4500d, rows.getVoidAmount());
            assertEquals(3, rows.getDeleteRows());
            assertEquals(5000d, rows.getDeleteAmount());
            assertEquals("PAID", a.getPaymentStatus());
            assertEquals("PAID", b.getPaymentStatus());
        }

        @Test
        @DisplayName("another institute cannot read what a payment covers")
        void describeChecksTheInstitute() {
            put(row("a", null, "MANUAL", "PAID", 3000));
            assertThrows(VacademyException.class, () -> service.describeRows("a", "other-institute"));
        }

        @Test
        @DisplayName("refuses the whole payment, changing nothing, when one share cannot be voided")
        void allOrNothing() {
            PaymentLog a = put(row("a", "g1", "MANUAL", "PAID", 3000));
            PaymentLog b = put(row("b", "g1", "RAZORPAY", "PAID", 2000));

            assertThrows(VacademyException.class, () -> service.voidPayment("a", INSTITUTE, null, "admin"));

            assertEquals("PAID", a.getPaymentStatus());
            assertEquals("PAID", b.getPaymentStatus());
            verify(invoiceService, never()).unwindInvoicesForVoidedPayment(anyString(), any(), any());
            verify(ledgerService, never()).reverseCreditsForVoidedPayment(anyString(), anyString());
        }
    }

    @Nested
    @DisplayName("assignPaymentGroup")
    class Assign {
        private PaymentLogRepository repo;
        private PaymentLogService service;
        private final Map<String, PaymentLog> rows = new HashMap<>();

        @BeforeEach
        void setUp() throws Exception {
            repo = mock(PaymentLogRepository.class);
            when(repo.findAllById(any())).thenAnswer(inv -> {
                List<PaymentLog> out = new ArrayList<>();
                for (Object id : (Iterable<?>) inv.getArgument(0)) {
                    PaymentLog r = rows.get(id);
                    if (r != null) out.add(r);
                }
                return out;
            });
            service = new PaymentLogService();
            Field f = PaymentLogService.class.getDeclaredField("paymentLogRepository");
            f.setAccessible(true);
            f.set(service, repo);
        }

        @Test
        @DisplayName("groups two or more rows, keeps a row already in another payment, ignores blanks")
        void groups() {
            rows.put("a", row("a", null, "MANUAL", "PAID", 1));
            rows.put("b", row("b", null, "MANUAL", "PAID", 1));
            rows.put("c", row("c", "other", "MANUAL", "PAID", 1));

            int grouped = service.assignPaymentGroup("g", java.util.Arrays.asList("a", "b", "c", null, " ", "a"));

            assertEquals(2, grouped);
            assertEquals("g", rows.get("a").getPaymentGroupId());
            assertEquals("g", rows.get("b").getPaymentGroupId());
            assertEquals("other", rows.get("c").getPaymentGroupId(), "one row is never in two payments");
        }

        @Test
        @DisplayName("a single row, or no group id, is not a group")
        void notAGroup() {
            rows.put("a", row("a", null, "MANUAL", "PAID", 1));
            assertEquals(0, service.assignPaymentGroup("g", List.of("a", "a")));
            assertEquals(0, service.assignPaymentGroup(" ", List.of("a", "b")));
            assertEquals(0, service.assignPaymentGroup("g", null));
            assertNull(rows.get("a").getPaymentGroupId());
            verify(repo, never()).save(any());
        }
    }

    @Nested
    @DisplayName("grouped listing row")
    class ListingRow {
        private PaymentLogWithUserPlanDTO line(String id, Double amount) {
            PaymentLogDTO log = new PaymentLogDTO();
            log.setId(id);
            log.setPaymentAmount(amount);
            log.setCurrency("INR");
            return PaymentLogWithUserPlanDTO.builder().paymentLog(log).currentPaymentStatus("PAID").build();
        }

        @Test
        @DisplayName("the payment's row carries the total; each line keeps its own share")
        void sumsTheShares() {
            PaymentLogWithUserPlanDTO a = line("a", 3000d);
            PaymentLogWithUserPlanDTO b = line("b", 2000.005d);

            PaymentLogWithUserPlanDTO row = PaymentLogService.toPaymentRow(a, List.of(a, b));

            assertEquals(5000.01d, row.getPaymentLog().getPaymentAmount());
            assertEquals("a", row.getPaymentLog().getId());
            assertEquals(3000d, a.getPaymentLog().getPaymentAmount(), "the head's own line keeps its share");
            assertEquals(List.of(a, b), row.getGroupLines());
            assertNull(a.getGroupLines(), "a line never carries lines");
        }

        @Test
        @DisplayName("a payment on its own is unchanged and lists itself")
        void singleRow() {
            PaymentLogWithUserPlanDTO a = line("a", 700d);
            PaymentLogWithUserPlanDTO row = PaymentLogService.toPaymentRow(a, List.of(a));
            assertSame(a.getPaymentLog(), row.getPaymentLog());
            assertEquals(List.of(a), row.getGroupLines());
        }

        @Test
        @DisplayName("lines without an amount do not invent one")
        void noAmounts() {
            PaymentLogWithUserPlanDTO a = line("a", null);
            PaymentLogWithUserPlanDTO b = line("b", null);
            assertNull(PaymentLogService.toPaymentRow(a, List.of(a, b)).getPaymentLog().getPaymentAmount());
        }
    }

    @Test
    @DisplayName("the SQL fragments are safe inside @Query text and splice with spaces")
    void sqlFragments() {
        for (String sql : List.of(PaymentGroupSql.GROUP_KEY_PL, PaymentGroupSql.IS_ORDER_PARENT_PL,
                PaymentGroupSql.NOT_ORDER_PARENT_PL)) {
            assertFalse(sql.contains("\"") || sql.contains(":") || sql.contains(";") || sql.contains("?"), sql);
            assertEquals(0, sql.chars().filter(c -> c == '\'').count() % 2, "unbalanced quote crashes the boot: " + sql);
            assertTrue(sql.startsWith(" ") && sql.endsWith(" "), sql);
            SpelQueryContext.of((a, b) -> b, (a, b) -> b).parse("SELECT 1 FROM payment_log pl WHERE" + sql);
        }
    }
}
