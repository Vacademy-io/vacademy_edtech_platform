package vacademy.io.assessment_service.features.question_library.service;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.evaluation.service.QuestionEvaluationService;
import vacademy.io.assessment_service.features.question_bank.manager.AddQuestionPaperFromImportManager;
import vacademy.io.assessment_service.features.question_bank.manager.GetQuestionPaperManager;
import vacademy.io.assessment_service.features.rich_text.entity.AssessmentRichTextData;
import vacademy.io.assessment_service.features.question_core.entity.Option;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.OptionRepository;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;
import vacademy.io.assessment_service.features.question_library.dto.CopyLibraryQuestionsRequest;
import vacademy.io.assessment_service.features.question_library.dto.LibraryCopyResponse;
import vacademy.io.assessment_service.features.question_library.repository.QuestionLibraryNodeRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Runs the real question builder, so the copied answer key is the one a test would grade with. */
class QuestionLibraryCopyServiceTest {

    private static final String OWNER = "owner-inst";
    private static final String CLIENT = "client-inst";

    private QuestionLibraryAccess access;
    private QuestionLibraryNodeRepository nodeRepository;
    private QuestionRepository questionRepository;
    private OptionRepository optionRepository;
    private AddQuestionPaperFromImportManager importManager;
    private QuestionLibraryCopyService service;

