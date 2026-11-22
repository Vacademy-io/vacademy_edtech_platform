package vacademy.io.admin_core_service.features.invoice.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.commerce.common.CommerceLegacyGuard;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceProductLinkDTO;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.repository.InvoicePaymentLogMappingRepository;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.admin_core_service.features.learner_management.dto.BulkAssignRequestDTO;
import vacademy.io.admin_core_service.features.learner_management.dto.BulkAssignResponseDTO;
import vacademy.io.admin_core_service.features.learner_management.dto.BulkAssignResultItemDTO;
import vacademy.io.admin_core_service.features.learner_management.service.BulkAssignmentService;
import vacademy.io.admin_core_service.features.learner_management.service.DefaultInviteResolver;
import vacademy.io.admin_core_service.features.user_subscription.dto.ManualRenewalResultDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.AdminManualRenewalService;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.math.BigDecimal;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * An admin invoice linked to a product: checked when raised, applied exactly once when paid,
 * never recording a second payment, and a failure kept on the invoice for a retry.
 */
class InvoiceProductLinkServiceTest {

    private static final String INST = "inst-1";

    private InvoiceRepository invoiceRepository;
    private StudentSessionRepository studentSessions;
    private DefaultInviteResolver resolver;
    private CommerceLegacyGuard commerceGuard;
    private AdminManualRenewalService renewals;
    private BulkAssignmentService bulkAssign;
    private InvoiceProductLinkService service;
    private Invoice invoice;
    private UserPlan membership;
    private PaymentLog settled;
    private PaymentLog abandoned;

    @BeforeEach
    void setUp() {
        invoiceRepository = mock(InvoiceRepository.class);
        studentSessions = mock(StudentSessionRepository.class);
        resolver = mock(DefaultInviteResolver.class);
        commerceGuard = mock(CommerceLegacyGuard.class);
        renewals = mock(AdminManualRenewalService.class);
        bulkAssign = mock(BulkAssignmentService.class);
        UserPlanRepository userPlans = mock(UserPlanRepository.class);
        membership = new UserPlan();
        membership.setId("up-1");
        when(userPlans.findById(any())).thenReturn(Optional.empty());
        when(userPlans.findById("up-1")).thenReturn(Optional.of(membership));

        // The invoice's payments: the one that settled it, and an abandoned gateway attempt.
        PaymentLogRepository paymentLogs = mock(PaymentLogRepository.class);
        settled = new PaymentLog();
        settled.setId("pl-1");
        settled.setPaymentStatus("PAID");
        abandoned = new PaymentLog();
        abandoned.setId("pl-0");
        abandoned.setPaymentStatus("PAYMENT_PENDING");
        when(paymentLogs.findById("pl-1")).thenReturn(Optional.of(settled));
        when(paymentLogs.findById("pl-0")).thenReturn(Optional.of(abandoned));
        InvoicePaymentLogMappingRepository mappings = mock(InvoicePaymentLogMappingRepository.class);
        when(mappings.findPaymentLogIdsByInvoiceId("inv-1")).thenReturn(List.of("pl-0", "pl-1"));

        service = new InvoiceProductLinkService(invoiceRepository, userPlans, paymentLogs, mappings,
                studentSessions, resolver, commerceGuard, renewals, bulkAssign, mock(AuthService.class),
                mock(PlatformTransactionManager.class), mock(org.springframework.cache.CacheManager.class));

        invoice = new Invoice();
        invoice.setId("inv-1");
        invoice.setInvoiceNumber("INV-0042");
        invoice.setInstituteId(INST);
        invoice.setUserId("u-1");
        invoice.setSource("ADMIN_MANUAL");
        invoice.setStatus("PAID");
        invoice.setTotalAmount(new BigDecimal("621.00"));
        invoice.setCurrency("INR");
        when(invoiceRepository.findById("inv-1")).thenAnswer(i -> Optional.of(invoice));
        when(invoiceRepository.lockForCredit(INST, "inv-1")).thenReturn("inv-1");
        when(invoiceRepository.save(any(Invoice.class))).thenAnswer(i -> i.getArgument(0));
    }

    @AfterEach
    void tearDown() {
        service.shutdown();
    }

    private void storeLink(InvoiceProductLinkDTO link) throws Exception {
        Map<String, Object> data = new HashMap<>();
        data.put("notes", "kept");
        data.put(InvoiceProductLinkService.JSON_KEY, InvoiceProductLinkService.toStored(link));
        invoice.setInvoiceDataJson(new ObjectMapper().writeValueAsString(data));
    }

