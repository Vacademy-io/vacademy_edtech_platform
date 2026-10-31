package vacademy.io.admin_core_service.features.user_subscription.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.fee_management.service.FeeBillCancellationService;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.util.Date;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Hard-removing a learner who was removed from the same course before (and re-enrolled) must
 * refresh the INVITED row of that first removal, not insert a second one — the duplicate trips
 * uq_dest_pkg_inst_user_status and rolls the whole removal back.
 */
class CancelUserPlanInvitedRowTest {

    private UserPlanRepository userPlanRepository;
    private StudentSessionRepository studentSessionRepository;
    private PackageSessionRepository packageSessionRepository;
    private UserPlanService service;
    private StudentSessionInstituteGroupMapping active;

    @BeforeEach
    void setUp() {
        userPlanRepository = mock(UserPlanRepository.class);
        studentSessionRepository = mock(StudentSessionRepository.class);
        packageSessionRepository = mock(PackageSessionRepository.class);
        service = new UserPlanService();
        ReflectionTestUtils.setField(service, "userPlanRepository", userPlanRepository);
        ReflectionTestUtils.setField(service, "studentSessionRepository", studentSessionRepository);
        ReflectionTestUtils.setField(service, "packageSessionRepository", packageSessionRepository);
        ReflectionTestUtils.setField(service, "feeBillCancellationService", mock(FeeBillCancellationService.class));

        UserPlan plan = new UserPlan();
        plan.setId("plan-1");
        plan.setUserId("user-1");
        when(userPlanRepository.findById("plan-1")).thenReturn(Optional.of(plan));

        PackageEntity pkg = new PackageEntity();
        pkg.setId("pkg-1");
        PackageSession activeSession = new PackageSession();
        activeSession.setId("ps-active");
        activeSession.setPackageEntity(pkg);
        PackageSession invitedSession = new PackageSession();
        invitedSession.setId("ps-invited");
        invitedSession.setPackageEntity(pkg);
        Institute institute = new Institute();
        institute.setId("inst-1");

        active = new StudentSessionInstituteGroupMapping();
        active.setId("active-row");
        active.setUserId("user-1");
        active.setUserPlanId("plan-1");
        active.setInstitute(institute);
        active.setPackageSession(activeSession);
        active.setStatus("ACTIVE");
        when(studentSessionRepository.findAllByUserPlanIdAndStatusIn("plan-1", List.of("ACTIVE")))
                .thenReturn(List.of(active));
        when(packageSessionRepository.findAllInvitedByPackageIds(Set.of("pkg-1")))
                .thenReturn(List.of(invitedSession));
    }

    @SuppressWarnings("unchecked")
    private StudentSessionInstituteGroupMapping savedInvitedRow() {
        ArgumentCaptor<List<StudentSessionInstituteGroupMapping>> saved = ArgumentCaptor.forClass(List.class);
        verify(studentSessionRepository).saveAll(saved.capture());
        assertEquals(1, saved.getValue().size());
        return saved.getValue().get(0);
    }

    @Test
    @DisplayName("an INVITED row left by an earlier removal is refreshed, not duplicated")
    void reusesInvitedRowFromEarlierRemoval() {
        StudentSessionInstituteGroupMapping earlier = new StudentSessionInstituteGroupMapping();
        earlier.setId("earlier-invited-row");
        Date earlierCreatedAt = new Date(1_000L);
        earlier.setCreatedAt(earlierCreatedAt);
        when(studentSessionRepository.findCollidingMapping("ps-active", "ps-invited", "inst-1", "user-1", "INVITED"))
                .thenReturn(Optional.of(earlier));

        service.cancelUserPlan("plan-1", true);

        verify(studentSessionRepository).deleteAllInBatch(anyList());
        StudentSessionInstituteGroupMapping row = savedInvitedRow();
        assertEquals("earlier-invited-row", row.getId());
        assertEquals(earlierCreatedAt, row.getCreatedAt());
        assertEquals("plan-1", row.getUserPlanId());
        assertEquals("INVITED", row.getStatus());
        assertEquals("ps-active", row.getDestinationPackageSession().getId());
    }

    @Test
    @DisplayName("a first removal still inserts a fresh INVITED row")
    void insertsFreshRowOnFirstRemoval() {
        when(studentSessionRepository.findCollidingMapping("ps-active", "ps-invited", "inst-1", "user-1", "INVITED"))
                .thenReturn(Optional.empty());

        service.cancelUserPlan("plan-1", true);

        StudentSessionInstituteGroupMapping row = savedInvitedRow();
        assertNull(row.getId());
        assertEquals("ps-invited", row.getPackageSession().getId());
    }
}
