package vacademy.io.admin_core_service.features.user_subscription.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.PaymentSettingService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.PageImpl;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.PackageSessionLearnerInvitationToPaymentOptionRepository;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.learner_access.enums.LearnerAccessSourceEnum;
import vacademy.io.admin_core_service.features.learner_access.service.LearnerAccessService;
import vacademy.io.admin_core_service.features.offline_payment.service.OfflinePaymentDetailsService;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.timeline.dto.TimelineEventDTO;
import vacademy.io.admin_core_service.features.timeline.dto.TimelineEventRequestDTO;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;
import vacademy.io.admin_core_service.features.user_account.service.UserAccountLedgerService;
import vacademy.io.admin_core_service.features.user_subscription.dto.ChangePlanEndDateRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.ManualRenewalRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.ManualRenewalResultDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Admin-recorded renewal: brings an EXPIRED member back with access, books the payment,
 * leaves a remark — and never arms autopay or contacts the member unless asked.
 */
class AdminManualRenewalServiceTest {

    private static final String INST = "inst-1";
    private static final long DAY = 24L * 60 * 60 * 1000;

    private UserPlanRepository planRepo;
    private StudentSessionInstituteGroupMappingRepository mappingRepo;
    private PaymentLogService paymentLogService;
    private PaymentLogRepository paymentLogRepo;
    private OfflinePaymentDetailsService offline;
    private UserAccountLedgerService ledger;
    private LearnerAccessService access;
    private TimelineEventService timeline;
    private InvoiceService invoices;
    private AuthService auth;
    private PackageSessionLearnerInvitationToPaymentOptionRepository invitations;
    private PackageSessionRepository packageSessions;
    private StudentSessionRepository studentSessions;
    private AdminManualRenewalService service;
    private vacademy.io.admin_core_service.features.commerce.common.CommercePlans commercePlans;
    private CustomPricePlanService customPlans;
    private UserPlan plan;
    private StudentSessionInstituteGroupMapping lapsed;
    private CustomUserDetails admin;

    @BeforeEach
    void setUp() {
        planRepo = mock(UserPlanRepository.class);
        mappingRepo = mock(StudentSessionInstituteGroupMappingRepository.class);
        paymentLogService = mock(PaymentLogService.class);
        paymentLogRepo = mock(PaymentLogRepository.class);
        offline = mock(OfflinePaymentDetailsService.class);
        ledger = mock(UserAccountLedgerService.class);
        access = mock(LearnerAccessService.class);
        timeline = mock(TimelineEventService.class);
        invoices = mock(InvoiceService.class);
        auth = mock(AuthService.class);
        invitations = mock(PackageSessionLearnerInvitationToPaymentOptionRepository.class);
        packageSessions = mock(PackageSessionRepository.class);
        studentSessions = mock(StudentSessionRepository.class);
        PaymentDateDefaults paymentDates = mock(PaymentDateDefaults.class);
        when(paymentDates.today(any())).thenReturn(new java.util.Date());
        commercePlans = mock(vacademy.io.admin_core_service.features.commerce.common.CommercePlans.class);
        customPlans = mock(CustomPricePlanService.class);
        service = new AdminManualRenewalService(planRepo, mappingRepo, paymentLogService, paymentLogRepo,
                offline, ledger, access, timeline, invoices, auth, invitations, packageSessions, studentSessions,
                new PaymentSettingService(mock(InstituteRepository.class), new ObjectMapper()),
                paymentDates, commercePlans, customPlans);

        EnrollInvite invite = new EnrollInvite();
        invite.setInstituteId(INST);
        PaymentPlan paymentPlan = new PaymentPlan();
        paymentPlan.setValidityInDays(365);
        paymentPlan.setActualPrice(431.0);
        paymentPlan.setCurrency("AUD");

        plan = new UserPlan();
        plan.setId("up-1");
        plan.setUserId("u-1");
        plan.setStatus("EXPIRED");
        plan.setEndDate(new Date(System.currentTimeMillis() - 30 * DAY));
        plan.setAutoRenewalEnabled(false);
        plan.setEnrollInvite(invite);
        plan.setPaymentPlan(paymentPlan);
        when(planRepo.findById("up-1")).thenReturn(Optional.of(plan));

        lapsed = new StudentSessionInstituteGroupMapping();
        lapsed.setId("m-1");
        lapsed.setUserId("u-1");
        lapsed.setStatus("INACTIVE");
        lapsed.setExpiryDate(plan.getEndDate());
        when(mappingRepo.findByUserPlanIdAndStatus(eq("up-1"), anyString())).thenReturn(List.of());
        when(mappingRepo.findByUserPlanIdAndStatus("up-1", "INACTIVE")).thenReturn(List.of(lapsed));

        when(paymentLogService.createPaymentLog(any(), anyDouble(), any(), any(), any(), any(), any(), any()))
                .thenReturn("pl-1");
        admin = mock(CustomUserDetails.class);
        when(admin.getUserId()).thenReturn("admin-1");
        when(admin.getUsername()).thenReturn("finance");
    }

