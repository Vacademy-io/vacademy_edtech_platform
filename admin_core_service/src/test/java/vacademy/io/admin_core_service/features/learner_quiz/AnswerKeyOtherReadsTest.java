package vacademy.io.admin_core_service.features.learner_quiz;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.chapter.repository.ChapterRepository;
import vacademy.io.admin_core_service.features.learner_offline.dto.OfflineManifestChapterDTO;
import vacademy.io.admin_core_service.features.learner_offline.dto.OfflineManifestDTO;
import vacademy.io.admin_core_service.features.learner_offline.dto.OfflineManifestModuleDTO;
import vacademy.io.admin_core_service.features.learner_offline.dto.OfflineManifestSlideDTO;
import vacademy.io.admin_core_service.features.learner_offline.dto.OfflineManifestSubjectDTO;
import vacademy.io.admin_core_service.features.learner_offline.service.OfflineManifestService;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.AnswerKeyAccess;
import vacademy.io.admin_core_service.features.learner_tracking.dto.ActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.dto.QuizSideActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.learner_tracking.entity.QuizSlideQuestionTracked;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;
import vacademy.io.admin_core_service.features.learner_tracking.service.AssignmentSlideActivityLogService;
import vacademy.io.admin_core_service.features.learner_tracking.service.LearnerTrackingService;
import vacademy.io.admin_core_service.features.learner_tracking.service.QuestionSlideActivityLogService;
import vacademy.io.admin_core_service.features.module.repository.ModuleChapterMappingRepository;
import vacademy.io.admin_core_service.features.quiz_results.repository.QuizResultsRepository;
import vacademy.io.admin_core_service.features.slide.dto.QuizSlideQuestionDTO;
import vacademy.io.admin_core_service.features.slide.entity.QuizSlideQuestion;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import vacademy.io.admin_core_service.features.slide.service.QuizSlideService;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.CALLS_REAL_METHODS;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Reads and saves around the attempt log that follow the same switches. */
class AnswerKeyOtherReadsTest {

    private final ActivityLogRepository logs = mock(ActivityLogRepository.class);

    private static ActivityLog quizRow() {
        ActivityLog row = new ActivityLog();
        row.setId("attempt");
        QuizSideActivityLogDTO side = new QuizSideActivityLogDTO();
        side.setId("row");
        side.setResponseJson("{\"correctOptions\":[{\"id\":\"KEYVALUE\"}]}");
        row.setQuizSlideQuestionTracked(List.of(new QuizSlideQuestionTracked(side, row)));
        return row;
    }

    private static AnswerKeyAccess switches(boolean learner) {
        return new AnswerKeyAccess(false, learner, false, false);
    }

    private void everyQueryFindsAQuizRow() {
        var page = new PageImpl<>(List.of(quizRow()));
        when(logs.findActivityLogsWithAssignmentSlide(any(), any(), any(Pageable.class))).thenReturn(page);
        when(logs.findActivityLogsWithQuestionSlides(any(), any(), any(Pageable.class))).thenReturn(page);
        when(logs.findActivityLogsWithDocuments(any(), any(), any(Pageable.class))).thenReturn(page);
        when(logs.findActivityLogsWithVideos(any(), any(), any(Pageable.class))).thenReturn(page);
    }

    private List<ActivityLogDTO> readAll(AnswerKeyAccess access) {
        everyQueryFindsAQuizRow();
        AssignmentSlideActivityLogService assignment = mock(AssignmentSlideActivityLogService.class, CALLS_REAL_METHODS);
        ReflectionTestUtils.setField(assignment, "activityLogRepository", logs);
        ReflectionTestUtils.setField(assignment, "answerKeyAccess", access);
        QuestionSlideActivityLogService question = mock(QuestionSlideActivityLogService.class, CALLS_REAL_METHODS);
        ReflectionTestUtils.setField(question, "activityLogRepository", logs);
        ReflectionTestUtils.setField(question, "answerKeyAccess", access);
        LearnerTrackingService tracking = mock(LearnerTrackingService.class, CALLS_REAL_METHODS);
        ReflectionTestUtils.setField(tracking, "activityLogRepository", logs);
        ReflectionTestUtils.setField(tracking, "answerKeyAccess", access);
        List<ActivityLogDTO> out = new ArrayList<>();
        out.addAll(assignment.getAssignmentSlideActivityLogs("", "s", Pageable.unpaged(), null).getContent());
        out.addAll(question.getQuestionSlideActivityLogs("u", "s", Pageable.unpaged(), null).getContent());
        out.addAll(tracking.getDocumentActivityLogs("u", "s", Pageable.unpaged(), null).getContent());
        out.addAll(tracking.getVideoActivityLogs("u", "s", Pageable.unpaged(), null).getContent());
        return out;
    }

