package vacademy.io.admin_core_service.features.slide.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.slide.dto.QuizSlideDTO;
import vacademy.io.admin_core_service.features.slide.entity.QuizSlide;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.repository.QuizSlideQuestionRepository;
import vacademy.io.admin_core_service.features.slide.repository.QuizSlideRepository;

import java.lang.reflect.Constructor;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * "Document + Quiz" slides: a QUIZ slide whose quiz_slide.title holds the document
 * marker. Covers the marker check, the update path and the slide copy path.
 */
class DocumentQuizSlideTest {

    private static final String MARKER =
            "{\"kind\":\"DOCUMENT_QUIZ\",\"v\":1,\"file_id\":\"file-1\",\"file_name\":\"Balance sheet.pdf\",\"source\":\"PDF\"}";
    private static final String OTHER_MARKER =
            "{\"kind\":\"DOCUMENT_QUIZ\",\"v\":1,\"file_id\":\"file-2\",\"file_name\":\"Deck.pdf\",\"source\":\"PPT\"}";

    @Test
    @DisplayName("marker: only a DOCUMENT_QUIZ object with a file id counts")
    void markerShape() {
        assertThat(DocumentQuizMarker.isMarker(MARKER)).isTrue();
        assertThat(DocumentQuizMarker.isMarker("  " + MARKER + " ")).isTrue();

        assertThat(DocumentQuizMarker.isMarker(null)).isFalse();
        assertThat(DocumentQuizMarker.isMarker("")).isFalse();
        assertThat(DocumentQuizMarker.isMarker("Quiz 1")).isFalse();
        assertThat(DocumentQuizMarker.isMarker("{not json")).isFalse();
        assertThat(DocumentQuizMarker.isMarker("[\"DOCUMENT_QUIZ\"]")).isFalse();
        assertThat(DocumentQuizMarker.isMarker("{\"kind\":\"OTHER\",\"file_id\":\"f\"}")).isFalse();
        assertThat(DocumentQuizMarker.isMarker("{\"kind\":\"DOCUMENT_QUIZ\",\"file_id\":\"  \"}")).isFalse();
        assertThat(DocumentQuizMarker.isMarker("{\"kind\":\"DOCUMENT_QUIZ\",\"file_id\":7}")).isFalse();
        assertThat(DocumentQuizMarker.isMarker("{\"kind\":\"DOCUMENT_QUIZ\"}")).isFalse();
        // Longer than the varchar(255) column: never written.
        String tooLong = "{\"kind\":\"DOCUMENT_QUIZ\",\"file_id\":\"f\",\"file_name\":\"" + "x".repeat(260) + "\"}";
        assertThat(DocumentQuizMarker.isMarker(tooLong)).isFalse();
    }

    private static QuizSlide storedQuiz(String title) {
        QuizSlide quiz = new QuizSlide();
        quiz.setId("quiz-1");
        quiz.setTitle(title);
        return quiz;
    }

    private static QuizSlideDTO update(String title) {
        QuizSlideDTO dto = new QuizSlideDTO();
        dto.setId("quiz-1");
        dto.setTitle(title);
        return dto;
    }

    @Test
    @DisplayName("update: a new marker replaces the document")
    void updateReplacesTheDocument() {
        QuizSlide quiz = storedQuiz(MARKER);
        new QuizSlideService().updateData(update(OTHER_MARKER), quiz);
        assertThat(quiz.getTitle()).isEqualTo(OTHER_MARKER);
    }

    @Test
    @DisplayName("update: a plain quiz title is still never rewritten (unchanged behaviour)")
    void updateIgnoresPlainTitles() {
        QuizSlide plain = storedQuiz("Chapter 1 quiz");
        new QuizSlideService().updateData(update("Renamed quiz"), plain);
        assertThat(plain.getTitle()).isEqualTo("Chapter 1 quiz");

        QuizSlide nullTitle = storedQuiz("Chapter 1 quiz");
        new QuizSlideService().updateData(update(null), nullTitle);
        assertThat(nullTitle.getTitle()).isEqualTo("Chapter 1 quiz");
    }

    @Test
    @DisplayName("update: an old payload with a plain title cannot drop the document")
    void updateKeepsTheDocumentAgainstPlainTitles() {
        QuizSlide quiz = storedQuiz(MARKER);
        new QuizSlideService().updateData(update("Quiz"), quiz);
        assertThat(quiz.getTitle()).isEqualTo(MARKER);
    }

    /** SlideService with only the two repositories the quiz copy path touches; the rest stay null. */
    private static SlideService slideServiceWith(QuizSlideRepository quizRepo,
                                                 QuizSlideQuestionRepository questionRepo) throws Exception {
        Constructor<?> ctor = SlideService.class.getDeclaredConstructors()[0];
        Class<?>[] types = ctor.getParameterTypes();
        Object[] args = new Object[types.length];
        for (int i = 0; i < types.length; i++) {
            if (types[i] == QuizSlideRepository.class) args[i] = quizRepo;
            if (types[i] == QuizSlideQuestionRepository.class) args[i] = questionRepo;
        }
        return (SlideService) ctor.newInstance(args);
    }

    @Test
    @DisplayName("copy: duplicating the slide (single copy and course copy) keeps the document")
    void copyKeepsTheDocument() throws Exception {
        QuizSlideRepository quizRepo = mock(QuizSlideRepository.class);
        QuizSlideQuestionRepository questionRepo = mock(QuizSlideQuestionRepository.class);
        QuizSlide source = storedQuiz(MARKER);
        source.setMarksPerQuestion(2.0);
        when(quizRepo.findById("quiz-1")).thenReturn(Optional.of(source));
        when(questionRepo.findByQuizSlideId("quiz-1")).thenReturn(List.of());
        when(quizRepo.save(any(QuizSlide.class))).thenAnswer(inv -> inv.getArgument(0));

        Slide slide = new Slide();
        slide.setId("slide-1");
        slide.setSourceType("QUIZ");
        slide.setSourceId("quiz-1");

        // copySlideSourceForSlide is what both SlideService copy and CourseContentCopyService call.
        String newSourceId = slideServiceWith(quizRepo, questionRepo).copySlideSourceForSlide(slide);

        ArgumentCaptor<QuizSlide> saved = ArgumentCaptor.forClass(QuizSlide.class);
        verify(quizRepo).save(saved.capture());
        assertThat(newSourceId).isNotEqualTo("quiz-1").isEqualTo(saved.getValue().getId());
        assertThat(saved.getValue().getTitle()).isEqualTo(MARKER);
        assertThat(DocumentQuizMarker.isMarker(saved.getValue().getTitle())).isTrue();
        assertThat(saved.getValue().getMarksPerQuestion()).isEqualTo(2.0);
    }
}
