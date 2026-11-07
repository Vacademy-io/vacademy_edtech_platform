package vacademy.io.assessment_service.features.question_library.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.question_bank.manager.AddQuestionPaperFromImportManager;
import vacademy.io.assessment_service.features.question_core.dto.OptionDTO;
import vacademy.io.assessment_service.features.question_core.dto.QuestionDTO;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.OptionRepository;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;
import vacademy.io.assessment_service.features.question_library.dto.LibraryQuestionEditResponse;
import vacademy.io.assessment_service.features.question_library.repository.QuestionLibraryNodeRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class QuestionLibraryEditServiceTest {

    private static final String INSTITUTE = "inst-1";

    /** What the admin editor sends for an edited MCQ: real option ids, preview_id = option id, key by id. */
    private static final String EDITED_MCQ = """
            {
              "id": "old-q",
              "question_type": "MCQS",
              "text": {"id": "txt-1", "type": "HTML", "content": "<p>2 + 2 = ?</p>"},
              "explanation_text": {"id": "exp-1", "type": "HTML", "content": "<p>Add them</p>"},
              "auto_evaluation_json": "{\\"type\\":\\"MCQS\\",\\"data\\":{\\"correctOptionIds\\":[\\"opt-b\\"]}}",
              "options": [
                {"id": "opt-a", "preview_id": "opt-a", "question_id": "old-q", "text": {"id": "ot-a", "content": "3"}},
                {"id": "opt-b", "preview_id": null, "question_id": "old-q", "text": {"id": "ot-b", "content": "4"}}
              ]
            }
            """;

    private QuestionRepository questionRepository;
    private OptionRepository optionRepository;
    private AddQuestionPaperFromImportManager importManager;
    private QuestionLibraryNodeRepository nodeRepository;
    private QuestionLibraryEditService service;

    @BeforeEach
    void setUp() {
        questionRepository = mock(QuestionRepository.class);
        optionRepository = mock(OptionRepository.class);
        importManager = mock(AddQuestionPaperFromImportManager.class);
        nodeRepository = mock(QuestionLibraryNodeRepository.class);
        service = new QuestionLibraryEditService();
        ReflectionTestUtils.setField(service, "questionRepository", questionRepository);
        ReflectionTestUtils.setField(service, "optionRepository", optionRepository);
        ReflectionTestUtils.setField(service, "importManager", importManager);
        ReflectionTestUtils.setField(service, "nodeRepository", nodeRepository);
    }

    private static QuestionDTO editedMcq() throws Exception {
        return new ObjectMapper().readValue(EDITED_MCQ, QuestionDTO.class);
    }

    private static Question liveQuestion(String instituteId) {
        Question q = new Question("old-q");
        q.setInstituteId(instituteId);
        q.setStatus("ACTIVE");
        q.setDifficulty("HARD");
        q.setSourceType("KNOWLEDGE_BASE");
        q.setSourceMeta("{\"kb_id\":\"kb-1\"}");
        return q;
    }

    private static CustomUserDetails user() {
        CustomUserDetails user = mock(CustomUserDetails.class);
        when(user.getUserId()).thenReturn("user-1");
        return user;
    }

    @Test
    void detachClearsEveryOldRowIdAndKeepsTheAnswerKeyMatchable() throws Exception {
        QuestionDTO dto = editedMcq();

        QuestionLibraryEditService.detachFromOldRows(dto);

        assertThat(dto.getId()).isNull();
        assertThat(dto.getText().getId()).isNull();
        assertThat(dto.getExplanationText().getId()).isNull();
        for (OptionDTO option : dto.getOptions()) {
            assertThat(option.getId()).isNull();
            assertThat(option.getQuestionId()).isNull();
            assertThat(option.getText().getId()).isNull();
        }
        // The key names opt-b by id. With the id gone, createOptions can only match it
        // through preview_id - so the correct option must carry its old id there.
        assertThat(dto.getOptions().get(1).getPreviewId()).isEqualTo("opt-b");
        assertThat(dto.getOptions().get(0).getPreviewId()).isEqualTo("opt-a");
    }

    @Test
    void unusedQuestionIsEditedInPlace() throws Exception {
        when(questionRepository.findById("old-q")).thenReturn(Optional.of(liveQuestion(INSTITUTE)));
        when(nodeRepository.countAssessmentsUsingQuestions("old-q")).thenReturn(List.of());

        LibraryQuestionEditResponse response = service.edit(user(), INSTITUTE, editedMcq());

        assertThat(response.getVersioned()).isFalse();
        assertThat(response.getQuestionId()).isEqualTo("old-q");
        verify(importManager).updateQuestionsInPlace(anyList(), eq(INSTITUTE));
        verify(questionRepository, never()).save(any());
        verify(nodeRepository, never()).recordVersion(any(), any(), any(), any());
    }

    @Test
    void questionUsedByAnAssessmentIsSavedAsANewVersion() throws Exception {
        when(questionRepository.findById("old-q")).thenReturn(Optional.of(liveQuestion(INSTITUTE)));
        List<Object[]> usage = new ArrayList<>();
        usage.add(new Object[]{"old-q", 2L});
        when(nodeRepository.countAssessmentsUsingQuestions("old-q")).thenReturn(usage);
        Question fresh = new Question();
        fresh.setOptions(new ArrayList<>());
        when(importManager.makeQuestionAndOptionFromImportQuestion(any(), eq(false), isNull())).thenReturn(fresh);
        when(questionRepository.save(any())).thenAnswer(inv -> {
            Question q = inv.getArgument(0);
            q.setId("new-q");
            return q;
        });

        LibraryQuestionEditResponse response = service.edit(user(), INSTITUTE, editedMcq());

        assertThat(response.getVersioned()).isTrue();
        assertThat(response.getQuestionId()).isEqualTo("new-q");
        assertThat(response.getPreviousQuestionId()).isEqualTo("old-q");
        assertThat(response.getAssessmentCount()).isEqualTo(2L);
        // Never touches the old row the tests point at.
        verify(importManager, never()).updateQuestionsInPlace(anyList(), any());
        // The new version inherits what the editor does not send.
        assertThat(fresh.getInstituteId()).isEqualTo(INSTITUTE);
        assertThat(fresh.getDifficulty()).isEqualTo("HARD");
        assertThat(fresh.getSourceType()).isEqualTo("KNOWLEDGE_BASE");
        assertThat(fresh.getSourceMeta()).isEqualTo("{\"kb_id\":\"kb-1\"}");
        // Topics move over, the old one is hidden.
        verify(nodeRepository).copyNonSubjectTags("old-q", "new-q");
        verify(nodeRepository).copyPlacements(INSTITUTE, "old-q", "new-q");
        verify(nodeRepository).removeQuestionsFromNodes(INSTITUTE, "old-q", null);
        verify(nodeRepository).recordVersion("old-q", "new-q", INSTITUTE, "user-1");
    }

    @Test
    void questionOfAnotherInstituteIsRefused() throws Exception {
        when(questionRepository.findById("old-q")).thenReturn(Optional.of(liveQuestion("someone-else")));

        assertThatThrownBy(() -> service.edit(user(), INSTITUTE, editedMcq()))
                .isInstanceOf(VacademyException.class);
        verifyNoInteractions(importManager);
    }

    @Test
    void alreadyReplacedQuestionIsRefused() throws Exception {
        when(questionRepository.findById("old-q")).thenReturn(Optional.of(liveQuestion(INSTITUTE)));
        when(nodeRepository.countReplacedVersions("old-q")).thenReturn(1L);

        assertThatThrownBy(() -> service.edit(user(), INSTITUTE, editedMcq()))
                .isInstanceOf(VacademyException.class)
                .hasMessageContaining("newer version");
        verifyNoInteractions(importManager);
    }
}
