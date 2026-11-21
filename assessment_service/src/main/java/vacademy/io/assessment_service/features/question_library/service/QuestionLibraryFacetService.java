package vacademy.io.assessment_service.features.question_library.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Query;
import org.hibernate.query.NativeQuery;
import org.hibernate.type.StandardBasicTypes;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.question_bank.dto.QuestionBankFilter;
import vacademy.io.assessment_service.features.question_bank.manager.QuestionFilterParams;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;
import vacademy.io.assessment_service.features.question_library.dto.LibraryFacetCountDto;
import vacademy.io.assessment_service.features.question_library.dto.LibraryFacetsResponse;
import vacademy.io.assessment_service.features.question_library.dto.LibraryTagDto;
import vacademy.io.assessment_service.features.question_library.entity.QuestionLibraryNode;

import java.util.*;

/**
 * The numbers next to each filter in the Question Library: per topic, difficulty, type and
 * tag, how many questions that choice would give together with the filters already set.
 * <p>
 * Each group is counted with its own selection left out (standard faceted search), so a
 * second difficulty or a second chapter shows what it would add, not zero. Every query
 * reuses {@link QuestionRepository#QUESTION_FILTER_WHERE} with values from
 * {@link QuestionFilterParams}, so a number here is what the list returns for that choice.
 * The caller sees exactly what the list would show it: owners the whole bank, everyone else
 * only questions on topics not hidden from them.
 */
@Service
public class QuestionLibraryFacetService {

    private static final String DIFFICULTY_SQL = "SELECT q.difficulty, COUNT(q.id) FROM question q "
            + QuestionRepository.QUESTION_FILTER_WHERE + " GROUP BY q.difficulty";

    private static final String TYPE_SQL = "SELECT q.question_type, COUNT(q.id) FROM question q "
            + QuestionRepository.QUESTION_FILTER_WHERE + " GROUP BY q.question_type";

    /** facetPairsCsv is nodeId~childId: every topic below a listed child counts for that child. */
    private static final String TOPIC_SQL = "SELECT fp.child_id, COUNT(DISTINCT q.id) FROM question q "
            + "JOIN question_library_mapping fm ON fm.question_id = q.id "
            + "JOIN (SELECT split_part(fx.pair, '~', 1) AS node_id, split_part(fx.pair, '~', 2) AS child_id "
            + "      FROM unnest(string_to_array(:facetPairsCsv, ',')) AS fx(pair)) fp ON fp.node_id = fm.node_id "
            + QuestionRepository.QUESTION_FILTER_WHERE + " GROUP BY fp.child_id";

    private static final String TAG_SQL = "SELECT ft.tag_id, tt.tag_name, ft.tag_source, COUNT(DISTINCT q.id) FROM question q "
            + "JOIN entity_tags ft ON ft.entity_id = q.id AND ft.entity_name = 'QUESTION' "
            + "    AND ft.tag_source = ANY(string_to_array(:facetKindsCsv, ',')) "
            + "JOIN tags tt ON tt.tag_id = ft.tag_id "
            + QuestionRepository.QUESTION_FILTER_WHERE
            + " GROUP BY ft.tag_id, tt.tag_name, ft.tag_source ORDER BY ft.tag_source, tt.tag_name";

    @PersistenceContext
    private EntityManager entityManager;

    @Autowired
    private QuestionLibraryScope scope;

    @Autowired
    private QuestionLibraryTreeResolver treeResolver;

    @Autowired
    private QuestionLibraryService libraryService;

    /**
     * @param filter      the same filter the question list gets. library_node_ids is the
     *                    selection (or the open topic when nothing below it is ticked).
     * @param scopeNodeId the open topic, whose direct children are counted as topics. Null
     *                    for the top level.
     */
    @Transactional(readOnly = true)
    public LibraryFacetsResponse facets(String callerInstituteId, QuestionBankFilter filter, String scopeNodeId) {
        QuestionLibraryScope.View view = scope.of(callerInstituteId);
        if (view.owner() == null || (!view.manager() && view.empty())) return empty();
        String owner = view.owner();
        QuestionBankFilter requested = filter == null ? new QuestionBankFilter() : filter;

        QuestionBankFilter scoped;
        String nodeIdsCsv;
        if (view.manager()) {
            scoped = requested;
            List<String> chosen = cleanIds(requested.getLibraryNodeIds());
            if (chosen.isEmpty()) {
                nodeIdsCsv = null;
            } else {
                List<String> expanded = treeResolver.withDescendants(owner, chosen);
                // Every chosen topic is gone: nothing can match, the same as the list.
                if (expanded.isEmpty()) return empty();
                nodeIdsCsv = QuestionFilterParams.toCsv(expanded);
            }
        } else {
            scoped = libraryService.readerFilter(view, requested);
            if (scoped == null) return empty();
            nodeIdsCsv = QuestionFilterParams.toCsv(scoped.getLibraryNodeIds());
        }
        QuestionFilterParams base = QuestionFilterParams.of(owner, scoped, nodeIdsCsv);

        Map<String, Long> difficulties = new LinkedHashMap<>();
        for (Object[] row : run(DIFFICULTY_SQL, base.withDifficulties(null), Map.of())) {
            // Kept as stored: the list matches difficulty exactly, so "easy" is not EASY there either.
            String level = row[0] == null ? "UNKNOWN" : (String) row[0];
            difficulties.merge(level, toLong(row[1]), Long::sum);
        }
        Map<String, Long> types = new LinkedHashMap<>();
        for (Object[] row : run(TYPE_SQL, base.withQuestionTypes(null), Map.of())) {
            types.merge(row[0] == null ? "UNKNOWN" : (String) row[0], toLong(row[1]), Long::sum);
        }

        return LibraryFacetsResponse.builder()
                .difficulties(difficulties)
                .questionTypes(types)
                .topics(Boolean.TRUE.equals(scoped.getUnsortedOnly())
                        ? List.of()
                        : topicCounts(view, base, blankToNull(scopeNodeId)))
                .tags(tagCounts(base, scoped.getTagGroups()))
                .build();
    }

