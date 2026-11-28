package vacademy.io.assessment_service.features.question_library.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.question_library.entity.QuestionLibraryNode;
import vacademy.io.assessment_service.features.question_library.repository.QuestionLibraryNodeRepository;

import java.util.*;

/**
 * Tree walking for the question library, kept apart from QuestionLibraryService so the
 * question-bank filter can expand topics without depending on the library service.
 */
@Component
public class QuestionLibraryTreeResolver {

    public static final String ACTIVE = "ACTIVE";

    @Autowired
    private QuestionLibraryNodeRepository nodeRepository;

    public List<QuestionLibraryNode> activeNodes(String instituteId) {
        return nodeRepository.findByInstituteIdAndStatusOrderByDisplayOrderAscCreatedAtAsc(instituteId, ACTIVE);
    }

    /**
     * The given topics plus every active topic below them. Ids that are not active
     * topics of this institute are dropped, so a stale or foreign id matches nothing
     * instead of widening the filter.
     */
    public List<String> withDescendants(String instituteId, Collection<String> nodeIds) {
        if (nodeIds == null || nodeIds.isEmpty()) return List.of();
        return new ArrayList<>(subtreeIds(childrenByParent(activeNodes(instituteId)), knownIds(instituteId, nodeIds)));
    }

    public static Map<String, List<QuestionLibraryNode>> childrenByParent(List<QuestionLibraryNode> nodes) {
        Map<String, List<QuestionLibraryNode>> children = new HashMap<>();
        for (QuestionLibraryNode node : nodes) {
            children.computeIfAbsent(node.getParentId(), k -> new ArrayList<>()).add(node);
        }
        return children;
    }

    /** Ids of the roots and everything below them, roots included. */
    public static Set<String> subtreeIds(Map<String, List<QuestionLibraryNode>> childrenByParent, Collection<String> roots) {
        Set<String> result = new LinkedHashSet<>();
        Deque<String> queue = new ArrayDeque<>(roots);
        while (!queue.isEmpty()) {
            String id = queue.poll();
            if (!result.add(id)) continue;
            for (QuestionLibraryNode child : childrenByParent.getOrDefault(id, List.of())) {
                queue.add(child.getId());
            }
        }
        return result;
    }

    /** 1 for a top-level topic. Parents missing from the map end the walk. */
    public static int depthOf(String nodeId, Map<String, QuestionLibraryNode> byId) {
        int depth = 0;
        String current = nodeId;
        Set<String> seen = new HashSet<>();
        while (current != null && byId.containsKey(current) && seen.add(current)) {
            depth++;
            current = byId.get(current).getParentId();
        }
        return depth;
    }

    /** Levels in the subtree rooted at nodeId, 1 for a topic with no children. */
    public static int heightOf(String nodeId, Map<String, List<QuestionLibraryNode>> childrenByParent) {
        int best = 0;
        for (QuestionLibraryNode child : childrenByParent.getOrDefault(nodeId, List.of())) {
            best = Math.max(best, heightOf(child.getId(), childrenByParent));
        }
        return best + 1;
    }

    private List<String> knownIds(String instituteId, Collection<String> nodeIds) {
        List<String> clean = nodeIds.stream().filter(id -> id != null && !id.isBlank()).distinct().toList();
        if (clean.isEmpty()) return List.of();
        return nodeRepository.findByInstituteIdAndStatusAndIdIn(instituteId, ACTIVE, clean).stream()
                .map(QuestionLibraryNode::getId)
                .toList();
    }
}