    @Test
    @DisplayName("The side-view's plan listing is uncached: an eviction only reaches one pod")
    void planListingIsNotCached() {
        java.lang.reflect.Method read = java.util.Arrays.stream(UserPlanService.class.getDeclaredMethods())
                .filter(m -> m.getName().equals("getUserPlansByUserIdAndInstituteId"))
                .findFirst().orElseThrow();
        assertFalse(read.isAnnotationPresent(org.springframework.cache.annotation.Cacheable.class));
    }

    @Test
    @DisplayName("A renewal and an end-date change clear the cached plan lookups")
    void renewalAndEndDateChangeEvictPlanCaches() {
        for (String name : List.of("renew", "changeEndDate")) {
            java.lang.reflect.Method write = java.util.Arrays.stream(AdminManualRenewalService.class.getDeclaredMethods())
                    .filter(m -> m.getName().equals(name))
                    .findFirst().orElseThrow();
            org.springframework.cache.annotation.CacheEvict evict =
                    write.getAnnotation(org.springframework.cache.annotation.CacheEvict.class);
            assertNotNull(evict, name);
            assertTrue(evict.allEntries(), name);
            assertTrue(List.of(evict.value()).containsAll(
                    List.of("userPlanById", "userPlanWithPaymentLogs", "membershipDetails")), name);
        }
    }

    @AfterEach
    void tearDown() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    private static ManualRenewalRequestDTO req(double amount) {
        ManualRenewalRequestDTO r = new ManualRenewalRequestDTO();
        r.setAmount(amount);
        r.setRemarks("Paid by bank transfer, ref 7781");
        return r;
    }

    @Test
    @DisplayName("an EXPIRED member is reactivated for a full year from today, access back on, autopay still off")
    void reactivatesExpired() {
        ManualRenewalResultDTO result = service.renew("up-1", INST, req(431), admin);

        assertEquals("EXPIRED", result.getPreviousStatus());
        assertEquals("ACTIVE", plan.getStatus());
        long daysAhead = (plan.getEndDate().getTime() - System.currentTimeMillis()) / DAY;
        assertTrue(daysAhead >= 364 && daysAhead <= 365, "~365 days from today, was " + daysAhead);
        assertFalse(plan.getAutoRenewalEnabled());
        assertNull(plan.getNextChargeAt(), "no automatic charge may be scheduled");
        assertEquals("ACTIVE", lapsed.getStatus());
        assertEquals(plan.getEndDate(), lapsed.getExpiryDate());
        assertEquals(1, result.getMappingsUpdated());
        verify(access).recordGrant(eq(LearnerAccessSourceEnum.RENEWAL), eq(INST), eq(lapsed), any(),
                any(), eq("up-1"), any(), any(), any(), eq("admin-1"), eq("finance"));
    }

    @Test
    @DisplayName("the payment is booked as MANUAL + PAID without the side-effecting update, and on the ledger")
    void booksPayment() {
        service.renew("up-1", INST, req(431), admin);

        verify(paymentLogService).createPaymentLog(eq("u-1"), eq(431.0), eq("MANUAL"), eq("MANUAL"),
                eq("AUD"), eq(plan), isNull(), any());
        verify(paymentLogService).updatePaymentLogOnly(eq("pl-1"), eq("SUCCESS"), eq("PAID"), any());
        verify(paymentLogService, never()).updatePaymentLog(any(), any(), any(), any());
        verify(offline).apply(eq("pl-1"), any(), eq("admin-1"));
        verify(ledger).recordSettledCharge(eq("u-1"), eq(INST), any(), eq("AUD"), isNull(),
                eq("USER_PLAN"), eq("up-1"), eq("pl-1"), eq("Manual renewal: Paid by bank transfer, ref 7781"));
    }

