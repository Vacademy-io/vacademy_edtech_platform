package vacademy.io.admin_core_service.features.user_subscription.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.user_subscription.dto.BalanceLearnerProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.BillingSummaryProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.BillingSummaryRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.BillingSummaryResponseDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.MonthDueLearnerProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.OutstandingLearnerDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.OutstandingLearnerProjection;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The instalment forecast added an optional {@code dueMonth} to the Due / Outstanding lists. These
 * pin that every existing caller — no month — still reaches exactly the query it did, with exactly
 * the arguments it did, and that the billing summary still reports every figure it did.
 */
class PaymentLogBalancesRoutingTest {

    private static final String INSTITUTE = "inst-1";
    private static final LocalDateTime EPOCH = LocalDateTime.of(1970, 1, 1, 0, 0);

    private final PaymentLogService service = new PaymentLogService();
    private final UserPlanRepository repo = mock(UserPlanRepository.class);
    private final AuthService authService = mock(AuthService.class);

    @BeforeEach
    void wire() {
        ReflectionTestUtils.setField(service, "userPlanRepository", repo);
        ReflectionTestUtils.setField(service, "authService", authService);
        ReflectionTestUtils.setField(service, "upcomingDays", 30);
    }

    private static BillingSummaryRequestDTO request() {
        BillingSummaryRequestDTO r = new BillingSummaryRequestDTO();
        r.setInstituteId(INSTITUTE);
        r.setStartDateInUtc(EPOCH);
        r.setEndDateInUtc(LocalDateTime.of(2026, 9, 28, 23, 59, 59));
        return r;
    }

    private static <T> Page<T> empty() {
        return new PageImpl<>(List.of(), PageRequest.of(0, 20), 0);
    }

    @Test
    @DisplayName("Due list (no month): the same query, the same arguments, nothing else")
    void dueListUnchanged() {
        when(repo.findOutstandingLearners(anyString(), any(), any(), anyBoolean(), anyList(), anyInt(),
                anyBoolean(), anyString(), anyString(), any()))
                .thenReturn(empty());

        service.getOutstandingLearners(request(), 0, 20);
        service.getOutstandingLearners(request(), 0, 20, false);
        service.getOutstandingLearners(request(), 0, 20, false, null);

        verify(repo, org.mockito.Mockito.times(3)).findOutstandingLearners(
                eq(INSTITUTE), eq(EPOCH), eq(LocalDateTime.of(2026, 9, 28, 23, 59, 59)), eq(true),
                eq(List.of("__none__")), eq(30), eq(true), eq(""), eq(""), eq(PageRequest.of(0, 20)));
        verify(repo, never()).findLearnersWithBalance(anyString(), any(), any(), anyBoolean(), anyList(), anyInt(),
                anyBoolean(), anyString(), anyString(), any());
        verify(repo, never()).findLearnersDueInMonth(
                anyString(), any(), any(), anyBoolean(), anyList(), anyInt(), any(), any(),
                anyBoolean(), anyString(), anyString(), any());
    }

    @Test
    @DisplayName("Outstanding / Upcoming list (no month): the same query as before")
    void outstandingListUnchanged() {
        when(repo.findLearnersWithBalance(anyString(), any(), any(), anyBoolean(), anyList(), anyInt(),
                anyBoolean(), anyString(), anyString(), any()))
                .thenReturn(empty());

        service.getOutstandingLearners(request(), 1, 20, true);
        service.getOutstandingLearners(request(), 1, 20, true, "  ");

        verify(repo, org.mockito.Mockito.times(2)).findLearnersWithBalance(
                eq(INSTITUTE), eq(EPOCH), any(), eq(true), eq(List.of("__none__")), eq(30),
                eq(true), eq(""), eq(""), eq(PageRequest.of(1, 20)));
        verify(repo, never()).findOutstandingLearners(anyString(), any(), any(), anyBoolean(), anyList(), anyInt(),
                anyBoolean(), anyString(), anyString(), any());
        verify(repo, never()).findLearnersDueInMonth(
                anyString(), any(), any(), anyBoolean(), anyList(), anyInt(), any(), any(),
                anyBoolean(), anyString(), anyString(), any());
    }

