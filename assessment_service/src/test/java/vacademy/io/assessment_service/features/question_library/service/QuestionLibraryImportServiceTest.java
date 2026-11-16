package vacademy.io.assessment_service.features.question_library.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.question_bank.manager.AddQuestionPaperFromImportManager;
import vacademy.io.assessment_service.features.question_core.dto.QuestionDTO;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.OptionRepository;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;
import vacademy.io.assessment_service.features.question_library.dto.LibraryImportRequest;
import vacademy.io.assessment_service.features.question_library.dto.LibraryImportResponse;
import vacademy.io.assessment_service.features.question_library.entity.QuestionLibraryNode;
import vacademy.io.assessment_service.features.question_library.repository.QuestionLibraryNodeRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Saving new questions straight into topics: topic creation, difficulty, tags and partial failure. */
class QuestionLibraryImportServiceTest {

    private static final String OWNER = "owner-inst";

    private QuestionLibraryNodeRepository nodes;
    private QuestionRepository questions;
    private AddQuestionPaperFromImportManager importManager;
    private QuestionLibraryCurationService curation;
    private QuestionLibraryImportService service;
    private final List<QuestionLibraryNode> createdNodes = new ArrayList<>();

    @BeforeEach
    void setUp() throws Exception {
        nodes = mock(QuestionLibraryNodeRepository.class);
        // UPSC (top) > Polity
        when(nodes.findByInstituteIdAndStatusOrderByDisplayOrderAscCreatedAtAsc(OWNER, "ACTIVE")).thenReturn(List.of(
                QuestionLibraryTestScopes.node("upsc", null),
                QuestionLibraryTestScopes.node("polity", "upsc")));
        when(nodes.findMaxDisplayOrder(eq(OWNER), any())).thenReturn(-1);
        when(nodes.save(any(QuestionLibraryNode.class))).thenAnswer(inv -> {
            QuestionLibraryNode node = inv.getArgument(0);
            node.setId("new-" + node.getName().toLowerCase().replace(' ', '-'));
            createdNodes.add(node);
            return node;
        });
        QuestionLibraryTreeResolver resolver = new QuestionLibraryTreeResolver();
        ReflectionTestUtils.setField(resolver, "nodeRepository", nodes);

        questions = mock(QuestionRepository.class);
        when(questions.save(any())).thenAnswer(inv -> {
            Question q = inv.getArgument(0);
            q.setId("q-" + UUID.randomUUID());
            return q;
        });
        importManager = mock(AddQuestionPaperFromImportManager.class);
        when(importManager.makeQuestionAndOptionFromImportQuestion(any(), anyBoolean(), any())).thenAnswer(inv -> {
            QuestionDTO dto = inv.getArgument(0);
            if ("BROKEN".equals(dto.getQuestionType())) throw new IllegalArgumentException("No enum constant");
            Question q = new Question();
            q.setDifficulty(dto.getAiDifficultyLevel());
            q.setOptions(new ArrayList<>());
            return q;
        });
        curation = mock(QuestionLibraryCurationService.class);
        when(curation.resolveTagId(eq(OWNER), anyString())).thenAnswer(inv -> "tag-" + inv.getArgument(1));

        service = new QuestionLibraryImportService();
        ReflectionTestUtils.setField(service, "nodeRepository", nodes);
        ReflectionTestUtils.setField(service, "treeResolver", resolver);
        ReflectionTestUtils.setField(service, "curationService", curation);
        ReflectionTestUtils.setField(service, "questionRepository", questions);
        ReflectionTestUtils.setField(service, "optionRepository", mock(OptionRepository.class));
        ReflectionTestUtils.setField(service, "importManager", importManager);
    }

    private static QuestionDTO mcq() {
        QuestionDTO dto = new QuestionDTO();
        dto.setQuestionType("MCQS");
        return dto;
    }

    private static LibraryImportRequest.Item item(List<String> path, QuestionDTO q, String difficulty,
                                                  LibraryImportRequest.TagInput... tags) {
        return LibraryImportRequest.Item.builder().path(path).question(q).difficulty(difficulty).tags(List.of(tags)).build();
    }

    private static LibraryImportRequest.TagInput tag(String kind, String name) {
        return LibraryImportRequest.TagInput.builder().kind(kind).name(name).build();
    }