    @Test
    @DisplayName("the remark is stored on the plan's timeline with the payment details")
    void writesRemark() {
        service.renew("up-1", INST, req(431), admin);

        ArgumentCaptor<TimelineEventRequestDTO> ev = ArgumentCaptor.forClass(TimelineEventRequestDTO.class);
        verify(timeline).createManualEvent(ev.capture(), eq(admin));
        assertEquals("USER_PLAN", ev.getValue().getType());
        assertEquals("up-1", ev.getValue().getTypeId());
        assertEquals("MANUAL_RENEWAL", ev.getValue().getActionType());
        assertEquals("u-1", ev.getValue().getStudentUserId());
        assertEquals("Paid by bank transfer, ref 7781", ev.getValue().getDescription());
    }

    @Test
    @DisplayName("by default nothing is invoiced or emailed")
    void silentByDefault() {
        service.renew("up-1", INST, req(431), admin);
        verifyNoInteractions(invoices);
        verify(paymentLogService, never()).scheduleSyncInvoiceAfterCommit(any(), any());
    }

    @Test
    @DisplayName("an invoice without email waits for the commit and is generated with sendEmail=false")
    void silentInvoiceAfterCommit() {
        TransactionSynchronizationManager.initSynchronization();
        ManualRenewalRequestDTO r = req(431);
        r.setGenerateInvoice(true);
        service.renew("up-1", INST, r, admin);
        verifyNoInteractions(invoices);

        for (TransactionSynchronization s : TransactionSynchronizationManager.getSynchronizations()) {
            s.afterCommit();
        }
        verify(invoices).generateInvoiceWithResultForCommittedPayment("pl-1", INST, false);
    }

    @Test
    @DisplayName("invoice + email goes through the normal offline-payment confirmation path")
    void invoiceWithEmail() {
        PaymentLog log = new PaymentLog();
        log.setId("pl-1");
        when(paymentLogRepo.findById("pl-1")).thenReturn(Optional.of(log));
        ManualRenewalRequestDTO r = req(431);
        r.setGenerateInvoice(true);
        r.setSendEmail(true);
        service.renew("up-1", INST, r, admin);
        verify(paymentLogService).scheduleSyncInvoiceAfterCommit(log, INST);
    }

    @Test
    @DisplayName("an ACTIVE member renewing early keeps the days left: extended from the current end date")
    void earlyRenewalExtendsFromEndDate() {
        Date end = new Date(System.currentTimeMillis() + 20 * DAY);
        plan.setStatus("ACTIVE");
        plan.setEndDate(end);
        service.renew("up-1", INST, req(431), admin);
        Calendar c = Calendar.getInstance();
        c.setTime(end);
        c.add(Calendar.DAY_OF_MONTH, 365);
        assertEquals(c.getTime(), plan.getEndDate());
    }

    @Test
    @DisplayName("an explicit end date from the admin wins")
    void explicitEndDate() {
        Date chosen = new Date(System.currentTimeMillis() + 100 * DAY);
        ManualRenewalRequestDTO r = req(431);
        r.setNewEndDate(chosen);
        service.renew("up-1", INST, r, admin);
        assertEquals(chosen, plan.getEndDate());
    }

    @Test
    @DisplayName("a zero amount extends access without inventing a payment")
    void zeroAmount() {
        service.renew("up-1", INST, req(0), admin);
        verify(paymentLogService, never()).createPaymentLog(any(), anyDouble(), any(), any(), any(), any(), any(), any());
        verifyNoInteractions(ledger);
        assertEquals("ACTIVE", plan.getStatus());
    }

    @Test
    @DisplayName("autopay that the member already had on is left on and re-armed for the new end date")
    void keepsExistingAutopay() {
        plan.setAutoRenewalEnabled(true);
        service.renew("up-1", INST, req(431), admin);
        assertTrue(plan.getAutoRenewalEnabled());
        assertEquals(plan.getEndDate(), plan.getNextChargeAt());
    }