    private static InvoiceProductLinkDTO pendingRenewal() {
        InvoiceProductLinkDTO link = new InvoiceProductLinkDTO();
        link.setType(InvoiceProductLinkDTO.TYPE_RENEWAL);
        link.setUserPlanId("up-1");
        link.setStatus(InvoiceProductLinkDTO.STATUS_PENDING);
        link.setCreatedBy("admin-1");
        link.setApplyAsMemberPrice(true);
        return link;
    }

    private static InvoiceProductLinkDTO pendingEnrolment() {
        InvoiceProductLinkDTO link = new InvoiceProductLinkDTO();
        link.setType(InvoiceProductLinkDTO.TYPE_NEW_ENROLLMENT);
        link.setPackageSessionId("ps-1");
        link.setEnrollInviteId("ei-1");
        link.setPaymentOptionId("po-1");
        link.setPlanId("pp-1");
        link.setStatus(InvoiceProductLinkDTO.STATUS_PENDING);
        link.setCreatedBy("admin-1");
        return link;
    }

    private DefaultInviteResolver.ResolvedConfig config(String optionType, boolean orgAssociated) {
        EnrollInvite invite = new EnrollInvite();
        invite.setId("ei-1");
        PaymentOption option = new PaymentOption();
        option.setId("po-1");
        option.setType(optionType);
        PaymentPlan plan = new PaymentPlan();
        plan.setId("pp-1");
        plan.setName("Yearly");
        PackageSession ps = new PackageSession();
        ps.setId("ps-1");
        ps.setIsOrgAssociated(orgAssociated);
        return new DefaultInviteResolver.ResolvedConfig(invite, option, plan, ps, 365, false);
    }

    // ── raising the invoice ──

    @Test
    @DisplayName("no product chosen: nothing stored, nothing checked")
    void noProduct() {
        assertNull(service.resolveForCreate(null, List.of("u-1"), INST, "admin-1"));
        assertNull(service.resolveForCreate(new InvoiceProductLinkDTO(), List.of("u-1"), INST, "admin-1"));
        verifyNoInteractions(renewals, resolver);
    }

    @Test
    @DisplayName("a product needs exactly one billed learner")
    void singleLearnerOnly() {
        assertThrows(VacademyException.class,
                () -> service.resolveForCreate(pendingRenewal(), List.of("u-1", "u-2"), INST, "admin-1"));
    }

    @Test
    @DisplayName("renewal: checked against the learner's own membership and stored PENDING with its label")
    void renewalResolved() {
        when(renewals.describeRenewableForInvoice("up-1", INST, "u-1")).thenReturn("Renewal · Gold · Yearly");
        InvoiceProductLinkDTO req = new InvoiceProductLinkDTO();
        req.setType("RENEWAL");
        req.setUserPlanId("up-1");
        req.setNewEndDate("2999-01-31");
        req.setApplyAsMemberPrice(true);

        InvoiceProductLinkDTO link = service.resolveForCreate(req, List.of("u-1"), INST, "admin-1");

        assertEquals("PENDING", link.getStatus());
        assertEquals("Renewal · Gold · Yearly", link.getLabel());
        assertEquals("2999-01-31", link.getNewEndDate());
        assertEquals("admin-1", link.getCreatedBy());
        assertTrue(link.getApplyAsMemberPrice());
        assertFalse(link.getApplyNow());
    }

    @Test
    @DisplayName("renewal: an access end date that is not in the future is refused")
    void renewalPastEndDate() {
        when(renewals.describeRenewableForInvoice(any(), any(), any())).thenReturn("Renewal · Gold");
        InvoiceProductLinkDTO req = new InvoiceProductLinkDTO();
        req.setType("RENEWAL");
        req.setUserPlanId("up-1");
        req.setNewEndDate("2001-01-01");
        assertThrows(VacademyException.class, () -> service.resolveForCreate(req, List.of("u-1"), INST, "a"));
    }

