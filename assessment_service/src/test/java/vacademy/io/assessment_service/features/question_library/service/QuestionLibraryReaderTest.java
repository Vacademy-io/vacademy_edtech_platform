package vacademy.io.assessment_service.features.question_library.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.question_bank.dto.QuestionBankFilter;
import vacademy.io.assessment_service.features.question_bank.manager.GetQuestionBankManager;
import vacademy.io.assessment_service.features.question_bank.manager.GetQuestionPaperManager;
import vacademy.io.assessment_service.features.question_core.dto.QuestionDTO;
import vacademy.io.assessment_service.features.question_library.dto.LibraryQuestionDto;
import vacademy.io.assessment_service.features.question_library.dto.LibraryTreeResponse;
import vacademy.io.assessment_service.features.question_library.entity.QuestionLibraryNode;
import vacademy.io.assessment_service.features.question_library.repository.QuestionLibraryNodeRepository;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** One library for everyone: what the owner institute sees, and what the others see. */
class QuestionLibraryReaderTest {

    private static final String OWNER = "owner-inst";
    private static final String CLIENT = "client-inst";

    private QuestionLibraryAccess access;
    private QuestionLibraryNodeRepository repository;
    private GetQuestionBankManager bank;
    private QuestionLibraryService service;

    private static QuestionLibraryNode node(String id) {
        return QuestionLibraryNode.builder().id(id).name(id).instituteId(OWNER).status("ACTIVE").displayOrder(0).build();
    }

    @BeforeEach
    void setUp() {
        access = new QuestionLibraryAccess();
        ReflectionTestUtils.setField(access, "ownerInstituteId", OWNER);
        repository = mock(QuestionLibraryNodeRepository.class);
        when(repository.findByInstituteIdAndStatusOrderByDisplayOrderAscCreatedAtAsc(OWNER, "ACTIVE"))
                .thenReturn(List.of(node("physics"), node("chemistry")));
        QuestionLibraryTreeResolver resolver = new QuestionLibraryTreeResolver();
        ReflectionTestUtils.setField(resolver, "nodeRepository", repository);
        bank = mock(GetQuestionBankManager.class);
        service = new QuestionLibraryService();
        ReflectionTestUtils.setField(service, "access", access);
        ReflectionTestUtils.setField(service, "nodeRepository", repository);
        ReflectionTestUtils.setField(service, "treeResolver", resolver);
        ReflectionTestUtils.setField(service, "questionBankManager", bank);
        ReflectionTestUtils.setField(service, "questionPaperManager", mock(GetQuestionPaperManager.class));
    }

    private static QuestionDTO ownerQuestion() {
        QuestionDTO dto = new QuestionDTO();
        dto.setId("lib-q");
        dto.setInstituteId(OWNER);
        dto.setSourceType("KNOWLEDGE_BASE");
        dto.setSourceMeta("{\"kb_id\":\"kb-1\"}");
        return dto;
    }

    private QuestionBankFilter filterSentToTheBank() {
        ArgumentCaptor<QuestionBankFilter> filter = ArgumentCaptor.forClass(QuestionBankFilter.class);
        verify(bank).getQuestions(any(), filter.capture(), eq(OWNER), anyInt(), anyInt());
        return filter.getValue();
    }

    @Test
    void aReaderOnlyEverSeesQuestionsPlacedOnATopic() {
        when(bank.getQuestions(any(), any(), eq(OWNER), anyInt(), anyInt())).thenReturn(Page.empty());
        QuestionBankFilter asked = new QuestionBankFilter();
        asked.setUnsortedOnly(true);
        asked.setStatuses(List.of("DELETED"));
        asked.setKbIds(List.of("kb-1"));

        service.listQuestions(null, CLIENT, asked, 0, 20);

        QuestionBankFilter sent = filterSentToTheBank();
        assertThat(sent.getLibraryNodeIds()).containsExactly("physics", "chemistry");
        assertThat(sent.getUnsortedOnly()).isNull();
        assertThat(sent.getStatuses()).isEmpty();
        assertThat(sent.getKbIds()).isEmpty();
    }

    @Test
    void withNoTopicsAReaderGetsNothingAndNotTheOwnersWholeBank() {
        when(repository.findByInstituteIdAndStatusOrderByDisplayOrderAscCreatedAtAsc(OWNER, "ACTIVE")).thenReturn(List.of());

        Page<LibraryQuestionDto> page = service.listQuestions(null, CLIENT, null, 0, 20);

        assertThat(page.getContent()).isEmpty();
        verifyNoInteractions(bank);
    }

