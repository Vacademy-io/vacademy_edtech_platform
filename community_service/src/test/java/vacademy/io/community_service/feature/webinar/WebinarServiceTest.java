package vacademy.io.community_service.feature.webinar;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.community_service.feature.webinar.dto.UpsertWebinarRequest;
import vacademy.io.community_service.feature.webinar.dto.WebinarDto;
import vacademy.io.community_service.feature.webinar.entity.Webinar;
import vacademy.io.community_service.feature.webinar.repository.WebinarRepository;
import vacademy.io.community_service.feature.webinar.service.WebinarService;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class WebinarServiceTest {

    @Mock
    private WebinarRepository repository;

    @InjectMocks
    private WebinarService service;

    private static UpsertWebinarRequest request(String title, String startsAt) {
        UpsertWebinarRequest r = new UpsertWebinarRequest();
        r.setTitle(title);
        r.setStartsAt(startsAt);
        return r;
    }

    private static Webinar row() {
        return Webinar.builder()
                .id("row-1")
                .title("Row")
                .startsAt(Instant.parse("2026-12-04T11:30:00Z"))
                .endsAt(Instant.parse("2026-12-04T12:15:00Z"))
                .build();
    }

    @Test
    @DisplayName("create stores a webinar, an hour long by default, with no recording yet")
    void createDefaults() {
        when(repository.save(any(Webinar.class))).thenAnswer(inv -> inv.getArgument(0));
        UpsertWebinarRequest r = request("  Friday product walkthrough ", "2026-12-04T17:00:00+05:30");
        r.setJoinUrl(" https://meet.example.com/abc ");

        WebinarDto dto = service.create(r);

        ArgumentCaptor<Webinar> saved = ArgumentCaptor.forClass(Webinar.class);
        verify(repository).save(saved.capture());
        assertTrue(saved.getValue().isActive());
        assertEquals("Friday product walkthrough", dto.getTitle());
        assertEquals("2026-12-04T11:30:00Z", dto.getStartsAt());
        assertEquals("2026-12-04T12:30:00Z", dto.getEndsAt());
        assertEquals("https://meet.example.com/abc", dto.getJoinUrl());
        assertNull(dto.getRecordingUrl());
        assertTrue(dto.isActive());
    }

    @ParameterizedTest
    @ValueSource(strings = {"javascript:alert(1)", "data:text/html,hi", "meet.example.com/abc", "https://",
            "https:///path", "https://example.com/a b", "https://user@:443/x"})
    @DisplayName("a join link that is not a full http(s) URL is rejected")
    void rejectsUnsafeJoinLinks(String link) {
        UpsertWebinarRequest r = request("Webinar", "2026-12-04T11:30:00Z");
        r.setJoinUrl(link);
        ResponseStatusException e = assertThrows(ResponseStatusException.class, () -> service.create(r));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatusCode());
        verify(repository, never()).save(any());
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "https://teams.microsoft.com/l/meetup-join/19:meeting_x@thread.v2/0?context={\"Tid\":\"x\"}",
            "https://us06web.zoom.us/j/81234567890?pwd=AbCd.1",
            "https://my_host.example.com/live",
            "http://[::1]:8080/room",
            "HTTPS://Meet.Google.com/abc-defg-hij"})
    @DisplayName("real meeting links that java.net.URI would refuse are still accepted")
    void acceptsRealMeetingLinks(String link) {
        when(repository.save(any(Webinar.class))).thenAnswer(inv -> inv.getArgument(0));
        UpsertWebinarRequest r = request("Webinar", "2026-12-04T11:30:00Z");
        r.setJoinUrl(link);
        assertEquals(link, service.create(r).getJoinUrl());
    }

    @Test
    @DisplayName("start is required, and the end must come after it")
    void validatesTheWindow() {
        assertThrows(ResponseStatusException.class, () -> service.create(request("Webinar", null)));
        assertThrows(ResponseStatusException.class, () -> service.create(request("Webinar", "next friday")));
        UpsertWebinarRequest r = request("Webinar", "2026-12-04T11:30:00Z");
        r.setEndsAt("2026-12-04T11:00:00Z");
        assertThrows(ResponseStatusException.class, () -> service.create(r));
        UpsertWebinarRequest tooLong = request("Webinar", "2026-12-04T11:30:00Z");
        tooLong.setEndsAt("2026-12-06T11:30:00Z");
        assertThrows(ResponseStatusException.class, () -> service.create(tooLong));
    }

    @Test
    @DisplayName("moving only the start keeps the length; an empty recording link clears it")
    void updateShiftsAndClears() {
        Webinar existing = row();
        existing.setRecordingUrl("https://cdn.example.com/rec.mp4");
        existing.setRecordingFileId("file-1");
        when(repository.findById("row-1")).thenReturn(Optional.of(existing));
        when(repository.save(any(Webinar.class))).thenAnswer(inv -> inv.getArgument(0));

        UpsertWebinarRequest r = new UpsertWebinarRequest();
        r.setStartsAt("2026-12-11T11:30:00Z");
        r.setRecordingUrl("");
        WebinarDto dto = service.update("row-1", r);

        assertEquals("2026-12-11T11:30:00Z", dto.getStartsAt());
        assertEquals("2026-12-11T12:15:00Z", dto.getEndsAt());
        assertNull(dto.getRecordingUrl());
        assertNull(dto.getRecordingFileId());
    }

    @Test
    @DisplayName("the live class id is stored, cleared with an empty string, and refused with spaces")
    void liveScheduleId() {
        when(repository.save(any(Webinar.class))).thenAnswer(inv -> inv.getArgument(0));
        UpsertWebinarRequest r = request("Webinar", "2026-12-04T11:30:00Z");
        r.setLiveScheduleId("  sched-1 ");
        assertEquals("sched-1", service.create(r).getLiveScheduleId());

        Webinar existing = row();
        existing.setLiveScheduleId("sched-1");
        when(repository.findById("row-1")).thenReturn(Optional.of(existing));
        UpsertWebinarRequest clear = new UpsertWebinarRequest();
        clear.setLiveScheduleId("");
        assertNull(service.update("row-1", clear).getLiveScheduleId());

        UpsertWebinarRequest bad = request("Webinar", "2026-12-04T11:30:00Z");
        bad.setLiveScheduleId("two words");
        assertThrows(ResponseStatusException.class, () -> service.create(bad));
    }

    @Test
    @DisplayName("the institute listing hands out the live class id only when asked to")
    void listingHidesLiveClassUnlessAllowed() {
        Webinar w = row();
        w.setLiveScheduleId("sched-1");
        when(repository.findByActiveTrueOrderByStartsAtDesc()).thenReturn(List.of(w));
        assertNull(service.listPublished(false).get(0).getLiveScheduleId());
        assertEquals("sched-1", service.listPublished(true).get(0).getLiveScheduleId());
    }

    @Test
    @DisplayName("an unknown id is a 404")
    void unknownId() {
        when(repository.findById("nope")).thenReturn(Optional.empty());
        ResponseStatusException e = assertThrows(ResponseStatusException.class,
                () -> service.update("nope", new UpsertWebinarRequest()));
        assertEquals(HttpStatus.NOT_FOUND, e.getStatusCode());
        assertThrows(ResponseStatusException.class, () -> service.delete("nope"));
        verify(repository, never()).delete(any());
    }
}
