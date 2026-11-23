package vacademy.io.assessment_service.features.question_bank.manager;

import vacademy.io.assessment_service.features.question_bank.dto.QuestionBankFilter;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The bound values of {@code QuestionRepository.QUESTION_FILTER_WHERE}, built one way for the
 * question list and for the library counts that reuse the same WHERE, so the two can never
 * disagree on what a filter means. Every multi-value filter is a comma-separated string (see
 * the repository comment) and null means "no constraint".
 */
public record QuestionFilterParams(
        String instituteId,
        String name,
        String statusesCsv,
        String questionTypesCsv,
        String difficultiesCsv,
        String sourceTypesCsv,
        String excludeQuestionIdsCsv,
        String kbIdsCsv,
        String kbNodeIdsCsv,
        String tagIdsCsv,
        String tagGroupsCsv,
        String libraryNodeIdsCsv,
        String unsortedFlag) {

    /** Questions with no explicit status filter are ACTIVE ones. */
    private static final List<String> DEFAULT_STATUSES = List.of("ACTIVE");

    /**
     * @param libraryNodeIdsCsv the library topics already expanded to every topic below them,
     *                          or null for no topic constraint
     */
    public static QuestionFilterParams of(String instituteId, QuestionBankFilter filter, String libraryNodeIdsCsv) {
        QuestionBankFilter safe = filter == null ? new QuestionBankFilter() : filter;
        return new QuestionFilterParams(
                instituteId,
                blankToNull(safe.getName()),
                // Statuses default to ACTIVE rather than "no constraint": a deleted
                // question must never be offered for reuse.
                toCsv(safe.getStatuses() == null || safe.getStatuses().isEmpty() ? DEFAULT_STATUSES : safe.getStatuses()),
                toCsv(safe.getQuestionTypes()),
                toCsv(safe.getDifficulties()),
                toCsv(safe.getSourceTypes()),
                toCsv(safe.getExcludeQuestionIds()),
                toCsv(safe.getKbIds()),
                toCsv(safe.getKbNodeIds()),
                toCsv(safe.getTagIds()),
                tagGroupsCsv(safe.getTagGroups()),
                libraryNodeIdsCsv,
                Boolean.TRUE.equals(safe.getUnsortedOnly()) ? "Y" : null);
    }

    public QuestionFilterParams withQuestionTypes(String csv) {
        return new QuestionFilterParams(instituteId, name, statusesCsv, csv, difficultiesCsv, sourceTypesCsv,
                excludeQuestionIdsCsv, kbIdsCsv, kbNodeIdsCsv, tagIdsCsv, tagGroupsCsv, libraryNodeIdsCsv, unsortedFlag);
    }

    public QuestionFilterParams withDifficulties(String csv) {
        return new QuestionFilterParams(instituteId, name, statusesCsv, questionTypesCsv, csv, sourceTypesCsv,
                excludeQuestionIdsCsv, kbIdsCsv, kbNodeIdsCsv, tagIdsCsv, tagGroupsCsv, libraryNodeIdsCsv, unsortedFlag);
    }

    public QuestionFilterParams withTagGroups(String csv) {
        return new QuestionFilterParams(instituteId, name, statusesCsv, questionTypesCsv, difficultiesCsv, sourceTypesCsv,
                excludeQuestionIdsCsv, kbIdsCsv, kbNodeIdsCsv, tagIdsCsv, csv, libraryNodeIdsCsv, unsortedFlag);
    }

    public QuestionFilterParams withLibraryNodeIds(String csv) {
        return new QuestionFilterParams(instituteId, name, statusesCsv, questionTypesCsv, difficultiesCsv, sourceTypesCsv,
                excludeQuestionIdsCsv, kbIdsCsv, kbNodeIdsCsv, tagIdsCsv, tagGroupsCsv, csv, unsortedFlag);
    }

    /** Parameter name to value, for queries built outside the repository interface. */
    public Map<String, String> asMap() {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("instituteId", instituteId);
        params.put("name", name);
        params.put("statusesCsv", statusesCsv);
        params.put("questionTypesCsv", questionTypesCsv);
        params.put("difficultiesCsv", difficultiesCsv);
        params.put("sourceTypesCsv", sourceTypesCsv);
        params.put("excludeQuestionIdsCsv", excludeQuestionIdsCsv);
        params.put("kbIdsCsv", kbIdsCsv);
        params.put("kbNodeIdsCsv", kbNodeIdsCsv);
        params.put("tagIdsCsv", tagIdsCsv);
        params.put("tagGroupsCsv", tagGroupsCsv);
        params.put("libraryNodeIdsCsv", libraryNodeIdsCsv);
        params.put("unsortedFlag", unsortedFlag);
        return params;
    }

    /**
     * The query unnests these in Postgres rather than binding a list, so an id
     * containing a comma would split into two. Ids here are UUIDs, but drop any that
     * are not comma-free rather than silently widening the filter.
     */
    public static String toCsv(List<String> values) {
        if (values == null || values.isEmpty()) return null;
        List<String> clean = values.stream()
                .filter(v -> v != null && !v.isBlank() && !v.contains(","))
                .toList();
        return clean.isEmpty() ? null : String.join(",", clean);
    }

    /**
     * group~tagId pairs. A group with no usable tag is left out (it would match nothing and
     * read as "no constraint" to nobody), and so are names or ids holding a comma or a tilde.
     */
    public static String tagGroupsCsv(Map<String, List<String>> groups) {
        if (groups == null || groups.isEmpty()) return null;
        List<String> pairs = new ArrayList<>();
        groups.forEach((group, ids) -> {
            if (group == null || group.isBlank() || !safe(group) || ids == null) return;
            ids.stream()
                    .filter(id -> id != null && !id.isBlank() && safe(id))
                    .map(String::trim)
                    .distinct()
                    .forEach(id -> pairs.add(group.trim() + "~" + id));
        });
        return pairs.isEmpty() ? null : String.join(",", pairs);
    }

    private static boolean safe(String value) {
        return !value.contains(",") && !value.contains("~");
    }

    private static String blankToNull(String value) {
        return (value == null || value.isBlank()) ? null : value;
    }
}
