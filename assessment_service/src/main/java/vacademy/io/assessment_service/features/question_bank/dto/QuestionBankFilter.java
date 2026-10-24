package vacademy.io.assessment_service.features.question_bank.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * Filters for browsing INDIVIDUAL questions, as opposed to whole question papers.
 * <p>
 * {@link QuestionPaperFilter} is the paper-level equivalent and stays as it is. Until
 * now a question was only reachable by fetching the paper that contains it, which made
 * "give me every medium-difficulty numerical this book produced" impossible to express —
 * and therefore made every AI-generated question a one-shot artifact rather than
 * something an institute accumulates.
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class QuestionBankFilter {

    /** Free-text search over the question body. */
    private String name;

    /** Knowledge bases the question was generated from (matched inside source_meta). */
    private List<String> kbIds = new ArrayList<>();

    /** Topic/subtopic nodes within those knowledge bases (matched inside source_meta). */
    private List<String> kbNodeIds = new ArrayList<>();

    /** MANUAL | UPLOAD | AI | KNOWLEDGE_BASE. */
    private List<String> sourceTypes = new ArrayList<>();

    private List<String> questionTypes = new ArrayList<>();

    /** EASY | MEDIUM | HARD. */
    private List<String> difficulties = new ArrayList<>();

    private List<String> tagIds = new ArrayList<>();

    /** Defaults to ACTIVE at the query layer when left empty. */
    private List<String> statuses = new ArrayList<>();

    /** Questions already in the section being filled — so the picker can hide them. */
    private List<String> excludeQuestionIds = new ArrayList<>();
}
