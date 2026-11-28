package vacademy.io.admin_core_service.features.commerce.parallelrun;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunDtos.DayView;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunDtos.DaysAnswer;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunDtos.SaveDayRequest;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunMath.Figures;
import vacademy.io.admin_core_service.features.commerce.parallelrun.entity.CommerceParallelRunDay;
import vacademy.io.admin_core_service.features.commerce.parallelrun.repository.CommerceParallelRunDayRepository;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosUserNames;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportRunner;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffScopeRepository;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockClock;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The parallel-run service: access (feature, role, location), the save rules (future date, open
 * session, stale version, note on a different day, reviewer set here) and the day list with its
 * streak. The guard is the real one over a mocked resolver and staff tables; the report runner
 * runs its bodies in place.
 */
class ParallelRunServiceTest {

    private static final String INST = "inst-1";
    private static final String LOC = "loc-1";
    private static final String OTHER_LOC = "loc-2";
    private static final LocalDate TODAY = LocalDate.of(2026, 11, 20);
    private static final LocalDate DAY = TODAY.minusDays(1);

    private CapabilityResolver resolver;
    private CommerceStaffLocationRepository staffLocations;
    private CommerceStaffScopeRepository staffScopes;
    private ReportRunner runner;
    private StockClock clock;
    private ParallelRunReadRepository reads;
    private CommerceParallelRunDayRepository days;
    private CommerceAuditService audit;
    private PosUserNames names;
    private ParallelRunService service;
    private PlatformTransactionManager tm;
    private final Set<String> features = new HashSet<>();

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        resolver = mock(CapabilityResolver.class);
        staffLocations = mock(CommerceStaffLocationRepository.class);
        staffScopes = mock(CommerceStaffScopeRepository.class);
        CommerceAccessGuard guard = new CommerceAccessGuard(resolver, staffLocations);
        guard.setStaffScopeRepository(staffScopes);
        features.addAll(Set.of(CommerceFeature.REPORTS.key(), CommerceFeature.MIGRATION.key()));
        when(resolver.isFeatureGranted(eq(INST), anyString())).thenAnswer(inv -> features.contains(inv.getArgument(1)));
        when(staffLocations.existsByInstituteIdAndUserIdAndLocationId(INST, "u-1", LOC)).thenReturn(true);

