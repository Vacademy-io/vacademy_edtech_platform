package vacademy.io.assessment_service.features.question_library.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.question_library.entity.QuestionLibraryNode;
import vacademy.io.assessment_service.features.question_library.repository.QuestionLibraryNodeRepository;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Which part of the Question Library one institute may see.
 * <p>
 * The owner institute sees and manages all of it. Every other institute sees only the
 * topics the owner gave it (question_library_access) and everything below them. Those
 * topics become its top level: their parents, and the rest of the library, stay hidden.
 * An institute that was given nothing sees nothing.
 */
@Component
public class QuestionLibraryScope {

    @Autowired
    private QuestionLibraryAccess access;

    @Autowired
    private QuestionLibraryTreeResolver treeResolver;

    @Autowired
    private QuestionLibraryNodeRepository nodeRepository;

    public View of(String callerInstituteId) {
        String owner = access.ownerInstituteId();
        if (owner == null) return new View(null, false, List.of(), Set.of());
        List<QuestionLibraryNode> active = treeResolver.activeNodes(owner);
        if (access.isOwner(callerInstituteId)) return new View(owner, true, active, Set.of());

        Set<String> activeIds = active.stream().map(QuestionLibraryNode::getId).collect(Collectors.toSet());
        Set<String> granted = new HashSet<>(nodeRepository.findGrantedNodeIds(owner, callerInstituteId));
        granted.retainAll(activeIds);
        if (granted.isEmpty()) return new View(owner, false, List.of(), Set.of());

        Map<String, List<QuestionLibraryNode>> children = QuestionLibraryTreeResolver.childrenByParent(active);
        Set<String> visible = QuestionLibraryTreeResolver.subtreeIds(children, granted);
        // A topic given on its own and also inside a bigger given topic is not a root.
        Map<String, QuestionLibraryNode> byId = active.stream()
                .collect(Collectors.toMap(QuestionLibraryNode::getId, n -> n));
        Set<String> roots = new HashSet<>();
        for (String id : granted) {
            if (!hasGrantedAncestor(id, byId, granted)) roots.add(id);
        }
        List<QuestionLibraryNode> nodes = active.stream().filter(n -> visible.contains(n.getId())).toList();
        return new View(owner, false, nodes, roots);
    }

    private static boolean hasGrantedAncestor(String id, Map<String, QuestionLibraryNode> byId, Set<String> granted) {
        Set<String> seen = new HashSet<>();
        String current = byId.get(id).getParentId();
        while (current != null && byId.containsKey(current) && seen.add(current)) {
            if (granted.contains(current)) return true;
            current = byId.get(current).getParentId();
        }
        return false;
    }

    /**
     * One institute's view of the library.
     *
     * @param owner   the owner institute, null when no library is configured
     * @param manager true for the owner institute itself
     * @param nodes   the active topics this institute sees, in display order
     * @param roots   for a reader, the topics shown at its top level
     */
    public record View(String owner, boolean manager, List<QuestionLibraryNode> nodes, Set<String> roots) {

        /** Nothing to show and nothing to read. */
        public boolean empty() {
            return owner == null || nodes.isEmpty();
        }

        public Set<String> nodeIds() {
            return nodes.stream().map(QuestionLibraryNode::getId).collect(Collectors.toCollection(LinkedHashSet::new));
        }

        public boolean sees(String nodeId) {
            return nodeId != null && nodes.stream().anyMatch(n -> n.getId().equals(nodeId));
        }

        /** Parent as this institute sees it: a root has none. */
        public String parentOf(QuestionLibraryNode node) {
            return roots.contains(node.getId()) ? null : node.getParentId();
        }

        /**
         * The topics a request may read. Empty means everything this institute sees. A reader
         * asking for topics it was not given gets the empty list back, which callers treat as
         * "nothing matches", never as "everything".
         */
        public List<String> restrict(List<String> requested) {
            List<String> clean = requested == null ? List.of() : requested.stream()
                    .filter(id -> id != null && !id.isBlank() && !id.contains(","))
                    .map(String::trim)
                    .distinct()
                    .toList();
            if (clean.isEmpty()) return new ArrayList<>(nodeIds());
            if (manager) return clean;
            Set<String> visible = nodeIds();
            return clean.stream().filter(visible::contains).toList();
        }

        /** For queries: null for the owner (any active topic), the csv of visible topics otherwise. */
        public String limitCsv() {
            return manager ? null : String.join(",", nodeIds());
        }
    }
}
