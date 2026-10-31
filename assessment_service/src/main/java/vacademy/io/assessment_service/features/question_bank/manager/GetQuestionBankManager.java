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

    /** Questions with no explicit status filter are ACTIVE ones. */
    private static final List<String> DEFAULT_STATUSES = List.of("ACTIVE");

    public Page<QuestionDTO> getQuestions(CustomUserDetails user, QuestionBankFilter filter,
                                          String instituteId, int pageNo, int pageSize) {
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException("instituteId is required");
        }
        QuestionBankFilter safeFilter = filter == null ? new QuestionBankFilter() : filter;

        Pageable pageable = PageRequest.of(pageNo, pageSize, Sort.by(Sort.Direction.DESC, "created_at"));

        Page<Question> questions = questionRepository.findQuestionsByFilters(
                instituteId,
                blankToNull(safeFilter.getName()),
                // Every multi-value filter goes over as CSV -- see the repository comment.
                // Statuses default to ACTIVE rather than "no constraint": a deleted
                // question must never be offered for reuse.
                toCsv(safeFilter.getStatuses() == null || safeFilter.getStatuses().isEmpty()
                        ? DEFAULT_STATUSES
                        : safeFilter.getStatuses()),
                toCsv(safeFilter.getQuestionTypes()),
                toCsv(safeFilter.getDifficulties()),
                toCsv(safeFilter.getSourceTypes()),
                toCsv(safeFilter.getExcludeQuestionIds()),
                toCsv(safeFilter.getKbIds()),
                toCsv(safeFilter.getKbNodeIds()),
                toCsv(safeFilter.getTagIds()),
                pageable
        );

        // provideSolution = true: this feeds a picker where the admin is deciding
        // whether a question is worth adding, and that judgement needs the answer.
        return questions.map(question -> new QuestionDTO(question, true));
    }

    private String blankToNull(String value) {
        return (value == null || value.isBlank()) ? null : value;
    }

    /**
     * The query unnests these in Postgres rather than binding a list, so an id
     * containing a comma would split into two. Ids here are UUIDs, but drop any that
     * are not comma-free rather than silently widening the filter.
     */
    private String toCsv(List<String> values) {
        if (values == null || values.isEmpty()) return null;
        List<String> clean = values.stream()
                .filter(v -> v != null && !v.isBlank() && !v.contains(","))
                .toList();
        return clean.isEmpty() ? null : String.join(",", clean);
    }
}