        runner = mock(ReportRunner.class);
        when(runner.screenRequest(any())).thenAnswer(inv -> ((Supplier<Object>) inv.getArgument(0)).get());
        when(runner.screen(any())).thenAnswer(inv -> ((Supplier<Object>) inv.getArgument(0)).get());
        when(runner.export(any(), any())).thenAnswer(inv -> {
            ReportRunner.ExportBody body = inv.getArgument(1);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            int rows = body.write(out, 50_000);
            return new ReportRunner.ExportResult(out.toByteArray(), rows);
        });
        clock = mock(StockClock.class);
        when(clock.today(INST)).thenReturn(TODAY);
        reads = mock(ParallelRunReadRepository.class);
        when(reads.locationIds(INST)).thenReturn(List.of(LOC, OTHER_LOC));
        days = mock(CommerceParallelRunDayRepository.class);
        when(days.findByInstituteIdAndLocationIdAndBusinessDate(any(), any(), any())).thenReturn(Optional.empty());
        when(days.findFirstByInstituteIdAndLocationIdOrderByBusinessDateDesc(any(), any()))
                .thenReturn(Optional.empty());
        when(days.findByInstituteIdAndLocationIdAndBusinessDateBetweenOrderByBusinessDateAsc(any(), any(), any(),
                any())).thenReturn(List.of());
        when(days.saveAndFlush(any())).thenAnswer(inv -> {
            CommerceParallelRunDay day = inv.getArgument(0);
            if (day.getId() == null) {
                day.setId("day-1");
            }
            day.setVersion(day.getVersion() == null ? 0 : day.getVersion() + 1);
            return day;
        });
        audit = mock(CommerceAuditService.class);
        names = mock(PosUserNames.class);
        when(names.names(any())).thenReturn(Map.of("u-1", "Test Manager"));
        tm = mock(PlatformTransactionManager.class);
        when(tm.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        service = new ParallelRunService(guard, runner, clock, reads, days, audit, names, tm);

        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", INST);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static CustomUserDetails user(String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("u-1");
        dto.setUsername("u-1");
        dto.setFullName("Test User");
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    private static final CustomUserDetails MANAGER = user(CommerceRole.STORE_MANAGER.authority());
    private static final CustomUserDetails ACCOUNTANT = user(CommerceRole.ACCOUNTANT.authority());
    private static final CustomUserDetails CASHIER = user(CommerceRole.POS_CASHIER.authority());
    private static final CustomUserDetails ADMIN = user("ADMIN");

    private static BigDecimal m(String value) {
        return new BigDecimal(value);
    }

    /** The D2 day: two POS sales (500 cash, 300 UPI, 5 % tax) and one cash refund of 100. */
    private static Figures dayFigures(int openSessions) {
        return new Figures(2, m("800.00"), m("38.10"), m("400.00"), m("0.00"), openSessions);
    }

    private void platformOn(LocalDate day, Figures figures) {
        Map<LocalDate, Figures> map = new LinkedHashMap<>();
        map.put(day, figures);
        when(reads.figures(INST, LOC, day, day)).thenReturn(map);
    }

    private static SaveDayRequest body(int bills, String sales, String tax, String cash) {
        SaveDayRequest request = new SaveDayRequest();
        request.setOldBillCount(bills);
        request.setOldSalesValue(m(sales));
        request.setOldTax(m(tax));
        request.setOldCash(m(cash));
        return request;
    }

    private static String code(RuntimeException e) {
        String message = e.getMessage();
        return message.contains(":") ? message.substring(0, message.indexOf(':')) : message;
    }

    // ================================================================== save

    @Test
    void matchingFiguresSaveCleanWithTheReviewerSetByTheService() {
        platformOn(DAY, dayFigures(0));
        DayView view = service.save(MANAGER, INST, LOC, DAY, body(2, "800", "38.10", "400"));

        assertEquals("CLEAN", view.status());
        assertEquals("CLEAN", view.result());
        assertTrue(view.countsClean());
        assertEquals("u-1", view.reviewedBy());
        assertEquals("Test Manager", view.reviewedByName());
        assertNotNull(view.reviewedAt());
        assertTrue(view.reviewedAt().endsWith("+05:30"));
        ArgumentCaptor<CommerceParallelRunDay> saved = ArgumentCaptor.forClass(CommerceParallelRunDay.class);
        verify(days).saveAndFlush(saved.capture());
        CommerceParallelRunDay row = saved.getValue();
        assertEquals("u-1", row.getReviewedBy());
        assertNotNull(row.getReviewedAt());
        assertEquals(INST, row.getInstituteId());
        assertEquals(LOC, row.getLocationId());
        assertEquals(DAY, row.getBusinessDate());
        assertTrue(row.getPlatformJson().contains("\"bills\":2"));
        verify(audit).record(eq(INST), eq("u-1"), eq(LOC), eq(ParallelRunService.AUDIT_KIND),
                eq(ParallelRunService.AUDIT_REFERENCE), eq("day-1"), isNull(), anyString(), isNull());
    }

    @Test
    void aSaveReadsTheFiguresOnThePrimaryInsideItsWriteTransaction() {
        platformOn(DAY, dayFigures(0));
        service.save(MANAGER, INST, LOC, DAY, body(2, "800", "38.10", "400"));

        // No replica read and no report slot: the figures come from the write transaction.
        verify(runner, never()).screen(any());
        verify(runner, never()).screenRequest(any());
        org.mockito.InOrder order = inOrder(tm, reads, days);
        order.verify(tm).getTransaction(any());
        order.verify(reads).limitStatementTime();
        order.verify(reads).locationIds(INST);
        order.verify(reads).figures(INST, LOC, DAY, DAY);
        order.verify(days).saveAndFlush(any());
        order.verify(tm).commit(any());
    }

    @Test
    void anUnsavedDayWithOnlyACashRefundEndsTheStreak() {
        LocalDate from = TODAY.minusDays(9);
        Map<LocalDate, Figures> live = new LinkedHashMap<>();
        List<CommerceParallelRunDay> saved = new ArrayList<>();
        for (LocalDate d = from; !d.isAfter(TODAY); d = d.plusDays(1)) {
            live.put(d, dayFigures(0));
        }
        for (int i = 1; i <= 8; i++) {
            if (i != 4) {
                saved.add(savedDay(TODAY.minusDays(i), "CLEAN", dayFigures(0)));
            }
        }
        // Day -4: no bills, but a cash refund of 1,500 at the counter; nothing saved.
        live.put(TODAY.minusDays(4), new Figures(0, m("0"), m("0"), m("-1500.00"), m("0"), 0));
        when(days.findByInstituteIdAndLocationIdAndBusinessDateBetweenOrderByBusinessDateAsc(eq(INST), eq(LOC),
                any(), any())).thenReturn(saved);
        when(days.findFirstByInstituteIdAndLocationIdOrderByBusinessDateDesc(INST, LOC))
                .thenReturn(Optional.of(saved.get(0)));
        when(reads.figures(eq(INST), eq(LOC), any(), any())).thenReturn(live);

        DaysAnswer answer = service.days(MANAGER, INST, LOC, from, TODAY);
        DayView refundDay = answer.days().stream().filter(v -> v.date().equals(TODAY.minusDays(4).toString()))
                .findFirst().orElseThrow();
        assertEquals(ParallelRunService.STATUS_NOT_SAVED, refundDay.status());
        assertEquals(3, answer.streak(), "the streak stops at the unsaved day, as the list shows it");
        assertFalse(answer.passed());
    }

    @Test
    void aFutureDateIsRefused() {
        InvalidRequestException e = assertThrows(InvalidRequestException.class,
                () -> service.save(MANAGER, INST, LOC, TODAY.plusDays(1), body(2, "800", "38.10", "400")));
        assertEquals("VALIDATION", code(e));
        verifyNoInteractions(reads);
        verify(days, never()).saveAndFlush(any());
    }

    @Test
    void anOpenSessionOnTheDayIsAConflict() {
        platformOn(DAY, dayFigures(1));
        ConflictException e = assertThrows(ConflictException.class,
                () -> service.save(MANAGER, INST, LOC, DAY, body(2, "800", "38.10", "400")));
        assertEquals("SESSION_OPEN", code(e));
        verify(days, never()).saveAndFlush(any());
        verify(tm).rollback(any());
    }

    @Test
    void aStaleVersionIsAConflict() {
        platformOn(DAY, dayFigures(0));
        CommerceParallelRunDay existing = savedDay(DAY, "CLEAN", dayFigures(0));
        existing.setVersion(3);
        when(days.findByInstituteIdAndLocationIdAndBusinessDate(INST, LOC, DAY)).thenReturn(Optional.of(existing));

        SaveDayRequest stale = body(2, "800", "38.10", "400");
        stale.setVersion(2);
        assertEquals("DAY_CHANGED", code(assertThrows(ConflictException.class,
                () -> service.save(MANAGER, INST, LOC, DAY, stale))));
        // A client that never read the saved day sends no version: also a conflict.
        assertEquals("DAY_CHANGED", code(assertThrows(ConflictException.class,
                () -> service.save(MANAGER, INST, LOC, DAY, body(2, "800", "38.10", "400")))));
        verify(days, never()).saveAndFlush(any());

        SaveDayRequest current = body(2, "800", "38.10", "400");
        current.setVersion(3);
        DayView view = service.save(MANAGER, INST, LOC, DAY, current);
        assertEquals(4, view.version());
        verify(audit).record(eq(INST), eq("u-1"), eq(LOC), eq(ParallelRunService.AUDIT_KIND),
                eq(ParallelRunService.AUDIT_REFERENCE), eq("day-" + DAY), anyString(), anyString(), isNull());
    }

    @Test
    void anOptimisticLockRaceIsAConflict() {
        platformOn(DAY, dayFigures(0));
        doThrow(new ObjectOptimisticLockingFailureException(CommerceParallelRunDay.class, "day-1"))
                .when(days).saveAndFlush(any());
        assertEquals("DAY_CHANGED", code(assertThrows(ConflictException.class,
                () -> service.save(MANAGER, INST, LOC, DAY, body(2, "800", "38.10", "400")))));
    }

    @Test
    void aDifferentDayNeedsANote() {
        platformOn(DAY, dayFigures(0));
        InvalidRequestException e = assertThrows(InvalidRequestException.class,
                () -> service.save(MANAGER, INST, LOC, DAY, body(2, "802", "38.10", "400")));
        assertEquals("NOTE_REQUIRED", code(e));
        verify(days, never()).saveAndFlush(any());

        SaveDayRequest withNote = body(2, "802", "38.10", "400");
        withNote.setNote("  One bill keyed twice in the old system  ");
        DayView view = service.save(MANAGER, INST, LOC, DAY, withNote);
        assertEquals("DIFFERENT", view.result());
        assertFalse(view.countsClean());
        assertEquals("One bill keyed twice in the old system", view.note());
        assertEquals(m("2.00"), view.difference().salesValue());
    }

    @Test
    void badFiguresAreRefused() {
        assertEquals("VALIDATION", code(assertThrows(InvalidRequestException.class,
                () -> service.save(MANAGER, INST, LOC, DAY, body(2, "800.001", "38.10", "400")))));
        assertEquals("VALIDATION", code(assertThrows(InvalidRequestException.class,
                () -> service.save(MANAGER, INST, LOC, DAY, body(-1, "800", "38.10", "400")))));
        assertEquals("VALIDATION", code(assertThrows(InvalidRequestException.class,
                () -> service.save(MANAGER, INST, LOC, DAY, body(2, "-5", "38.10", "400")))));
        SaveDayRequest missing = body(2, "800", "38.10", "400");
        missing.setOldTax(null);
        assertEquals("VALIDATION", code(assertThrows(InvalidRequestException.class,
                () -> service.save(MANAGER, INST, LOC, DAY, missing))));
        assertEquals("VALIDATION", code(assertThrows(InvalidRequestException.class,
                () -> service.save(MANAGER, INST, LOC, DAY, null))));
        verifyNoInteractions(reads);
    }

    @Test
    void aManagerOfAnotherLocationIsRefused() {
        CommerceAccessDeniedException e = assertThrows(CommerceAccessDeniedException.class,
                () -> service.save(MANAGER, INST, OTHER_LOC, DAY, body(2, "800", "38.10", "400")));
        assertEquals(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED, e.getCode());
        CommerceAccessDeniedException read = assertThrows(CommerceAccessDeniedException.class,
                () -> service.days(MANAGER, INST, OTHER_LOC, null, null));
        assertEquals(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED, read.getCode());
        verifyNoInteractions(reads);
    }

    @Test
    void theAccountantAndTheCashierCannotSave() {
        assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, assertThrows(CommerceAccessDeniedException.class,
                () -> service.save(ACCOUNTANT, INST, LOC, DAY, body(2, "800", "38.10", "400"))).getCode());
        assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, assertThrows(CommerceAccessDeniedException.class,
                () -> service.save(CASHIER, INST, LOC, DAY, body(2, "800", "38.10", "400"))).getCode());
        assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, assertThrows(CommerceAccessDeniedException.class,
                () -> service.days(CASHIER, INST, LOC, null, null)).getCode());
        verify(days, never()).saveAndFlush(any());
    }

    @Test
    void migrationOffRefusesEveryRoute() {
        features.remove(CommerceFeature.MIGRATION.key());
        for (CustomUserDetails who : List.of(ADMIN, MANAGER, ACCOUNTANT)) {
            assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED,
                    assertThrows(CommerceAccessDeniedException.class,
                            () -> service.save(who, INST, LOC, DAY, body(2, "800", "38.10", "400"))).getCode());
            assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED,
                    assertThrows(CommerceAccessDeniedException.class,
                            () -> service.days(who, INST, LOC, null, null)).getCode());
            assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED,
                    assertThrows(CommerceAccessDeniedException.class,
                            () -> service.export(who, INST, LOC, null, null, "csv", false)).getCode());
        }
        verifyNoInteractions(reads, audit);
    }

    @Test
    void reportsOffRefusesToo() {
        features.remove(CommerceFeature.REPORTS.key());
        assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED, assertThrows(CommerceAccessDeniedException.class,
                () -> service.save(MANAGER, INST, LOC, DAY, body(2, "800", "38.10", "400"))).getCode());
        assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED, assertThrows(CommerceAccessDeniedException.class,
                () -> service.days(ACCOUNTANT, INST, LOC, null, null)).getCode());
    }

    @Test
    void anAdminMustNameALocationOfTheInstitute() {
        when(reads.figures(any(), eq("loc-x"), any(), any())).thenReturn(Map.of());
        assertEquals(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED,
                assertThrows(CommerceAccessDeniedException.class,
                        () -> service.save(ADMIN, INST, "loc-x", DAY, body(2, "800", "38.10", "400"))).getCode());
        assertEquals("VALIDATION", code(assertThrows(InvalidRequestException.class,
                () -> service.days(ADMIN, INST, " ", null, null))));
    }

    // ================================================================== days

    private CommerceParallelRunDay savedDay(LocalDate day, String result, Figures platform) {
        CommerceParallelRunDay row = new CommerceParallelRunDay();
        row.setId("day-" + day);
        row.setInstituteId(INST);
        row.setLocationId(LOC);
        row.setBusinessDate(day);
        row.setOldBillCount((int) platform.bills());
        row.setOldSalesValue(platform.salesValue());
        row.setOldTax(platform.tax());
        row.setOldCash(platform.cash());
        row.setPlatformJson(ParallelRunService.writePlatform(platform));
        row.setResult(result);
        row.setReviewedBy("u-1");
        row.setReviewedAt(day.atTime(14, 0));
        row.setVersion(0);
        return row;
    }

    @Test
    void sevenSavedCleanDaysPassAndAChangedPlatformDayAsksForARecheck() {
        LocalDate from = TODAY.minusDays(9);
        Map<LocalDate, Figures> live = new LinkedHashMap<>();
        List<CommerceParallelRunDay> saved = new ArrayList<>();
        for (LocalDate d = from; !d.isAfter(TODAY); d = d.plusDays(1)) {
            live.put(d, dayFigures(0));
        }
        // Saved: the seven days before yesterday (yesterday and today trade, not saved yet).
        for (int i = 2; i <= 8; i++) {
            saved.add(savedDay(TODAY.minusDays(i), "CLEAN", dayFigures(0)));
        }
        when(days.findByInstituteIdAndLocationIdAndBusinessDateBetweenOrderByBusinessDateAsc(eq(INST), eq(LOC),
                any(), any())).thenReturn(saved);
        when(days.findFirstByInstituteIdAndLocationIdOrderByBusinessDateDesc(INST, LOC))
                .thenReturn(Optional.of(saved.get(0)));
        when(reads.figures(eq(INST), eq(LOC), any(), any())).thenReturn(live);

        DaysAnswer answer = service.days(ACCOUNTANT, INST, LOC, from, TODAY);
        assertEquals(7, answer.streak());
        assertTrue(answer.passed());
        assertEquals(10, answer.days().size());
        assertEquals(TODAY.minusDays(2).toString(), answer.latestSaved());
        DayView yesterday = answer.days().get(8);
        assertEquals(ParallelRunService.STATUS_NOT_SAVED, yesterday.status());
        assertNull(yesterday.old());
        assertEquals("CLEAN", answer.days().get(2).status());
        assertEquals("Test Manager", answer.days().get(2).reviewedByName());

        // A bill keyed later for one of the saved days: that day asks for a recheck and breaks the streak.
        live.put(TODAY.minusDays(4), new Figures(3, m("900.00"), m("42.86"), m("400.00"), m("0.00"), 0));
        DaysAnswer after = service.days(MANAGER, INST, LOC, from, TODAY);
        DayView changed = after.days().get(5);
        assertEquals(TODAY.minusDays(4).toString(), changed.date());
        assertEquals(ParallelRunService.STATUS_RECHECK, changed.status());
        assertTrue(changed.platformChanged());
        assertEquals("CLEAN", changed.result());
        assertEquals(2, after.streak());
        assertFalse(after.passed());
    }

    @Test
    void anInstituteWideAccountantReadsWithoutAnAssignment() {
        when(staffScopes.existsByInstituteIdAndUserIdAndAllLocationsTrue(INST, "u-1")).thenReturn(true);
        when(reads.figures(eq(INST), eq(OTHER_LOC), any(), any())).thenReturn(Map.of());
        DaysAnswer answer = service.days(ACCOUNTANT, INST, OTHER_LOC, TODAY.minusDays(2), TODAY);
        assertEquals(3, answer.days().size());
        assertEquals(ParallelRunService.STATUS_NO_SALES, answer.days().get(0).status());
        assertEquals(0, answer.streak());
    }

    @Test
    void theRangeIsAtMostSixtyTwoDaysAndStopsAtToday() {
        assertEquals("VALIDATION", code(assertThrows(InvalidRequestException.class,
                () -> service.days(MANAGER, INST, LOC, TODAY.minusDays(62), TODAY))));
        assertEquals("VALIDATION", code(assertThrows(InvalidRequestException.class,
                () -> service.days(MANAGER, INST, LOC, TODAY.plusDays(1), TODAY.plusDays(3)))));
        when(reads.figures(eq(INST), eq(LOC), any(), any())).thenReturn(Map.of());
        DaysAnswer answer = service.days(MANAGER, INST, LOC, null, TODAY.plusDays(10));
        assertEquals(TODAY.withDayOfMonth(1).toString(), answer.from());
        assertEquals(TODAY.toString(), answer.to());
    }

    @Test
    void theExportHasOneRowPerDay() {
        when(reads.figures(eq(INST), eq(LOC), any(), any())).thenReturn(Map.of());
        ParallelRunService.ExportFile file = service.export(MANAGER, INST, LOC, TODAY.minusDays(2), TODAY, "csv",
                false);
        String csv = new String(file.bytes(), StandardCharsets.UTF_8);
        assertTrue(csv.contains("date"));
        assertTrue(csv.contains(TODAY.toString()));
        assertEquals("parallel-run-" + TODAY.minusDays(2) + "-" + TODAY + ".csv", file.fileName());
        assertEquals("VALIDATION", code(assertThrows(InvalidRequestException.class,
                () -> service.export(MANAGER, INST, LOC, null, null, "pdf", false))));
    }
}