    @Test
    @DisplayName("refused: terminated plan, past end date, no access rows, other institute — nothing written")
    void refusals() {
        plan.setStatus("TERMINATED");
        assertThrows(VacademyException.class, () -> service.renew("up-1", INST, req(431), admin));
        plan.setStatus("EXPIRED");

        ManualRenewalRequestDTO past = req(431);
        past.setNewEndDate(new Date(System.currentTimeMillis() - DAY));
        assertThrows(VacademyException.class, () -> service.renew("up-1", INST, past, admin));

        assertThrows(VacademyException.class, () -> service.renew("up-1", "other-inst", req(431), admin));

        when(mappingRepo.findByUserPlanIdAndStatus("up-1", "INACTIVE")).thenReturn(List.of());
        assertThrows(VacademyException.class, () -> service.renew("up-1", INST, req(431), admin));

        ManualRenewalRequestDTO negative = req(-1);
        assertThrows(VacademyException.class, () -> service.renew("up-1", INST, negative, admin));

        verify(paymentLogService, never()).createPaymentLog(any(), anyDouble(), any(), any(), any(), any(), any(), any());
        verify(planRepo, never()).save(any());
    }

    private static StudentSessionInstituteGroupMapping row(String id, String packageSessionId, String institute,
                                                           String userPlanId, String status) {
        PackageSession ps = new PackageSession();
        ps.setId(packageSessionId);
        Institute inst = new Institute();
        inst.setId(institute);
        StudentSessionInstituteGroupMapping m = new StudentSessionInstituteGroupMapping();
        m.setId(id);
        m.setUserId("u-1");
        m.setPackageSession(ps);
        m.setInstitute(inst);
        m.setUserPlanId(userPlanId);
        m.setStatus(status);
        return m;
    }

    private void noLinkedAccess() {
        when(mappingRepo.findByUserPlanIdAndStatus("up-1", "INACTIVE")).thenReturn(List.of());
        when(invitations.findPackageSessionIdsByEnrollInviteAndStatusIn(any(), eq(List.of("ACTIVE"))))
                .thenReturn(List.of("ps-1"));
    }

    @Test
    @DisplayName("no row linked to the plan: the member's unlinked row for the plan's course is adopted and extended")
    void adoptsUnlinkedRow() {
        noLinkedAccess();
        StudentSessionInstituteGroupMapping imported = row("m-imp", "ps-1", INST, null, "EXPIRED");
        when(mappingRepo.findAllByUserIdAndPackageSessionIdsAndStatus(eq("u-1"), eq(List.of("ps-1")), anyList()))
                .thenReturn(List.of(imported));

        ManualRenewalResultDTO result = service.renew("up-1", INST, req(431), admin);

        assertEquals("up-1", imported.getUserPlanId());
        assertEquals("ACTIVE", imported.getStatus());
        assertEquals(result.getNewEndDate(), imported.getExpiryDate());
        assertEquals(1, result.getMappingsUpdated());
        verify(mappingRepo).save(imported);
        verify(packageSessions, never()).findById(any());
    }

    @Test
    @DisplayName("no row at all for the plan's course: one is created, linked and active until the new end date")
    void createsMissingRow() {
        noLinkedAccess();
        PackageSession ps = new PackageSession();
        ps.setId("ps-1");
        when(packageSessions.findById("ps-1")).thenReturn(Optional.of(ps));
        StudentSessionInstituteGroupMapping other = row("m-other", "ps-9", INST, null, "ACTIVE");
        other.setInstituteEnrolledNumber("ENR-42");
        when(studentSessions.findByInstituteIdAndUserIdNative(INST, "u-1")).thenReturn(Optional.of(other));

        ManualRenewalResultDTO result = service.renew("up-1", INST, req(431), admin);

        ArgumentCaptor<StudentSessionInstituteGroupMapping> saved =
                ArgumentCaptor.forClass(StudentSessionInstituteGroupMapping.class);
        verify(mappingRepo).save(saved.capture());
        StudentSessionInstituteGroupMapping created = saved.getValue();
        assertSame(ps, created.getPackageSession());
        assertEquals("up-1", created.getUserPlanId());
        assertEquals("ACTIVE", created.getStatus());
        assertEquals(result.getNewEndDate(), created.getExpiryDate());
        assertEquals("PACKAGE_SESSION", created.getType());
        assertEquals("MANUAL_RENEWAL", created.getSource());
        assertEquals("ENR-42", created.getInstituteEnrolledNumber());
        assertEquals(1, result.getMappingsUpdated());
    }