    @Test
    void aNewChapterNamedOnManyRowsIsCreatedOnceAndExistingTopicsAreReused() {
        LibraryImportResponse response = service.importQuestions(null, OWNER, LibraryImportRequest.builder().items(List.of(
                item(List.of("UPSC", "polity ", "Fundamental Rights"), mcq(), "hard"),
                item(List.of("upsc", "Polity", "fundamental rights"), mcq(), null),
                item(List.of("UPSC"), mcq(), "EASY"))).build());

        assertThat(response.getCreated()).isEqualTo(3);
        assertThat(response.getNodesCreated()).isEqualTo(1);
        assertThat(createdNodes).singleElement().satisfies(node -> {
            assertThat(node.getParentId()).isEqualTo("polity");
            assertThat(node.getName()).isEqualTo("Fundamental Rights");
        });
        verify(nodes).addQuestionsToNode(eq(OWNER), eq("new-fundamental-rights"), argThat(csv -> csv.split(",").length == 2));
        verify(nodes).addQuestionsToNode(eq(OWNER), eq("upsc"), anyString());
        verify(questions).flush();
    }

    @Test
    void anEmptyPathFilesUnderTheOpenTopic() {
        service.importQuestions(null, OWNER, LibraryImportRequest.builder().parentId("polity")
                .items(List.of(item(List.of(), mcq(), null))).build());

        verify(nodes).addQuestionsToNode(eq(OWNER), eq("polity"), anyString());
        verify(nodes, never()).save(any());
    }

    @Test
    void difficultyIsTheAskedOneElseTheQuestionsOwnElseMedium() {
        QuestionDTO aiHard = mcq();
        aiHard.setAiDifficultyLevel("hard");
        QuestionDTO unknown = mcq();
        unknown.setAiDifficultyLevel("tricky");

        service.importQuestions(null, OWNER, LibraryImportRequest.builder().parentId("polity").items(List.of(
                item(List.of(), mcq(), "Easy"), item(List.of(), aiHard, ""), item(List.of(), unknown, null))).build());

        ArgumentCaptor<Question> saved = ArgumentCaptor.forClass(Question.class);
        verify(questions, times(3)).save(saved.capture());
        assertThat(saved.getAllValues()).extracting(Question::getDifficulty).containsExactly("EASY", "HARD", "MEDIUM");
        assertThat(saved.getAllValues()).allMatch(q -> OWNER.equals(q.getInstituteId()));
    }

    @Test
    void oneBadRowIsReportedAndTheRestAreSaved() {
        QuestionDTO broken = new QuestionDTO();
        broken.setQuestionType("BROKEN");

        LibraryImportResponse response = service.importQuestions(null, OWNER, LibraryImportRequest.builder().items(List.of(
                item(List.of("UPSC", "Brand new topic"), broken, null),
                item(List.of("UPSC", "A", "B", "C", "D", "E"), mcq(), null),
                item(List.of("UPSC"), mcq(), "VERY_HARD"),
                item(List.of(), mcq(), null),
                item(List.of("UPSC"), mcq(), null))).build());

        assertThat(response.getCreated()).isEqualTo(1);
        assertThat(response.getErrors()).hasSize(4);
        assertThat(response.getErrors().get(0)).startsWith("Item 1:");
        assertThat(response.getErrors().get(1)).contains("levels deep");
        assertThat(response.getErrors().get(2)).contains("difficulty");
        assertThat(response.getErrors().get(3)).contains("choose a topic");
        // The broken row never created its new topic.
        assertThat(createdNodes).isEmpty();
    }

    @Test
    void tagsAreGroupedSoEachTagIsResolvedOnce() {
        service.importQuestions(null, OWNER, LibraryImportRequest.builder().parentId("polity").items(List.of(
                item(List.of(), mcq(), null, tag("concept", "Article 21"), tag("PYQ", "UPSC 2023")),
                item(List.of(), mcq(), null, tag("CONCEPT", "article 21"), tag("SOURCE", " "))))
                .build());

        verify(curation, times(1)).resolveTagId(OWNER, "Article 21");
        verify(nodes).addLibraryTag(eq(OWNER), argThat(csv -> csv.split(",").length == 2), eq("tag-Article 21"), eq("CONCEPT"));
        verify(nodes).addLibraryTag(eq(OWNER), argThat(csv -> !csv.contains(",")), eq("tag-UPSC 2023"), eq("PYQ"));
    }

    @Test
    void anEmptyOrUnknownParentIsRefused() {
        assertThatThrownBy(() -> service.importQuestions(null, OWNER, new LibraryImportRequest()))
                .isInstanceOf(VacademyException.class);
        assertThatThrownBy(() -> service.importQuestions(null, OWNER, LibraryImportRequest.builder()
                .parentId("elsewhere").items(List.of(item(List.of(), mcq(), null))).build()))
                .isInstanceOf(VacademyException.class).hasMessageContaining("Topic not found");
        verifyNoInteractions(questions);
    }
}
