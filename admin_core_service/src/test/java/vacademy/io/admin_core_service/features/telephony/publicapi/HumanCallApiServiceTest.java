package vacademy.io.admin_core_service.features.telephony.publicapi;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadStatusRepository;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.telephony.core.CallDispositionService;
import vacademy.io.admin_core_service.features.telephony.core.CallLifecycleTxOps;
import vacademy.io.admin_core_service.features.telephony.core.CallOrchestrator;
import vacademy.io.admin_core_service.features.telephony.core.TelephonyConfigCache;
import vacademy.io.admin_core_service.features.telephony.core.TelephonyProviderRegistry;
import vacademy.io.admin_core_service.features.telephony.core.dto.ConnectCallResponseDTO;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.InstituteTelephonyConfig;
import vacademy.io.admin_core_service.features.telephony.publicapi.entity.HumanCallApiCall;
import vacademy.io.admin_core_service.features.telephony.publicapi.repository.HumanCallApiCallRepository;
import vacademy.io.admin_core_service.features.telephony.spi.OutboundOriginationResolver;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.UserWithRolesDTO;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Duration;
import java.time.Instant;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class HumanCallApiServiceTest {

    private static final AiCallingApiAuth.Principal P =
            new AiCallingApiAuth.Principal("inst-1", "0b8c3f4e-1111-2222-3333-444455556666", List.of("calls:write"));

    private HumanCallApiCallRepository calls;
    private HumanCallViews views;
    private HumanCallGuards guards;
    private HumanCallReservation reservation;
    private CallOrchestrator orchestrator;
    private CallLifecycleTxOps callTx;
    private TelephonyConfigCache cache;
    private TelephonyProviderRegistry registry;
    private AuthService auth;
    private AudienceResponseRepository leads;
    private CallDispositionService dispositions;
    private HumanCallApiService service;

    @BeforeEach
    void setUp() {
        calls = mock(HumanCallApiCallRepository.class);
        views = mock(HumanCallViews.class);
        guards = mock(HumanCallGuards.class);
        reservation = mock(HumanCallReservation.class);
        orchestrator = mock(CallOrchestrator.class);
        callTx = mock(CallLifecycleTxOps.class);
        cache = mock(TelephonyConfigCache.class);
        registry = mock(TelephonyProviderRegistry.class);
        auth = mock(AuthService.class);
        leads = mock(AudienceResponseRepository.class);
        dispositions = mock(CallDispositionService.class);
        service = new HumanCallApiService(calls, views, guards, reservation, orchestrator, callTx, cache, registry,
                auth, leads, dispositions, mock(LeadStatusRepository.class));
        provider("EXOTEL");
        when(auth.getActiveUsersByRoles(eq("inst-1"), anyList())).thenReturn(List.of(
                user("c-1", "Priya Sharma", "priya@school.in", "+919800000001"),
                user("c-2", "No Phone", "nophone@school.in", null)));
        when(reservation.reserve(any(), anyString(), anyInt(), any(), any())).thenAnswer(i -> new HumanCallReservation.Reserved(
                i.getArgument(0), prepared("log-1"), null));
        when(calls.findById(anyString())).thenReturn(Optional.empty());
        when(views.view(any(HumanCallApiCall.class))).thenAnswer(i -> new LinkedHashMap<>(Map.of("id",
                ((HumanCallApiCall) i.getArgument(0)).getId())));
        when(guards.perNumberDailyCap("inst-1")).thenReturn(3);
        when(leads.findUpToTwoLiveLeadsByInstituteAndPhoneLast10(anyString(), anyString())).thenReturn(List.of());
        when(auth.getUserByMobile(anyString())).thenReturn(Optional.empty());
        ConnectCallResponseDTO dialed = ConnectCallResponseDTO.builder().callLogId("log-1").status("QUEUED").build();
        when(orchestrator.dispatchPrepared(any())).thenReturn(dialed);
    }

    private static CallOrchestrator.Prepared prepared(String callLogId) {
        return new CallOrchestrator.Prepared(callLogId, "EXOTEL", null, null, null, null);
    }

    private HumanCallApiCall reservedRow() {
        ArgumentCaptor<HumanCallApiCall> row = ArgumentCaptor.forClass(HumanCallApiCall.class);
        verify(reservation).reserve(row.capture(), anyString(), anyInt(), any(), any());
        return row.getValue();
    }

    private CallLifecycleTxOps.DialTarget reservedTarget() {
        ArgumentCaptor<CallLifecycleTxOps.DialTarget> t = ArgumentCaptor.forClass(CallLifecycleTxOps.DialTarget.class);
        verify(reservation).reserve(any(), anyString(), anyInt(), t.capture(), any());
        return t.getValue();
    }

    private void provider(String type) {
        InstituteTelephonyConfig cfg = InstituteTelephonyConfig.builder().instituteId("inst-1").providerType(type)
                .enabled(true).build();
        when(cache.get("inst-1")).thenReturn(Optional.of(TelephonyConfigCache.Resolved.builder().config(cfg)
                .enabledNumbers(List.of()).build()));
    }

    private static UserWithRolesDTO user(String id, String name, String email, String mobile) {
        UserWithRolesDTO u = new UserWithRolesDTO();
        u.setId(id);
        u.setFullName(name);
        u.setEmail(email);
        u.setMobileNumber(mobile);
        return u;
    }

    private static HumanCallApiService.HumanCallInput input(String counsellorId, String phone) {
        return new HumanCallApiService.HumanCallInput(counsellorId, null, phone, "Asha Verma", null, "lead-8812",
                Map.of("deal", "D-9"), false);
    }

    private static AiCallingApiException apiError(Runnable r) {
        return assertThrows(AiCallingApiException.class, r::run);
    }

    // ── Validation ───────────────────────────────────────────────────────────────

    @Test
    void exactlyOneCounsellorSelectorIsRequired() {
        HumanCallApiService.Validated both = service.validate(new HumanCallApiService.HumanCallInput(
                "c-1", "priya@school.in", "+919876543210", null, null, null, null, null));
        assertEquals("counsellor_id", both.errors().get(0).get("field"));
        HumanCallApiService.Validated none = service.validate(new HumanCallApiService.HumanCallInput(
                null, " ", "+919876543210", null, null, null, null, null));
        assertEquals("counsellor_id", none.errors().get(0).get("field"));
        HumanCallApiService.Validated ok = service.validate(new HumanCallApiService.HumanCallInput(
                null, "priya@school.in", "+91 98765-43210", null, null, null, null, true));
        assertTrue(ok.errors().isEmpty());
        assertEquals("+919876543210", ok.phone());
        assertTrue(ok.analyze());
    }

    @Test
    void phoneAndMetadataAreValidatedLikeAiCalls() {
        HumanCallApiService.Validated v = service.validate(new HumanCallApiService.HumanCallInput(
                "c-1", null, "98765", null, "bad-email", null, Map.of("blob", "x".repeat(9000)), null));
        List<String> fields = v.errors().stream().map(e -> e.get("field")).toList();
        assertTrue(fields.containsAll(List.of("phone_number", "contact.email", "metadata")), fields.toString());
    }

    // ── Counsellors ──────────────────────────────────────────────────────────────

    @Test
    void aCounsellorOfAnotherInstituteIsNotFound() {
        // auth_service lists only inst-1's counsellors; "c-9" belongs elsewhere.
        AiCallingApiException e = apiError(() -> service.createHumanCall(P, input("c-9", "+919876543210"), null));
        assertEquals(HttpStatus.NOT_FOUND, e.getStatus());
        assertEquals("counsellor_not_found", e.getCode());
        verifyNoInteractions(orchestrator, reservation);
    }

    @Test
    void aCounsellorIsFoundByEmailCaseInsensitively() {
        HumanCallApiService.Validated v = service.validate(new HumanCallApiService.HumanCallInput(
                null, "PRIYA@School.in", "+919876543210", null, null, null, null, null));
        assertEquals("c-1", service.requireCounsellor("inst-1", v).id());
    }

    @Test
    void aCounsellorWithoutAMobileCannotCall() {
        AiCallingApiException e = apiError(() -> service.createHumanCall(P, input("c-2", "+919876543210"), null));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, e.getStatus());
        assertEquals("counsellor_cannot_call", e.getCode());
        verifyNoInteractions(orchestrator);
    }

    @Test
    void theCounsellorListSaysWhoCanCallAndNeverShowsNumbers() {
        Map<String, Object> out = service.listCounsellors(P);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> data = (List<Map<String, Object>>) out.get("data");
        assertEquals(2, data.size());
        Map<String, Object> noPhone = data.get(0);   // sorted by name: "No Phone" < "Priya Sharma"
        assertEquals("c-2", noPhone.get("id"));
        assertEquals(false, noPhone.get("can_call"));
        assertEquals(HumanCallApiService.NO_MOBILE, noPhone.get("blocked_reason"));
        assertEquals(true, data.get(1).get("can_call"));
        assertFalse(out.toString().contains("+9198"), "no phone numbers in the response");
    }

    @Test
    void airtelReadinessComesFromTheProvidersOwnPreflight() {
        provider("AIRTEL");
        OutboundOriginationResolver resolver = mock(OutboundOriginationResolver.class);
        when(registry.originationResolver("AIRTEL")).thenReturn(resolver);
        when(resolver.callerBlockedReason("inst-1", "c-1")).thenReturn(Optional.of("No Airtel extension is mapped to you"));
        when(resolver.callerBlockedReason("inst-1", "c-2")).thenReturn(Optional.empty());
        HumanCallApiService.Counsellor c1 = new HumanCallApiService.Counsellor("c-1", "P", null, null, List.of());
        HumanCallApiService.Counsellor c2 = new HumanCallApiService.Counsellor("c-2", "N", null, null, List.of());
        assertEquals(HumanCallApiService.NO_EXTENSION, service.blockedReason("inst-1", "AIRTEL", c1));
        assertNull(service.blockedReason("inst-1", "AIRTEL", c2));
    }

    @Test
    void noProviderMeansTelephonyNotConfigured() {
        when(cache.get("inst-1")).thenReturn(Optional.empty());
        AiCallingApiException e = apiError(() -> service.createHumanCall(P, input("c-1", "+919876543210"), null));
        assertEquals("telephony_not_configured", e.getCode());
        // An AI-only primary line cannot ring a counsellor either.
        provider("VACADEMY_AI");
        assertEquals("telephony_not_configured",
                apiError(() -> service.createHumanCall(P, input("c-1", "+919876543210"), null)).getCode());
    }

    // ── Guards ───────────────────────────────────────────────────────────────────

    @Test
    void outsideCallingHoursIsRejectedNotQueued() {
        doThrow(new AiCallingApiException(HttpStatus.UNPROCESSABLE_ENTITY, "outside_calling_hours", "late"))
                .when(guards).requireCallingHours(eq("inst-1"), any());
        AiCallingApiException e = apiError(() -> service.createHumanCall(P, input("c-1", "+919876543210"), null));
        assertEquals("outside_calling_hours", e.getCode());
        verifyNoInteractions(orchestrator, reservation);
    }

    @Test
    void theCallIsReservedThenDialledOutsideTheReservation() {
        service.createHumanCall(P, input("c-1", "+919876543210"), null);
        var order = inOrder(orchestrator, reservation);
        order.verify(orchestrator).assertCanDial("inst-1");
        order.verify(reservation).reserve(any(), eq("EXOTEL"), eq(3), any(), isNull());
        order.verify(orchestrator).dispatchPrepared(any());
        // The live-call guards run inside the reservation (under its locks), not before it.
        verify(guards, never()).requireCounsellorFree(any(), any(), any());
        verify(guards, never()).requireNumberAllowed(any(), any(), any(), anyInt());
    }

    @Test
    void aGuardRefusalInTheReservationDialsNothing() {
        when(reservation.reserve(any(), anyString(), anyInt(), any(), any()))
                .thenThrow(new AiCallingApiException(HttpStatus.CONFLICT, "counsellor_busy", "busy"));
        assertEquals("counsellor_busy",
                apiError(() -> service.createHumanCall(P, input("c-1", "+919876543210"), null)).getCode());
        verify(orchestrator, never()).dispatchPrepared(any());
    }

    @Test
    void aRetryThatWaitedOnTheLockGetsTheFirstCall() {
        when(reservation.reserve(any(), anyString(), anyInt(), any(), any())).thenReturn(
                new HumanCallReservation.Reserved(null, null, prior("log-1", Instant.now().minusSeconds(1))));
        Map<String, Object> out = service.createHumanCall(P, input("c-1", "+919876543210"), "k-1");
        assertEquals(true, out.get("idempotent_replay"));
        verify(orchestrator, never()).dispatchPrepared(any());
    }

    // ── Create, lead link, dial ──────────────────────────────────────────────────

    @Test
    void anUnknownNumberIsDialledAsAnApiContact() {
        service.createHumanCall(P, input("c-1", "+919876543210"), null);
        HumanCallApiCall row = reservedRow();
        assertTrue(row.getId().matches("^hcall_[0-9a-f]{24}$"));
        assertEquals("Priya Sharma", row.getCounsellorName());
        assertEquals("c-1", row.getCounsellorUserId());
        CallLifecycleTxOps.DialTarget target = reservedTarget();
        assertEquals("API_CONTACT", target.subjectType());
        assertEquals(row.getId(), target.subjectId());
        assertNull(target.responseId());
        assertEquals(AiCallingApiService.contactUserId("inst-1", "+919876543210"), target.userId());
    }

    @Test
    void exactlyOneMatchingLeadFilesTheCallOnThatLead() {
        when(leads.findUpToTwoLiveLeadsByInstituteAndPhoneLast10("inst-1", "9876543210"))
                .thenReturn(List.<Object[]>of(new Object[]{"resp-1", "lead-user-1"}));
        service.createHumanCall(P, input("c-1", "+919876543210"), null);
        CallLifecycleTxOps.DialTarget target = reservedTarget();
        assertEquals("resp-1", target.responseId());
        assertEquals("lead-user-1", target.userId());
        assertNull(target.subjectType(), "a lead call is stored like the dashboard's");
        verify(reservation).reserve(any(), anyString(), anyInt(), any(), eq("resp-1"));
    }

    @Test
    void twoMatchingLeadsAreAmbiguousAndNotLinked() {
        when(leads.findUpToTwoLiveLeadsByInstituteAndPhoneLast10("inst-1", "9876543210"))
                .thenReturn(List.of(new Object[]{"resp-1", "u1"}, new Object[]{"resp-2", "u2"}));
        assertNull(service.linkLead("inst-1", "+919876543210"));
        verify(auth, never()).getUserByMobile(anyString());
    }

    @Test
    void aLeadIsAlsoFoundThroughTheUserWhoseMobileItIs() {
        UserDTO u = new UserDTO();
        u.setId("user-7");
        when(auth.getUserByMobile("9876543210")).thenReturn(Optional.of(u));
        when(leads.findUpToTwoLiveLeadIdsByInstituteAndUser("inst-1", "user-7")).thenReturn(List.of("resp-7"));
        HumanCallApiService.LeadLink link = service.linkLead("inst-1", "+919876543210");
        assertEquals("resp-7", link.responseId());
        assertEquals("user-7", link.userId());
        when(leads.findUpToTwoLiveLeadIdsByInstituteAndUser("inst-1", "user-7")).thenReturn(List.of("a", "b"));
        assertNull(service.linkLead("inst-1", "+919876543210"));
    }

    @Test
    void outOfCreditsIsRefusedBeforeAnythingIsReserved() {
        doThrow(new ConflictException("Your institute has run out of AI credits. Please top up to continue calling."))
                .when(orchestrator).assertCanDial("inst-1");
        AiCallingApiException e = apiError(() -> service.createHumanCall(P, input("c-1", "+919876543210"), "k-1"));
        assertEquals(HttpStatus.PAYMENT_REQUIRED, e.getStatus());
        assertEquals("insufficient_credits", e.getCode());
        verifyNoInteractions(reservation);
    }

    @Test
    void aFailedDialClosesTheCallRowAndDropsTheApiRow() {
        when(orchestrator.dispatchPrepared(any()))
                .thenThrow(new VacademyException("Calling provider is temporarily unavailable. Try again in a moment."));
        AiCallingApiException e = apiError(() -> service.createHumanCall(P, input("c-1", "+919876543210"), "k-1"));
        assertEquals("provider_unavailable", e.getCode());
        verify(callTx).markFailedIfNotDispatched("log-1", "dispatch_failed");
        verify(calls).deleteById(startsWith("hcall_"));
    }

    @Test
    void anOriginationRefusalInTheReservationIsMapped() {
        when(reservation.reserve(any(), anyString(), anyInt(), any(), any()))
                .thenThrow(new VacademyException("Add a verified mobile number in your profile before placing calls"));
        assertEquals("counsellor_cannot_call",
                apiError(() -> service.createHumanCall(P, input("c-1", "+919876543210"), null)).getCode());
        verify(orchestrator, never()).dispatchPrepared(any());
    }

    @Test
    void dialErrorsUseTheApiVocabulary() {
        assertEquals("counsellor_cannot_call", HumanCallApiService.dialError(
                new VacademyException("Add a verified mobile number in your profile before placing calls")).getCode());
        assertEquals("telephony_not_configured", HumanCallApiService.dialError(
                new VacademyException("Calling is not configured for this institute")).getCode());
        assertEquals("provider_unavailable", HumanCallApiService.dialError(
                new VacademyException("Calling provider is temporarily unavailable. Try again in a moment.")).getCode());
        AiCallingApiException contact = HumanCallApiService.dialError(new VacademyException("Phone number format not supported"));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, contact.getStatus());
        assertEquals("invalid_request", contact.getCode());
        assertEquals("invalid_request", HumanCallApiService.dialError(
                new VacademyException("This contact has no phone on file")).getCode());
        AiCallingApiException counsellorNumber = HumanCallApiService.dialError(new VacademyException(
                "Phone number format rejected by the provider. Check the From/To fields."));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, counsellorNumber.getStatus());
        assertEquals("counsellor_cannot_call", counsellorNumber.getCode());
        assertEquals("conflict", HumanCallApiService.dialError(new ConflictException("Something else")).getCode());
        AiCallingApiException other = HumanCallApiService.dialError(new VacademyException("Exotel balance is low"));
        assertEquals(HttpStatus.BAD_GATEWAY, other.getStatus());
        assertEquals("dial_failed", other.getCode());
    }

    // ── Idempotency ──────────────────────────────────────────────────────────────

    private HumanCallApiCall prior(String callLogId, Instant createdAt) {
        return HumanCallApiCall.builder().id("hcall_abc").instituteId("inst-1").counsellorUserId("c-1")
                .counsellorEmail("priya@school.in").phoneNumber("+919876543210").contactName("Asha Verma")
                .externalId("lead-8812").metadata(Map.of("deal", "D-9")).callLogId(callLogId)
                .createdAt(createdAt).build();
    }

    @Test
    void theSameRequestReplaysTheFirstCall() {
        when(calls.findByInstituteIdAndIdempotencyKey("inst-1", "k-1"))
                .thenReturn(Optional.of(prior("log-1", Instant.now().minusSeconds(30))));
        Map<String, Object> out = service.createHumanCall(P, input("c-1", "+91 98765 43210"), " k-1 ");
        assertEquals(true, out.get("idempotent_replay"));
        assertEquals("hcall_abc", out.get("id"));
        verifyNoInteractions(orchestrator, reservation);
    }

    @Test
    void theSameCounsellorByEmailIsTheSameRequest() {
        when(calls.findByInstituteIdAndIdempotencyKey("inst-1", "k-1"))
                .thenReturn(Optional.of(prior("log-1", Instant.now().minusSeconds(30))));
        HumanCallApiService.HumanCallInput byEmail = new HumanCallApiService.HumanCallInput(null, "Priya@School.in",
                "+919876543210", "Asha Verma", null, "lead-8812", Map.of("deal", "D-9"), null);
        assertEquals(true, service.createHumanCall(P, byEmail, "k-1").get("idempotent_replay"));
    }

    @Test
    void aDifferentRequestUnderTheKeyIsRefused() {
        when(calls.findByInstituteIdAndIdempotencyKey("inst-1", "k-1"))
                .thenReturn(Optional.of(prior("log-1", Instant.now().minusSeconds(30))));
        for (HumanCallApiService.HumanCallInput other : List.of(
                input("c-1", "+919876543211"),
                input("c-2", "+919876543210"),
                new HumanCallApiService.HumanCallInput("c-1", null, "+919876543210", "Asha Verma", null, "lead-8812",
                        Map.of("deal", "D-9"), true))) {
            AiCallingApiException e = apiError(() -> service.createHumanCall(P, other, "k-1"));
            assertEquals(HttpStatus.CONFLICT, e.getStatus());
            assertEquals("idempotency_key_reused", e.getCode());
        }
        verifyNoInteractions(orchestrator, reservation);
    }

    @Test
    void aFirstRequestStillDiallingIsInProgress() {
        when(calls.findByInstituteIdAndIdempotencyKey("inst-1", "k-1"))
                .thenReturn(Optional.of(prior(null, Instant.now().minusSeconds(3))));
        AiCallingApiException e = apiError(() -> service.createHumanCall(P, input("c-1", "+919876543210"), "k-1"));
        assertEquals("request_in_progress", e.getCode());
        assertEquals(HumanCallApiService.IN_PROGRESS_RETRY_AFTER, e.getRetryAfterSeconds());
    }

    @Test
    void aConcurrentInsertWithTheKeyAnswersFromTheWinner() {
        when(calls.findByInstituteIdAndIdempotencyKey("inst-1", "k-1"))
                .thenReturn(Optional.empty())
                .thenReturn(Optional.of(prior(null, Instant.now())));
        when(reservation.reserve(any(), anyString(), anyInt(), any(), any()))
                .thenThrow(new org.springframework.dao.DataIntegrityViolationException("dup"));
        AiCallingApiException e = apiError(() -> service.createHumanCall(P, input("c-1", "+919876543210"), "k-1"));
        assertEquals("request_in_progress", e.getCode());
        verify(orchestrator, never()).dispatchPrepared(any());
    }

    @Test
    void anExpiredKeyMayBeReused() {
        when(calls.findByInstituteIdAndIdempotencyKey("inst-1", "k-1"))
                .thenReturn(Optional.of(prior("log-1", Instant.now().minus(Duration.ofHours(25)))));
        service.createHumanCall(P, input("c-1", "+919876543299"), "k-1");
        verify(calls).clearIdempotencyKeysBefore(any());
        verify(orchestrator).dispatchPrepared(any());
    }

    // ── Dispositions ─────────────────────────────────────────────────────────────

    @Test
    void aDispositionGoesThroughTheDashboardPathAsTheKey() {
        when(calls.findByIdAndInstituteId("hcall_abc", "inst-1"))
                .thenReturn(Optional.of(prior("log-1", Instant.now())));
        service.setDisposition(P, "hcall_abc", "INTERESTED", " wants a demo ");
        verify(dispositions).applyDisposition("log-1", "inst-1", "INTERESTED", "wants a demo", null,
                "api:0b8c3f4e111122223333444455556666");
    }

    @Test
    void anotherInstitutesCallIsNotFoundForADisposition() {
        when(calls.findByIdAndInstituteId("hcall_abc", "inst-1")).thenReturn(Optional.empty());
        assertEquals("not_found", apiError(() -> service.setDisposition(P, "hcall_abc", "INTERESTED", null)).getCode());
        verifyNoInteractions(dispositions);
    }

    @Test
    void anUnknownDispositionIs422() {
        when(calls.findByIdAndInstituteId("hcall_abc", "inst-1"))
                .thenReturn(Optional.of(prior("log-1", Instant.now())));
        when(dispositions.applyDisposition(anyString(), anyString(), anyString(), any(), any(), anyString()))
                .thenThrow(new VacademyException("Unknown disposition: NOPE"));
        assertEquals("unknown_disposition", apiError(() -> service.setDisposition(P, "hcall_abc", "NOPE", null)).getCode());
    }

    @Test
    void aCallThatWasNeverPlacedTakesNoDisposition() {
        when(calls.findByIdAndInstituteId("hcall_abc", "inst-1")).thenReturn(Optional.of(prior(null, Instant.now())));
        assertEquals("call_not_dialed", apiError(() -> service.setDisposition(P, "hcall_abc", "INTERESTED", null)).getCode());
    }

    @Test
    void theActorFitsTheDispositionedByColumn() {
        assertEquals("api:0b8c3f4e111122223333444455556666", HumanCallApiService.actor("0b8c3f4e-1111-2222-3333-444455556666"));
        assertTrue(HumanCallApiService.actor("legacy:" + "x".repeat(60)).length() <= 36);
    }

    // ── List filters ─────────────────────────────────────────────────────────────

    @Test
    void theStatusFilterIsThePublicStatusWithTheViewsCutOffs() {
        when(calls.page(anyString(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), anyInt()))
                .thenReturn(List.of());
        Instant before = Instant.now();
        service.listHumanCalls(P, "c-1", "failed", "+91 98765 43210", null, null, null, 500, null);
        ArgumentCaptor<Instant> creatingSince = ArgumentCaptor.forClass(Instant.class);
        ArgumentCaptor<java.sql.Timestamp> stuck = ArgumentCaptor.forClass(java.sql.Timestamp.class);
        ArgumentCaptor<java.sql.Timestamp> airtelStuck = ArgumentCaptor.forClass(java.sql.Timestamp.class);
        verify(calls).page(eq("inst-1"), eq("c-1"), eq("+919876543210"), isNull(), isNull(), isNull(), eq("failed"),
                creatingSince.capture(), stuck.capture(), airtelStuck.capture(), isNull(), isNull(), eq(101));
        assertFalse(creatingSince.getValue().isAfter(before.minus(HumanCallViews.CREATING_GRACE).plusSeconds(5)));
        Instant stuckAt = stuck.getValue().toLocalDateTime().toInstant(java.time.ZoneOffset.UTC);
        assertTrue(Duration.between(stuckAt, before).minus(HumanCallViews.STUCK_AFTER).abs().getSeconds() < 5);
        Instant airtelAt = airtelStuck.getValue().toLocalDateTime().toInstant(java.time.ZoneOffset.UTC);
        assertTrue(Duration.between(airtelAt, before).minus(HumanCallViews.STUCK_AFTER_AIRTEL).abs().getSeconds() < 5);
        assertEquals("invalid_request", apiError(() -> service.listHumanCalls(P, null, "ringing", null, null, null,
                null, 10, null)).getCode());
    }

    @Test
    void aCounsellorMobileThatIsNotAPhoneNumberCannotCall() {
        HumanCallApiService.Counsellor c = new HumanCallApiService.Counsellor("c-3", "X", null, "12345", List.of());
        assertEquals(HumanCallApiService.BAD_MOBILE, service.blockedReason("inst-1", "PLIVO", c));
    }
}
