package vacademy.io.admin_core_service.features.learner_notes.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import vacademy.io.admin_core_service.features.learner_notes.dto.LearnerNoteDTO;
import vacademy.io.admin_core_service.features.learner_notes.entity.LearnerNote;
import vacademy.io.admin_core_service.features.learner_notes.repository.LearnerNoteRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class LearnerNoteServiceTest {

    private static final String ME = "user-me";
    private static final String OTHER = "user-other";
    private static final String ID = "3f2b1c9e-8a7d-4e6f-9b1a-0c2d3e4f5a6b";

    private LearnerNoteRepository repository;
    private LearnerNoteService service;

    @BeforeEach
    void setUp() {
        repository = Mockito.mock(LearnerNoteRepository.class);
        service = new LearnerNoteService(repository);
        when(repository.save(any())).thenAnswer(i -> i.getArgument(0));
        when(repository.findById(ID)).thenReturn(Optional.empty());
    }

    private static LearnerNoteDTO highlight() {
        LearnerNoteDTO dto = new LearnerNoteDTO();
        dto.setInstituteId("inst");
        dto.setSlideId("slide");
        dto.setKind("HIGHLIGHT");
        dto.setColor("yellow");
        dto.setQuoteText("Photosynthesis needs light");
        return dto;
    }

    private static LearnerNote ownedBy(String user) {
        LearnerNote note = new LearnerNote();
        note.setId(ID);
        note.setUserId(user);
        note.setKind("HIGHLIGHT");
        note.setQuoteText("text");
        return note;
    }

    @Test
    void createsWithTheTokenUserAndSchedulesFirstReview() {
        LearnerNoteDTO saved = service.save(ME, ID, highlight());
        assertEquals(ID, saved.getId());
        assertNotNull(saved.getNextReviewAt());
        assertTrue(saved.getNextReviewAt().isAfter(Instant.now().plus(Duration.ofHours(23))));
        verify(repository).save(Mockito.argThat(n -> ME.equals(n.getUserId())));
    }

    @Test
    void retryWithTheSameIdKeepsOneNoteAndItsSchedule() {
        LearnerNote existing = ownedBy(ME);
        Instant scheduled = Instant.now().plus(Duration.ofDays(7));
        existing.setNextReviewAt(scheduled);
        existing.setReviewStage(2);
        existing.setCreatedAt(Instant.EPOCH);
        when(repository.findById(ID)).thenReturn(Optional.of(existing));

        LearnerNoteDTO saved = service.save(ME, ID, highlight());

        assertEquals(scheduled, saved.getNextReviewAt());
        assertEquals(2, saved.getReviewStage());
        assertEquals(Instant.EPOCH, saved.getCreatedAt());
    }

    @Test
    void anotherLearnersIdCannotBeOverwritten() {
        when(repository.findById(ID)).thenReturn(Optional.of(ownedBy(OTHER)));
        assertThrows(VacademyException.class, () -> service.save(ME, ID, highlight()));
        verify(repository, never()).save(any());
    }

    @Test
    void anotherLearnersNoteCannotBeDeletedOrReviewed() {
        LearnerNote theirs = ownedBy(OTHER);
        when(repository.findById(ID)).thenReturn(Optional.of(theirs));

        service.delete(ME, ID);
        assertNull(theirs.getDeletedAt());
        assertThrows(VacademyException.class, () -> service.recordReview(ME, ID, true));
        verify(repository, never()).save(any());
    }

    @Test
    void bookmarksAreNeverDueForReview() {
        LearnerNoteDTO bookmark = highlight();
        bookmark.setKind("BOOKMARK");
        bookmark.setQuoteText(null);
        assertNull(service.save(ME, ID, bookmark).getNextReviewAt());
    }

    @Test
    void rejectsBadInput() {
        assertThrows(VacademyException.class, () -> service.save(ME, "not-a-uuid", highlight()));

        LearnerNoteDTO badKind = highlight();
        badKind.setKind("SCRIPT");
        assertThrows(VacademyException.class, () -> service.save(ME, ID, badKind));

        LearnerNoteDTO badColor = highlight();
        badColor.setColor("#fff");
        assertThrows(VacademyException.class, () -> service.save(ME, ID, badColor));

        LearnerNoteDTO tooLong = highlight();
        tooLong.setNoteText("x".repeat(LearnerNoteService.MAX_NOTE_CHARS + 1));
        assertThrows(VacademyException.class, () -> service.save(ME, ID, tooLong));
    }

    @Test
    void rememberingWidensTheGapAndForgettingResetsIt() {
        LearnerNote note = ownedBy(ME);
        when(repository.findById(ID)).thenReturn(Optional.of(note));

        LearnerNoteDTO first = service.recordReview(ME, ID, true);
        assertEquals(1, first.getReviewStage());
        assertTrue(first.getNextReviewAt().isAfter(Instant.now().plus(Duration.ofDays(2))));

        LearnerNoteDTO forgot = service.recordReview(ME, ID, false);
        assertEquals(0, forgot.getReviewStage());
        assertFalse(forgot.getNextReviewAt().isAfter(Instant.now().plus(Duration.ofDays(2))));
    }

    @Test
    void gapHoldsAtTheLongestStage() {
        assertEquals(1, LearnerNoteService.gapDays(0));
        assertEquals(35, LearnerNoteService.gapDays(4));
        assertEquals(35, LearnerNoteService.gapDays(40));
    }

    @Test
    void aDeletedNoteStaysDeletedWhenALateSaveArrives() {
        LearnerNote deleted = ownedBy(ME);
        deleted.setDeletedAt(Instant.now());
        when(repository.findById(ID)).thenReturn(Optional.of(deleted));

        service.save(ME, ID, highlight());

        assertNotNull(deleted.getDeletedAt());
        verify(repository, never()).save(any());
    }

    @Test
    void stripsNulCharactersPostgresWouldRefuse() {
        LearnerNoteDTO dto = highlight();
        dto.setQuoteText("a\u0000b");
        assertEquals("ab", service.save(ME, ID, dto).getQuoteText());
    }

    @Test
    void theAppsJsonRoundTrips() throws Exception {
        com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper()
                .findAndRegisterModules()
                .disable(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);

        // What the app sends back after an edit, with the server's fields still on it.
        LearnerNoteDTO in = mapper.readValue("""
                {"id":"x","institute_id":"i","slide_id":"s","kind":"NOTE","page_index":2,"time_ms":9000,
                 "note_text":"hi","review_stage":9,"created_at":"not a date","next_review_at":"2026-11-06T10:00:00Z"}
                """, LearnerNoteDTO.class);
        assertEquals("i", in.getInstituteId());
        assertEquals(2, in.getPageIndex());
        assertEquals(9000L, in.getTimeMs());
        assertNull(in.getReviewStage());
        assertNull(in.getCreatedAt());
        assertNull(in.getNextReviewAt());

        LearnerNoteDTO out = new LearnerNoteDTO();
        out.setCreatedAt(Instant.parse("2026-11-06T10:00:00Z"));
        String json = mapper.writeValueAsString(out);
        assertTrue(json.contains("\"created_at\":\"2026-11-06T10:00:00Z\""), json);
    }

    @Test
    void searchEscapesWildcards() {
        assertEquals("", LearnerNoteService.likePattern("  "));
        assertEquals("%50!% of a!_b!!%", LearnerNoteService.likePattern(" 50% of A_B! "));
    }
}
