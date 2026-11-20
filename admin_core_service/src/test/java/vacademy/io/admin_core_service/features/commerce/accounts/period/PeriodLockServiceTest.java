package vacademy.io.admin_core_service.features.commerce.accounts.period;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.PessimisticLockException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.orm.jpa.JpaSystemException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.commerce.accounts.AccountsAccess;
import vacademy.io.admin_core_service.features.commerce.accounts.AccountsAuditKinds;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommercePeriodLock;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.Approval;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.PeriodLockRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.PeriodLockView;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.PreviewItem;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.PreviewSample;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.PreviewView;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommercePeriodLockRepository;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommercePeriodLockRepository.LockRow;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard.FeatureState;
import vacademy.io.admin_core_service.features.commerce.security.CommerceApprovalService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockClock;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.sql.SQLException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
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
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** The period lock: assertOpen's protocol and the lock / unlock / preview actions. */
class PeriodLockServiceTest {

    private static final String INST = "inst-1";
    private static final LocalDate TODAY = LocalDate.of(2026, 11, 20);
    private static final LocalDate OCT_31 = LocalDate.of(2026, 10, 31);
    private static final ObjectMapper JSON = new ObjectMapper();

    private CommercePeriodLockRepository repo;
    private CommerceAccessGuard guard;
    private CommerceRequestGuard requestGuard;
    private CommerceApprovalService approvals;
    private CommerceAuditService audit;
    private JdbcTemplate jdbc;
    private PlatformTransactionManager txManager;
    private final List<PeriodLockPreviewContributor> contributors = new ArrayList<>();
    private PeriodLockService service;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        repo = mock(CommercePeriodLockRepository.class);
        guard = mock(CommerceAccessGuard.class);
        requestGuard = mock(CommerceRequestGuard.class);
        approvals = mock(CommerceApprovalService.class);
        audit = mock(CommerceAuditService.class);
        jdbc = mock(JdbcTemplate.class);
        txManager = mock(PlatformTransactionManager.class);
        StockClock clock = mock(StockClock.class);
        when(clock.today(anyString())).thenReturn(TODAY);
        when(guard.featureState(anyString(), eq(CommerceFeature.ACCOUNTS))).thenReturn(FeatureState.ON);
        when(requestGuard.run(any(), any(), any())).thenAnswer(inv ->
                new CommerceRequestGuard.Outcome<>(((Supplier<Object>) inv.getArgument(1)).get(), false));
        when(repo.findByInstituteId(anyString())).thenReturn(Optional.empty());
        contributors.clear();
        contributors.add(contributor("UNBILLED_RECEIPTS", 3));
        service = new PeriodLockService(repo, guard, clock, requestGuard, approvals, audit, jdbc, txManager,
                contributors);
    }

    @AfterEach
    void clearTransactionState() {
        TransactionSynchronizationManager.clear();
    }

    private static LockRow row(LocalDate lockedThrough) {
        return () -> lockedThrough;
    }

    private static PeriodLockPreviewContributor contributor(String kind, long count) {
        return new PeriodLockPreviewContributor() {
            @Override
            public String kind() {
                return kind;
            }

            @Override
            public PreviewItem items(String instituteId, LocalDate through) {
                return new PreviewItem(kind, count, List.of(new PreviewSample("r1", "GRN-000001", through)));
            }
        };
    }

    private static CustomUserDetails user(String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("user-1");
        dto.setUsername("user-1");
        dto.setFullName("Test User");
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    private static PeriodLockRequest request(LocalDate through, String reason, String approver, String pin) {
        PeriodLockRequest r = new PeriodLockRequest();
        r.setClientRequestId("lock-req-0001");
        r.setLockedThrough(through);
        r.setReason(reason);
        if (approver != null || pin != null) {
            r.setApproval(new Approval(approver, pin));
        }
        return r;
    }

    private void stored(LocalDate lockedThrough) {
        when(repo.readPlain(INST)).thenReturn(List.of(row(lockedThrough)));
        when(repo.readForUpdate(INST)).thenReturn(List.of(row(lockedThrough)));
        CommercePeriodLock lock = new CommercePeriodLock();
        lock.setInstituteId(INST);
        lock.setLockedThrough(lockedThrough);
        lock.setLockedBy(lockedThrough == null ? null : "someone");
        lock.setLockedAt(lockedThrough == null ? null : LocalDateTime.of(2026, 11, 1, 10, 0));
        when(repo.findByInstituteId(INST)).thenReturn(Optional.of(lock));
    }

    private void inActualTransaction(boolean readOnly) {
        TransactionSynchronizationManager.setActualTransactionActive(true);
        TransactionSynchronizationManager.setCurrentTransactionReadOnly(readOnly);
    }

    private static String periodLocked(Runnable call) {
        ConflictException e = assertThrows(ConflictException.class, call::run);
        assertTrue(e.getMessage().startsWith("PERIOD_LOCKED: "), e.getMessage());
        return e.getMessage();
    }

    // ------------------------------------------------------------------ assertOpen

    @Test
    void dateTodayOrLaterOrNullMakesNoDatabaseCall() {
        service.assertOpen(INST, TODAY);
        service.assertOpen(INST, TODAY.plusDays(30));
        service.assertOpen(INST, null);
        verifyNoInteractions(repo, txManager);
        verify(guard, never()).featureState(anyString(), any());
    }

    @Test
    void featureOffAndNoRowCreatesNothing() {
        when(guard.featureState(INST, CommerceFeature.ACCOUNTS)).thenReturn(FeatureState.OFF);
        when(repo.readForShare(INST)).thenReturn(List.of());
        inActualTransaction(false);
        service.assertOpen(INST, OCT_31);
        verify(repo, never()).ensureRow(anyString(), anyString());
    }

    @Test
    void featureOffMakesNoDatabaseCallAndOpensNoTransaction() {
        when(guard.featureState(INST, CommerceFeature.ACCOUNTS)).thenReturn(FeatureState.OFF);
        service.assertOpen(INST, OCT_31);
        inActualTransaction(false);
        service.assertOpen(INST, OCT_31);
        verifyNoInteractions(repo, txManager);
    }

    @Test
    void featureOnAndNoRowEnsuresTheRowThenRereads() {
        when(repo.readForShare(INST)).thenReturn(List.of(), List.of(row(null)));
        inActualTransaction(false);
        service.assertOpen(INST, OCT_31);
        InOrder order = inOrder(repo);
        order.verify(repo).readForShare(INST);
        order.verify(repo).ensureRow(anyString(), eq(INST));
        order.verify(repo).readForShare(INST);
    }

    @Test
    void aLockCommittedWhileTheRowWasEnsuredIsHonoured() {
        // The first post and the first lock: the post waited for the lock's insert and re-reads its date.
        when(repo.readForShare(INST)).thenReturn(List.of(), List.of(row(OCT_31)));
        inActualTransaction(false);
        periodLocked(() -> service.assertOpen(INST, OCT_31));
        verify(repo).ensureRow(anyString(), eq(INST));
    }

    @Test
    void lockedAndDateOnOrBeforeTheLockIsRefusedNamingBothDates() {
        when(repo.readForShare(INST)).thenReturn(List.of(row(OCT_31)));
        inActualTransaction(false);
        String message = periodLocked(() -> service.assertOpen(INST, OCT_31));
        assertTrue(message.contains("2026-10-31"), message);
        assertTrue(message.contains("2026-11-01"), message);
        periodLocked(() -> service.assertOpen(INST, LocalDate.of(2025, 1, 1)));
        verify(repo, never()).ensureRow(anyString(), anyString());
    }

    @Test
    void dateAfterTheLockIsOpenAskingTheFeatureOnceBeforeTheRead() {
        when(repo.readForShare(INST)).thenReturn(List.of(row(OCT_31)));
        inActualTransaction(false);
        assertDoesNotThrow(() -> service.assertOpen(INST, LocalDate.of(2026, 11, 1)));
        InOrder order = inOrder(guard, repo);
        order.verify(guard).featureState(INST, CommerceFeature.ACCOUNTS);
        order.verify(repo).readForShare(INST);
        verify(guard, times(1)).featureState(anyString(), any());
    }

    @Test
    void rowWithNothingLockedIsOpen() {
        when(repo.readForShare(INST)).thenReturn(List.of(row(null)));
        inActualTransaction(false);
        assertDoesNotThrow(() -> service.assertOpen(INST, LocalDate.of(2020, 1, 1)));
    }

    @Test
    void lockedButFeatureOffIsDormant() {
        when(repo.readForShare(INST)).thenReturn(List.of(row(OCT_31)));
        when(guard.featureState(INST, CommerceFeature.ACCOUNTS)).thenReturn(FeatureState.OFF);
        inActualTransaction(false);
        assertDoesNotThrow(() -> service.assertOpen(INST, OCT_31));
    }

    @Test
    void unknownFeatureStateKeepsTheLock() {
        when(repo.readForShare(INST)).thenReturn(List.of(row(OCT_31)));
        when(guard.featureState(INST, CommerceFeature.ACCOUNTS)).thenReturn(FeatureState.UNKNOWN);
        inActualTransaction(false);
        periodLocked(() -> service.assertOpen(INST, OCT_31));
        // UNKNOWN with no row also creates the row (only OFF skips it).
        when(repo.readForShare("inst-2")).thenReturn(List.of(), List.of(row(null)));
        when(guard.featureState("inst-2", CommerceFeature.ACCOUNTS)).thenReturn(FeatureState.UNKNOWN);
        service.assertOpen("inst-2", OCT_31);
        verify(repo).ensureRow(anyString(), eq("inst-2"));
    }

    @Test
    void readOnlyTransactionInsertsNothingAndTakesNoRowLock() {
        inActualTransaction(true);
        service.assertOpen(INST, OCT_31);
        verify(repo, never()).ensureRow(anyString(), anyString());
        verify(repo, never()).readForShare(anyString());

        stored(OCT_31);
        periodLocked(() -> service.assertOpen(INST, OCT_31));
        verify(repo, never()).readForShare(anyString());
    }

    @Test
    void insideATransactionTheCheckJoinsIt() {
        when(repo.readForShare(INST)).thenReturn(List.of(row(null)));
        inActualTransaction(false);
        service.assertOpen(INST, OCT_31);
        verifyNoInteractions(txManager);
    }

    @Test
    void outsideATransactionTheCheckRunsInAShortOneOfItsOwn() {
        when(repo.readForShare(INST)).thenReturn(List.of(row(OCT_31)));
        periodLocked(() -> service.assertOpen(INST, OCT_31));
        ArgumentCaptor<TransactionDefinition> definition = ArgumentCaptor.forClass(TransactionDefinition.class);
        verify(txManager).getTransaction(definition.capture());
        assertFalse(definition.getValue().isReadOnly());
    }

    // ------------------------------------------------------------------ guard and validation

    @Test
    void routesUseTheirGuards() {
        CustomUserDetails ac = user("COMMERCE_ACCOUNTANT");
        stored(null);
        service.read(ac, INST);
        verify(guard).require(ac, INST, CommerceFeature.ACCOUNTS, AccountsAccess.ACCOUNTS_STAFF);
        service.preview(ac, INST, OCT_31);
        verify(guard).requireInstituteWide(ac, INST, CommerceFeature.ACCOUNTS, AccountsAccess.ACCOUNTS_STAFF);
        service.change(ac, INST, request(OCT_31, null, null, null));
        verify(guard, times(2)).requireInstituteWide(ac, INST, CommerceFeature.ACCOUNTS, AccountsAccess.ACCOUNTS_STAFF);
    }

    @Test
    void aRefusedCallerReachesNothing() {
        CustomUserDetails ac = user("COMMERCE_ACCOUNTANT");
        doThrow(new CommerceAccessDeniedException(CommerceAccessDeniedException.INSTITUTE_WIDE_REQUIRED, "x"))
                .when(guard).requireInstituteWide(any(), anyString(), any(), any());
        assertThrows(CommerceAccessDeniedException.class, () -> service.change(ac, INST, request(OCT_31, null, null,
                null)));
        assertThrows(CommerceAccessDeniedException.class, () -> service.preview(ac, INST, OCT_31));
        verifyNoInteractions(repo, requestGuard, jdbc);
    }

    @Test
    void lockDateMustBeBeforeTodayAndFrom2000() {
        CustomUserDetails m = user("COMMERCE_STORE_MANAGER");
        for (LocalDate bad : new LocalDate[]{TODAY, TODAY.plusDays(1), LocalDate.of(1999, 12, 31)}) {
            InvalidRequestException e = assertThrows(InvalidRequestException.class,
                    () -> service.change(m, INST, request(bad, null, null, null)));
            assertTrue(e.getMessage().startsWith("VALIDATION: the lock date must be before today"), e.getMessage());
        }
        assertThrows(InvalidRequestException.class, () -> service.preview(m, INST, TODAY));
        assertThrows(InvalidRequestException.class, () -> service.preview(m, INST, null));
        PeriodLockRequest noKey = request(OCT_31, null, null, null);
        noKey.setClientRequestId("short");
        assertThrows(InvalidRequestException.class, () -> service.change(m, INST, noKey));
        assertThrows(InvalidRequestException.class,
                () -> service.change(m, INST, request(OCT_31, "r".repeat(501), null, null)));
        verifyNoInteractions(requestGuard);
    }

    // ------------------------------------------------------------------ change

    @Test
    void noneWritesNothing() {
        CustomUserDetails m = user("COMMERCE_STORE_MANAGER");
        stored(OCT_31);
        PeriodLockView same = service.change(m, INST, request(OCT_31, null, null, null));
        assertFalse(same.isChanged());
        assertEquals("NONE", same.getDirection());
        assertEquals(OCT_31, same.getLockedThrough());
        assertEquals(LocalDate.of(2026, 11, 1), same.getFirstOpenDate());

        stored(null);
        PeriodLockView bothNull = service.change(m, INST, request(null, null, null, null));
        assertFalse(bothNull.isChanged());
        assertNull(bothNull.getFirstOpenDate());

        verify(repo, never()).setLockedThrough(anyString(), any(), any());
        verifyNoInteractions(audit, approvals);
    }

    @Test
    void lockWritesUpdateAndAuditWithPreviewCounts() throws Exception {
        CustomUserDetails ac = user("COMMERCE_ACCOUNTANT");
        stored(null);
        PeriodLockView view = service.change(ac, INST, request(OCT_31, "month end", null, null));

        assertTrue(view.isChanged());
        assertEquals("LOCK", view.getDirection());
        assertNotNull(view.getPreview());
        assertEquals(3, view.getPreview().getItems().get(0).getCount());

        InOrder order = inOrder(jdbc, repo, audit);
        order.verify(jdbc).execute("SET LOCAL lock_timeout = '5s'");
        order.verify(repo).ensureRow(anyString(), eq(INST));
        order.verify(repo).readForUpdate(INST);
        order.verify(repo).setLockedThrough(INST, OCT_31, "user-1");
        ArgumentCaptor<String> oldJson = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> newJson = ArgumentCaptor.forClass(String.class);
        order.verify(audit).record(eq(INST), eq("user-1"), isNull(), eq(AccountsAuditKinds.PERIOD_LOCK),
                eq("PERIOD_LOCK"), eq(INST), oldJson.capture(), newJson.capture(), eq("month end"));
        assertTrue(JSON.readTree(oldJson.getValue()).get("locked_through").isNull());
        JsonNode created = JSON.readTree(newJson.getValue());
        assertEquals("2026-10-31", created.get("locked_through").asText());
        assertEquals(3, created.get("preview_counts").get("UNBILLED_RECEIPTS").asInt());
        verifyNoInteractions(approvals);
    }

    @Test
    void movingTheLockForwardIsALockWithoutPin() {
        CustomUserDetails ac = user("COMMERCE_ACCOUNTANT");
        stored(LocalDate.of(2026, 9, 30));
        assertEquals("LOCK", service.change(ac, INST, request(OCT_31, null, null, null)).getDirection());
        verifyNoInteractions(approvals);
    }

    @Test
    void unlockByAnAccountantIsRoleNotAllowed() {
        CustomUserDetails ac = user("COMMERCE_ACCOUNTANT");
        stored(OCT_31);
        CommerceAccessDeniedException e = assertThrows(CommerceAccessDeniedException.class,
                () -> service.change(ac, INST, request(LocalDate.of(2026, 9, 30), "wrong entry", "user-1", "1234")));
        assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, e.getCode());
        verify(repo, never()).setLockedThrough(anyString(), any(), any());
        verifyNoInteractions(approvals, audit);
    }

    @Test
    void unlockWithoutReasonOrApprovalIs400() {
        CustomUserDetails m = user("COMMERCE_STORE_MANAGER");
        stored(OCT_31);
        assertThrows(InvalidRequestException.class,
                () -> service.change(m, INST, request(null, null, "user-1", "1234")));
        assertThrows(InvalidRequestException.class,
                () -> service.change(m, INST, request(null, "no", "user-1", "1234")));
        assertThrows(InvalidRequestException.class,
                () -> service.change(m, INST, request(null, "wrong entry", null, null)));
        verify(repo, never()).setLockedThrough(anyString(), any(), any());
        verifyNoInteractions(approvals, audit);
    }

    @Test
    void unlockApprovedByAnotherUserIs400() {
        CustomUserDetails m = user("COMMERCE_STORE_MANAGER");
        stored(OCT_31);
        InvalidRequestException e = assertThrows(InvalidRequestException.class,
                () -> service.change(m, INST, request(null, "wrong entry", "user-2", "1234")));
        assertTrue(e.getMessage().contains("your own PIN"));
        verifyNoInteractions(approvals);
    }

    @Test
    void unlockIsApprovedWithPeriodUnlockAndNoLocationThenAudited() {
        CustomUserDetails m = user("COMMERCE_STORE_MANAGER");
        stored(OCT_31);
        PeriodLockView view = service.change(m, INST, request(LocalDate.of(2026, 9, 30), "late supplier bill",
                "user-1", "1234"));
        assertEquals("UNLOCK", view.getDirection());
        assertNull(view.getPreview());
        InOrder order = inOrder(approvals, repo, audit);
        order.verify(approvals).approve(INST, null, "user-1", "user-1", "1234", "PERIOD_UNLOCK", "PERIOD_LOCK", INST,
                null, "late supplier bill");
        order.verify(repo).setLockedThrough(INST, LocalDate.of(2026, 9, 30), "user-1");
        order.verify(audit).record(eq(INST), eq("user-1"), isNull(), eq(AccountsAuditKinds.PERIOD_UNLOCK),
                eq("PERIOD_LOCK"), eq(INST), anyString(), anyString(), eq("late supplier bill"));
    }

    @Test
    void unlockApprovalRunsBeforeTheRowLock() {
        CustomUserDetails m = user("COMMERCE_STORE_MANAGER");
        stored(OCT_31);
        service.change(m, INST, request(LocalDate.of(2026, 9, 30), "late supplier bill", "user-1", "1234"));
        InOrder order = inOrder(jdbc, repo, approvals);
        order.verify(jdbc).execute("SET LOCAL lock_timeout = '5s'");
        order.verify(repo).readPlain(INST);
        order.verify(approvals).approve(anyString(), isNull(), anyString(), anyString(), any(), eq("PERIOD_UNLOCK"),
                anyString(), anyString(), any(), any());
        order.verify(repo).readForUpdate(INST);
        order.verify(repo).setLockedThrough(INST, LocalDate.of(2026, 9, 30), "user-1");
        verify(approvals, times(1)).approve(anyString(), any(), anyString(), anyString(), any(), anyString(),
                anyString(), anyString(), any(), any());
    }

    @Test
    void anUnlockWhoseLockMovedBeforeTheRowLockIs409AndWritesNothing() {
        CustomUserDetails m = user("COMMERCE_STORE_MANAGER");
        stored(OCT_31);
        // Someone else reopened to the same date between the first read and the row lock.
        when(repo.readForUpdate(INST)).thenReturn(List.of(row(LocalDate.of(2026, 9, 30))));
        ConflictException e = assertThrows(ConflictException.class, () -> service.change(m, INST,
                request(LocalDate.of(2026, 9, 30), "late supplier bill", "user-1", "1234")));
        assertTrue(e.getMessage().startsWith("PERIOD_LOCK_BUSY: "), e.getMessage());
        verify(repo, never()).setLockedThrough(anyString(), any(), any());
        verifyNoInteractions(audit);
    }

    @Test
    void aLockThatTurnedIntoAnUnlockUnderTheRowLockIsRefusedWithoutApproval() {
        stored(LocalDate.of(2026, 9, 30));
        when(repo.readForUpdate(INST)).thenReturn(List.of(row(LocalDate.of(2026, 11, 10))));
        ConflictException busy = assertThrows(ConflictException.class, () -> service.change(
                user("COMMERCE_STORE_MANAGER"), INST, request(OCT_31, "month end", "user-1", "1234")));
        assertTrue(busy.getMessage().startsWith("PERIOD_LOCK_BUSY: "), busy.getMessage());
        CommerceAccessDeniedException denied = assertThrows(CommerceAccessDeniedException.class,
                () -> service.change(user("COMMERCE_ACCOUNTANT"), INST, request(OCT_31, "month end", null, null)));
        assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, denied.getCode());
        verify(repo, never()).setLockedThrough(anyString(), any(), any());
        verifyNoInteractions(approvals, audit);
    }

    @Test
    void anAdminMayReopenEverything() {
        CustomUserDetails admin = user("ADMIN");
        stored(OCT_31);
        PeriodLockView view = service.change(admin, INST, request(null, "start over", "user-1", "1234"));
        assertEquals("UNLOCK", view.getDirection());
        verify(repo).setLockedThrough(INST, null, "user-1");
    }

    @Test
    void aWrongPinRollsTheUnlockBack() {
        CustomUserDetails m = user("COMMERCE_STORE_MANAGER");
        stored(OCT_31);
        when(approvals.approve(anyString(), any(), anyString(), anyString(), any(), anyString(), anyString(),
                anyString(), any(), any())).thenThrow(new CommerceAccessDeniedException(
                CommerceAccessDeniedException.PIN_INVALID, "wrong PIN"));
        assertThrows(CommerceAccessDeniedException.class,
                () -> service.change(m, INST, request(null, "start over", "user-1", "0000")));
        verify(repo, never()).setLockedThrough(anyString(), any(), any());
        verifyNoInteractions(audit);
    }

    @Test
    void lockTimeoutIs409Busy() {
        CustomUserDetails m = user("COMMERCE_STORE_MANAGER");
        List<RuntimeException> waits = List.of(
                new CannotAcquireLockException("canceling statement due to lock timeout"),
                new JpaSystemException(new PessimisticLockException("lock timeout")),
                new JpaSystemException(new RuntimeException(new SQLException("lock timeout", "55P03"))));
        for (RuntimeException wait : waits) {
            doThrow(wait).when(repo).readForUpdate(INST);
            ConflictException e = assertThrows(ConflictException.class,
                    () -> service.change(m, INST, request(OCT_31, null, null, null)));
            assertTrue(e.getMessage().startsWith("PERIOD_LOCK_BUSY: "), e.getMessage());
        }
        assertFalse(PeriodLockService.isLockTimeout(new IllegalStateException("other")));
    }

    @Test
    void requestHashExcludesThePin() {
        String a = PeriodLockService.requestHash(INST, request(null, "start over", "user-1", "1234"));
        String b = PeriodLockService.requestHash(INST, request(null, "start over", "user-1", "9876"));
        String c = PeriodLockService.requestHash(INST, request(null, "start over", null, null));
        String d = PeriodLockService.requestHash(INST, request(OCT_31, "start over", "user-1", "1234"));
        assertEquals(a, b);
        assertEquals(a, c);
        assertNotEquals(a, d);
        assertNotEquals(a, PeriodLockService.requestHash("inst-2", request(null, "start over", "user-1", "1234")));

        CustomUserDetails m = user("COMMERCE_STORE_MANAGER");
        stored(OCT_31);
        PeriodLockRequest withPin = request(null, "start over", "user-1", "4321");
        service.change(m, INST, withPin);
        ArgumentCaptor<CommerceRequestGuard.Key> key = ArgumentCaptor.forClass(CommerceRequestGuard.Key.class);
        verify(requestGuard).run(key.capture(), any(), any());
        assertEquals(PeriodLockService.requestHash(INST, withPin), key.getValue().requestHash());
        assertEquals("PERIOD_LOCK", key.getValue().action());
        assertEquals("lock-req-0001", key.getValue().clientRequestId());
        assertFalse(key.getValue().toString().contains("4321"));
        assertFalse(withPin.toString().contains("4321"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void aReplayAnswersTheCurrentLockUnchanged() {
        org.mockito.Mockito.doAnswer(inv ->
                new CommerceRequestGuard.Outcome<>(((Supplier<Object>) inv.getArgument(2)).get(), true))
                .when(requestGuard).run(any(), any(), any());
        stored(OCT_31);
        PeriodLockView view = service.change(user("COMMERCE_STORE_MANAGER"), INST, request(OCT_31, null, null, null));
        assertFalse(view.isChanged());
        assertEquals(OCT_31, view.getLockedThrough());
        assertEquals("someone", view.getLockedBy());
        verifyNoInteractions(jdbc);
    }

    @Test
    void readWithNoRowAnswersNothingLockedAndCreatesNoRow() {
        PeriodLockView view = service.read(user("COMMERCE_ACCOUNTANT"), INST);
        assertNull(view.getLockedThrough());
        assertNull(view.getFirstOpenDate());
        assertEquals("NONE", view.getDirection());
        assertNull(view.getPreview());
        verify(repo, never()).ensureRow(anyString(), anyString());
    }

    // ------------------------------------------------------------------ preview

    @Test
    void previewAggregatesContributorsInKindOrder() {
        contributors.clear();
        contributors.add(contributor("Z_LAST", 1));
        contributors.add(contributor("A_FIRST", 2));
        contributors.add(new PeriodLockPreviewContributor() {
            @Override
            public String kind() {
                return "M_NOTHING";
            }

            @Override
            public PreviewItem items(String instituteId, LocalDate through) {
                return null;
            }
        });
        StockClock clock = mock(StockClock.class);
        when(clock.today(anyString())).thenReturn(TODAY);
        service = new PeriodLockService(repo, guard, clock, requestGuard, approvals, audit, jdbc, txManager,
                contributors);
        PreviewView preview = service.preview(user("COMMERCE_ACCOUNTANT"), INST, OCT_31);
        assertEquals(OCT_31, preview.getThrough());
        assertEquals(List.of("A_FIRST", "Z_LAST"), preview.getItems().stream().map(PreviewItem::getKind).toList());
        assertEquals(List.of(2L, 1L), preview.getItems().stream().map(PreviewItem::getCount).toList());
        ArgumentCaptor<TransactionDefinition> definition = ArgumentCaptor.forClass(TransactionDefinition.class);
        verify(txManager).getTransaction(definition.capture());
        assertTrue(definition.getValue().isReadOnly());
    }
}
