package vacademy.io.admin_core_service.features.booking.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.booking.dto.MeetingBookingRequestDTO;
import vacademy.io.admin_core_service.features.booking.entity.BookingInstance;
import vacademy.io.admin_core_service.features.booking.repository.BookingInstanceRepository;
import vacademy.io.common.exceptions.ConflictException;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** One meeting per person per day: a second booking the same day is refused, not sent as a second invite. */
class OneMeetingPerDayGuardTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private BookingInstanceRepository repo;

    private MeetingBookingService service() {
        repo = mock(BookingInstanceRepository.class);
        MeetingBookingService s = mock(MeetingBookingService.class, CALLS_REAL_METHODS);
        ReflectionTestUtils.setField(s, "bookingInstanceRepository", repo);
        return s;
    }

    private static MeetingBookingRequestDTO request() {
        return MeetingBookingRequestDTO.builder()
                .instituteId("i1").audienceResponseId("r-new").inviteeUserId("u-new")
                .inviteeName("Priyanshu Mishra").inviteePhone("+91 99688 58268")
                .inviteeEmail("Priyanshu@Vidyayatan.com").build();
    }

    @Test
    @DisplayName("a second meeting the same day is refused, naming the existing one")
    void refusesSecondSameDay() {
        MeetingBookingService s = service();
        BookingInstance existing = new BookingInstance();
        existing.setInviteeName("Priyanshu Mishra");
        existing.setScheduledStartUtc(Timestamp.from(Instant.parse("2026-10-30T06:00:00Z"))); // 11:30 IST
        when(repo.findLiveBookingsOfPersonBetween(any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(List.of(existing));
        ConflictException ex = assertThrows(ConflictException.class, () -> s.requireNoOtherMeetingThatDay(
                request(), OffsetDateTime.parse("2026-10-30T10:00:00+05:30"), IST));
        assertTrue(ex.getMessage().contains("Fri 30 Oct at 11:30 AM"), ex.getMessage());
    }

    @Test
    @DisplayName("the person is matched by lead, user, last-10 phone and lower-cased email, within that local day")
    void matchesPersonWithinLocalDay() {
        MeetingBookingService s = service();
        when(repo.findLiveBookingsOfPersonBetween(any(), any(), any(), any(), any(), any(), any())).thenReturn(List.of());
        s.requireNoOtherMeetingThatDay(request(), OffsetDateTime.parse("2026-10-30T10:00:00+05:30"), IST);
        ArgumentCaptor<Timestamp> from = ArgumentCaptor.forClass(Timestamp.class);
        ArgumentCaptor<Timestamp> to = ArgumentCaptor.forClass(Timestamp.class);
        verify(repo).findLiveBookingsOfPersonBetween(eq("i1"), eq("r-new"), eq("u-new"), eq("9968858268"),
                eq("priyanshu@vidyayatan.com"), from.capture(), to.capture());
        assertEquals(Instant.parse("2026-10-29T18:30:00Z"), from.getValue().toInstant()); // 30 Oct 00:00 IST
        assertEquals(Instant.parse("2026-10-30T18:30:00Z"), to.getValue().toInstant());
    }

    @Test
    @DisplayName("a booking with no way to identify the person is not checked")
    void anonymousSkipped() {
        MeetingBookingService s = service();
        s.requireNoOtherMeetingThatDay(MeetingBookingRequestDTO.builder().instituteId("i1").build(),
                OffsetDateTime.parse("2026-10-30T10:00:00+05:30"), IST);
        verifyNoInteractions(repo);
    }
}