    /** The open topic's children, each counted over itself and everything below it. */
    private List<LibraryFacetCountDto> topicCounts(QuestionLibraryScope.View view, QuestionFilterParams base, String scopeNodeId) {
        if (scopeNodeId != null && !view.sees(scopeNodeId)) return List.of();
        // view.nodes() already leaves out what is hidden from a reader, so every subtree
        // built from it is what that reader may count.
        Map<String, List<QuestionLibraryNode>> children = QuestionLibraryTreeResolver.childrenByParent(view.nodes());
        List<QuestionLibraryNode> kids = view.nodes().stream()
                .filter(node -> Objects.equals(view.parentOf(node), scopeNodeId))
                .toList();
        if (kids.isEmpty()) return List.of();

        List<String> pairs = new ArrayList<>();
        for (QuestionLibraryNode kid : kids) {
            for (String id : QuestionLibraryTreeResolver.subtreeIds(children, List.of(kid.getId()))) {
                pairs.add(id + "~" + kid.getId());
            }
        }
        // The topic selection is this group's own, so it is replaced by the open topic.
        String scopeCsv;
        if (scopeNodeId != null) {
            scopeCsv = String.join(",", QuestionLibraryTreeResolver.subtreeIds(children, List.of(scopeNodeId)));
        } else {
            scopeCsv = view.limitCsv();
        }
        Map<String, Long> byChild = new HashMap<>();
        for (Object[] row : run(TOPIC_SQL, base.withLibraryNodeIds(scopeCsv), Map.of("facetPairsCsv", String.join(",", pairs)))) {
            byChild.put((String) row[0], toLong(row[1]));
        }
        List<LibraryFacetCountDto> result = new ArrayList<>();
        for (QuestionLibraryNode kid : kids) {
            Long count = byChild.get(kid.getId());
            if (count != null && count > 0) result.add(new LibraryFacetCountDto(kid.getId(), count));
        }
        return result;
    }

    /**
     * Library tags. A kind with something ticked is counted without its own selection; the
     * kinds with nothing ticked share one query with every selection applied.
     */
    private List<LibraryTagDto> tagCounts(QuestionFilterParams base, Map<String, List<String>> groups) {
        Map<String, List<String>> selected = new LinkedHashMap<>();
        if (groups != null) {
            groups.forEach((kind, ids) -> {
                if (kind != null && ids != null && ids.stream().anyMatch(id -> id != null && !id.isBlank())) {
                    selected.put(kind.trim().toUpperCase(Locale.ROOT), ids);
                }
            });
        }
        List<LibraryTagDto> tags = new ArrayList<>();
        List<String> untouched = QuestionLibraryCurationService.TAG_KINDS.stream()
                .filter(kind -> !selected.containsKey(kind))
                .toList();
        if (!untouched.isEmpty()) {
            tags.addAll(readTags(base, String.join(",", untouched)));
        }
        for (String kind : QuestionLibraryCurationService.TAG_KINDS) {
            if (!selected.containsKey(kind)) continue;
            Map<String, List<String>> others = new LinkedHashMap<>(groups);
            others.keySet().removeIf(key -> key != null && key.trim().equalsIgnoreCase(kind));
            tags.addAll(readTags(base.withTagGroups(QuestionFilterParams.tagGroupsCsv(others)), kind));
        }
        return tags;
    }

    private List<LibraryTagDto> readTags(QuestionFilterParams params, String kindsCsv) {
        List<LibraryTagDto> tags = new ArrayList<>();
        for (Object[] row : run(TAG_SQL, params, Map.of("facetKindsCsv", kindsCsv))) {
            tags.add(LibraryTagDto.builder()
                    .tagId((String) row[0])
                    .tagName((String) row[1])
                    .kind((String) row[2])
                    .questionCount(toLong(row[3]))
                    .build());
        }
        return tags;
    }

    @SuppressWarnings("unchecked")
    private List<Object[]> run(String sql, QuestionFilterParams params, Map<String, String> extra) {
        Query query = entityManager.createNativeQuery(sql);
        NativeQuery<?> nativeQuery = query.unwrap(NativeQuery.class);
        Map<String, String> values = new LinkedHashMap<>(params.asMap());
        values.putAll(extra);
        // Typed as text even when null: Postgres cannot infer the type of a bare null in ":x IS NULL".
        values.forEach((name, value) -> nativeQuery.setParameter(name, value, StandardBasicTypes.STRING));
        return (List<Object[]>) nativeQuery.getResultList();
    }

    private static LibraryFacetsResponse empty() {
        return LibraryFacetsResponse.builder()
                .difficulties(Map.of())
                .questionTypes(Map.of())
                .topics(List.of())
                .tags(List.of())
                .build();
    }

    private static List<String> cleanIds(List<String> ids) {
        if (ids == null) return List.of();
        return ids.stream()
                .filter(id -> id != null && !id.isBlank() && !id.contains(","))
                .map(String::trim)
                .distinct()
                .toList();
    }

    private static String blankToNull(String value) {
        return (value == null || value.isBlank()) ? null : value.trim();
    }

    private static long toLong(Object value) {
        return value == null ? 0L : ((Number) value).longValue();
    }
}
