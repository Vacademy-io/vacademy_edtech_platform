package vacademy.io.admin_core_service.features.institute_learner.manager;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.junit.jupiter.MockitoExtension;
import vacademy.io.admin_core_service.features.institute_learner.dto.InstituteStudentDetails;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerStatusEnum;

import java.lang.reflect.Method;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Which statuses a re-enrollment may promote in place.
 *
 * <p>{@code updateExistingMapping} used to advance {@code expiry_date} and never touch
 * {@code status}, so re-enrolling a learner parked at TERMINATED/EXPIRED/INACTIVE handed them a
 * fresh access window on a row that every ACTIVE-only gate still refuses. The fix promotes those
 * dormant rows — but it must never promote INVITED or PENDING_FOR_APPROVAL, which are
 * pre-payment parking states owned by the payment webhook. Promoting those would grant access
 * before the money arrived, so that boundary is what these tests pin down.
 */
@ExtendWith(MockitoExtension.class)
class ReviveDormantMappingTest {

    // The single constructor arg is unrelated to this helper; the repository it would use is an
    // @Autowired field that stays untouched because these mappings have a NULL destination.
    private final StudentRegistrationManager manager = new StudentRegistrationManager(null);

    /**
     * Drives the private helper directly. A mapping with a NULL destination package session is
     * used deliberately: that is the shape of a fully-enrolled row, and it skips the collision
     * lookup (so no repository stubbing is needed) exactly as it does in production.
     */
    private String revive(String currentStatus, String requestedStatus) throws Exception {
        StudentSessionInstituteGroupMapping mapping = new StudentSessionInstituteGroupMapping();
        mapping.setId("mapping-1");
        mapping.setUserId("user-1");
        mapping.setStatus(currentStatus);

        InstituteStudentDetails details = new InstituteStudentDetails();
        details.setEnrollmentStatus(requestedStatus);

        Method m = StudentRegistrationManager.class.getDeclaredMethod(
                "reviveDormantMapping",
                StudentSessionInstituteGroupMapping.class,
                LearnerSessionStatusEnum.class,
                InstituteStudentDetails.class);
        m.setAccessible(true);
        m.invoke(manager, mapping, LearnerSessionStatusEnum.valueOf(currentStatus), details);
        return mapping.getStatus();
    }

    @Test
    @DisplayName("TERMINATED is revived to ACTIVE — the case that locked learners out")
    void terminatedIsRevived() throws Exception {
        assertEquals("ACTIVE", revive(LearnerSessionStatusEnum.TERMINATED.name(), "ACTIVE"));
    }

    @Test
    @DisplayName("EXPIRED is revived to ACTIVE")
    void expiredIsRevived() throws Exception {
        assertEquals("ACTIVE", revive(LearnerSessionStatusEnum.EXPIRED.name(), "ACTIVE"));
    }

    @Test
    @DisplayName("INACTIVE is revived to ACTIVE")
    void inactiveIsRevived() throws Exception {
        assertEquals("ACTIVE", revive(LearnerSessionStatusEnum.INACTIVE.name(), "ACTIVE"));
    }

    @Test
    @DisplayName("INVITED is left alone — the payment webhook owns that promotion")
    void invitedIsNotRevived() throws Exception {
        assertEquals("INVITED", revive(LearnerSessionStatusEnum.INVITED.name(), "ACTIVE"));
    }

    @Test
    @DisplayName("PENDING_FOR_APPROVAL is left alone — approval has not happened yet")
    void pendingForApprovalIsNotRevived() throws Exception {
        assertEquals("PENDING_FOR_APPROVAL",
                revive(LearnerStatusEnum.PENDING_FOR_APPROVAL.name(), "ACTIVE"));
    }

    @Test
    @DisplayName("ACTIVE is untouched — a repurchase only extends the window")
    void activeIsUntouched() throws Exception {
        assertEquals("ACTIVE", revive(LearnerSessionStatusEnum.ACTIVE.name(), "ACTIVE"));
    }

    @Test
    @DisplayName("No requested status means no promotion — expiry-only updates stay expiry-only")
    void noRequestedStatusLeavesRowAlone() throws Exception {
        assertEquals("TERMINATED", revive(LearnerSessionStatusEnum.TERMINATED.name(), null));
    }

    @Test
    @DisplayName("A dormant row is never revived INTO a pre-payment parking state")
    void neverRevivesIntoInvited() throws Exception {
        assertEquals("TERMINATED",
                revive(LearnerSessionStatusEnum.TERMINATED.name(),
                        LearnerSessionStatusEnum.INVITED.name()));
        assertEquals("EXPIRED",
                revive(LearnerSessionStatusEnum.EXPIRED.name(),
                        LearnerStatusEnum.PENDING_FOR_APPROVAL.name()));
    }

    @Test
    @DisplayName("A junk status is refused, not written — this path must not add to the enum drift")
    void junkStatusIsRefused() throws Exception {
        assertEquals("TERMINATED", revive(LearnerSessionStatusEnum.TERMINATED.name(), "Actve"));
        assertEquals("TERMINATED", revive(LearnerSessionStatusEnum.TERMINATED.name(), "string"));
        assertEquals("TERMINATED", revive(LearnerSessionStatusEnum.TERMINATED.name(), ""));
    }

    @Test
    @DisplayName("Case drift is canonicalised — 'Active' is written as ACTIVE, never as-is")
    void caseDriftIsCanonicalised() throws Exception {
        assertEquals("ACTIVE", revive(LearnerSessionStatusEnum.TERMINATED.name(), "Active"));
        assertEquals("ACTIVE", revive(LearnerSessionStatusEnum.EXPIRED.name(), "  active  "));
    }
}