    @Test
    @DisplayName("new enrolment: resolved as a dry run and the invite / option / plan pinned")
    void enrolmentResolved() {
        when(resolver.resolve(any(), eq(INST), eq(true))).thenReturn(config("SUBSCRIPTION", false));
        InvoiceProductLinkDTO req = new InvoiceProductLinkDTO();
        req.setType("NEW_ENROLLMENT");
        req.setPackageSessionId("ps-1");

        InvoiceProductLinkDTO link = service.resolveForCreate(req, List.of("u-1"), INST, "admin-1");

        assertEquals("ei-1", link.getEnrollInviteId());
        assertEquals("po-1", link.getPaymentOptionId());
        assertEquals("pp-1", link.getPlanId());
        assertTrue(link.getLabel().endsWith("Yearly"));
        verify(resolver).resolve(any(), eq(INST), eq(true));
        verify(resolver, never()).resolve(any(), any(), eq(false));
    }

    @Test
    @DisplayName("new enrolment refused: installment fee plan, organisation course, already enrolled")
    void enrolmentRefusals() {
        InvoiceProductLinkDTO req = new InvoiceProductLinkDTO();
        req.setType("NEW_ENROLLMENT");
        req.setPackageSessionId("ps-1");

        when(resolver.resolve(any(), eq(INST), eq(true))).thenReturn(config("CPO", false));
        assertThrows(VacademyException.class, () -> service.resolveForCreate(req, List.of("u-1"), INST, "a"));

        when(resolver.resolve(any(), eq(INST), eq(true))).thenReturn(config("ONE_TIME", true));
        assertThrows(VacademyException.class, () -> service.resolveForCreate(req, List.of("u-1"), INST, "a"));

        when(resolver.resolve(any(), eq(INST), eq(true))).thenReturn(config("ONE_TIME", false));
        when(studentSessions.findTopByPackageSessionIdAndUserIdAndStatusIn(eq("ps-1"), eq(INST), eq("u-1"), anyList()))
                .thenReturn(Optional.of(new StudentSessionInstituteGroupMapping()));
        VacademyException e = assertThrows(VacademyException.class,
                () -> service.resolveForCreate(req, List.of("u-1"), INST, "a"));
        assertTrue(e.getMessage().contains("renewal"), e.getMessage());
    }

    // ── once it is paid ──

    @Test
    @DisplayName("paid renewal: renewed once with the invoice total as its price, then stored FULFILLED")
    void renewalAppliedOnce() throws Exception {
        storeLink(pendingRenewal());
        Date end = new Date(System.currentTimeMillis() + 365L * 86_400_000L);
        when(renewals.renewFromInvoice(any())).thenReturn(
                ManualRenewalResultDTO.builder().userPlanId("up-1").newEndDate(end).build());

        InvoiceProductLinkDTO first = service.fulfil("inv-1", false);
        InvoiceProductLinkDTO second = service.fulfil("inv-1", false);

        ArgumentCaptor<AdminManualRenewalService.InvoiceRenewal> req =
                ArgumentCaptor.forClass(AdminManualRenewalService.InvoiceRenewal.class);
        verify(renewals, times(1)).renewFromInvoice(req.capture());
        assertEquals(new BigDecimal("621.00"), req.getValue().amount());
        assertEquals("INR", req.getValue().currency());
        assertTrue(req.getValue().lockMemberPrice());
        assertEquals("INV-0042", req.getValue().invoiceNumber());
        assertEquals("FULFILLED", first.getStatus());
        assertEquals("FULFILLED", second.getStatus());
        assertEquals(new BigDecimal("621.00"), first.getLockedPrice());
        assertTrue(invoice.getInvoiceDataJson().contains("\"notes\":\"kept\""), "other invoice data untouched");
        assertSame(membership, settled.getUserPlan(), "the payment is recorded on the membership");
        assertNull(abandoned.getUserPlan(), "an abandoned gateway attempt stays off the membership");
        assertTrue(second.getPaymentRecorded());
    }

    @Test
    @DisplayName("apply now: renewed while unpaid; the payment is recorded on the membership once it arrives")
    void applyNowThenPaid() throws Exception {
        invoice.setStatus("PENDING_PAYMENT");
        settled.setPaymentStatus("PAYMENT_PENDING");
        InvoiceProductLinkDTO link = pendingRenewal();
        link.setApplyNow(true);
        storeLink(link);
        when(renewals.renewFromInvoice(any())).thenReturn(
                ManualRenewalResultDTO.builder().userPlanId("up-1").newEndDate(new Date()).build());

        InvoiceProductLinkDTO applied = service.fulfil("inv-1", false);
        assertEquals("FULFILLED", applied.getStatus());
        assertNull(settled.getUserPlan(), "nothing is paid yet");

        invoice.setStatus("PAID");
        settled.setPaymentStatus("PAID");
        InvoiceProductLinkDTO paid = service.fulfil("inv-1", false);

        verify(renewals, times(1)).renewFromInvoice(any());
        assertSame(membership, settled.getUserPlan());
        assertTrue(paid.getPaymentRecorded());
    }

