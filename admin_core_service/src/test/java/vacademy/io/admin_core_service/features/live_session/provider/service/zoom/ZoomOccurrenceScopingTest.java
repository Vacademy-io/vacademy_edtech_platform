package vacademy.io.admin_core_service.features.live_session.provider.service.zoom;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.provider.manager.ZoomMeetingManager;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionRepository;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;
import vacademy.io.common.meeting.dto.MeetingRecordingDTO;

import java.lang.reflect.Method;
import java.sql.Date;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.when;

/**
 * One Zoom meeting is reused for every class in a recurring series, so asking for its instances
 * returns several days at once. A schedule row is a SINGLE occurrence. Without scoping, the
 * hourly sweep stacks every day of the series onto whichever row happens to hold the meeting id
 * — duplicating files already held correctly by their own rows, and showing learners a date's
 * page full of other dates' classes. Modelled on the real HCCA series where meeting 88901426421
 * ran on 24, 25 and 26 Aug while only the 26th row carries the id.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ZoomOccurrenceScopingTest {

    private static final String SESSION_ID = "sess-advanced-hr";

    @Mock private ZoomMeetingManager zoomMeetingManager;
    @Mock private ZoomAccountStore zoomAccountStore;
    @Mock private SessionScheduleRepository scheduleRepository;
    @Mock private LiveSessionRepository liveSessionRepository;
    @Mock private com.fasterxml.jackson.databind.ObjectMapper objectMapper;
    @Mock private vacademy.io.admin_core_service.features.live_session.service.RecordingAutoLinkService recordingAutoLinkService;

    @InjectMocks private ZoomRecordingService service;

    private SessionSchedule scheduleOn(String isoDate) {
        return SessionSchedule.builder()
                .id("sched-" + isoDate).sessionId(SESSION_ID)
                .meetingDate(Date.valueOf(LocalDate.parse(isoDate))).build();
    }

    /** 09:30 IST classes — note the UTC stamps are 04:0x on the SAME local day. */
    private static final List<MeetingRecordingDTO> THREE_DAYS = List.of(
            MeetingRecordingDTO.builder().recordingId("a24").startTime("2026-08-24T04:17:22Z").build(),
            MeetingRecordingDTO.builder().recordingId("a25").startTime("2026-08-25T04:01:25Z").build(),
            MeetingRecordingDTO.builder().recordingId("a26").startTime("2026-08-26T04:01:31Z").build());

    @SuppressWarnings("unchecked")
    private List<MeetingRecordingDTO> scope(List<MeetingRecordingDTO> recs, SessionSchedule sched) throws Exception {
        when(liveSessionRepository.findById(SESSION_ID))
                .thenReturn(Optional.of(LiveSession.builder().id(SESSION_ID).timezone("Asia/Kolkata").build()));
        Method m = ZoomRecordingService.class.getDeclaredMethod(
                "onlyThisOccurrence", List.class, SessionSchedule.class);
        m.setAccessible(true);
        return (List<MeetingRecordingDTO>) m.invoke(service, recs, sched);
    }

    @Test
    @DisplayName("a row keeps only its OWN day out of a three-day series")
    void keepsOnlyItsOwnDay() throws Exception {
        assertEquals(List.of("a24"), scope(THREE_DAYS, scheduleOn("2026-08-24")).stream().map(MeetingRecordingDTO::getRecordingId).toList());
        assertEquals(List.of("a25"), scope(THREE_DAYS, scheduleOn("2026-08-25")).stream().map(MeetingRecordingDTO::getRecordingId).toList());
        assertEquals(List.of("a26"), scope(THREE_DAYS, scheduleOn("2026-08-26")).stream().map(MeetingRecordingDTO::getRecordingId).toList());
    }

    @Test
    @DisplayName("a date the series never ran on takes nothing rather than a sibling's class")
    void takesNothingWhenNoInstanceMatches() throws Exception {
        assertEquals(List.of(), scope(THREE_DAYS, scheduleOn("2026-08-27")));
    }

    @Test
    @DisplayName("UTC-to-local is respected: a 09:30 IST class stamped 04:00Z stays on its local day")
    void respectsSessionTimezone() throws Exception {
        assertEquals(1, scope(THREE_DAYS, scheduleOn("2026-08-26")).size());
    }

    @Test
    @DisplayName("recordings with no usable timestamp are dropped, not smeared across dates")
    void dropsUnusableTimestamps() throws Exception {
        List<MeetingRecordingDTO> junk = List.of(
                MeetingRecordingDTO.builder().recordingId("x").startTime(null).build(),
                MeetingRecordingDTO.builder().recordingId("y").startTime("").build(),
                MeetingRecordingDTO.builder().recordingId("z").startTime("not-a-date").build());
        assertEquals(List.of(), scope(junk, scheduleOn("2026-08-26")));
    }
}
