package vacademy.io.assessment_service.features.question_bank.manager;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.question_bank.dto.QuestionBankFilter;
import vacademy.io.assessment_service.features.question_core.dto.QuestionDTO;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;
import vacademy.io.assessment_service.features.question_library.service.QuestionLibraryTreeResolver;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

/**
 * Browsing individual questions in an institute's bank.
 * <p>
 * The paper-level equivalent is {@link GetQuestionPaperManager}. This exists so a
 * question generated once — from a knowledge base, an upload, or by hand — can be found
 * and reused later instead of being generated again.
 */
@Component
public class GetQuestionBankManager {

    @Autowired
    private QuestionRepository questionRepository;

    @Autowired
    private QuestionLibraryTreeResolver libraryTreeResolver;

    public Page<QuestionDTO> getQuestions(CustomUserDetails user, QuestionBankFilter filter,
                                          String instituteId, int pageNo, int pageSize) {
        return getQuestions(user, filter, instituteId, pageNo, pageSize, true);
    }

    /**
     * Same as above. With expandLibraryNodes false the library topics are used exactly as
     * given: the caller already added the topics below them it is allowed to read (the
     * Content Library can hide a topic inside one an institute still sees).
     */
    public Page<QuestionDTO> getQuestions(CustomUserDetails user, QuestionBankFilter filter,
                                          String instituteId, int pageNo, int pageSize,
                                          boolean expandLibraryNodes) {
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException("instituteId is required");
        }
        QuestionBankFilter safeFilter = filter == null ? new QuestionBankFilter() : filter;

        Pageable pageable = PageRequest.of(pageNo, pageSize, Sort.by(Sort.Direction.DESC, "created_at"));

        // A library topic matches the questions of every topic below it too. When every
        // asked-for topic is gone (deleted in another tab), nothing can match - return an
        // empty page rather than dropping the filter and showing the whole bank.
        String libraryNodeIdsCsv = null;
        if (safeFilter.getLibraryNodeIds() != null && !safeFilter.getLibraryNodeIds().isEmpty()) {
            List<String> expanded = expandLibraryNodes
                    ? libraryTreeResolver.withDescendants(instituteId, safeFilter.getLibraryNodeIds())
                    : safeFilter.getLibraryNodeIds();
            if (expanded.isEmpty()) return Page.empty(pageable);
            libraryNodeIdsCsv = QuestionFilterParams.toCsv(expanded);
        }
        QuestionFilterParams p = QuestionFilterParams.of(instituteId, safeFilter, libraryNodeIdsCsv);

        Page<Question> questions = questionRepository.findQuestionsByFilters(
                p.instituteId(),
                p.name(),
                p.statusesCsv(),
                p.questionTypesCsv(),
                p.difficultiesCsv(),
                p.sourceTypesCsv(),
                p.excludeQuestionIdsCsv(),
                p.kbIdsCsv(),
                p.kbNodeIdsCsv(),
                p.tagIdsCsv(),
                p.tagGroupsCsv(),
                p.libraryNodeIdsCsv(),
                p.unsortedFlag(),
                pageable
        );

        // provideSolution = true: this feeds a picker where the admin is deciding
        // whether a question is worth adding, and that judgement needs the answer.
        return questions.map(question -> new QuestionDTO(question, true));
    }
}