    @Test
    @DisplayName("apply now on a cancelled invoice does nothing")
    void applyNowCancelled() throws Exception {
        invoice.setStatus("REJECTED");
        InvoiceProductLinkDTO link = pendingRenewal();
        link.setApplyNow(true);
        storeLink(link);
        assertEquals("PENDING", service.fulfil("inv-1", false).getStatus());
        verifyNoInteractions(renewals);
    }

    @Test
    @DisplayName("an unpaid invoice applies nothing")
    void unpaidDoesNothing() throws Exception {
        invoice.setStatus("PENDING_PAYMENT");
        storeLink(pendingRenewal());
        InvoiceProductLinkDTO link = service.fulfil("inv-1", false);
        assertEquals("PENDING", link.getStatus());
        verifyNoInteractions(renewals, bulkAssign);
    }

    @Test
    @DisplayName("paid enrolment: bulk assign with no payment details, so no second payment is recorded")
    void enrolmentRecordsNoPayment() throws Exception {
        storeLink(pendingEnrolment());
        BulkAssignResultItemDTO row = BulkAssignResultItemDTO.builder()
                .userId("u-1").status("SUCCESS").actionTaken("CREATED").userPlanId("up-new").build();
        when(bulkAssign.bulkAssign(any(), eq("admin-1")))
                .thenReturn(BulkAssignResponseDTO.builder().results(List.of(row)).build());

        InvoiceProductLinkDTO link = service.fulfil("inv-1", false);

        ArgumentCaptor<BulkAssignRequestDTO> req = ArgumentCaptor.forClass(BulkAssignRequestDTO.class);
        verify(bulkAssign).bulkAssign(req.capture(), eq("admin-1"));
        assertEquals(List.of("u-1"), req.getValue().getUserIds());
        assertEquals("ps-1", req.getValue().getAssignments().get(0).getPackageSessionId());
        assertEquals("pp-1", req.getValue().getAssignments().get(0).getPlanId());
        assertNull(req.getValue().getOptions().getPaymentDate());
        assertNull(req.getValue().getOptions().getTransactionId());
        assertNull(req.getValue().getOptions().getPaymentDetails());
        assertFalse(req.getValue().getOptions().isDryRun());
        assertEquals("FULFILLED", link.getStatus());
        assertEquals("up-new", link.getResultUserPlanId());
        verify(renewals, never()).lockMemberPriceFromInvoice(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("a failed enrolment is stored FAILED with the reason, and a retry runs it again")
    void failureKeptForRetry() throws Exception {
        storeLink(pendingEnrolment());
        BulkAssignResultItemDTO failed = BulkAssignResultItemDTO.builder()
                .userId("u-1").status("FAILED").message("Config resolution failed: plan inactive").build();
        BulkAssignResultItemDTO ok = BulkAssignResultItemDTO.builder()
                .userId("u-1").status("SUCCESS").userPlanId("up-new").build();
        when(bulkAssign.bulkAssign(any(), any()))
                .thenReturn(BulkAssignResponseDTO.builder().results(List.of(failed)).build())
                .thenReturn(BulkAssignResponseDTO.builder().results(List.of(ok)).build());

        InvoiceProductLinkDTO link = service.fulfil("inv-1", false);
        assertEquals("FAILED", link.getStatus());
        assertEquals("Config resolution failed: plan inactive", link.getError());

        InvoiceProductLinkDTO retried = service.retry("inv-1", INST);
        assertEquals("FULFILLED", retried.getStatus());
        assertNull(retried.getError());
        verify(bulkAssign, times(2)).bulkAssign(any(), any());
    }

    @Test
    @DisplayName("a run already in progress is not started twice; a manual retry is told so")
    void inProgressNotDoubled() throws Exception {
        InvoiceProductLinkDTO running = pendingRenewal();
        running.setStatus(InvoiceProductLinkDTO.STATUS_IN_PROGRESS);
        running.setAttemptedAt(java.time.LocalDateTime.now().toString());
        storeLink(running);

        assertEquals("IN_PROGRESS", service.fulfil("inv-1", false).getStatus());
        assertThrows(VacademyException.class, () -> service.retry("inv-1", INST));
        verifyNoInteractions(renewals);
    }
}
