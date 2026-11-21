package vacademy.io.admin_core_service.features.live_session.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.live_session.dto.LearnerDisplaySettingsFlags;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Who gets an institute's unassigned public live classes added to their lists.
 * The flag is opt-in and the learner must be enrolled in that institute; any
 * failure means "no broadcast", never an error on the learner list.
 */
class LearnerPublicSessionVisibilityServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final String BATCH = "ps-1";
    private static final String LEARNER = "learner-1";

    private LiveSessionLearnerDisplaySettingsService settings;
    private PackageSessionRepository packageSessions;
    private StudentSessionInstituteGroupMappingRepository mappings;
    private LearnerPublicSessionVisibilityService service;

    @BeforeEach
    void setUp() {
        settings = mock(LiveSessionLearnerDisplaySettingsService.class);
        packageSessions = mock(PackageSessionRepository.class);
        mappings = mock(StudentSessionInstituteGroupMappingRepository.class);
        service = new LearnerPublicSessionVisibilityService(settings, packageSessions, mappings);
    }

    private static LearnerDisplaySettingsFlags flag(boolean on) {
        return new LearnerDisplaySettingsFlags(false, false, false, false, false, on);
    }

    @Test
    @DisplayName("opted-in institute + enrolled learner: broadcast resolves to the batch's institute")
    void enrolledLearnerInOptedInInstitute() {
        when(packageSessions.findInstituteIdByPackageSessionId(BATCH)).thenReturn(Optional.of(INSTITUTE));
        when(settings.getFlags(INSTITUTE)).thenReturn(flag(true));
        when(mappings.existsActiveLearnerInInstitute(LEARNER, INSTITUTE)).thenReturn(true);

        assertEquals(INSTITUTE, service.resolveBroadcastInstituteId(BATCH, null, LEARNER, "caller"));
    }

    @Test
    @DisplayName("flag off (the default): no broadcast, and the enrolment query never runs")
    void flagOff() {
        when(packageSessions.findInstituteIdByPackageSessionId(BATCH)).thenReturn(Optional.of(INSTITUTE));
        when(settings.getFlags(INSTITUTE)).thenReturn(LearnerDisplaySettingsFlags.allOff());

        assertNull(service.resolveBroadcastInstituteId(BATCH, null, LEARNER, "caller"));
        verify(mappings, never()).existsActiveLearnerInInstitute(anyString(), anyString());
    }

    @Test
    @DisplayName("not enrolled (or only an abandoned cart) in that institute: no broadcast")
    void notEnrolled() {
        when(settings.getFlags(INSTITUTE)).thenReturn(flag(true));
        when(mappings.existsActiveLearnerInInstitute(LEARNER, INSTITUTE)).thenReturn(false);

        assertNull(service.resolveBroadcastInstituteId(null, INSTITUTE, LEARNER, "caller"));
    }

    @Test
    @DisplayName("the batch's institute wins over a mismatching instituteId param")
    void batchInstituteWins() {
        when(packageSessions.findInstituteIdByPackageSessionId(BATCH)).thenReturn(Optional.of(INSTITUTE));
        when(settings.getFlags(INSTITUTE)).thenReturn(flag(true));
        when(mappings.existsActiveLearnerInInstitute(LEARNER, INSTITUTE)).thenReturn(true);

        assertEquals(INSTITUTE, service.resolveBroadcastInstituteId(BATCH, "other-inst", LEARNER, "caller"));
        verify(settings, never()).getFlags("other-inst");
    }

    @Test
    @DisplayName("no batch and no instituteId: falls back to the learner's active enrolment")
    void fallsBackToEnrolment() {
        when(mappings.findInstituteIdByUserIdAndStatus(any(), anyList())).thenReturn(Optional.of(INSTITUTE));
        when(settings.getFlags(INSTITUTE)).thenReturn(flag(true));
        when(mappings.existsActiveLearnerInInstitute(LEARNER, INSTITUTE)).thenReturn(true);

        assertEquals(INSTITUTE, service.resolveBroadcastInstituteId(null, null, LEARNER, "caller"));
    }

    @Test
    @DisplayName("blank userId param: the caller is the learner checked for enrolment")
    void blankUserFallsBackToCaller() {
        when(settings.getFlags(INSTITUTE)).thenReturn(flag(true));
        when(mappings.existsActiveLearnerInInstitute("caller", INSTITUTE)).thenReturn(true);

        assertEquals(INSTITUTE, service.resolveBroadcastInstituteId(null, INSTITUTE, " ", "caller"));
    }

    @Test
    @DisplayName("no user at all: no broadcast")
    void noUser() {
        assertNull(service.resolveBroadcastInstituteId(BATCH, INSTITUTE, null, null));
    }

    @Test
    @DisplayName("a failing lookup never breaks the learner list")
    void neverThrows() {
        when(packageSessions.findInstituteIdByPackageSessionId(BATCH)).thenThrow(new RuntimeException("db down"));
        assertNull(service.resolveBroadcastInstituteId(BATCH, null, LEARNER, "caller"));

        when(mappings.existsActiveLearnerInInstitute(LEARNER, INSTITUTE)).thenThrow(new RuntimeException("db down"));
        assertFalse(service.isEnrolledLearner(INSTITUTE, LEARNER));
    }

    @Test
    @DisplayName("isEnrolledLearner needs both ids")
    void isEnrolledNeedsIds() {
        assertFalse(service.isEnrolledLearner(null, LEARNER));
        assertFalse(service.isEnrolledLearner(INSTITUTE, ""));
        when(mappings.existsActiveLearnerInInstitute(LEARNER, INSTITUTE)).thenReturn(true);
        assertTrue(service.isEnrolledLearner(INSTITUTE, LEARNER));
    }
}
