package vacademy.io.admin_core_service.features.telephony.controller;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.admin_core_service.features.telephony.controller.dto.TelephonyCounsellorEndpointDTO;
import vacademy.io.admin_core_service.features.telephony.core.CallOrchestrator;
import vacademy.io.admin_core_service.features.telephony.core.dto.ConnectCallRequestDTO;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCounsellorEndpoint;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCounsellorEndpointRepository;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.dto.UserWithRolesDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The human-calling admin routes are limited to staff of the institute they touch. Before
 * this, /calls/connect, /calls/options, the call history, the recording link and every
 * counsellor-endpoint route trusted the instituteId the caller sent (or, for a delete, no
 * institute at all), so a signed-in user of one institute could act on another.
 *
 * <p>The principal here is a TEACHER of inst-1 whose dashboard sends clientId inst-1 —
 * the shape auth_service gives every staff member.
 */
class TelephonyInstituteAccessTest {

    private static final String MINE = "inst-1";
    private static final String OTHER = "inst-2";

    private final InstituteAccessValidator validator = new InstituteAccessValidator();
    private CustomUserDetails staff;

    @BeforeEach
    void signedInToInstituteOne() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", MINE);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("u-1");
        dto.setUsername("u-1");
        dto.setFullName("Counsellor One");
        dto.setAuthorities(List.of("TEACHER"));
        staff = new CustomUserDetails(dto);
    }

    @AfterEach
    void reset() {
        RequestContextHolder.resetRequestAttributes();
    }

    private TelephonyCallController callController(CallOrchestrator orchestrator, TelephonyCallLogRepository logs) {
        TelephonyCallController c = new TelephonyCallController();
        ReflectionTestUtils.setField(c, "orchestrator", orchestrator);
        ReflectionTestUtils.setField(c, "callLogRepo", logs);
        ReflectionTestUtils.setField(c, "instituteAccessValidator", validator);
        return c;
    }

    @Test
    void connectRefusesAnotherInstitute() {
        CallOrchestrator orchestrator = mock(CallOrchestrator.class);
        TelephonyCallController c = callController(orchestrator, mock(TelephonyCallLogRepository.class));
        ConnectCallRequestDTO req = new ConnectCallRequestDTO();
        req.setInstituteId(OTHER);
        req.setResponseId("lead-1");
        assertThrows(ForbiddenException.class, () -> c.connect(req, staff));
        verifyNoInteractions(orchestrator);
    }

    @Test
    void connectStillWorksForOwnInstitute() {
        CallOrchestrator orchestrator = mock(CallOrchestrator.class);
        TelephonyCallController c = callController(orchestrator, mock(TelephonyCallLogRepository.class));
        ConnectCallRequestDTO req = new ConnectCallRequestDTO();
        req.setInstituteId(MINE);
        req.setResponseId("lead-1");
        assertDoesNotThrow(() -> c.connect(req, staff));
        verify(orchestrator).connect(req, staff);
    }

    @Test
    void optionsAndHistoryRefuseAnotherInstitute() {
        CallOrchestrator orchestrator = mock(CallOrchestrator.class);
        TelephonyCallLogRepository logs = mock(TelephonyCallLogRepository.class);
        TelephonyCallController c = callController(orchestrator, logs);
        assertThrows(ForbiddenException.class, () -> c.options(OTHER, null, staff));
        assertThrows(ForbiddenException.class, () -> c.list("lead-user", null, OTHER, 0, 20, staff));
        verifyNoInteractions(orchestrator, logs);
    }

    @Test
    void aLearnerIsNotStaff() {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("learner");
        dto.setUsername("learner");
        dto.setAuthorities(List.of("STUDENT"));
        CustomUserDetails learner = new CustomUserDetails(dto);
        TelephonyCallController c = callController(mock(CallOrchestrator.class), mock(TelephonyCallLogRepository.class));
        ConnectCallRequestDTO req = new ConnectCallRequestDTO();
        req.setInstituteId(MINE);
        assertThrows(ForbiddenException.class, () -> c.connect(req, learner));
    }

    @Test
    void recordingLinkRequiresMembershipOfThatInstitute() {
        TelephonyCallLogRepository logs = mock(TelephonyCallLogRepository.class);
        MediaService media = mock(MediaService.class);
        TelephonyCallLog row = TelephonyCallLog.builder().id("log-9").instituteId(OTHER)
                .recordingStorageKey("file-1").build();
        when(logs.findById("log-9")).thenReturn(Optional.of(row));
        RecordingPlaybackController c = new RecordingPlaybackController();
        ReflectionTestUtils.setField(c, "callLogRepo", logs);
        ReflectionTestUtils.setField(c, "mediaService", media);
        ReflectionTestUtils.setField(c, "instituteAccessValidator", validator);
        // The caller names the row's own institute, which used to be the whole check.
        assertThrows(ForbiddenException.class, () -> c.recording("log-9", OTHER, staff));
        verifyNoInteractions(media);
    }

    // ── counsellor endpoints ────────────────────────────────────────────────────

    private TelephonyCounsellorEndpointController endpointController(TelephonyCounsellorEndpointRepository repo,
                                                                     AuthService auth) {
        TelephonyCounsellorEndpointController c = new TelephonyCounsellorEndpointController();
        ReflectionTestUtils.setField(c, "repo", repo);
        ReflectionTestUtils.setField(c, "authService", auth);
        ReflectionTestUtils.setField(c, "instituteAccessValidator", validator);
        return c;
    }

    private static TelephonyCounsellorEndpointDTO body(String userId) {
        TelephonyCounsellorEndpointDTO b = new TelephonyCounsellorEndpointDTO();
        b.setCounsellorUserId(userId);
        b.setProviderType("AIRTEL");
        b.setExtension("447");
        return b;
    }

    @Test
    void endpointRoutesRefuseAnotherInstitute() {
        TelephonyCounsellorEndpointRepository repo = mock(TelephonyCounsellorEndpointRepository.class);
        AuthService auth = mock(AuthService.class);
        TelephonyCounsellorEndpointController c = endpointController(repo, auth);
        assertThrows(ForbiddenException.class, () -> c.list(OTHER, "AIRTEL", staff));
        assertThrows(ForbiddenException.class, () -> c.eligibleUsers(OTHER, staff));
        assertThrows(ForbiddenException.class, () -> c.upsert(OTHER, body("u-7"), staff));
        verifyNoInteractions(repo, auth);
    }

    @Test
    void deletingAnotherInstitutesRowIsRefused() {
        TelephonyCounsellorEndpointRepository repo = mock(TelephonyCounsellorEndpointRepository.class);
        TelephonyCounsellorEndpoint row = TelephonyCounsellorEndpoint.builder().id("ep-1").instituteId(OTHER)
                .counsellorUserId("u-7").providerType("AIRTEL").build();
        when(repo.findById("ep-1")).thenReturn(Optional.of(row));
        TelephonyCounsellorEndpointController c = endpointController(repo, mock(AuthService.class));
        assertThrows(ForbiddenException.class, () -> c.delete("ep-1", staff));
        verify(repo, never()).delete(any());
        verify(repo, never()).deleteById(any());
    }

    @Test
    void deletingOwnRowWorks() {
        TelephonyCounsellorEndpointRepository repo = mock(TelephonyCounsellorEndpointRepository.class);
        TelephonyCounsellorEndpoint row = TelephonyCounsellorEndpoint.builder().id("ep-1").instituteId(MINE)
                .counsellorUserId("u-7").providerType("AIRTEL").build();
        when(repo.findById("ep-1")).thenReturn(Optional.of(row));
        TelephonyCounsellorEndpointController c = endpointController(repo, mock(AuthService.class));
        assertEquals(204, c.delete("ep-1", staff).getStatusCode().value());
        verify(repo).delete(row);
    }

    @Test
    void anUpsertCannotMoveARowOutOfAnotherInstitute() {
        TelephonyCounsellorEndpointRepository repo = mock(TelephonyCounsellorEndpointRepository.class);
        TelephonyCounsellorEndpoint theirs = TelephonyCounsellorEndpoint.builder().id("ep-1").instituteId(OTHER)
                .counsellorUserId("u-7").providerType("AIRTEL").extension("101").build();
        when(repo.findByCounsellorUserIdAndProviderType("u-7", "AIRTEL")).thenReturn(Optional.of(theirs));
        TelephonyCounsellorEndpointController c = endpointController(repo, mock(AuthService.class));
        assertThrows(ConflictException.class, () -> c.upsert(MINE, body("u-7"), staff));
        assertEquals(OTHER, theirs.getInstituteId());
        verify(repo, never()).save(any());
    }

    @Test
    void aNewRowIsOnlyForThisInstitutesCounsellorsAndAdmins() {
        TelephonyCounsellorEndpointRepository repo = mock(TelephonyCounsellorEndpointRepository.class);
        when(repo.findByCounsellorUserIdAndProviderType(anyString(), anyString())).thenReturn(Optional.empty());
        when(repo.save(any())).thenAnswer(i -> i.getArgument(0));
        AuthService auth = mock(AuthService.class);
        UserWithRolesDTO member = new UserWithRolesDTO();
        member.setId("u-8");
        when(auth.getActiveUsersByRoles(eq(MINE), anyList())).thenReturn(List.of(member));
        TelephonyCounsellorEndpointController c = endpointController(repo, auth);
        assertThrows(VacademyException.class, () -> c.upsert(MINE, body("stranger"), staff));
        TelephonyCounsellorEndpointDTO saved = c.upsert(MINE, body("u-8"), staff);
        assertEquals("447", saved.getExtension());
        verify(repo, times(1)).save(any());
    }
}
