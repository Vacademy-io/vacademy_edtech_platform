package vacademy.io.admin_core_service.features.suborg.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSubOrg;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSubOrgRepository;
import vacademy.io.admin_core_service.features.suborg.dto.SeatUsageDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SubOrgMemberMoveServiceTest {

    private static final String INSTITUTE = "inst";
    private static final String BATCH = "batch";
    private static final String LEARNER = "learner";
    private static final String TARGET = "target-org";
    private static final String OLD = "old-org";

    @Mock private StudentSessionRepository studentSessionRepository;
    @Mock private StudentSubOrgRepository studentSubOrgRepository;
    @Mock private InstituteStudentRepository instituteStudentRepository;
    @Mock private InstituteRepository instituteRepository;
    @Mock private UserPlanRepository userPlanRepository;
    @Mock private EnrollInviteRepository enrollInviteRepository;
    @Mock private SubOrgSubscriptionService subOrgSubscriptionService;
    @Mock private SubOrgAccessScopeService subOrgAccessScopeService;

    private SubOrgMemberMoveService service;
    private Institute target;

    @BeforeEach
    void setUp() {
        service = new SubOrgMemberMoveService(studentSessionRepository, studentSubOrgRepository,
                instituteStudentRepository, instituteRepository, userPlanRepository, enrollInviteRepository,
                subOrgSubscriptionService, subOrgAccessScopeService);
        target = institute(TARGET);
        when(instituteRepository.findById(TARGET)).thenReturn(Optional.of(target));
        when(instituteStudentRepository.findTopByUserIdOrderByCreatedAtDesc(LEARNER)).thenReturn(Optional.empty());
        when(studentSubOrgRepository.findByUserIdAndSubOrgId(anyString(), anyString())).thenReturn(Optional.empty());
        seats(3, 10);
    }

    @Test
    void movesALearnerWithNoSubOrgAndLinksTheSubOrg() {
        StudentSessionInstituteGroupMapping row = row(null, null);
        active(row);

        SubOrgMemberMoveService.Outcome outcome =
                service.moveActiveEnrollment(LEARNER, BATCH, INSTITUTE, TARGET, null);

        assertEquals(SubOrgMemberMoveService.Outcome.MOVED, outcome);
        assertEquals(TARGET, row.getSubOrg().getId());
        assertEquals("LEARNER", row.getCommaSeparatedOrgRoles());
        verify(studentSessionRepository).save(row);
        ArgumentCaptor<StudentSubOrg> link = ArgumentCaptor.forClass(StudentSubOrg.class);
        verify(studentSubOrgRepository).save(link.capture());
        assertEquals(LEARNER, link.getValue().getUserId());
        assertEquals("ACTIVE", link.getValue().getStatus());
        verify(userPlanRepository, never()).save(any());
    }

    @Test
    void aLearnerAlreadyInTheSubOrgIsLeftAlone() {
        StudentSessionInstituteGroupMapping row = row(target, "LEARNER");
        active(row);
        when(studentSubOrgRepository.findByUserIdAndSubOrgId(LEARNER, TARGET))
                .thenReturn(Optional.of(new StudentSubOrg("s", LEARNER, target, "DIRECT")));

        SubOrgMemberMoveService.Outcome outcome =
                service.moveActiveEnrollment(LEARNER, BATCH, INSTITUTE, TARGET, null);

        assertEquals(SubOrgMemberMoveService.Outcome.ALREADY_MEMBER, outcome);
        verify(studentSessionRepository, never()).save(any());
        verify(subOrgSubscriptionService, never()).getSeatUsage(anyString(), anyString(), anyString());
        verify(studentSubOrgRepository, never()).save(any());
    }

    @Test
    void subOrgAdminsAreNeverMoved() {
        active(row(institute(OLD), "ROOT_ADMIN"));

        VacademyException e = assertThrows(VacademyException.class,
                () -> service.moveActiveEnrollment(LEARNER, BATCH, INSTITUTE, TARGET, null));

        assertTrue(e.getMessage().contains("admin"));
        verify(studentSessionRepository, never()).save(any());
    }

    @Test
    void aFullSubOrgRefusesTheMove() {
        active(row(null, null));
        seats(10, 10);

        VacademyException e = assertThrows(VacademyException.class,
                () -> service.moveActiveEnrollment(LEARNER, BATCH, INSTITUTE, TARGET, null));

        assertTrue(e.getMessage().startsWith("Seat limit reached"));
        verify(studentSessionRepository, never()).save(any());
    }

    @Test
    void notEnrolledInTheBatchIsRefused() {
        when(studentSessionRepository.findByUserIdAndPackageSession_IdAndStatus(LEARNER, BATCH, "ACTIVE"))
                .thenReturn(List.of());

        assertThrows(VacademyException.class,
                () -> service.moveActiveEnrollment(LEARNER, BATCH, INSTITUTE, TARGET, null));
    }

    @Test
    void anotherInstitutesEnrollmentIsNotTouched() {
        StudentSessionInstituteGroupMapping row = row(null, null);
        row.setInstitute(institute("other-inst"));
        when(studentSessionRepository.findByUserIdAndPackageSession_IdAndStatus(LEARNER, BATCH, "ACTIVE"))
                .thenReturn(List.of(row));

        assertThrows(VacademyException.class,
                () -> service.moveActiveEnrollment(LEARNER, BATCH, INSTITUTE, TARGET, null));
        verify(studentSessionRepository, never()).save(any());
    }

    @Test
    void aLearnerWhosePlanBelongsToAnotherSubOrgIsRefusedAndNothingIsWritten() {
        StudentSessionInstituteGroupMapping row = row(institute(OLD), "LEARNER");
        row.setUserPlanId("plan");
        active(row);
        UserPlan plan = plan("plan", LEARNER, OLD, null);
        when(userPlanRepository.findById("plan")).thenReturn(Optional.of(plan));
        Institute oldOrg = institute(OLD);
        oldOrg.setInstituteName("Old Org");
        when(instituteRepository.findById(OLD)).thenReturn(Optional.of(oldOrg));

        VacademyException e = assertThrows(VacademyException.class,
                () -> service.moveActiveEnrollment(LEARNER, BATCH, INSTITUTE, TARGET, null));

        assertTrue(e.getMessage().contains("Old Org"));
        assertEquals(OLD, row.getSubOrg().getId());
        assertEquals(OLD, plan.getSubOrgId());
        verify(studentSessionRepository, never()).save(any());
        verify(userPlanRepository, never()).save(any());
        verify(studentSubOrgRepository, never()).delete(any());
    }

    @Test
    void aLearnerWhoJoinedThroughAnotherSubOrgsLinkIsRefused() {
        StudentSessionInstituteGroupMapping row = row(null, null);
        row.setUserPlanId("plan");
        active(row);
        when(userPlanRepository.findById("plan")).thenReturn(Optional.of(plan("plan", LEARNER, null, "old-invite")));
        when(enrollInviteRepository.findById("old-invite")).thenReturn(Optional.of(invite("old-invite", OLD)));

        assertThrows(VacademyException.class,
                () -> service.moveActiveEnrollment(LEARNER, BATCH, INSTITUTE, TARGET, null));
        verify(studentSessionRepository, never()).save(any());
    }

    @Test
    void aLearnerOnASharedSubOrgAdminPlanIsRefused() {
        StudentSessionInstituteGroupMapping row = row(institute(OLD), "LEARNER");
        row.setUserPlanId("admin-plan");
        active(row);
        when(userPlanRepository.findById("admin-plan"))
                .thenReturn(Optional.of(plan("admin-plan", "the-admin", OLD, null)));

        assertThrows(VacademyException.class,
                () -> service.moveActiveEnrollment(LEARNER, BATCH, INSTITUTE, TARGET, null));
        verify(studentSessionRepository, never()).save(any());
        verify(userPlanRepository, never()).save(any());
    }

    @Test
    void aLearnerWhoJoinedThroughThisSubOrgsLinkIsAlreadyAMemberAndUntouched() {
        StudentSessionInstituteGroupMapping row = row(null, null);
        row.setUserPlanId("plan");
        active(row);
        when(userPlanRepository.findById("plan")).thenReturn(Optional.of(plan("plan", LEARNER, null, "t-invite")));
        when(enrollInviteRepository.findById("t-invite")).thenReturn(Optional.of(invite("t-invite", TARGET)));

        SubOrgMemberMoveService.Outcome outcome =
                service.moveActiveEnrollment(LEARNER, BATCH, INSTITUTE, TARGET, null);

        assertEquals(SubOrgMemberMoveService.Outcome.ALREADY_MEMBER, outcome);
        assertEquals(null, row.getSubOrg());
        verify(studentSessionRepository, never()).save(any());
        verify(studentSubOrgRepository, never()).save(any());
    }

    @Test
    void aStampOnlyMemberOfAnotherSubOrgMovesAndTheOldLinkIsDropped() {
        Institute old = institute(OLD);
        StudentSessionInstituteGroupMapping row = row(old, "LEARNER");
        row.setUserPlanId("plan");
        active(row);
        // Their own plan, bought from the parent institute: not tied to any sub-org.
        when(userPlanRepository.findById("plan")).thenReturn(Optional.of(plan("plan", LEARNER, null, "parent-invite")));
        when(enrollInviteRepository.findById("parent-invite")).thenReturn(Optional.of(invite("parent-invite", null)));
        StudentSubOrg oldLink = new StudentSubOrg("s", LEARNER, old, "DIRECT");
        when(studentSubOrgRepository.findByUserIdAndSubOrgId(LEARNER, OLD)).thenReturn(Optional.of(oldLink));
        when(studentSessionRepository.countByUserIdAndSubOrg_IdAndStatus(LEARNER, OLD, "ACTIVE")).thenReturn(0L);

        SubOrgMemberMoveService.Outcome outcome =
                service.moveActiveEnrollment(LEARNER, BATCH, INSTITUTE, TARGET, null);

        assertEquals(SubOrgMemberMoveService.Outcome.MOVED, outcome);
        assertEquals(TARGET, row.getSubOrg().getId());
        verify(subOrgAccessScopeService).assertCanAccessSubOrg(null, OLD, INSTITUTE);
        verify(studentSubOrgRepository).delete(oldLink);
        verify(userPlanRepository, never()).save(any());
    }

    @Test
    void theOldLinkStaysWhileAnotherBatchIsStillInThatSubOrg() {
        Institute old = institute(OLD);
        active(row(old, "LEARNER"));
        when(studentSessionRepository.countByUserIdAndSubOrg_IdAndStatus(LEARNER, OLD, "ACTIVE")).thenReturn(1L);

        service.moveActiveEnrollment(LEARNER, BATCH, INSTITUTE, TARGET, null);

        verify(studentSubOrgRepository, never()).delete(any());
    }

    private static UserPlan plan(String id, String owner, String subOrgId, String inviteId) {
        UserPlan plan = new UserPlan();
        plan.setId(id);
        plan.setUserId(owner);
        plan.setSubOrgId(subOrgId);
        plan.setEnrollInviteId(inviteId);
        return plan;
    }

    private static EnrollInvite invite(String id, String subOrgId) {
        EnrollInvite invite = new EnrollInvite();
        invite.setId(id);
        invite.setSubOrgId(subOrgId);
        return invite;
    }

    private void active(StudentSessionInstituteGroupMapping row) {
        when(studentSessionRepository.findByUserIdAndPackageSession_IdAndStatus(LEARNER, BATCH, "ACTIVE"))
                .thenReturn(List.of(row));
    }

    private void seats(long used, Integer total) {
        when(subOrgSubscriptionService.getSeatUsage(eq(TARGET), eq(INSTITUTE), eq(BATCH)))
                .thenReturn(SeatUsageDTO.builder().usedSeats(used).totalSeats(total).build());
    }

    private static StudentSessionInstituteGroupMapping row(Institute subOrg, String roles) {
        StudentSessionInstituteGroupMapping row = new StudentSessionInstituteGroupMapping();
        row.setId("row-" + System.nanoTime());
        row.setUserId(LEARNER);
        row.setStatus("ACTIVE");
        row.setInstitute(institute(INSTITUTE));
        row.setSubOrg(subOrg);
        row.setCommaSeparatedOrgRoles(roles);
        return row;
    }

    private static Institute institute(String id) {
        Institute institute = new Institute();
        institute.setId(id);
        return institute;
    }
}
