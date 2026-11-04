package vacademy.io.assessment_service.features.question_library.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.question_bank.manager.AddQuestionPaperFromImportManager;
import vacademy.io.assessment_service.features.question_bank.manager.GetQuestionPaperManager;
import vacademy.io.assessment_service.features.question_core.dto.OptionDTO;
import vacademy.io.assessment_service.features.question_core.dto.QuestionDTO;
import vacademy.io.assessment_service.features.question_core.entity.Option;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.OptionRepository;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;
import vacademy.io.assessment_service.features.question_library.dto.CopyLibraryQuestionsRequest;
import vacademy.io.assessment_service.features.question_library.dto.LibraryCopyResponse;
import vacademy.io.assessment_service.features.question_library.repository.QuestionLibraryNodeRepository;
import vacademy.io.assessment_service.features.rich_text.entity.AssessmentRichTextData;
import vacademy.io.common.exceptions.VacademyException;

import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Taking questions out of the library into a test.
 * <p>
 * An assessment links to a question row and editing it there rewrites that row, so a test
 * must never link to a library row: one institute's edit would change the library and
 * every other institute's test. Every pick therefore makes a new row owned by the caller.
 * A pick is one copy for one test, so two tests never share a copy.
 * <p>
 * Copies are marked with {@link #SOURCE_TYPE}. The bank query leaves them out, because the
 * question bank shows only what the institute itself added.
 */
@Slf4j
@Service
public class QuestionLibraryCopyService {

    /** question.source_type of a copy. QuestionRepository and the library counts filter on it. */
    public static final String SOURCE_TYPE = "LIBRARY_COPY";

    private static final int MAX_QUESTIONS_PER_CALL = 500;
    /** A question edited this many times between two picks would be unusual; it only bounds the walk. */
    private static final int MAX_VERSION_HOPS = 20;
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Autowired
    private QuestionLibraryAccess access;

    @Autowired
    private QuestionLibraryNodeRepository nodeRepository;

    @Autowired
    private QuestionRepository questionRepository;

    @Autowired
    private OptionRepository optionRepository;

    @Autowired
    private AddQuestionPaperFromImportManager importManager;

    @Autowired
    private GetQuestionPaperManager questionPaperManager;

    @Transactional
    public LibraryCopyResponse copy(String instituteId, CopyLibraryQuestionsRequest request) {
        String owner = access.ownerInstituteId();
        if (owner == null) throw new VacademyException("The Question Library is not available");
        if (request == null) throw new VacademyException("Choose questions or a paper to add");

        List<Question> sources = sourcesOf(owner, request);
        if (sources.isEmpty()) {
            throw new VacademyException("These questions are no longer in the Question Library");
        }
        if (sources.size() > MAX_QUESTIONS_PER_CALL) {
            throw new VacademyException("Add at most " + MAX_QUESTIONS_PER_CALL + " questions at a time");
        }

        Set<String> inSection = sourcesAlreadyCopied(request.getExcludeQuestionIds());
        List<Question> toCopy = sources.stream().filter(q -> !inSection.contains(q.getId())).toList();
        int alreadyInSection = sources.size() - toCopy.size();

        List<QuestionDTO> sourceDtos = toCopy.stream().map(q -> new QuestionDTO(q, true)).toList();
        questionPaperManager.attachSubjectTags(sourceDtos);

        List<LibraryCopyResponse.CopiedQuestion> copied = new ArrayList<>();
        List<Question> savedCopies = new ArrayList<>();
        List<QuestionDTO> savedDtos = new ArrayList<>();
        int failed = 0;
        for (int i = 0; i < toCopy.size(); i++) {
            Question source = toCopy.get(i);
            QuestionDTO dto = sourceDtos.get(i);
            Question copy;
            try {
                copy = buildCopy(instituteId, source, dto);
            } catch (JsonProcessingException | RuntimeException e) {
                // Nothing is saved at this point. One unusable question must not cost the
                // teacher the other forty in a paper; the response reports how many failed.
                log.warn("Could not copy library question {}: {}", source.getId(), e.getMessage());
                failed++;
                continue;
            }
            List<Option> options = new ArrayList<>(copy.getOptions() == null ? List.of() : copy.getOptions());
            Question saved = questionRepository.save(copy);
            if (!options.isEmpty()) optionRepository.saveAll(options);
            savedCopies.add(saved);
            savedDtos.add(dto);
            copied.add(LibraryCopyResponse.CopiedQuestion.builder()
                    .sourceQuestionId(source.getId())
                    .questionId(saved.getId())
                    .questionType(saved.getQuestionType())
                    .text(source.getTextData() == null ? null : source.getTextData().getContent())
                    .build());
        }
        // Tags resolve by name inside the caller's institute, so the copy never points at
        // the owner's tag rows. The two lists are in lockstep, and the DTO ids are gone.
        importManager.addQuestionEntityTags(savedCopies, savedDtos, instituteId);

        return LibraryCopyResponse.builder()
                .copied(copied)
                .alreadyInSection(alreadyInSection)
                .failed(failed)
                .build();
    }

    private Question buildCopy(String instituteId, Question source, QuestionDTO dto) throws JsonProcessingException {
        QuestionLibraryEditService.detachFromOldRows(dto);
        dto.setSourceType(SOURCE_TYPE);
        dto.setSourceMeta(MAPPER.writeValueAsString(Map.of("library_question_id", source.getId())));
        Question copy = importManager.makeQuestionAndOptionFromImportQuestion(dto, false, null);
        copy.setInstituteId(instituteId);
        if (copy.getDefaultQuestionTimeMins() == null) copy.setDefaultQuestionTimeMins(source.getDefaultQuestionTimeMins());
        if (copy.getCriteriaTemplateId() == null) copy.setCriteriaTemplateId(source.getCriteriaTemplateId());
        return copy;
    }

    /** A copy to edit, for a test that has not been saved yet or has not picked it up since. */
    @Transactional
    public QuestionDTO getCopy(String instituteId, String questionId) {
        QuestionDTO dto = new QuestionDTO(requireCopy(instituteId, questionId), true);
        // Without these the editor sends an empty list back and the save wipes the tags.
        questionPaperManager.attachSubjectTags(List.of(dto));
        return dto;
    }

    /**
     * Saves an edit to one of the caller's copies. The check is on the row: a library row
     * is never a copy, so nothing that goes through here can reach the library.
     */
    @Transactional
    public Boolean editCopy(String instituteId, QuestionDTO edited) {
        if (edited == null) throw new VacademyException("Question is required");
        Question copy = requireCopy(instituteId, edited.getId());
        pinToOwnRows(copy, edited);
        // The editor sends neither. Left alone the DTO default would reset the difficulty.
        edited.setSourceType(null);
        edited.setSourceMeta(null);
        if (copy.getDifficulty() != null) edited.setAiDifficultyLevel(copy.getDifficulty());
        try {
            importManager.updateQuestionsInPlace(List.of(edited), instituteId);
        } catch (JsonProcessingException e) {
            throw new VacademyException("Could not save the question: " + e.getMessage());
        }
        return true;
    }

    /**
     * Makes every row id in an edit point at the copy's own rows. The save writes to whatever
     * ids it is given, and a reader can see the library's text and option ids, so a request
     * carrying one must not be able to overwrite that row or take that option away.
     */
    public static void pinToOwnRows(Question own, QuestionDTO edited) {
        if (edited.getText() != null) edited.getText().setId(idOf(own.getTextData()));
        if (edited.getExplanationText() != null) edited.getExplanationText().setId(idOf(own.getExplanationTextData()));
        if (edited.getParentRichText() != null) edited.getParentRichText().setId(idOf(own.getParentRichText()));
        edited.setParentRichTextId(idOf(own.getParentRichText()));
        if (edited.getOptions() == null) return;
        Map<String, Option> ownOptions = new HashMap<>();
        if (own.getOptions() != null) own.getOptions().forEach(option -> ownOptions.put(option.getId(), option));
        for (OptionDTO option : edited.getOptions()) {
            Option mine = option.getId() == null ? null : ownOptions.get(option.getId());
            if (option.getId() != null && mine == null) {
                throw new VacademyException("This edit names an option of another question. Reopen the question and try again.");
            }
            if (option.getText() != null) option.getText().setId(mine == null ? null : idOf(mine.getText()));
            if (option.getExplanationText() != null) {
                option.getExplanationText().setId(mine == null ? null : idOf(mine.getExplanationTextData()));
            }
        }
    }

    private static String idOf(AssessmentRichTextData row) {
        return row == null ? null : row.getId();
    }

    private Question requireCopy(String instituteId, String questionId) {
        if (questionId == null || questionId.isBlank()) throw new VacademyException("Question id is required");
        return questionRepository.findById(questionId)
                .filter(q -> instituteId.equals(q.getInstituteId()))
                .filter(q -> SOURCE_TYPE.equals(q.getSourceType()))
                .filter(q -> "ACTIVE".equals(q.getStatus()))
                .orElseThrow(() -> new VacademyException("Question not found"));
    }

    /**
     * The library rows the request names, in order. Anything not actually offered by the
     * library is dropped, so a guessed id cannot read the owner's other questions.
     */
    private List<Question> sourcesOf(String owner, CopyLibraryQuestionsRequest request) {
        String paperId = request.getQuestionPaperId();
        if (paperId != null && !paperId.isBlank()) {
            if (nodeRepository.countPaperInLibrary(owner, paperId) == 0) {
                throw new VacademyException("This paper is no longer in the Question Library");
            }
            List<String> ids = questionRepository.findQuestionsByQuestionPaperId(paperId).stream()
                    .map(Question::getId)
                    .toList();
            return liveQuestionsInOrder(owner, latestVersions(owner, ids));
        }
        List<String> ids = request.getQuestionIds() == null ? List.of() : request.getQuestionIds().stream()
                .filter(id -> id != null && !id.isBlank() && !id.contains(","))
                .distinct()
                .toList();
        if (ids.isEmpty()) throw new VacademyException("Choose questions or a paper to add");
        if (ids.size() > MAX_QUESTIONS_PER_CALL) {
            throw new VacademyException("Add at most " + MAX_QUESTIONS_PER_CALL + " questions at a time");
        }
        Set<String> placed = new HashSet<>(nodeRepository.findPlacedLiveQuestionIds(owner, String.join(",", ids)));
        return liveQuestionsInOrder(owner, ids.stream().filter(placed::contains).toList());
    }

    /** A paper keeps pointing at the row it was saved with; a library edit may have replaced that row. */
    private List<String> latestVersions(String owner, List<String> ids) {
        if (ids.isEmpty()) return ids;
        Map<String, String> next = new HashMap<>();
        List<String> frontier = ids;
        for (int hop = 0; hop < MAX_VERSION_HOPS && !frontier.isEmpty(); hop++) {
            List<String> found = new ArrayList<>();
            for (Object[] row : nodeRepository.findNewerVersions(owner, String.join(",", frontier))) {
                if (next.putIfAbsent((String) row[0], (String) row[1]) == null) found.add((String) row[1]);
            }
            frontier = found;
        }
        return ids.stream().map(id -> {
            String current = id;
            for (int hop = 0; hop < MAX_VERSION_HOPS && next.containsKey(current); hop++) current = next.get(current);
            return current;
        }).distinct().toList();
    }

    private List<Question> liveQuestionsInOrder(String owner, List<String> ids) {
        if (ids.isEmpty()) return List.of();
        Map<String, Question> byId = questionRepository.findAllById(ids).stream()
                .filter(q -> owner.equals(q.getInstituteId()) && "ACTIVE".equals(q.getStatus()))
                .collect(Collectors.toMap(Question::getId, Function.identity()));
        return ids.stream().map(byId::get).filter(Objects::nonNull).toList();
    }

    private Set<String> sourcesAlreadyCopied(List<String> questionIdsInSection) {
        if (questionIdsInSection == null || questionIdsInSection.isEmpty()) return Set.of();
        String csv = questionIdsInSection.stream()
                .filter(id -> id != null && !id.isBlank() && !id.contains(","))
                .collect(Collectors.joining(","));
        return csv.isEmpty() ? Set.of() : new HashSet<>(nodeRepository.findLibrarySourcesOfCopies(csv));
    }
}