    @Test
    @DisplayName("the plan's course held under another membership is refused, not moved, and nothing is written")
    void courseHeldElsewhere() {
        noLinkedAccess();
        when(mappingRepo.findAllByUserIdAndPackageSessionIdsAndStatus(eq("u-1"), eq(List.of("ps-1")), anyList()))
                .thenReturn(List.of(row("m-x", "ps-1", INST, "up-other", "ACTIVE")));

        assertThrows(VacademyException.class, () -> service.renew("up-1", INST, req(431), admin));

        verify(paymentLogService, never()).createPaymentLog(any(), anyDouble(), any(), any(), any(), any(), any(), any());
        verify(planRepo, never()).save(any());
        verify(mappingRepo, never()).save(any());
    }

    @Test
    @DisplayName("an empty remark is refused; a real one is stored on the plan")
    void addRemark() {
        assertThrows(VacademyException.class, () -> service.addRemark("up-1", INST, "  ", admin));
        service.addRemark("up-1", INST, " Called, will pay Friday ", admin);
        ArgumentCaptor<TimelineEventRequestDTO> ev = ArgumentCaptor.forClass(TimelineEventRequestDTO.class);
        verify(timeline).createManualEvent(ev.capture(), eq(admin));
        assertEquals("PLAN_REMARK", ev.getValue().getActionType());
        assertEquals("Called, will pay Friday", ev.getValue().getDescription());
    }

    @Test
    @DisplayName("a renewal without a remark is refused before anything is written")
    void remarkRequired() {
        for (String blank : new String[] {null, "", "   "}) {
            ManualRenewalRequestDTO r = req(431);
            r.setRemarks(blank);
            assertThrows(VacademyException.class, () -> service.renew("up-1", INST, r, admin));
        }
        verify(paymentLogService, never()).createPaymentLog(any(), anyDouble(), any(), any(), any(), any(), any(), any());
        verify(planRepo, never()).save(any());
        verifyNoInteractions(timeline);
    }

    @Test
    @DisplayName("the remarks history shows each admin's full name, falling back to the stored username")
    void remarkAuthors() {
        // Fresh rows per call: the service rewrites actor_name on the DTOs it returns.
        when(timeline.getTimelineEvents(eq("USER_PLAN"), eq("up-1"), any())).thenAnswer(i -> new PageImpl<>(List.of(
                TimelineEventDTO.builder().id("e1").actorId("admin-1").actorName("finance").build(),
                TimelineEventDTO.builder().id("e2").actorId("admin-2").actorName("ops").build())));
        UserDTO u = new UserDTO();
        u.setId("admin-1");
        u.setFullName("Priya Sharma");
        when(auth.getUsersFromAuthServiceByUserIds(anyList())).thenReturn(List.of(u));

        List<TimelineEventDTO> rows = service.listRemarks("up-1", INST, 0, 20).getContent();
        assertEquals("Priya Sharma", rows.get(0).getActorName());
        assertEquals("ops", rows.get(1).getActorName());

        when(auth.getUsersFromAuthServiceByUserIds(anyList())).thenThrow(new RuntimeException("auth down"));
        assertEquals("finance", service.listRemarks("up-1", INST, 0, 20).getContent().get(0).getActorName());
    }

    // ---------------------------------------------------------------- end-date change

    private StudentSessionInstituteGroupMapping activeMembership() {
        plan.setStatus("ACTIVE");
        plan.setStartDate(new Date(System.currentTimeMillis() - 10 * DAY));
        plan.setEndDate(new Date(System.currentTimeMillis() + 355 * DAY));
        StudentSessionInstituteGroupMapping active = new StudentSessionInstituteGroupMapping();
        active.setId("m-2");
        active.setUserId("u-1");
        active.setUserPlanId("up-1");
        active.setStatus("ACTIVE");
        active.setExpiryDate(plan.getEndDate());
        when(mappingRepo.findByUserPlanIdAndStatus("up-1", "ACTIVE")).thenReturn(List.of(active));
        when(mappingRepo.findByUserPlanIdAndStatus("up-1", "INACTIVE")).thenReturn(List.of());
        return active;
    }