    @Test
    @DisplayName("Existing rows come back as before, with month_amount left null")
    void existingRowsHaveNoMonthAmount() {
        BalanceLearnerProjection row = mock(BalanceLearnerProjection.class);
        when(row.getUserId()).thenReturn("u1");
        when(row.getOutstanding()).thenReturn(45000d);
        when(row.getNextDueAmount()).thenReturn(11000d);
        when(row.getNextDueDate()).thenReturn(LocalDate.of(2026, 11, 6));
        Page<BalanceLearnerProjection> page = new PageImpl<>(List.of(row), PageRequest.of(0, 20), 1);
        when(repo.findLearnersWithBalance(anyString(), any(), any(), anyBoolean(), anyList(), anyInt(),
                anyBoolean(), anyString(), anyString(), any()))
                .thenReturn(page);
        when(authService.getUsersFromAuthServiceByUserIds(anyList())).thenReturn(List.of());

        OutstandingLearnerDTO dto = service.getOutstandingLearners(request(), 0, 20, true).getContent().get(0);

        assertEquals(45000d, dto.getOutstanding());
        assertEquals(11000d, dto.getNextDueAmount());
        assertEquals(LocalDate.of(2026, 11, 6), dto.getNextDueDate());
        assertNull(dto.getMonthAmount());
    }

    @Test
    @DisplayName("A month narrows to that month's learners, [first of month, first of next month)")
    void monthRoutesToMonthQuery() {
        MonthDueLearnerProjection row = mock(MonthDueLearnerProjection.class);
        when(row.getUserId()).thenReturn("u1");
        when(row.getMonthAmount()).thenReturn(11000d);
        Page<MonthDueLearnerProjection> page = new PageImpl<>(List.of(row), PageRequest.of(0, 20), 1);
        when(repo.findLearnersDueInMonth(
                anyString(), any(), any(), anyBoolean(), anyList(), anyInt(), any(), any(),
                anyBoolean(), anyString(), anyString(), any()))
                .thenReturn(page);
        when(authService.getUsersFromAuthServiceByUserIds(anyList())).thenReturn(List.of());

        OutstandingLearnerDTO dto = service.getOutstandingLearners(request(), 0, 20, true, "2026-12")
                .getContent().get(0);

        verify(repo).findLearnersDueInMonth(eq(INSTITUTE), eq(EPOCH), any(), eq(true), eq(List.of("__none__")),
                eq(30), eq(LocalDate.of(2026, 12, 1)), eq(LocalDate.of(2027, 1, 1)),
                eq(true), eq(""), eq(""), eq(PageRequest.of(0, 20)));
        verify(repo, never()).findLearnersWithBalance(anyString(), any(), any(), anyBoolean(), anyList(), anyInt(),
                anyBoolean(), anyString(), anyString(), any());
        assertEquals(11000d, dto.getMonthAmount());
    }

    @Test
    @DisplayName("Search box: a name narrows the Due list, trimmed, with no phone match")
    void nameSearchReachesDueList() {
        when(repo.findOutstandingLearners(anyString(), any(), any(), anyBoolean(), anyList(), anyInt(),
                anyBoolean(), anyString(), anyString(), any()))
                .thenReturn(empty());
        BillingSummaryRequestDTO r = request();
        r.setSearchString("  Nikita Patil ");

        service.getOutstandingLearners(r, 0, 20);

        verify(repo).findOutstandingLearners(eq(INSTITUTE), eq(EPOCH), any(), eq(true),
                eq(List.of("__none__")), eq(30), eq(false), eq("Nikita Patil"), eq(""),
                eq(PageRequest.of(0, 20)));
    }