    @Test
    void theOwnerKeepsItsFullFilterIncludingUnsorted() {
        when(bank.getQuestions(any(), any(), eq(OWNER), anyInt(), anyInt())).thenReturn(Page.empty());
        QuestionBankFilter asked = new QuestionBankFilter();
        asked.setUnsortedOnly(true);

        service.listQuestions(null, OWNER, asked, 0, 20);

        assertThat(filterSentToTheBank()).isSameAs(asked);
    }

    @Test
    void aReaderDoesNotSeeTheOwnersProvenanceOrUsage() {
        when(bank.getQuestions(any(), any(), eq(OWNER), anyInt(), anyInt()))
                .thenReturn(new PageImpl<>(new ArrayList<>(List.of(ownerQuestion()))));

        Page<LibraryQuestionDto> page = service.listQuestions(null, CLIENT, null, 0, 20);

        QuestionDTO question = page.getContent().get(0).getQuestion();
        assertThat(question.getInstituteId()).isNull();
        assertThat(question.getSourceType()).isNull();
        assertThat(question.getSourceMeta()).isNull();
        assertThat(page.getContent().get(0).getAssessmentCount()).isZero();
        verify(repository, never()).countAssessmentsUsingQuestions(any());
    }

    @Test
    void aSectionsCopiesHideTheLibraryQuestionsTheyCameFrom() {
        when(bank.getQuestions(any(), any(), eq(OWNER), anyInt(), anyInt())).thenReturn(Page.empty());
        when(repository.findLibrarySourcesOfCopies("copy-1,own-q")).thenReturn(List.of("lib-q"));
        QuestionBankFilter asked = new QuestionBankFilter();
        asked.setExcludeQuestionIds(List.of("copy-1", "own-q"));

        service.listQuestions(null, CLIENT, asked, 0, 20);

        assertThat(filterSentToTheBank().getExcludeQuestionIds()).containsExactly("lib-q");
    }

    @Test
    void treeTellsTheClientWhetherItMayManage() {
        when(repository.countPlacedQuestionsByDifficultyAndType(OWNER)).thenReturn(List.of());
        when(repository.countLiveQuestionsByDifficultyAndType(OWNER)).thenReturn(List.of());
        when(repository.countQuestionsPerNode(OWNER)).thenReturn(List.of());

        LibraryTreeResponse forClient = service.getTree(CLIENT);
        LibraryTreeResponse forOwner = service.getTree(OWNER);

        assertThat(forClient.getCanManage()).isFalse();
        assertThat(forClient.getNodes()).hasSize(2);
        assertThat(forClient.getSummary().getUnsortedQuestions()).isZero();
        assertThat(forOwner.getCanManage()).isTrue();
        verify(repository, times(1)).countUnsortedQuestions(OWNER);
    }

    @Test
    void withNoOwnerConfiguredTheLibraryIsEmptyAndClosed() {
        ReflectionTestUtils.setField(access, "ownerInstituteId", " ");

        LibraryTreeResponse tree = service.getTree(CLIENT);

        assertThat(tree.getNodes()).isEmpty();
        assertThat(tree.getCanManage()).isFalse();
        assertThat(service.listPapers(null)).isEmpty();
        assertThat(service.listQuestions(null, CLIENT, null, 0, 20).getContent()).isEmpty();
        assertThatThrownBy(() -> access.requireOwner(CLIENT)).isInstanceOf(ForbiddenException.class);
    }

    @Test
    void onlyTheOwnerPassesTheManagerCheck() {
        access.requireOwner(OWNER);
        assertThatThrownBy(() -> access.requireOwner(CLIENT)).isInstanceOf(ForbiddenException.class);
    }

    @Test
    void aPaperOnTwoTopicsIsListedOnce() {
        List<Object[]> rows = new ArrayList<>();
        rows.add(new Object[]{"physics", "paper-1", "SSC Mock 1", 40L});
        rows.add(new Object[]{"chemistry", "paper-1", "SSC Mock 1", 40L});
        when(repository.findPapersOnNodes(OWNER, null)).thenReturn(rows);

        assertThat(service.listPapers(null)).hasSize(1);
    }
}
