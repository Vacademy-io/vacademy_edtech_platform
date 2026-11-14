package vacademy.io.auth_service.feature.auth.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.auth_service.feature.admin_core_service.dto.InstituteSignupPolicy;
import vacademy.io.auth_service.feature.admin_core_service.service.InstitutePolicyService;
import vacademy.io.auth_service.feature.auth.constants.AuthConstants;
import vacademy.io.auth_service.feature.auth.manager.LearnerAuthManager;
import vacademy.io.auth_service.feature.institute.service.InstituteSettingsService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.learner.LearnerEnrollRequestDTO;
import vacademy.io.common.auth.dto.learner.LearnerPackageSessionsEnrollDTO;
import vacademy.io.common.auth.entity.RefreshToken;
import vacademy.io.common.auth.entity.Role;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.repository.RoleRepository;
import vacademy.io.common.auth.repository.UserPermissionRepository;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.auth.service.JwtService;
import vacademy.io.common.auth.service.OAuth2VendorToUserDetailService;
import vacademy.io.common.auth.service.RefreshTokenService;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * POST /auth-service/learner/v1/register takes its role list from a body anyone can write.
 * Whatever it names, only learner roles are saved and forwarded; internal (HMAC) callers of the
 * same writer keep sending staff roles.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class PublicLearnerSignupRolesTest {

    private static final String INSTITUTE = "inst-1";
    private static final String OTHER_INSTITUTE = "inst-2";

    @Mock UserRepository userRepository;
    @Mock RoleRepository roleRepository;
    @Mock UserRoleRepository userRoleRepository;
    @Mock InstituteSettingsService instituteSettingsService;
    @Mock InstitutePolicyService institutePolicyService;
    @Mock UserPermissionRepository userPermissionRepository;
    @Mock JwtService jwtService;

    @Mock InternalClientUtils internalClientUtils;
    @Mock RefreshTokenService refreshTokenService;
    @Mock OAuth2VendorToUserDetailService oAuth2VendorToUserDetailService;

    @InjectMocks AuthService authService;

    LearnerAuthManager manager;

    @BeforeEach
    void setUp() {
        when(instituteSettingsService.getUserIdentifier(any())).thenReturn("EMAIL");
        // Every name asked for exists as a role: nothing but the filter stands in the way.
        when(roleRepository.findByNameIn(anyList())).thenAnswer(inv -> {
            List<Role> found = new ArrayList<>();
            for (String name : inv.<List<String>>getArgument(0)) {
                Role role = new Role();
                role.setName(name);
                found.add(role);
            }
            return found;
        });
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc(anyString())).thenReturn(Optional.empty());
        when(userRepository.findByUsername(anyString())).thenReturn(Optional.empty());
        when(userRepository.save(any(User.class))).thenAnswer(inv -> {
            User saved = inv.getArgument(0);
            if (saved.getId() == null) saved.setId("new-id");
            return saved;
        });
        when(userPermissionRepository.findByUserId(any())).thenReturn(List.of());
        when(jwtService.generateToken(any(User.class), anyList(), anyList())).thenReturn("access");
        RefreshToken refreshToken = new RefreshToken();
        refreshToken.setToken("refresh");
        when(refreshTokenService.createRefreshToken(any(), any())).thenReturn(refreshToken);
        when(internalClientUtils.makeHmacRequest(any(), any(), any(), any(), any()))
                .thenReturn(ResponseEntity.ok("{}"));
        policy(false);

        manager = new LearnerAuthManager();
        ReflectionTestUtils.setField(manager, "authService", authService);
        ReflectionTestUtils.setField(manager, "institutePolicyService", institutePolicyService);
        ReflectionTestUtils.setField(manager, "internalClientUtils", internalClientUtils);
        ReflectionTestUtils.setField(manager, "refreshTokenService", refreshTokenService);
        ReflectionTestUtils.setField(manager, "oAuth2VendorToUserDetailService", oAuth2VendorToUserDetailService);
        ReflectionTestUtils.setField(manager, "applicationName", "auth_service");
        ReflectionTestUtils.setField(manager, "adminCoreServiceBaseUrl", "http://admin-core.test");
    }

    private void policy(boolean learnersCreateCourses) {
        InstituteSignupPolicy policy = InstituteSignupPolicy.builder()
                .allowLearnersToCreateCourses(learnersCreateCourses).build();
        when(institutePolicyService.fetchSignupPolicy(INSTITUTE)).thenReturn(policy);
        when(institutePolicyService.fetchSignupPolicyCached(INSTITUTE)).thenReturn(policy);
    }

    private static UserDTO body(String email, List<String> roles) {
        UserDTO dto = new UserDTO();
        dto.setEmail(email);
        dto.setFullName("Asha Rao");
        dto.setPassword("chosen-by-caller");
        dto.setRoles(roles);
        return dto;
    }

    private static LearnerEnrollRequestDTO request(String instituteId, UserDTO user) {
        LearnerEnrollRequestDTO request = new LearnerEnrollRequestDTO();
        request.setInstituteId(instituteId);
        request.setUser(user);
        return request;
    }

    private static UserRole held(String name, String instituteId, String status) {
        Role role = new Role();
        role.setName(name);
        UserRole userRole = new UserRole();
        userRole.setRole(role);
        userRole.setInstituteId(instituteId);
        userRole.setStatus(status);
        return userRole;
    }

    private User existing(String email, UserRole... roles) {
        User user = User.builder().id("existing-id").username("existing").email(email)
                .fullName("Existing Person").isRootUser(true).build();
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc(email)).thenReturn(Optional.of(user));
        when(userRoleRepository.findByUser(user)).thenReturn(List.of(roles));
        return user;
    }

    private static Set<String> names(Collection<UserRole> roles) {
        Set<String> names = new TreeSet<>();
        for (UserRole userRole : roles) names.add(userRole.getRole().getName());
        return names;
    }

    /** Role names in the access token handed back by the register route. */
    @SuppressWarnings("unchecked")
    private Set<String> rolesInToken() {
        ArgumentCaptor<List<UserRole>> captor = ArgumentCaptor.forClass(List.class);
        verify(jwtService).generateToken(any(User.class), captor.capture(), anyList());
        return names(captor.getValue());
    }

    @SuppressWarnings("unchecked")
    private Set<String> rolesAddedToExistingUser() {
        ArgumentCaptor<Iterable<UserRole>> captor = ArgumentCaptor.forClass(Iterable.class);
        verify(userRoleRepository).saveAll(captor.capture());
        List<UserRole> added = new ArrayList<>();
        captor.getValue().forEach(added::add);
        return names(added);
    }

    // ── the register route, new email ───────────────────────────────────────

    @Test
    void registerWithAdminGrantsNothing() {
        UserDTO body = body("new@example.com", List.of("ADMIN"));

        manager.registerLearner(request(INSTITUTE, body));

        assertEquals(Set.of(), rolesInToken());
        assertEquals(List.of(), body.getRoles(), "the body forwarded to admin-core is reduced too");
        verify(internalClientUtils).makeHmacRequest(any(), any(), any(), eq(AuthConstants.ADD_LEARNER), eq(body));
    }

    @Test
    void registerWithMixedListKeepsStudentOnly() {
        UserDTO body = body("new@example.com", List.of("ADMIN", "STUDENT", "EVALUATOR", "TEACHER", "My Custom Role"));

        manager.registerLearner(request(INSTITUTE, body));

        assertEquals(Set.of("STUDENT"), rolesInToken());
        assertEquals(List.of("STUDENT"), body.getRoles());
    }

    @Test
    void registerWithOddCaseAndWhitespaceGrantsNoStaffRole() {
        UserDTO body = body("new@example.com",
                Arrays.asList(" ADMIN ", "admin", "Admin\t", "ADMIN​", " ADMIN", null, " student "));

        manager.registerLearner(request(INSTITUTE, body));

        assertEquals(Set.of("STUDENT"), rolesInToken());
    }

    @Test
    void registerRolesAreSavedActiveForTheInstituteInTheBody() {
        ArgumentCaptor<User> saved = ArgumentCaptor.forClass(User.class);

        manager.registerLearner(request(INSTITUTE, body("new@example.com", List.of("STUDENT", "ADMIN"))));

        verify(userRepository, org.mockito.Mockito.atLeastOnce()).save(saved.capture());
        Set<UserRole> roles = saved.getValue().getRoles();
        assertEquals(Set.of("STUDENT"), names(roles));
        UserRole only = roles.iterator().next();
        assertEquals(INSTITUTE, only.getInstituteId());
        assertEquals("ACTIVE", only.getStatus());
    }

    @Test
    void teacherIsGrantedOnlyWhereTheInstituteAllowsIt() {
        policy(true);
        manager.registerLearner(request(INSTITUTE, body("new@example.com", List.of("STUDENT", "TEACHER", "ADMIN"))));
        assertEquals(Set.of("STUDENT", "TEACHER"), rolesInToken());
    }

    @Test
    void teacherIsDroppedWhereTheInstituteForbidsIt() {
        policy(false);
        UserDTO body = body("new@example.com", List.of("STUDENT", "TEACHER"));
        manager.registerLearner(request(INSTITUTE, body));
        assertEquals(Set.of("STUDENT"), rolesInToken());
        assertEquals(List.of("STUDENT"), body.getRoles());
    }

    @Test
    void teacherIsDroppedWhenThePolicyCannotBeRead() {
        when(institutePolicyService.fetchSignupPolicy(INSTITUTE)).thenReturn(null);
        when(institutePolicyService.fetchSignupPolicyCached(INSTITUTE)).thenThrow(new RuntimeException("down"));
        manager.registerLearner(request(INSTITUTE, body("new@example.com", List.of("STUDENT", "TEACHER"))));
        assertEquals(Set.of("STUDENT"), rolesInToken());
    }

    @Test
    void teacherIsDroppedWithoutAnInstitute() {
        manager.registerLearner(request(null, body("new@example.com", List.of("STUDENT", "TEACHER", "ADMIN"))));
        assertEquals(Set.of("STUDENT"), rolesInToken());
    }

    @Test
    void nullAndEmptyRolesStillRegisterWithNoRole() {
        manager.registerLearner(request(INSTITUTE, body("a@example.com", null)));
        assertEquals(Set.of(), rolesInToken());

        org.mockito.Mockito.clearInvocations(jwtService);
        manager.registerLearner(request(INSTITUTE, body("b@example.com", List.of())));
        assertEquals(Set.of(), rolesInToken());
    }

    // ── what the real callers send ──────────────────────────────────────────

    @Test
    void enrollmentPaymentDialogStudentStillWorks() {
        LearnerEnrollRequestDTO request = request(INSTITUTE, body("new@example.com", List.of("STUDENT")));
        request.setLearnerPackageSessionEnroll(new LearnerPackageSessionsEnrollDTO());

        assertEquals("access", manager.registerLearner(request).getAccessToken());

        assertEquals(Set.of("STUDENT"), rolesInToken());
        assertEquals(List.of("STUDENT"), request.getUser().getRoles());
        verify(internalClientUtils).makeHmacRequest(any(), any(), any(), eq(AuthConstants.LEARNER_ENROLL_PATH),
                eq(request));
    }

    @Test
    void unifiedRegistrationStudentTeacherStillWorksWhereAllowed() {
        policy(true);
        UserDTO body = body("new@example.com", List.of("STUDENT", "TEACHER"));

        assertEquals("refresh", manager.registerLearner(request(INSTITUTE, body)).getRefreshToken());

        assertEquals(Set.of("STUDENT", "TEACHER"), rolesInToken());
        assertEquals(List.of("STUDENT", "TEACHER"), body.getRoles());
    }

    @Test
    void oauthSignUpListsStillWork() {
        // LearnerOAuth2Manager builds the list from the same policy and calls registerLearner.
        policy(true);
        LearnerEnrollRequestDTO request = request(INSTITUTE, body("new@example.com", List.of("STUDENT", "TEACHER")));
        request.setSubjectId("google-subject");
        request.setVendorId("google");

        manager.registerLearner(request);

        assertEquals(Set.of("STUDENT", "TEACHER"), rolesInToken());
        verify(oAuth2VendorToUserDetailService).verifyEmail("google-subject", "google", "new@example.com");
    }

    // ── the register route, existing email ──────────────────────────────────

    @Test
    void existingLearnerGetsNoRoleBeyondTheLearnerSet() {
        existing("learner@example.com", held("STUDENT", OTHER_INSTITUTE, "ACTIVE"));

        manager.registerLearner(request(INSTITUTE, body("learner@example.com", List.of("ADMIN", "STUDENT", "TEACHER"))));

        assertEquals(Set.of("STUDENT"), rolesAddedToExistingUser());
    }

    @Test
    void existingLearnerAskingOnlyForAdminGetsNoRole() {
        existing("learner@example.com", held("STUDENT", INSTITUTE, "ACTIVE"), held("PARENT", INSTITUTE, "ACTIVE"));

        manager.registerLearner(request(INSTITUTE, body("learner@example.com", List.of("ADMIN"))));

        assertEquals(Set.of(), rolesAddedToExistingUser());
    }

    @Test
    void returningLearnerStillEnrolsAndIsSignedIn() {
        // EnrollmentPaymentDialog: a signed-out learner who already has an account pays again.
        existing("learner@example.com", held("STUDENT", OTHER_INSTITUTE, "ACTIVE"));
        LearnerEnrollRequestDTO request = request(INSTITUTE, body("learner@example.com", List.of("STUDENT")));
        request.setLearnerPackageSessionEnroll(new LearnerPackageSessionsEnrollDTO());

        assertEquals("access", manager.registerLearner(request).getAccessToken());
        assertEquals("existing-id", request.getUser().getId());
        assertEquals(Set.of("STUDENT"), rolesAddedToExistingUser());
    }

    @Test
    void existingAccountWithNoRolesKeepsWorking() {
        existing("norole@example.com");
        assertEquals("access", manager.registerLearner(
                request(INSTITUTE, body("norole@example.com", List.of("STUDENT")))).getAccessToken());
    }

    @Test
    void existingLearnerSigningUpAgainGetsTheSameResponseAsBefore() {
        // Same shape as main: no refusal, both tokens, the access token built from the roles
        // the account itself holds, the account's id written back on the body, and the same
        // add-learner call to admin-core.
        User learner = existing("learner@example.com", held("STUDENT", INSTITUTE, "ACTIVE"));
        learner.setRoles(new java.util.HashSet<>(List.of(held("STUDENT", INSTITUTE, "ACTIVE"))));
        UserDTO body = body("learner@example.com", List.of("STUDENT"));

        var response = manager.registerLearner(request(INSTITUTE, body));

        assertEquals("access", response.getAccessToken());
        assertEquals("refresh", response.getRefreshToken());
        assertEquals(Set.of("STUDENT"), rolesInToken());
        assertEquals("existing-id", body.getId());
        assertEquals(List.of("STUDENT"), body.getRoles());
        verify(refreshTokenService).createRefreshToken(eq("existing"), any());
        verify(internalClientUtils).makeHmacRequest(any(), any(), any(), eq(AuthConstants.ADD_LEARNER), eq(body));
    }

    @Test
    void existingAccountHoldingOtherRolesIsAnsweredAsBeforeAndGainsNothingOutsideTheLearnerSet() {
        // Out of this commit's scope by the owner's decision: what an existing account is
        // answered with. Only the role names that may be ADDED are narrowed.
        for (String heldRole : List.of("ADMIN", "TEACHER", "EVALUATOR", "My Custom Role")) {
            org.mockito.Mockito.clearInvocations(userRoleRepository, jwtService);
            existing("other@example.com", held("STUDENT", INSTITUTE, "ACTIVE"),
                    held(heldRole, OTHER_INSTITUTE, "ACTIVE"));

            assertEquals("access", manager.registerLearner(request(INSTITUTE,
                    body("other@example.com", List.of("ADMIN", "STUDENT", "EVALUATOR")))).getAccessToken(), heldRole);
            assertEquals(Set.of("STUDENT"), rolesAddedToExistingUser(), heldRole);
        }
    }

    @Test
    void existingAccountFoundByPhoneGainsNothingOutsideTheLearnerSet() {
        when(instituteSettingsService.getUserIdentifier(any())).thenReturn("PHONE");
        User byPhone = User.builder().id("phone-id").username("byphone").mobileNumber("919999999999")
                .fullName("By Phone").isRootUser(true).build();
        when(userRepository.findLatestUserByMobileNumber(anyString())).thenReturn(Optional.of(byPhone));
        UserDTO body = body("someone@example.com", List.of("ADMIN", "TEACHER"));
        body.setMobileNumber("+91 99999 99999");

        manager.registerLearner(request(INSTITUTE, body));

        assertEquals(Set.of(), rolesAddedToExistingUser());
    }

    // ── internal (HMAC) callers of the same writers are untouched ───────────

    @Test
    void internalLearnerEnrollmentKeepsStaffRoles() {
        UserDTO body = body("teacher@example.com", List.of("TEACHER", "ADMIN", "PARENT", "My Custom Role"));

        User user = authService.createUserForLearnerEnrollment(body, INSTITUTE, false);

        assertEquals(Set.of("ADMIN", "My Custom Role", "PARENT", "TEACHER"), names(user.getRoles()));
        assertEquals(List.of("TEACHER", "ADMIN", "PARENT", "My Custom Role"), body.getRoles());
    }

    @Test
    void internalCreateUserKeepsStaffRolesAndExistingStaffAccounts() {
        User user = authService.createUser(body("new-admin@example.com", List.of("ADMIN")), INSTITUTE, false);
        assertEquals(Set.of("ADMIN"), names(user.getRoles()));

        existing("staff@example.com", held("ADMIN", OTHER_INSTITUTE, "ACTIVE"));
        authService.createUser(body("staff@example.com", List.of("TEACHER")), INSTITUTE, false);
        authService.createUserForLearnerEnrollment(body("staff@example.com", List.of("STUDENT")), INSTITUTE, false);
        verify(userRoleRepository, org.mockito.Mockito.times(2)).saveAll(any());
    }
}