    @Test
    @DisplayName("refused: a shop order line is neither renewed nor given an end date")
    void refusesACommercePlan() {
        doThrow(new VacademyException(org.springframework.http.HttpStatus.BAD_REQUEST, "shop order line"))
                .when(commercePlans).refuseCommercePlan(eq(plan), anyString());
        String statusBefore = plan.getStatus();
        Date endBefore = plan.getEndDate();

        assertThrows(VacademyException.class, () -> service.renew("up-1", INST, req(431), admin));
        assertThrows(VacademyException.class, () -> service.changeEndDate("up-1", INST,
                endDateReq(new Date(System.currentTimeMillis() + 30 * DAY)), admin));

        assertEquals(statusBefore, plan.getStatus());
        assertEquals(endBefore, plan.getEndDate());
        verify(planRepo, never()).save(any());
    }

    private static ChangePlanEndDateRequestDTO endDateReq(Date newEnd) {
        ChangePlanEndDateRequestDTO r = new ChangePlanEndDateRequestDTO();
        r.setNewEndDate(newEnd);
        r.setRemarks("Paid on 7 Oct, enrolled on 23 Oct");
        return r;
    }

    @Test
    @DisplayName("changing the end date moves the plan and its access together, audited with the admin and the reason")
    void changeEndDateMovesPlanAndAccess() {
        StudentSessionInstituteGroupMapping active = activeMembership();
        Date previousEnd = plan.getEndDate();
        Date newEnd = new Date(System.currentTimeMillis() + 340 * DAY);

        ManualRenewalResultDTO result = service.changeEndDate("up-1", INST, endDateReq(newEnd), admin);

        assertEquals(previousEnd, result.getPreviousEndDate());
        assertEquals(newEnd, plan.getEndDate());
        assertEquals("ACTIVE", plan.getStatus());
        assertNull(plan.getNextChargeAt(), "autopay is off, so no charge may be scheduled");
        assertEquals(newEnd, active.getExpiryDate());
        assertEquals(1, result.getMappingsUpdated());
        verify(planRepo).save(plan);
        verify(paymentLogService, never()).createPaymentLog(any(), anyDouble(), any(), any(), any(), any(), any(), any());
        verify(access).recordGrant(eq(LearnerAccessSourceEnum.ADMIN_EXTENSION), eq(INST), eq(active), eq(previousEnd),
                isNull(), eq("up-1"), any(), any(), contains("Paid on 7 Oct"), eq("admin-1"), eq("finance"));

        ArgumentCaptor<TimelineEventRequestDTO> event = ArgumentCaptor.forClass(TimelineEventRequestDTO.class);
        verify(timeline).createManualEvent(event.capture(), eq(admin));
        assertEquals("END_DATE_CHANGE", event.getValue().getActionType());
        assertEquals("up-1", event.getValue().getTypeId());
        assertEquals("Paid on 7 Oct, enrolled on 23 Oct", event.getValue().getDescription());
    }

    @Test
    @DisplayName("with autopay on, the next charge follows the new end date")
    void changeEndDateRepointsArmedCharge() {
        activeMembership();
        plan.setAutoRenewalEnabled(true);
        plan.setNextChargeAt(plan.getEndDate());
        Date newEnd = new Date(System.currentTimeMillis() + 400 * DAY);

        service.changeEndDate("up-1", INST, endDateReq(newEnd), admin);

        assertEquals(newEnd, plan.getNextChargeAt());
    }

    @Test
    @DisplayName("a lapsed membership, a past date or a missing reason is refused and nothing is written")
    void changeEndDateRefusals() {
        Date future = new Date(System.currentTimeMillis() + 30 * DAY);
        // plan is EXPIRED from setUp: lapsed memberships go through Renew manually.
        assertThrows(VacademyException.class, () -> service.changeEndDate("up-1", INST, endDateReq(future), admin));

        activeMembership();
        assertThrows(VacademyException.class, () -> service.changeEndDate("up-1", INST,
                endDateReq(new Date(System.currentTimeMillis() - DAY)), admin));
        ChangePlanEndDateRequestDTO noReason = endDateReq(future);
        noReason.setRemarks("  ");
        assertThrows(VacademyException.class, () -> service.changeEndDate("up-1", INST, noReason, admin));
        assertThrows(VacademyException.class, () -> service.changeEndDate("up-1", "other-inst", endDateReq(future), admin));

        verify(planRepo, never()).save(any());
        verifyNoInteractions(timeline);
    }

