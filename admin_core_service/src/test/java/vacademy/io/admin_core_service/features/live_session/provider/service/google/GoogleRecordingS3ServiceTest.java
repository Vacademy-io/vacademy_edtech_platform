package vacademy.io.admin_core_service.features.live_session.provider.service.google;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.provider.dto.google.GoogleAccount;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.media.service.FileService;
import vacademy.io.common.meeting.dto.MeetingRecordingDTO;

import java.io.File;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class GoogleRecordingS3ServiceTest {

    private static final String REC_ID = "conferenceRecords/abc/recordings/r1";
    private static final String DRIVE_URL = "https://drive.google.com/file/d/1DU1rt9Ae6_C6-13eG/view?usp=drive_web";

    @Mock private GoogleAccountStore googleAccountStore;
    @Mock private GoogleAccessTokenService accessTokenService;
    @Mock private GoogleRecordingService googleRecordingService;
    @Mock private SessionScheduleRepository scheduleRepository;
    @Mock private FileService fileService;

    private GoogleRecordingS3Service spyService() {
        return spy(new GoogleRecordingS3Service(googleAccountStore, accessTokenService,
                googleRecordingService, scheduleRepository, fileService));
    }

    private SessionSchedule schedule() {
        return SessionSchedule.builder().id("sch-1").sessionId("sess-1").providerAccountId("acct-1").build();
    }

    private GoogleAccount account(String scopes) {
        return GoogleAccount.builder().id("acct-1").organizerEmail("team@example.in").grantedScopes(scopes).build();
    }

    private MeetingRecordingDTO driveRecording() {
        return MeetingRecordingDTO.builder().recordingId(REC_ID)
                .downloadUrl(DRIVE_URL).playbackUrl(DRIVE_URL).recordingStorage("GOOGLE_DRIVE").build();
    }

    @Test
    void withoutDriveScopeFailsWith412AndDownloadsNothing() throws Exception {
        GoogleRecordingS3Service service = spyService();
        when(googleAccountStore.findById("acct-1"))
                .thenReturn(Optional.of(account("openid https://www.googleapis.com/auth/meetings.space.created")));

        VacademyException e = assertThrows(VacademyException.class, () -> service.mirrorToS3(schedule()));

        assertEquals(HttpStatus.PRECONDITION_FAILED, e.getStatus());
        assertTrue(e.getMessage().contains("team@example.in"));
        verify(service, never()).downloadToFile(anyString(), anyString(), any(File.class));
    }

    @Test
    void mirrorsDriveRecordingAndAttachesViaFreshSchedule() throws Exception {
        GoogleRecordingS3Service service = spyService();
        SessionSchedule schedule = schedule();
        SessionSchedule fresh = schedule();
        when(googleAccountStore.findById("acct-1"))
                .thenReturn(Optional.of(account("openid " + GoogleOAuthService.DRIVE_MEET_READONLY_SCOPE)));
        when(googleRecordingService.getStored(schedule)).thenReturn(List.of(driveRecording()));
        when(accessTokenService.getAccessToken(any())).thenReturn("tok");
        when(scheduleRepository.findById("sch-1")).thenReturn(Optional.of(fresh));
        when(fileService.getPresignedUploadUrl(any(), any(), any(), any()))
                .thenReturn(Map.of("id", "file-9", "url", "https://s3/presigned-put"));
        doReturn(500L).when(service).downloadToFile(anyString(), anyString(), any(File.class));
        doNothing().when(service).putFileToPresignedUrl(anyString(), any(File.class), anyString());

        int mirrored = service.mirrorToS3(schedule);

        assertEquals(1, mirrored);
        verify(accessTokenService).evict("acct-1");
        verify(service).downloadToFile(
                eq(GoogleRecordingS3Service.DRIVE_FILES_URL + "1DU1rt9Ae6_C6-13eG?alt=media&supportsAllDrives=true"),
                eq("tok"), any(File.class));
        verify(googleRecordingService).attachUploadedFile(fresh, REC_ID, "file-9");
    }

    @Test
    void skipsRecordingsAlreadyInLibrary() throws Exception {
        GoogleRecordingS3Service service = spyService();
        MeetingRecordingDTO saved = driveRecording();
        saved.setFileId("file-1");
        when(googleAccountStore.findById("acct-1"))
                .thenReturn(Optional.of(account(GoogleOAuthService.DRIVE_MEET_READONLY_SCOPE)));
        when(googleRecordingService.getStored(any())).thenReturn(List.of(saved));

        assertEquals(0, service.mirrorToS3(schedule()));
        verify(service, never()).downloadToFile(anyString(), anyString(), any(File.class));
        verify(googleRecordingService, never()).attachUploadedFile(any(), anyString(), anyString());
    }

    @Test
    void surfacesDriveFailureWhenNothingSaved() throws Exception {
        GoogleRecordingS3Service service = spyService();
        when(googleAccountStore.findById("acct-1"))
                .thenReturn(Optional.of(account(GoogleOAuthService.DRIVE_MEET_READONLY_SCOPE)));
        when(googleRecordingService.getStored(any())).thenReturn(List.of(driveRecording()));
        when(accessTokenService.getAccessToken(any())).thenReturn("tok");
        doThrow(new IllegalStateException("Google Drive returned HTTP 403"))
                .when(service).downloadToFile(anyString(), anyString(), any(File.class));

        VacademyException e = assertThrows(VacademyException.class, () -> service.mirrorToS3(schedule()));

        assertEquals(HttpStatus.BAD_GATEWAY, e.getStatus());
        assertTrue(e.getMessage().contains("HTTP 403"));
        verify(googleRecordingService, never()).attachUploadedFile(any(), anyString(), anyString());
    }

    @Test
    void extractsDriveFileIdFromExportUriAndIdParam() {
        assertEquals("1DU1rt9Ae6_C6-13eG", GoogleRecordingS3Service.driveFileId(driveRecording()));
        MeetingRecordingDTO open = MeetingRecordingDTO.builder()
                .downloadUrl("https://drive.google.com/open?id=abc-123_X").build();
        assertEquals("abc-123_X", GoogleRecordingS3Service.driveFileId(open));
        assertNull(GoogleRecordingS3Service.driveFileId(MeetingRecordingDTO.builder().build()));
    }
}
