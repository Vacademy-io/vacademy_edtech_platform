package vacademy.io.assessment_service.features.question_library.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.question_bank.manager.AddQuestionPaperFromImportManager;
import vacademy.io.assessment_service.features.question_core.dto.OptionDTO;
import vacademy.io.assessment_service.features.question_core.dto.QuestionDTO;
import vacademy.io.assessment_service.features.question_core.entity.Option;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.OptionRepository;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;
import vacademy.io.assessment_service.features.question_library.dto.LibraryQuestionEditResponse;
import vacademy.io.assessment_service.features.question_library.repository.QuestionLibraryNodeRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.*;

/**
 * Editing a question from the library without rewriting history.
 * <p>
 * An assessment links to the question row itself (question_assessment_section_mapping
 * holds the question id, nothing is copied). So a plain in-place edit of a question that
 * a test already used would change that test after the fact: its report, its answer key
 * and every student's result. From the library that is never what the teacher means - they
 * are improving the question for next time.
 * <p>
 * So: a question no assessment uses is edited in place, exactly like the paper editor does.
 * A question an assessment uses is saved as a NEW question. The new one takes over the
 * old one's topics and tags, the old one is recorded in question_library_version and
 * disappears from the library and the pickers, and every existing test keeps the old one.
 * <p>
 * Editing from a question paper or from the assessment screen is unchanged (in place) -
 * there, fixing a typo in a live test is the point.
 */
@Slf4j
@Service
public class QuestionLibraryEditService {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Autowired
    private QuestionRepository questionRepository;

    @Autowired
    private OptionRepository optionRepository;

    @Autowired
    private AddQuestionPaperFromImportManager importManager;

    @Autowired
    private QuestionLibraryNodeRepository nodeRepository;

    @Transactional
    public LibraryQuestionEditResponse edit(CustomUserDetails user, String instituteId, QuestionDTO edited) {
        if (edited == null || edited.getId() == null || edited.getId().isBlank()) {
            throw new VacademyException("Question id is required");
        }
        String oldId = edited.getId();
        Question old = questionRepository.findById(oldId)
                .filter(q -> instituteId.equals(q.getInstituteId()))
                .filter(q -> "ACTIVE".equals(q.getStatus()))
                .orElseThrow(() -> new VacademyException("Question not found in this library"));
        if (nodeRepository.countReplacedVersions(oldId) > 0) {
            throw new VacademyException("This question was already replaced by a newer version. Refresh and edit that one.");
        }

        long usedBy = 0;
        for (Object[] row : nodeRepository.countAssessmentsUsingQuestions(oldId)) {
            usedBy = ((Number) row[1]).longValue();
        }

        try {
            if (usedBy == 0) {
                importManager.updateQuestionsInPlace(List.of(edited), instituteId);
                return LibraryQuestionEditResponse.builder()
                        .questionId(oldId)
                        .versioned(false)
                        .assessmentCount(0L)
                        .build();
            }
            Question saved = saveAsNewVersion(instituteId, old, edited);
            nodeRepository.copyNonSubjectTags(oldId, saved.getId());
            importManager.addQuestionEntityTags(List.of(saved), List.of(edited), instituteId);
            nodeRepository.copyPlacements(instituteId, oldId, saved.getId());
            nodeRepository.removeQuestionsFromNodes(instituteId, oldId, null);
            nodeRepository.recordVersion(oldId, saved.getId(), instituteId, user == null ? null : user.getUserId());
            log.info("Question library edit saved as new version: old={}, new={}, usedByAssessments={}",
                    oldId, saved.getId(), usedBy);
            return LibraryQuestionEditResponse.builder()
                    .questionId(saved.getId())
                    .versioned(true)
                    .previousQuestionId(oldId)
                    .assessmentCount(usedBy)
                    .build();
        } catch (JsonProcessingException e) {
            throw new VacademyException("Could not save the question: " + e.getMessage());
        }
    }

    private Question saveAsNewVersion(String instituteId, Question old, QuestionDTO edited) throws JsonProcessingException {
        detachFromOldRows(edited);
        Question copy = importManager.makeQuestionAndOptionFromImportQuestion(edited, false, null);
        copy.setInstituteId(instituteId);
        // What the editor does not send, carried over so the new version is the same
        // question in every respect but the edit.
        if (copy.getSourceType() == null) copy.setSourceType(old.getSourceType());
        if (copy.getSourceMeta() == null) copy.setSourceMeta(old.getSourceMeta());
        if (copy.getProblemType() == null) copy.setProblemType(old.getProblemType());
        if (copy.getDifficulty() == null) copy.setDifficulty(old.getDifficulty());
        if (copy.getDefaultQuestionTimeMins() == null) copy.setDefaultQuestionTimeMins(old.getDefaultQuestionTimeMins());
        if (copy.getEvaluationCriteriaJson() == null) copy.setEvaluationCriteriaJson(old.getEvaluationCriteriaJson());
        if (copy.getCriteriaTemplateId() == null) copy.setCriteriaTemplateId(old.getCriteriaTemplateId());
        if (copy.getMediaId() == null) copy.setMediaId(old.getMediaId());

        // Same order as addPrivateQuestions: the question first, then its options, which
        // point at it (the collection is the inverse side and does not cascade).
        List<Option> options = new ArrayList<>(copy.getOptions() == null ? List.of() : copy.getOptions());
        Question saved = questionRepository.save(copy);
        if (!options.isEmpty()) optionRepository.saveAll(options);
        return saved;
    }

    /**
     * Clears every id in the edit that points at a row of the OLD question.
     * <p>
     * Left in place they would be reused: createOptions loads an option by id and
     * re-parents it onto the new question (taking it away from the old one, which tests
     * still use), and a rich-text id would make both questions share - and overwrite - one
     * text row. Options keep their old id as preview_id when the answer key names them by
     * id, because the answer key is matched on preview_id once the id is gone.
     */
    static void detachFromOldRows(QuestionDTO edited) {
        Set<String> correctMarkers = correctOptionMarkers(edited.getAutoEvaluationJson());
        edited.setId(null);
        if (edited.getText() != null) edited.getText().setId(null);
        if (edited.getExplanationText() != null) edited.getExplanationText().setId(null);
        if (edited.getParentRichText() != null) edited.getParentRichText().setId(null);
        edited.setParentRichTextId(null);
        if (edited.getOptions() == null) return;
        for (OptionDTO option : edited.getOptions()) {
            if (option.getId() != null && correctMarkers.contains(option.getId())) {
                option.setPreviewId(option.getId());
            }
            option.setId(null);
            option.setQuestionId(null);
            if (option.getText() != null) option.getText().setId(null);
            if (option.getExplanationText() != null) option.getExplanationText().setId(null);
        }
    }

    private static Set<String> correctOptionMarkers(String autoEvaluationJson) {
        Set<String> markers = new HashSet<>();
        if (autoEvaluationJson == null || autoEvaluationJson.isBlank()) return markers;
        try {
            JsonNode ids = MAPPER.readTree(autoEvaluationJson).path("data").path("correctOptionIds");
            if (ids.isArray()) ids.forEach(id -> markers.add(id.asText()));
        } catch (JsonProcessingException e) {
            // Not an MCQ key (or malformed): no option needs its marker kept.
        }
        return markers;
    }
}