    @BeforeEach
    void setUp() {
        access = new QuestionLibraryAccess();
        ReflectionTestUtils.setField(access, "ownerInstituteId", OWNER);
        nodeRepository = mock(QuestionLibraryNodeRepository.class);
        questionRepository = mock(QuestionRepository.class);
        optionRepository = mock(OptionRepository.class);
        importManager = spy(new AddQuestionPaperFromImportManager());
        ReflectionTestUtils.setField(importManager, "optionRepository", optionRepository);
        QuestionEvaluationService evaluationService = new QuestionEvaluationService();
        ReflectionTestUtils.setField(evaluationService, "objectMapper",
                new ObjectMapper().configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false));
        ReflectionTestUtils.setField(importManager, "questionEvaluationService", evaluationService);
        doNothing().when(importManager).addQuestionEntityTags(anyList(), anyList(), anyString());
        when(questionRepository.save(any())).thenAnswer(inv -> {
            Question q = inv.getArgument(0);
            q.setId(UUID.randomUUID().toString());
            return q;
        });
        service = new QuestionLibraryCopyService();
        ReflectionTestUtils.setField(service, "access", access);
        ReflectionTestUtils.setField(service, "scope", QuestionLibraryTestScopes.scope(access, nodeRepository));
        ReflectionTestUtils.setField(service, "nodeRepository", nodeRepository);
        // "upsc" is hidden from the client, so it sees only "ssc".
        when(nodeRepository.findByInstituteIdAndStatusOrderByDisplayOrderAscCreatedAtAsc(OWNER, "ACTIVE"))
                .thenReturn(List.of(QuestionLibraryTestScopes.node("ssc", null), QuestionLibraryTestScopes.node("upsc", null)));
        when(nodeRepository.findHiddenNodeIds(OWNER, CLIENT)).thenReturn(List.of("upsc"));
        ReflectionTestUtils.setField(service, "questionRepository", questionRepository);
        ReflectionTestUtils.setField(service, "optionRepository", optionRepository);
        ReflectionTestUtils.setField(service, "importManager", importManager);
        ReflectionTestUtils.setField(service, "questionPaperManager", mock(GetQuestionPaperManager.class));
    }

    private static AssessmentRichTextData rich(String id, String content) {
        AssessmentRichTextData data = new AssessmentRichTextData();
        data.setId(id);
        data.setType("HTML");
        data.setContent(content);
        return data;
    }

    private static Question libraryMcq(String id) {
        Question q = new Question(id);
        q.setInstituteId(OWNER);
        q.setStatus("ACTIVE");
        q.setQuestionType("MCQS");
        q.setDifficulty("HARD");
        q.setSourceType("KNOWLEDGE_BASE");
        q.setSourceMeta("{\"kb_id\":\"kb-1\"}");
        q.setDefaultQuestionTimeMins(3);
        q.setTextData(rich("txt-" + id, "<p>2 + 2 = ?</p>"));
        q.setExplanationTextData(rich("exp-" + id, "<p>Add them</p>"));
        q.setAutoEvaluationJson("{\"type\":\"MCQS\",\"data\":{\"correctOptionIds\":[\"opt-b\"]}}");
        Option a = new Option();
        a.setId("opt-a");
        a.setQuestion(q);
        a.setText(rich("ot-a", "3"));
        Option b = new Option();
        b.setId("opt-b");
        b.setQuestion(q);
        b.setText(rich("ot-b", "4"));
        q.setOptions(new ArrayList<>(List.of(a, b)));
        return q;
    }

    private static CopyLibraryQuestionsRequest pick(String... ids) {
        return CopyLibraryQuestionsRequest.builder().questionIds(List.of(ids)).excludeQuestionIds(List.of()).build();
    }

    private void offered(Question... questions) {
        List<String> ids = java.util.Arrays.stream(questions).map(Question::getId).toList();
        when(nodeRepository.findPlacedLiveQuestionIds(eq(OWNER), anyString(), eq("ssc"))).thenReturn(ids);
        when(questionRepository.findAllById(anyList())).thenReturn(List.of(questions));
    }

    @Test
    void copyIsANewRowOfTheCallerAndLeavesTheLibraryRowAlone() {
        Question source = libraryMcq("lib-q");
        offered(source);

        LibraryCopyResponse response = service.copy(CLIENT, pick("lib-q"));

        ArgumentCaptor<Question> saved = ArgumentCaptor.forClass(Question.class);
        verify(questionRepository).save(saved.capture());
        Question copy = saved.getValue();
        assertThat(copy).isNotSameAs(source);
        assertThat(copy.getInstituteId()).isEqualTo(CLIENT);
        assertThat(copy.getSourceType()).isEqualTo(QuestionLibraryCopyService.SOURCE_TYPE);
        assertThat(copy.getSourceMeta()).isEqualTo("{\"library_question_id\":\"lib-q\"}");
        assertThat(copy.getDifficulty()).isEqualTo("HARD");
        assertThat(copy.getDefaultQuestionTimeMins()).isEqualTo(3);

        // The rows the library still points at were not re-parented or renamed.
        assertThat(source.getInstituteId()).isEqualTo(OWNER);
        assertThat(source.getSourceType()).isEqualTo("KNOWLEDGE_BASE");
        assertThat(source.getOptions()).allMatch(o -> o.getQuestion() == source);
        verify(optionRepository, never()).findById(anyString());
        assertThat(copy.getTextData().getId()).isNotEqualTo("txt-lib-q");

        assertThat(response.getCopied()).hasSize(1);
        assertThat(response.getCopied().get(0).getSourceQuestionId()).isEqualTo("lib-q");
        assertThat(response.getCopied().get(0).getQuestionId()).isEqualTo(copy.getId());
    }

    @Test
    void answerKeyPointsAtTheNewOptionsAndNotTheOldOnes() {
        offered(libraryMcq("lib-q"));

        service.copy(CLIENT, pick("lib-q"));

        ArgumentCaptor<Question> saved = ArgumentCaptor.forClass(Question.class);
        verify(questionRepository).save(saved.capture());
        Question copy = saved.getValue();
        assertThat(copy.getOptions()).hasSize(2);
        assertThat(copy.getOptions()).noneMatch(o -> "opt-a".equals(o.getId()) || "opt-b".equals(o.getId()));
        Option correct = copy.getOptions().get(1);
        assertThat(correct.getText().getContent()).isEqualTo("4");
        assertThat(copy.getAutoEvaluationJson()).contains(correct.getId()).doesNotContain("opt-b");
        assertThat(copy.getAutoEvaluationJson()).doesNotContain(copy.getOptions().get(0).getId());
    }

    @Test
    void aQuestionTheLibraryDoesNotOfferCannotBeCopiedByGuessingItsId() {
        when(nodeRepository.findPlacedLiveQuestionIds(eq(OWNER), anyString(), any())).thenReturn(List.of());

        assertThatThrownBy(() -> service.copy(CLIENT, pick("owner-private-q")))
                .isInstanceOf(VacademyException.class);
        verify(questionRepository, never()).save(any());
    }

    @Test
    void aPaperOutsideTheLibraryIsRefused() {
        when(nodeRepository.countPaperInLibrary(OWNER, "other-paper", "ssc")).thenReturn(0L);

        assertThatThrownBy(() -> service.copy(CLIENT,
                CopyLibraryQuestionsRequest.builder().questionPaperId("other-paper").build()))
                .isInstanceOf(VacademyException.class);
        verify(questionRepository, never()).findQuestionsByQuestionPaperId(any());
    }

    @Test
    void aPaperCopiesTheLatestVersionOfEachQuestionInPaperOrder() {
        Question first = libraryMcq("q1");
        Question replaced = libraryMcq("q2-old");
        Question latest = libraryMcq("q2-new");
        when(nodeRepository.countPaperInLibrary(OWNER, "paper-1", "ssc")).thenReturn(1L);
        when(questionRepository.findQuestionsByQuestionPaperId("paper-1")).thenReturn(List.of(replaced, first));
        List<Object[]> hop = new ArrayList<>();
        hop.add(new Object[]{"q2-old", "q2-new"});
        when(nodeRepository.findNewerVersions(OWNER, "q2-old,q1")).thenReturn(hop);
        when(nodeRepository.findNewerVersions(OWNER, "q2-new")).thenReturn(List.of());
        when(questionRepository.findAllById(List.of("q2-new", "q1"))).thenReturn(List.of(first, latest));

        LibraryCopyResponse response = service.copy(CLIENT,
                CopyLibraryQuestionsRequest.builder().questionPaperId("paper-1").build());

        assertThat(response.getCopied()).extracting(LibraryCopyResponse.CopiedQuestion::getSourceQuestionId)
                .containsExactly("q2-new", "q1");
    }

    @Test
    void aQuestionAlreadyCopiedIntoTheSectionIsSkipped() {
        offered(libraryMcq("lib-q"));
        when(nodeRepository.findLibrarySourcesOfCopies("copy-in-section")).thenReturn(List.of("lib-q"));

        LibraryCopyResponse response = service.copy(CLIENT, CopyLibraryQuestionsRequest.builder()
                .questionIds(List.of("lib-q"))
                .excludeQuestionIds(List.of("copy-in-section"))
                .build());

        assertThat(response.getCopied()).isEmpty();
        assertThat(response.getAlreadyInSection()).isEqualTo(1);
        verify(questionRepository, never()).save(any());
    }

    @Test
    void oneUnusableQuestionDoesNotLoseTheRest() {
        Question good = libraryMcq("good");
        Question broken = libraryMcq("broken");
        broken.setQuestionType("NOT_A_TYPE");
        offered(broken, good);

        LibraryCopyResponse response = service.copy(CLIENT, pick("broken", "good"));

        assertThat(response.getFailed()).isEqualTo(1);
        assertThat(response.getCopied()).extracting(LibraryCopyResponse.CopiedQuestion::getSourceQuestionId)
                .containsExactly("good");
    }

    @Test
    void anInstituteWithEverythingHiddenCannotCopyAnything() {
        when(nodeRepository.findHiddenNodeIds(OWNER, "stranger-inst")).thenReturn(List.of("ssc", "upsc"));
        assertThatThrownBy(() -> service.copy("stranger-inst", pick("lib-q")))
                .isInstanceOf(VacademyException.class);
        verify(nodeRepository, never()).findPlacedLiveQuestionIds(any(), any(), any());
        verify(questionRepository, never()).save(any());
    }

    @Test
    void theOwnerCopiesFromAnyTopic() {
        Question source = libraryMcq("lib-q");
        when(nodeRepository.findPlacedLiveQuestionIds(eq(OWNER), anyString(), isNull())).thenReturn(List.of("lib-q"));
        when(questionRepository.findAllById(anyList())).thenReturn(List.of(source));

        assertThat(service.copy(OWNER, pick("lib-q")).getCopied()).hasSize(1);
    }

    @Test
    void withNoOwnerConfiguredNothingCanBeCopied() {
        ReflectionTestUtils.setField(access, "ownerInstituteId", "");

        assertThatThrownBy(() -> service.copy(CLIENT, pick("lib-q")))
                .isInstanceOf(VacademyException.class);
    }
}