    // ── renewal paid through an admin invoice ──

    private static AdminManualRenewalService.InvoiceRenewal invoiceRenewal(double amount, Date until, boolean lockPrice) {
        return new AdminManualRenewalService.InvoiceRenewal("up-1", INST, java.math.BigDecimal.valueOf(amount), "AUD",
                until, lockPrice, null, "inv-1", "INV-0042", "admin-1", "Finance Admin");
    }

    @Test
    @DisplayName("invoice renewal: plan and access renewed, but no payment, ledger row or invoice of its own")
    void invoiceRenewalWritesNoMoney() {
        AdminManualRenewalService.InvoiceRenewalResult renewed =
                service.renewFromInvoice(invoiceRenewal(621, null, false));
        ManualRenewalResultDTO result = renewed.result();

        assertEquals("EXPIRED", result.getPreviousStatus());
        assertEquals("ACTIVE", plan.getStatus());
        long daysAhead = (plan.getEndDate().getTime() - System.currentTimeMillis()) / DAY;
        assertTrue(daysAhead >= 364 && daysAhead <= 365, "~365 days from today, was " + daysAhead);
        assertEquals("ACTIVE", lapsed.getStatus());
        assertEquals(plan.getEndDate(), lapsed.getExpiryDate());
        verify(paymentLogService, never()).createPaymentLog(any(), anyDouble(), any(), any(), any(), any(), any(), any());
        verifyNoInteractions(ledger, invoices, offline, customPlans);
        assertNull(renewed.pricePlan(), "the renewal price is only changed when asked");
        verify(access).recordGrant(eq(LearnerAccessSourceEnum.RENEWAL), eq(INST), eq(lapsed), any(),
                any(), eq("up-1"), any(), any(), eq("Renewal through invoice INV-0042"), eq("admin-1"), eq("Finance Admin"));
        verify(timeline).logEvent(eq("USER_PLAN"), eq("up-1"), eq("INVOICE_RENEWAL"), eq("ADMIN"), eq("admin-1"),
                eq("Finance Admin"), contains("INV-0042"), isNull(), any(), eq("u-1"));
    }

    @Test
    @DisplayName("invoice renewal: an explicit end date wins; one that has passed falls back to the normal renewal")
    void invoiceRenewalEndDate() {
        Date chosen = new Date(System.currentTimeMillis() + 100 * DAY);
        service.renewFromInvoice(invoiceRenewal(621, chosen, false));
        assertEquals(chosen, plan.getEndDate());

        plan.setStatus("EXPIRED");
        plan.setEndDate(new Date(System.currentTimeMillis() - 30 * DAY));
        service.renewFromInvoice(invoiceRenewal(621, new Date(System.currentTimeMillis() - DAY), false));
        long daysAhead = (plan.getEndDate().getTime() - System.currentTimeMillis()) / DAY;
        assertTrue(daysAhead >= 364 && daysAhead <= 365, "fell back to ~365 days, was " + daysAhead);
    }

    @Test
    @DisplayName("invoice renewal with a renewal price: the membership moves onto a plan at that price")
    void invoiceRenewalMovesToPricePlan() {
        PaymentPlan base = plan.getPaymentPlan();
        PaymentPlan custom = new PaymentPlan();
        custom.setId("pp-621");
        custom.setName("Yearly · 621.00");
        custom.setActualPrice(621.0);
        custom.setValidityInDays(365);
        when(customPlans.refusal(eq(plan), eq(base), any(), any(), eq("AUD"), eq(INST))).thenReturn(null);
        when(customPlans.findOrCreate(eq(base), eq(java.math.BigDecimal.valueOf(621.0)), eq("INV-0042"))).thenReturn(custom);

        AdminManualRenewalService.InvoiceRenewalResult renewed =
                service.renewFromInvoice(invoiceRenewal(621, null, true));

        assertSame(custom, renewed.pricePlan());
        assertNull(renewed.priceWarning());
        assertEquals("pp-621", plan.getPaymentPlanId());
        assertSame(custom, plan.getPaymentPlan());
        assertNull(plan.getRegionalPrice(), "no per-member price override is used");
        verify(planRepo, atLeastOnce()).save(plan);
    }

