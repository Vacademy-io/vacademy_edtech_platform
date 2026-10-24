package vacademy.io.admin_core_service.features.access_pass.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.access_pass.entity.AccessPass;
import vacademy.io.admin_core_service.features.access_pass.entity.AccessPassGrant;
import vacademy.io.admin_core_service.features.access_pass.repository.AccessPassGrantRepository;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.institute_learner.dto.InstituteStudentDetails;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.manager.StudentRegistrationManager;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AccessPassEntitlementServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final String INVITE = "invite-1";
    private static final String PLAN = "plan-1";
    private static final String USER = "user-1";

    @Mock private UserPlanRepository userPlanRepository;
    @Mock private AccessPassGrantRepository grantRepository;
    @Mock private StudentSessionInstituteGroupMappingRepository membershipRepository;
    @Mock private StudentSessionRepository studentSessionRepository;
    @Mock private InstituteStudentRepository instituteStudentRepository;
    @Mock private StudentRegistrationManager studentRegistrationManager;
    @Mock private AuthService authService;
    @Mock private vacademy.io.admin_core_service.features.institute_learner.manager.LearnerTerminationWorkflowHelper terminationWorkflowHelper;

    @InjectMocks
    private AccessPassEntitlementService service;

    private AccessPass pass;
    private UserPlan plan;

    @BeforeEach
    void setUp() {
        pass = AccessPass.builder().id("pass-1").instituteId(INSTITUTE).enrollInviteId(INVITE)
                .onItemRemoved("KEEP_FOR_EXISTING").build();
        plan = new UserPlan();
        plan.setId(PLAN);
        plan.setUserId(USER);
        plan.setEnrollInviteId(INVITE);
        plan.setStatus("ACTIVE");
        plan.setEndDate(new Date(System.currentTimeMillis() + 30L * 86_400_000L));
        when(userPlanRepository.findById(PLAN)).thenReturn(Optional.of(plan));
        when(grantRepository.findByUserPlanId(PLAN)).thenReturn(new ArrayList<>());
        when(membershipRepository.findActiveMembershipsForUserInPackageSessions(eq(USER), anyList()))
                .thenReturn(new ArrayList<>());
        when(grantRepository.save(any(AccessPassGrant.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    private static StudentSessionInstituteGroupMapping mapping(String id, String courseId, String userPlanId) {
        PackageSession ps = new PackageSession();
        ps.setId(courseId);
        StudentSessionInstituteGroupMapping m = new StudentSessionInstituteGroupMapping();
        m.setId(id);
        m.setPackageSession(ps);
        m.setUserPlanId(userPlanId);
        m.setStatus("ACTIVE");
        return m;
    }

    private static AccessPassGrant grant(String courseId, String ssigmId, String type) {
        return AccessPassGrant.builder().id("g-" + courseId).accessPassId("pass-1").userPlanId(PLAN).userId(USER)
                .packageSessionId(courseId).ssigmId(ssigmId).grantType(type).status("ACTIVE").build();
    }

    private List<AccessPassGrant> savedGrants() {
        ArgumentCaptor<AccessPassGrant> captor = ArgumentCaptor.forClass(AccessPassGrant.class);
        verify(grantRepository, atLeastOnce()).save(captor.capture());
        return captor.getAllValues();
    }

    @Test
    @DisplayName("A course checkout already gave on the holder's plan is only recorded as GRANTED")
    void recordsCourseAlreadyOnPlan() {
        when(membershipRepository.findActiveMembershipsForUserInPackageSessions(eq(USER), anyList()))
                .thenReturn(List.of(mapping("m-a", "ps-a", PLAN)));

        AccessPassEntitlementService.PlanResult r = service.reconcilePlan(pass, List.of("ps-a"), PLAN);

        assertEquals(1, r.recorded());
        assertEquals(0, r.granted());
        AccessPassGrant g = savedGrants().get(0);
        assertEquals("GRANTED", g.getGrantType());
        assertEquals("m-a", g.getSsigmId());
        verify(studentRegistrationManager, never()).linkStudentToInstitute(any(), any());
    }

    @Test
    @DisplayName("A course held through a separate plan is COVERED and its row is left alone")
    void coversCourseHeldElsewhere() {
        when(membershipRepository.findActiveMembershipsForUserInPackageSessions(eq(USER), anyList()))
                .thenReturn(List.of(mapping("m-b", "ps-b", "other-plan")));

        AccessPassEntitlementService.PlanResult r = service.reconcilePlan(pass, List.of("ps-b"), PLAN);

        assertEquals(1, r.covered());
        assertEquals("COVERED", savedGrants().get(0).getGrantType());
        verify(studentRegistrationManager, never()).linkStudentToInstitute(any(), any());
        verify(studentSessionRepository, never()).save(any());
    }

    @Test
    @DisplayName("A course added later is granted on the holder's plan, expiring with the plan")
    void grantsNewCourseOnPlan() {
        Student student = new Student();
        when(instituteStudentRepository.findTopByUserId(USER)).thenReturn(Optional.of(student));
        when(studentRegistrationManager.linkStudentToInstitute(eq(student), any())).thenReturn("m-new");
        StudentSessionInstituteGroupMapping created = mapping("m-new", "ps-c", null);
        created.setStatus("INVITED");
        when(studentSessionRepository.findById("m-new")).thenReturn(Optional.of(created));

        AccessPassEntitlementService.PlanResult r = service.reconcilePlan(pass, List.of("ps-c"), PLAN);

        assertEquals(1, r.granted());
        ArgumentCaptor<InstituteStudentDetails> details = ArgumentCaptor.forClass(InstituteStudentDetails.class);
        verify(studentRegistrationManager).linkStudentToInstitute(eq(student), details.capture());
        assertEquals("ps-c", details.getValue().getPackageSessionId());
        assertEquals(PLAN, details.getValue().getUserPlanId());
        assertEquals("ACTIVE", created.getStatus());
        assertEquals(PLAN, created.getUserPlanId());
        assertEquals(plan.getEndDate(), created.getExpiryDate());
        assertEquals("GRANTED", savedGrants().get(0).getGrantType());
    }

    @Test
    @DisplayName("An up-to-date plan changes nothing")
    void idempotentWhenUpToDate() {
        when(grantRepository.findByUserPlanId(PLAN)).thenReturn(List.of(grant("ps-a", "m-a", "GRANTED")));
        when(membershipRepository.findActiveMembershipsForUserInPackageSessions(eq(USER), anyList()))
                .thenReturn(List.of(mapping("m-a", "ps-a", PLAN)));

        AccessPassEntitlementService.PlanResult r = service.reconcilePlan(pass, List.of("ps-a"), PLAN);

        assertEquals(new AccessPassEntitlementService.PlanResult(0, 0, 0, 0), r);
        verify(grantRepository, never()).save(any());
    }

    @Test
    @DisplayName("REVOKE: a removed course the pass granted is deactivated; a covered one is not touched")
    void revokeOnlyTouchesGrantedRows() {
        pass.setOnItemRemoved("REVOKE");
        AccessPassGrant granted = grant("ps-x", "m-x", "GRANTED");
        AccessPassGrant covered = grant("ps-y", "m-y", "COVERED");
        when(grantRepository.findByUserPlanId(PLAN)).thenReturn(List.of(granted, covered));
        StudentSessionInstituteGroupMapping ours = mapping("m-x", "ps-x", PLAN);
        when(studentSessionRepository.findById("m-x")).thenReturn(Optional.of(ours));

        AccessPassEntitlementService.PlanResult r = service.reconcilePlan(pass, List.of(), PLAN);

        assertEquals(1, r.revoked());
        assertEquals("INACTIVE", ours.getStatus());
        assertEquals("REVOKED", granted.getStatus());
        assertEquals("REVOKED", covered.getStatus());
        verify(studentSessionRepository, never()).findById("m-y");
        // LMS un-enroll for the revoked course only (no transaction in a unit test -> fires at once).
        verify(terminationWorkflowHelper).fireTerminationWorkflows(USER, List.of("ps-x"), INSTITUTE, null);
        verifyNoMoreInteractions(terminationWorkflowHelper);
    }

    @Test
    @DisplayName("KEEP_FOR_EXISTING: removing a course leaves current holders' access as is")
    void keepPolicyDoesNotRevoke() {
        AccessPassGrant granted = grant("ps-x", "m-x", "GRANTED");
        when(grantRepository.findByUserPlanId(PLAN)).thenReturn(List.of(granted));

        AccessPassEntitlementService.PlanResult r = service.reconcilePlan(pass, List.of(), PLAN);

        assertEquals(0, r.revoked());
        assertEquals("ACTIVE", granted.getStatus());
        verify(studentSessionRepository, never()).save(any());
    }

    @Test
    @DisplayName("A plan that is not a current holder (expired) is skipped")
    void skipsNonCurrentPlan() {
        plan.setStatus("EXPIRED");

        AccessPassEntitlementService.PlanResult r = service.reconcilePlan(pass, List.of("ps-a"), PLAN);

        assertEquals(new AccessPassEntitlementService.PlanResult(0, 0, 0, 0), r);
        verifyNoInteractions(studentRegistrationManager);
    }

    @Test
    @DisplayName("daysUntil rounds up and never returns less than one day")
    void daysUntilRoundsUp() {
        assertNull(AccessPassEntitlementService.daysUntil(null));
        assertEquals(1, AccessPassEntitlementService.daysUntil(new Date(System.currentTimeMillis() + 1000)));
        assertEquals(1, AccessPassEntitlementService.daysUntil(new Date(System.currentTimeMillis() - 1000)));
        assertEquals(3, AccessPassEntitlementService.daysUntil(
                new Date(System.currentTimeMillis() + 2L * 86_400_000L + 3_600_000L)));
    }

    @Test
    @DisplayName("slugify produces URL-safe keys")
    void slugify() {
        assertEquals("all-access-pass-2026", AccessPassService.slugify("  All-Access Pass (2026)! "));
        assertEquals("cafe-membership", AccessPassService.slugify("Café Membership"));
    }
}