    @Test
    @DisplayName("with the learner switch on, the other log reads carry no quiz answers")
    void otherLogReadsLoseQuizSides() {
        List<ActivityLogDTO> read = readAll(switches(true));
        assertThat(read).hasSize(4);
        read.forEach(log -> assertThat(log.getQuizSides()).isEmpty());
    }

    @Test
    @DisplayName("with it off, they are as they are today")
    void otherLogReadsUnchangedWhenOff() {
        readAll(switches(false)).forEach(log -> assertThat(log.getQuizSides()).hasSize(1));
    }

    @Test
    @DisplayName("the offline preview for staff carries availability, never slide content")
    void adminPreviewHasNoSlideContent() {
        OfflineManifestSlideDTO slide = new OfflineManifestSlideDTO();
        slide.setDownloadable(true);
        slide.setInlinePayload(new Object());
        OfflineManifestChapterDTO chapter = new OfflineManifestChapterDTO();
        chapter.setSlides(new ArrayList<>(List.of(slide)));
        OfflineManifestModuleDTO module = new OfflineManifestModuleDTO();
        module.setChapters(new ArrayList<>(List.of(chapter)));
        OfflineManifestSubjectDTO subject = new OfflineManifestSubjectDTO();
        subject.setModules(new ArrayList<>(List.of(module)));
        OfflineManifestDTO manifest = new OfflineManifestDTO();
        manifest.setSubjects(new ArrayList<>(List.of(subject)));

        OfflineManifestService.removeSlideContent(manifest);

        assertThat(slide.getInlinePayload()).isNull();
        assertThat(slide.isDownloadable()).isTrue();
    }

    @ParameterizedTest
    @ValueSource(classes = { SlideRepository.class, ChapterRepository.class, ModuleChapterMappingRepository.class })
    @DisplayName("the slide reads state no option order of their own, so learners and the editor keep the order they have")
    void slideReadsKeepTheirOptionOrder(Class<?> repository) {
        int found = 0;
        for (Method method : repository.getDeclaredMethods()) {
            Query query = method.getAnnotation(Query.class);
            if (query == null || !query.value().contains("quiz_slide_question_options o")) {
                continue;
            }
            found++;
            assertThat(query.value()).as(method.getName()).doesNotContain("ctid");
        }
        assertThat(found).as("the query this guards is still here").isPositive();
    }

    private QuizSlideService saveService(boolean authoringStrip) {
        QuizSlideService service = new QuizSlideService();
        ReflectionTestUtils.setField(service, "answerKeyAccess", new AnswerKeyAccess(false, false, authoringStrip, false));
        return service;
    }

    private static QuizSlideQuestion stored() {
        QuizSlideQuestion question = new QuizSlideQuestion();
        question.setId("q");
        question.setAutoEvaluationJson("{\"correctAnswers\":[\"a\"]}");
        question.setExplanationText(new vacademy.io.admin_core_service.features.common.entity.RichTextData());
        return question;
    }

    private static QuizSlideQuestionDTO savedWithoutAnswers() {
        QuizSlideQuestionDTO dto = new QuizSlideQuestionDTO();
        dto.setId("q");
        return dto;
    }

    @Test
    @DisplayName("switch off: a save writes what it is given, including a cleared key")
    void saveAsTodayWhenOff() {
        QuizSlideQuestion question = stored();
        ReflectionTestUtils.invokeMethod(saveService(false), "updateExistingQuestion", question, savedWithoutAnswers());
        assertThat(question.getAutoEvaluationJson()).isNull();
        assertThat(question.getExplanationText()).isNull();
    }

    @Test
    @DisplayName("switch on: a save built from a read without answers keeps both the key and the explanation")
    void saveKeepsAnswersWhenOn() {
        QuizSlideQuestion question = stored();
        ReflectionTestUtils.invokeMethod(saveService(true), "updateExistingQuestion", question, savedWithoutAnswers());
        assertThat(question.getAutoEvaluationJson()).contains("correctAnswers");
        assertThat(question.getExplanationText()).isNotNull();
    }
}
