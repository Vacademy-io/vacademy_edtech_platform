package vacademy.io.admin_core_service.features.live_session.provider.service.google;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.provider.dto.google.GoogleAccount;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;
import vacademy.io.admin_core_service.features.live_session.service.RecordingAutoLinkService;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.meeting.dto.MeetingRecordingDTO;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class GoogleRecordingServiceTest {

    private static final String REC_ID = "conferenceRecords/abc/recordings/r1";
    private static final String DRIVE_URL = "https://drive.google.com/file/d/xyz/view";

    @Mock private GoogleConferenceService conferenceService;
    @Mock private GoogleAccountStore googleAccountStore;
    @Mock private SessionScheduleRepository scheduleRepository;
    @Mock private RecordingAutoLinkService recordingAutoLinkService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private GoogleRecordingService service() {
        return new GoogleRecordingService(conferenceService, googleAccountStore, scheduleRepository,
                objectMapper, recordingAutoLinkService);
    }

    private MeetingRecordingDTO driveRecording() {
        return MeetingRecordingDTO.builder()
                .recordingId(REC_ID).downloadUrl(DRIVE_URL).playbackUrl(DRIVE_URL)
                .recordingStorage("GOOGLE_DRIVE").build();
    }

    private SessionSchedule schedule(List<MeetingRecordingDTO> stored) throws Exception {
        return SessionSchedule.builder().id("sch-1").sessionId("sess-1")
                .providerAccountId("acct-1").providerMeetingId("spaces/xyz")
                .providerRecordingsJson(objectMapper.writeValueAsString(stored)).build();
    }

    private List<MeetingRecordingDTO> stored(SessionSchedule schedule) throws Exception {
        return objectMapper.readValue(schedule.getProviderRecordingsJson(),
                new TypeReference<List<MeetingRecordingDTO>>() {});
    }

    @Test
    void attachStoresFileIdAsLibraryCopyAndReRunsAutoLink() throws Exception {
        SessionSchedule schedule = schedule(List.of(driveRecording()));

        List<MeetingRecordingDTO> result = service().attachUploadedFile(schedule, REC_ID, "file-1");

        MeetingRecordingDTO rec = stored(schedule).get(0);
        assertEquals("file-1", rec.getFileId());
        assertEquals("S3", rec.getRecordingStorage());
        assertNull(rec.getDownloadUrl());
        assertNull(rec.getPlaybackUrl());
        assertEquals("file-1", result.get(0).getFileId());
        verify(scheduleRepository).save(schedule);
        verify(recordingAutoLinkService).processSchedule(schedule);
    }

    @Test
    void attachRejectsUnknownRecordingAndUrlFileIds() throws Exception {
        SessionSchedule schedule = schedule(List.of(driveRecording()));

        assertThrows(VacademyException.class,
                () -> service().attachUploadedFile(schedule, "other", "file-1"));
        assertThrows(VacademyException.class,
                () -> service().attachUploadedFile(schedule, REC_ID, "https://s3/file"));
        assertThrows(VacademyException.class,
                () -> service().attachUploadedFile(schedule, REC_ID, " "));
        verify(scheduleRepository, never()).save(any());
    }

    @Test
    void reSyncKeepsUploadedLibraryCopy() throws Exception {
        MeetingRecordingDTO uploaded = driveRecording();
        uploaded.setFileId("file-1");
        uploaded.setRecordingStorage("S3");
        uploaded.setDownloadUrl(null);
        uploaded.setPlaybackUrl(null);
        uploaded.setYoutubeVideoId("yt-1");
        uploaded.setYoutubeVideoUrl("https://www.youtube.com/watch?v=yt-1");
        SessionSchedule schedule = schedule(List.of(uploaded));

        when(googleAccountStore.findById("acct-1")).thenReturn(Optional.of(mock(GoogleAccount.class)));
        // The Meet API returns the bare Drive recording again on every poll / webhook.
        when(conferenceService.fetchRecordings(any(), anyString()))
                .thenReturn(List.of(MeetingRecordingDTO.builder()
                        .recordingId(REC_ID).downloadUrl(DRIVE_URL).playbackUrl(DRIVE_URL).build()));

        int added = service().syncFromApi(schedule);

        assertEquals(0, added);
        MeetingRecordingDTO rec = stored(schedule).get(0);
        assertEquals("file-1", rec.getFileId());
        assertEquals("S3", rec.getRecordingStorage());
        assertNull(rec.getPlaybackUrl());
        assertEquals("yt-1", rec.getYoutubeVideoId());
    }

    @Test
    void reSyncOfDriveOnlyRecordingStillTagsGoogleDrive() throws Exception {
        SessionSchedule schedule = schedule(List.of(driveRecording()));

        when(googleAccountStore.findById("acct-1")).thenReturn(Optional.of(mock(GoogleAccount.class)));
        when(conferenceService.fetchRecordings(any(), anyString()))
                .thenReturn(List.of(MeetingRecordingDTO.builder()
                        .recordingId(REC_ID).downloadUrl(DRIVE_URL).playbackUrl(DRIVE_URL).build()));

        service().syncFromApi(schedule);

        MeetingRecordingDTO rec = stored(schedule).get(0);
        assertNull(rec.getFileId());
        assertEquals("GOOGLE_DRIVE", rec.getRecordingStorage());
        assertEquals(DRIVE_URL, rec.getPlaybackUrl());
    }
}