    @Test
    @DisplayName("Search box: a formatted phone reaches the Outstanding list as its last ten digits")
    void phoneSearchReachesOutstandingList() {
        when(repo.findLearnersWithBalance(anyString(), any(), any(), anyBoolean(), anyList(), anyInt(),
                anyBoolean(), anyString(), anyString(), any()))
                .thenReturn(empty());
        BillingSummaryRequestDTO r = request();
        r.setSearchString("+91 95886-97989");

        service.getOutstandingLearners(r, 0, 20, true);

        verify(repo).findLearnersWithBalance(eq(INSTITUTE), eq(EPOCH), any(), eq(true),
                eq(List.of("__none__")), eq(30), eq(false), eq("+91 95886-97989"), eq("9588697989"),
                eq(PageRequest.of(0, 20)));
    }

    @Test
    @DisplayName("Phone digits: only phone-shaped searches of 5+ digits, country code dropped")
    void phoneSearchDigits() {
        assertEquals("9588697989", PaymentLogService.phoneSearchDigits("919588697989"));
        assertEquals("9588697989", PaymentLogService.phoneSearchDigits("+91 (95886) 97989"));
        assertEquals("9588697989", PaymentLogService.phoneSearchDigits("9588697989"));
        assertEquals("97989", PaymentLogService.phoneSearchDigits("97989"));
        // Too short to mean a phone: an amount such as 500 must not pull in every number with "500".
        assertEquals("", PaymentLogService.phoneSearchDigits("500"));
        assertEquals("", PaymentLogService.phoneSearchDigits("1250.50"));
        assertEquals("", PaymentLogService.phoneSearchDigits("harshitabalsaraf7@gmail.com"));
        assertEquals("", PaymentLogService.phoneSearchDigits("Nikita"));
        assertEquals("", PaymentLogService.phoneSearchDigits(null));
    }

    @Test
    @DisplayName("A malformed month is a bad request, not a silent 'no filter'")
    void badMonthRejected() {
        assertThrows(VacademyException.class,
                () -> service.getOutstandingLearners(request(), 0, 20, true, "Nov 2026"));
    }

    @Test
    @DisplayName("Billing summary: every existing figure as before, plus the instalment plan count")
    void billingSummaryFigures() {
        BillingSummaryProjection row = mock(BillingSummaryProjection.class);
        when(row.getCollected()).thenReturn(620000d);
        when(row.getDue()).thenReturn(0d);
        when(row.getUpcoming()).thenReturn(0d);
        when(row.getLearnersOwing()).thenReturn(0L);
        when(row.getLearnersUpcoming()).thenReturn(0L);
        when(row.getPlanCount()).thenReturn(28L);
        when(row.getInstalmentPlanCount()).thenReturn(28L);
        when(row.getLivePlanCount()).thenReturn(54L);
        when(row.getActivatedWithoutPaymentCount()).thenReturn(0L);
        when(row.getOutstanding()).thenReturn(845000d);
        when(row.getLearnersOutstanding()).thenReturn(23L);
        when(row.getUpcomingAll()).thenReturn(845000d);
        when(row.getLearnersUpcomingAll()).thenReturn(23L);
        when(row.getNextDueDate()).thenReturn("2026-11-06");
        when(row.getUsesInstallments()).thenReturn(true);
        when(row.getCurrency()).thenReturn("INR");
        when(repo.getBillingSummary(anyString(), any(), any(), anyBoolean(), anyList(), anyInt())).thenReturn(row);

        BillingSummaryResponseDTO dto = service.getBillingSummary(request());

        assertEquals(620000d, dto.getTotalBilled()); // still collected + due
        assertEquals(620000d, dto.getCollected());
        assertEquals(0d, dto.getDue());
        assertEquals(845000d, dto.getOutstanding());
        assertEquals(845000d, dto.getUpcomingAll());
        assertEquals(28L, dto.getPlanCount());
        assertEquals(28L, dto.getInstalmentPlanCount());
        assertEquals(54L, dto.getLivePlanCount());
        assertEquals("2026-11-06", dto.getNextDueDate());
        assertEquals(true, dto.getUsesInstallments());
    }
}