    @Test
    @DisplayName("invoice renewal whose renewal price is refused by then: renewed anyway, plan unchanged, reason returned")
    void invoiceRenewalPriceRefusedStillRenews() {
        when(customPlans.refusal(any(), any(), any(), any(), any(), any())).thenReturn("autopay covers up to 431.00");

        AdminManualRenewalService.InvoiceRenewalResult renewed =
                service.renewFromInvoice(invoiceRenewal(621, null, true));

        assertEquals("ACTIVE", plan.getStatus());
        assertNull(renewed.pricePlan());
        assertEquals("autopay covers up to 431.00", renewed.priceWarning());
        verify(customPlans, never()).findOrCreate(any(), any(), any());
    }

    @Test
    @DisplayName("raising the invoice: a renewable membership of the billed learner is described; others refused")
    void describeRenewableForInvoice() {
        assertTrue(service.describeRenewableForInvoice("up-1", INST, "u-1", null, null).startsWith("Renewal"));

        assertThrows(VacademyException.class, () -> service.describeRenewableForInvoice("up-1", INST, "someone-else", null, null));
        assertThrows(VacademyException.class, () -> service.describeRenewableForInvoice("up-1", "other-inst", "u-1", null, null));
        plan.setStatus("TERMINATED");
        assertThrows(VacademyException.class, () -> service.describeRenewableForInvoice("up-1", INST, "u-1", null, null));
        plan.setStatus("EXPIRED");
        when(mappingRepo.findByUserPlanIdAndStatus("up-1", "INACTIVE")).thenReturn(List.of());
        assertThrows(VacademyException.class, () -> service.describeRenewableForInvoice("up-1", INST, "u-1", null, null));

        verify(planRepo, never()).save(any());
        verify(mappingRepo, never()).save(any());
    }

    @Test
    @DisplayName("invoice renewal with a separate renewal price: the plan is priced at it, not at the invoice total")
    void invoiceRenewalUsesRenewalPrice() {
        PaymentPlan custom = new PaymentPlan();
        custom.setId("pp-621");
        custom.setActualPrice(621.0);
        when(customPlans.refusal(any(), any(), any(), any(), any(), any())).thenReturn(null);
        when(customPlans.findOrCreate(any(), eq(new java.math.BigDecimal("621.00")), any())).thenReturn(custom);

        // The invoice charged 821 (621 renewal + 200 registration fee); renewals stay at 621.
        service.renewFromInvoice(new AdminManualRenewalService.InvoiceRenewal("up-1", INST,
                java.math.BigDecimal.valueOf(821), "AUD", null, true, new java.math.BigDecimal("621.00"),
                "inv-1", "INV-0042", "admin-1", "Finance Admin"));

        verify(customPlans).findOrCreate(any(), eq(new java.math.BigDecimal("621.00")), eq("INV-0042"));
        assertEquals("pp-621", plan.getPaymentPlanId());
    }

    @Test
    @DisplayName("raising the invoice: a membership the organisation pays for is refused")
    void describeRefusesSubOrgMembership() {
        plan.setSource("SUB_ORG");
        VacademyException e = assertThrows(VacademyException.class,
                () -> service.describeRenewableForInvoice("up-1", INST, "u-1", null, null));
        assertTrue(e.getMessage().contains("organisation"));
    }

    @Test
    @DisplayName("raising the invoice with a renewal price: a refused price is reported before anything is raised")
    void describeRefusesRenewalPrice() {
        when(customPlans.refusal(any(), any(), any(), any(), any(), any()))
                .thenReturn("The invoice is in INR but the plan is priced in AUD.");
        VacademyException e = assertThrows(VacademyException.class, () -> service.describeRenewableForInvoice(
                "up-1", INST, "u-1", java.math.BigDecimal.valueOf(621), "INR"));
        assertTrue(e.getMessage().contains("AUD"));
    }
}
