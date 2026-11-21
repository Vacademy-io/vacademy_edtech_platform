package vacademy.io.admin_core_service.features.telephony.publicapi;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.institute_api.service.InstituteApiAuditWriter;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCounsellorEndpoint;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCounsellorEndpointRepository;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.*;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class CounsellorApiServiceTest {

    private static final String INST = "inst-1";
    private static final AiCallingApiAuth.Principal P =
            new AiCallingApiAuth.Principal(INST, "key-1", List.of("counsellors:manage"));
    private static final AiCallingApiAuth.Principal READER =
            new AiCallingApiAuth.Principal(INST, "key-2", List.of("human_calls:read"));

    private AuthService auth;
    private HumanCallApiService humanCalls;
    private TelephonyCounsellorEndpointRepository endpoints;
    private NamedParameterJdbcTemplate jdbc;
    private ApiIdempotencyStore idempotency;
    private CounsellorApiService service;
    /** userId -> role rows (institute_id, role_name, status). */
    private final Map<String, List<Map<String, String>>> roles = new HashMap<>();
    private final Map<String, UserDTO> users = new HashMap<>();

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        auth = mock(AuthService.class);
        humanCalls = mock(HumanCallApiService.class);
        endpoints = mock(TelephonyCounsellorEndpointRepository.class);
        jdbc = mock(NamedParameterJdbcTemplate.class);
        idempotency = mock(ApiIdempotencyStore.class);
        service = new CounsellorApiService(auth, humanCalls, endpoints, jdbc, idempotency,
                mock(InstituteApiAuditWriter.class));
        when(idempotency.run(any(), any(), any(), any(), any(), any(), any())).thenAnswer(i -> {
            ApiIdempotencyStore.Created c = ((Supplier<ApiIdempotencyStore.Created>) i.getArgument(5)).get();
            return new ApiIdempotencyStore.Outcome(c.body(), false, c.created());
        });
        when(idempotency.tryLock(anyString(), anyString())).thenReturn(true);
        when(auth.getRoleMembershipsStrict(anyString())).thenAnswer(i -> roles.getOrDefault(i.getArgument(0), List.of()));
        when(auth.getUsersFromAuthServiceByUserIds(anyList())).thenAnswer(i -> {
            List<UserDTO> out = new ArrayList<>();
            for (Object id : (List<?>) i.getArgument(0)) if (users.containsKey(id)) out.add(users.get(id));
            return out;
        });
        when(auth.findUserByEmailStrict(anyString())).thenReturn(Optional.empty());
        when(auth.getUserByMobile(anyString())).thenReturn(Optional.empty());
        when(humanCalls.primaryProvider(INST)).thenReturn("EXOTEL");
        when(endpoints.findByCounsellorUserIdAndProviderType(anyString(), anyString())).thenReturn(Optional.empty());
        when(endpoints.findByInstituteIdAndProviderTypeAndExtension(anyString(), anyString(), anyString())).thenReturn(List.of());
        when(jdbc.queryForList(anyString(), any(SqlParameterSource.class))).thenReturn(List.of());
    }

    private void role(String userId, String institute, String role, String status) {
        roles.computeIfAbsent(userId, k -> new ArrayList<>())
                .add(Map.of("institute_id", institute, "role_name", role, "status", status));
    }

    private UserDTO user(String id, String name, String email, String mobile) {
        UserDTO u = new UserDTO();
        u.setId(id);
        u.setFullName(name);
        u.setEmail(email);
        u.setMobileNumber(mobile);
        u.setRootUser(true);
        users.put(id, u);
        return u;
    }

    private static CounsellorApiService.CreateInput create(String mobile) {
        return new CounsellorApiService.CreateInput("Asha Rao", "Asha@School.in", mobile, null, null);
    }

    // ── Create ───────────────────────────────────────────────────────────────────

    @Test
    void aNewEmailCreatesAnActiveCounsellorWithTheWelcomeEmail() {
        when(auth.createUserFromAuthService(any(), eq(INST), eq(true))).thenAnswer(i -> {
            UserDTO u = user("u-new", "Asha Rao", "asha@school.in", null);
            role("u-new", INST, "COUNSELLOR", "ACTIVE");
            return u;
        });

        ApiIdempotencyStore.Outcome out = service.createCounsellor(P, create("+91 98000 00001"), "idem-1");

        ArgumentCaptor<UserDTO> dto = ArgumentCaptor.forClass(UserDTO.class);
        verify(auth).createUserFromAuthService(dto.capture(), eq(INST), eq(true));
        assertEquals(List.of("COUNSELLOR"), dto.getValue().getRoles());
        assertEquals("asha@school.in", dto.getValue().getEmail());
        // The mobile is never part of the create (a PHONE-identifier institute would match it to another account).
        assertNull(dto.getValue().getMobileNumber());
        ArgumentCaptor<UserDTO> patch = ArgumentCaptor.forClass(UserDTO.class);
        verify(auth).updateUser(patch.capture(), eq("u-new"));
        assertEquals("919800000001", patch.getValue().getMobileNumber());
        assertTrue(patch.getValue().isRootUser());
        assertTrue(out.created());
        assertEquals(false, out.body().get("existing_account"));
        assertEquals(true, out.body().get("welcome_email_sent"));
        assertEquals("active", out.body().get("status"));
        verify(auth, never()).addRolesToUserStrict(any(), any(), any());
    }

    @Test
    void anAccountOfAnotherInstituteIsRefusedAndNothingIsRevealed() {
        user("u-old", "Asha R", "asha@school.in", "919811111111");
        role("u-old", "inst-9", "STUDENT", "ACTIVE");
        when(auth.findUserByEmailStrict("asha@school.in")).thenReturn(Optional.of(users.get("u-old")));

        AiCallingApiException e = assertThrows(AiCallingApiException.class,
                () -> service.createCounsellor(P, create("+919800000001"), null));

        assertEquals("email_in_use_elsewhere", e.getCode());
        assertNull(e.getDetails());                              // no id, no name, no number
        assertFalse(e.getMessage().contains("Asha"));
        verify(auth, never()).addRolesToUserStrict(any(), any(), any());
        verify(auth, never()).createUserFromAuthService(any(), any(), anyBoolean());
    }

    @Test
    void anAccountWithNoMembershipAnywhereIsRefusedToo() {
        user("u-orphan", "Somebody", "asha@school.in", "919811111111");
        when(auth.findUserByEmailStrict("asha@school.in")).thenReturn(Optional.of(users.get("u-orphan")));
        assertEquals("email_in_use_elsewhere", assertThrows(AiCallingApiException.class,
                () -> service.createCounsellor(P, create(null), null)).getCode());
    }

    @Test
    void aFormerMemberOfThisInstituteGetsTheRoleBackNoEmailNoProfileChange() {
        user("u-old", "Asha R", "asha@school.in", "919811111111");
        role("u-old", INST, "COUNSELLOR", "DELETED");
        when(auth.findUserByEmailStrict("asha@school.in")).thenReturn(Optional.of(users.get("u-old")));
        doAnswer(i -> {
            role("u-old", INST, "COUNSELLOR", "ACTIVE");
            return null;
        }).when(auth).addRolesToUserStrict("u-old", List.of("COUNSELLOR"), INST);

        ApiIdempotencyStore.Outcome out = service.createCounsellor(P, create("+919800000001"), null);

        verify(auth, never()).createUserFromAuthService(any(), any(), anyBoolean());
        verify(auth, never()).updateUser(any(), any());
        assertTrue(out.created());
        assertEquals(true, out.body().get("existing_account"));
        assertEquals(false, out.body().get("welcome_email_sent"));
        assertEquals(false, out.body().get("shared_account"));
        @SuppressWarnings("unchecked")
        List<Map<String, String>> warnings = (List<Map<String, String>>) out.body().get("warnings");
        assertTrue(warnings.stream().anyMatch(w -> "mobile_number_ignored".equals(w.get("code"))));
        assertTrue(warnings.stream().anyMatch(w -> "name_ignored".equals(w.get("code"))));
    }

    @Test
    void aRetryAfterAHalfDoneCreateFillsInTheMissingMobile() {
        user("u-1", "Asha Rao", "asha@school.in", null);          // created, mobile never set
        role("u-1", INST, "COUNSELLOR", "ACTIVE");
        when(auth.findUserByEmailStrict("asha@school.in")).thenReturn(Optional.of(users.get("u-1")));
        ApiIdempotencyStore.Outcome out = service.createCounsellor(P, create("+919800000001"), "idem-1");
        assertFalse(out.created());
        ArgumentCaptor<UserDTO> patch = ArgumentCaptor.forClass(UserDTO.class);
        verify(auth).updateUser(patch.capture(), eq("u-1"));
        assertEquals("919800000001", patch.getValue().getMobileNumber());
    }

    @Test
    void aSharedLoginsMobileIsNeverShown() {
        user("u-1", "Asha", "asha@school.in", "919800000001");
        role("u-1", INST, "COUNSELLOR", "ACTIVE");
        role("u-1", "inst-2", "STUDENT", "ACTIVE");
        Map<String, Object> view = service.getCounsellor(P, "u-1");
        assertTrue(view.containsKey("mobile_number"));
        assertNull(view.get("mobile_number"));
        assertEquals(true, view.get("shared_account"));
    }

    @Test
    void anActiveCounsellorAlreadyHereIsA200NoOp() {
        user("u-1", "Asha Rao", "asha@school.in", "919800000001");
        role("u-1", INST, "COUNSELLOR", "ACTIVE");
        when(auth.findUserByEmailStrict("asha@school.in")).thenReturn(Optional.of(users.get("u-1")));
        ApiIdempotencyStore.Outcome out = service.createCounsellor(P, create(null), null);
        assertFalse(out.created());
        assertEquals(false, out.body().get("created"));
        verify(auth, never()).addRolesToUserStrict(any(), any(), any());
    }

    @Test
    void anAdminOrTeacherOfThisInstituteIsNeverTurnedIntoACounsellor() {
        user("u-1", "Boss", "asha@school.in", null);
        role("u-1", INST, "ADMIN", "ACTIVE");
        when(auth.findUserByEmailStrict("asha@school.in")).thenReturn(Optional.of(users.get("u-1")));
        AiCallingApiException e = assertThrows(AiCallingApiException.class,
                () -> service.createCounsellor(P, create(null), null));
        assertEquals("account_has_other_role", e.getCode());
        verify(auth, never()).addRolesToUserStrict(any(), any(), any());
    }

    @Test
    void aDeactivatedCounsellorMustBeReactivatedNotRecreated() {
        user("u-1", "Asha", "asha@school.in", null);
        role("u-1", INST, "COUNSELLOR", "DISABLED");
        when(auth.findUserByEmailStrict("asha@school.in")).thenReturn(Optional.of(users.get("u-1")));
        assertEquals("counsellor_inactive", assertThrows(AiCallingApiException.class,
                () -> service.createCounsellor(P, create(null), null)).getCode());
    }

    @Test
    void aGrantThatDidNotLandIsAnError() {
        when(auth.createUserFromAuthService(any(), eq(INST), anyBoolean()))
                .thenAnswer(i -> user("u-new", "Asha Rao", "asha@school.in", null)); // no role row appears
        AiCallingApiException e = assertThrows(AiCallingApiException.class,
                () -> service.createCounsellor(P, create(null), null));
        assertEquals("role_unavailable", e.getCode());
    }

    @Test
    void anAuthOutageIsA503NotANewAccount() {
        when(auth.findUserByEmailStrict(anyString())).thenThrow(new RuntimeException("down"));
        AiCallingApiException e = assertThrows(AiCallingApiException.class,
                () -> service.createCounsellor(P, create(null), null));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, e.getStatus());
        verify(auth, never()).createUserFromAuthService(any(), any(), anyBoolean());
    }

    @Test
    void aConcurrentCreateOfTheSameEmailWaits() {
        when(idempotency.tryLock(anyString(), anyString())).thenReturn(false);
        AiCallingApiException e = assertThrows(AiCallingApiException.class,
                () -> service.createCounsellor(P, create(null), null));
        assertEquals("request_in_progress", e.getCode());
        verify(auth, never()).findUserByEmailStrict(any());
        verify(auth, never()).createUserFromAuthService(any(), any(), anyBoolean());
    }

    @Test
    void theEmailLockIsReleasedEvenWhenTheCreateFails() {
        when(auth.findUserByEmailStrict(anyString())).thenThrow(new RuntimeException("down"));
        assertThrows(AiCallingApiException.class, () -> service.createCounsellor(P, create(null), null));
        verify(idempotency).unlock(eq("global"), anyString());
    }

    @Test
    void createValidatesItsInput() {
        AiCallingApiException e = assertThrows(AiCallingApiException.class, () -> service.createCounsellor(P,
                new CounsellorApiService.CreateInput(" ", "not-an-email", "12345", "ext 1", null), null));
        assertEquals("invalid_request", e.getCode());
        @SuppressWarnings("unchecked")
        List<Map<String, String>> errors = (List<Map<String, String>>) e.getDetails().get("errors");
        assertEquals(List.of("name", "email", "mobile_number", "airtel_extension"),
                errors.stream().map(x -> x.get("field")).toList());
    }

    @Test
    void aTakenExtensionIsRefusedBeforeAnythingIsCreated() {
        when(endpoints.findByInstituteIdAndProviderTypeAndExtension(INST, "AIRTEL", "201")).thenReturn(List.of(
                TelephonyCounsellorEndpoint.builder().instituteId(INST).counsellorUserId("someone").extension("201").build()));
        AiCallingApiException e = assertThrows(AiCallingApiException.class, () -> service.createCounsellor(P,
                new CounsellorApiService.CreateInput("Asha", "asha@school.in", null, "201", false), null));
        assertEquals("extension_taken", e.getCode());
        verify(auth, never()).createUserFromAuthService(any(), any(), anyBoolean());
    }

    @Test
    void sendWelcomeEmailFalseIsPassedThrough() {
        when(auth.createUserFromAuthService(any(), eq(INST), eq(false))).thenAnswer(i -> {
            role("u-new", INST, "COUNSELLOR", "ACTIVE");
            return user("u-new", "Asha", "asha@school.in", null);
        });
        ApiIdempotencyStore.Outcome out = service.createCounsellor(P,
                new CounsellorApiService.CreateInput("Asha", "asha@school.in", null, null, false), null);
        assertEquals(false, out.body().get("welcome_email_sent"));
        @SuppressWarnings("unchecked")
        List<Map<String, String>> warnings = (List<Map<String, String>>) out.body().get("warnings");
        assertTrue(warnings.stream().anyMatch(w -> "mobile_number_missing".equals(w.get("code"))));
    }

    // ── Read ─────────────────────────────────────────────────────────────────────

    @Test
    void readingHidesStaffContactDetailsFromAHumanCallsKey() {
        user("u-1", "Asha", "asha@school.in", "919800000001");
        role("u-1", INST, "COUNSELLOR", "ACTIVE");
        Map<String, Object> view = service.getCounsellor(READER, "u-1");
        assertFalse(view.containsKey("mobile_number"));
        assertEquals("active", view.get("status"));
        assertTrue(service.getCounsellor(P, "u-1").containsKey("mobile_number"));
    }

    @Test
    void aUserOfAnotherInstituteIsNotFound() {
        user("u-9", "Other", "o@x.in", null);
        role("u-9", "inst-2", "COUNSELLOR", "ACTIVE");
        assertEquals("counsellor_not_found",
                assertThrows(AiCallingApiException.class, () -> service.getCounsellor(P, "u-9")).getCode());
    }

    @Test
    void aDeactivatedCounsellorReadsAsInactiveAndCannotCall() {
        user("u-1", "Asha", "asha@school.in", "919800000001");
        role("u-1", INST, "COUNSELLOR", "DISABLED");
        Map<String, Object> view = service.getCounsellor(P, "u-1");
        assertEquals("inactive", view.get("status"));
        assertEquals(false, view.get("can_call"));
    }

    // ── Patch ────────────────────────────────────────────────────────────────────

    @Test
    void patchChangesOnlyTheFieldsSent() {
        user("u-1", "Asha", "asha@school.in", "919800000001");
        role("u-1", INST, "COUNSELLOR", "ACTIVE");
        service.patchCounsellor(P, "u-1", new CounsellorApiService.PatchInput("Asha Rao", true, null, false,
                null, false, null));
        ArgumentCaptor<UserDTO> patch = ArgumentCaptor.forClass(UserDTO.class);
        verify(auth).updateUser(patch.capture(), eq("u-1"));
        assertEquals("Asha Rao", patch.getValue().getFullName());
        assertNull(patch.getValue().getMobileNumber());
        assertNull(patch.getValue().getEmail());
        assertTrue(patch.getValue().isRootUser());
        verify(endpoints, never()).save(any());
        verify(auth, never()).updateRoleStatusForRoles(any(), any(), any(), any());
    }

    @Test
    void anAdminIsNeverModified() {
        user("u-1", "Boss", "b@school.in", null);
        role("u-1", INST, "ADMIN", "ACTIVE");
        role("u-1", INST, "COUNSELLOR", "ACTIVE");
        AiCallingApiException e = assertThrows(AiCallingApiException.class, () -> service.patchCounsellor(P, "u-1",
                new CounsellorApiService.PatchInput(null, false, null, false, null, false, false)));
        assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
        assertEquals("counsellor_not_manageable", e.getCode());
        assertThrows(AiCallingApiException.class, () -> service.deactivateCounsellor(P, "u-1"));
        verify(auth, never()).updateRoleStatusForRoles(any(), any(), any(), any());
        verify(auth, never()).updateUser(any(), any());
    }

    @Test
    void aSharedAccountsNameAndMobileAreNotChangedButItsExtensionIs() {
        user("u-1", "Asha", "asha@school.in", null);
        role("u-1", INST, "COUNSELLOR", "ACTIVE");
        role("u-1", "inst-2", "STUDENT", "ACTIVE");
        AiCallingApiException e = assertThrows(AiCallingApiException.class, () -> service.patchCounsellor(P, "u-1",
                new CounsellorApiService.PatchInput(null, false, "+919800000001", true, null, false, null)));
        assertEquals("shared_account", e.getCode());
        verify(auth, never()).updateUser(any(), any());

        service.patchCounsellor(P, "u-1", new CounsellorApiService.PatchInput(null, false, null, false, "205", true, null));
        ArgumentCaptor<TelephonyCounsellorEndpoint> row = ArgumentCaptor.forClass(TelephonyCounsellorEndpoint.class);
        verify(endpoints).save(row.capture());
        assertEquals("205", row.getValue().getExtension());
        assertEquals(INST, row.getValue().getInstituteId());
    }

    @Test
    void aNullExtensionRemovesOnlyThisInstitutesMapping() {
        user("u-1", "Asha", "asha@school.in", null);
        role("u-1", INST, "COUNSELLOR", "ACTIVE");
        TelephonyCounsellorEndpoint mine = TelephonyCounsellorEndpoint.builder().id("ep-1").instituteId(INST)
                .counsellorUserId("u-1").providerType("AIRTEL").extension("201").build();
        when(endpoints.findByCounsellorUserIdAndProviderType("u-1", "AIRTEL")).thenReturn(Optional.of(mine));
        service.patchCounsellor(P, "u-1", new CounsellorApiService.PatchInput(null, false, null, false, null, true, null));
        verify(endpoints).delete(mine);
    }

    @Test
    void anEmptyPatchOrAnEmptiedMobileIsA400() {
        user("u-1", "Asha", "asha@school.in", null);
        role("u-1", INST, "COUNSELLOR", "ACTIVE");
        assertThrows(AiCallingApiException.class, () -> service.patchCounsellor(P, "u-1",
                new CounsellorApiService.PatchInput(null, false, null, false, null, false, null)));
        assertEquals("invalid_request", assertThrows(AiCallingApiException.class, () -> service.patchCounsellor(P, "u-1",
                new CounsellorApiService.PatchInput(null, false, null, true, null, false, null))).getCode());
    }

    // ── Deactivate / reactivate ──────────────────────────────────────────────────

    @Test
    void deactivationDisablesTheRolePausesPoolsAndLeavesIvrLists() {
        user("u-1", "Asha", "asha@school.in", null);
        role("u-1", INST, "COUNSELLOR", "ACTIVE");
        when(auth.updateRoleStatusForRoles(INST, "u-1", List.of("COUNSELLOR", "COUNSELOR"), "DISABLED")).thenAnswer(i -> {
            roles.put("u-1", List.of(Map.of("institute_id", INST, "role_name", "COUNSELLOR", "status", "DISABLED")));
            return 1;
        });
        when(jdbc.update(contains("counselor_pool_member"), any(SqlParameterSource.class))).thenReturn(3);
        Map<String, Object> ivrRow = new HashMap<>();
        ivrRow.put("node_id", "n-1");
        ivrRow.put("menu_id", "m-1");
        ivrRow.put("menu_name", "Main");
        ivrRow.put("label", "Sales");
        ivrRow.put("dial_user_ids", "[\"u-1\",\"u-2\"]");
        ivrRow.put("dial_targets", null);
        Map<String, Object> soloRow = new HashMap<>(ivrRow);
        soloRow.put("node_id", "n-2");
        soloRow.put("dial_user_ids", "[\"u-1\"]");
        when(jdbc.queryForList(contains("dial_user_ids"), any(SqlParameterSource.class))).thenReturn(List.of(ivrRow, soloRow));

        Map<String, Object> out = service.deactivateCounsellor(P, "u-1");

        assertEquals("inactive", out.get("status"));
        @SuppressWarnings("unchecked")
        Map<String, Object> effects = (Map<String, Object>) out.get("effects");
        assertEquals(true, effects.get("role_disabled"));
        assertEquals("this_account", effects.get("sessions_revoked"));
        assertEquals(3, effects.get("pool_memberships_deactivated"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> steps = (List<Map<String, Object>>) effects.get("ivr_dial_steps_updated");
        assertEquals(2, steps.size());
        assertEquals(false, steps.get(0).get("no_one_left"));
        assertEquals(true, steps.get(1).get("no_one_left"));
        ArgumentCaptor<SqlParameterSource> params = ArgumentCaptor.forClass(SqlParameterSource.class);
        verify(jdbc, times(2)).update(contains("UPDATE ivr_node"), params.capture());
        assertEquals("[\"u-2\"]", params.getAllValues().get(0).getValue("j"));
        assertEquals("[]", params.getAllValues().get(1).getValue("j"));
        // The pool update is scoped to THIS institute's pools.
        ArgumentCaptor<SqlParameterSource> pool = ArgumentCaptor.forClass(SqlParameterSource.class);
        verify(jdbc).update(contains("counselor_pool_member"), pool.capture());
        assertEquals(INST, pool.getValue().getValue("i"));
    }

    @Test
    void aMixedCaseRoleIsDisabledByItsStoredName() {
        user("u-1", "Asha", "asha@school.in", null);
        role("u-1", INST, "Counsellor", "ACTIVE");
        when(auth.updateRoleStatusForRoles(eq(INST), eq("u-1"), anyList(), eq("DISABLED"))).thenReturn(1);
        service.deactivateCounsellor(P, "u-1");
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<String>> names = ArgumentCaptor.forClass(List.class);
        verify(auth).updateRoleStatusForRoles(eq(INST), eq("u-1"), names.capture(), eq("DISABLED"));
        assertTrue(names.getValue().contains("Counsellor"));
    }

    @Test
    void aRoleThatDidNotChangeStopsBeforePoolsAndIvr() {
        user("u-1", "Asha", "asha@school.in", null);
        role("u-1", INST, "COUNSELLOR", "ACTIVE");
        when(auth.updateRoleStatusForRoles(any(), any(), anyList(), any())).thenReturn(0);
        AiCallingApiException e = assertThrows(AiCallingApiException.class, () -> service.deactivateCounsellor(P, "u-1"));
        assertEquals("role_update_failed", e.getCode());
        verify(jdbc, never()).update(anyString(), any(SqlParameterSource.class));
        verify(jdbc, never()).queryForList(anyString(), any(SqlParameterSource.class));
    }

    @Test
    void deactivatingTwiceIsHarmless() {
        user("u-1", "Asha", "asha@school.in", null);
        role("u-1", INST, "COUNSELLOR", "DISABLED");
        when(auth.updateRoleStatusForRoles(any(), any(), any(), any())).thenReturn(0);
        Map<String, Object> out = service.deactivateCounsellor(P, "u-1");
        @SuppressWarnings("unchecked")
        Map<String, Object> effects = (Map<String, Object>) out.get("effects");
        assertEquals(false, effects.get("role_disabled"));
    }

    @Test
    void reactivationRestoresTheRoleButNotPools() {
        user("u-1", "Asha", "asha@school.in", null);
        role("u-1", INST, "COUNSELLOR", "DISABLED");
        when(auth.updateRoleStatusForRoles(INST, "u-1", List.of("COUNSELLOR", "COUNSELOR"), "ACTIVE")).thenReturn(1);
        Map<String, Object> out = service.patchCounsellor(P, "u-1",
                new CounsellorApiService.PatchInput(null, false, null, false, null, false, true));
        @SuppressWarnings("unchecked")
        Map<String, Object> effects = (Map<String, Object>) out.get("effects");
        assertEquals(true, effects.get("role_restored"));
        assertEquals(false, effects.get("pool_memberships_restored"));
        verify(jdbc, never()).update(contains("counselor_pool_member"), any(SqlParameterSource.class));
    }

    @Test
    void anotherInstitutesCounsellorCannotBeDeactivated() {
        user("u-9", "Other", "o@x.in", null);
        role("u-9", "inst-2", "COUNSELLOR", "ACTIVE");
        assertEquals("counsellor_not_found",
                assertThrows(AiCallingApiException.class, () -> service.deactivateCounsellor(P, "u-9")).getCode());
        verify(auth, never()).updateRoleStatusForRoles(any(), any(), any(), any());
    }

    @Test
    void ivrRemovalTargetsOnlyThisInstitutesMenus() {
        service.removeFromIvrDialLists(INST, "u-1");
        ArgumentCaptor<SqlParameterSource> p = ArgumentCaptor.forClass(SqlParameterSource.class);
        verify(jdbc).queryForList(contains("m.institute_id = :i"), p.capture());
        assertEquals(INST, p.getValue().getValue("i"));
        assertEquals("u-1", p.getValue().getValue("u"));
        assertTrue(p.getValue() instanceof MapSqlParameterSource);
    }
}
