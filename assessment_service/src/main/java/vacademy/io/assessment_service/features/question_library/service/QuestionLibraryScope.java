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
 * The owner institute sees and manages all of it. Every other institute sees all of it
 * too, except the topics hidden from it (question_library_access) and everything below
 * them. Platform staff hide topics per institute from the health dashboard.
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
        Set<String> hidden = new HashSet<>(nodeRepository.findHiddenNodeIds(owner, callerInstituteId));
        hidden.retainAll(activeIds);
        if (hidden.isEmpty()) return new View(owner, false, active, Set.of());

        Map<String, List<QuestionLibraryNode>> children = QuestionLibraryTreeResolver.childrenByParent(active);
        Set<String> gone = QuestionLibraryTreeResolver.subtreeIds(children, hidden);
        List<QuestionLibraryNode> nodes = active.stream().filter(n -> !gone.contains(n.getId())).toList();
        return new View(owner, false, nodes, Set.of());
    }

    /**
     * One institute's view of the library.
     *
     * @param owner   the owner institute, null when no library is configured
     * @param manager true for the owner institute itself
     * @param nodes   the active topics this institute sees, in display order
     * @param roots   topics shown at the top level although they have a parent (none today:
     *                a hidden topic takes everything below it, so parents stay visible)
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
         * asking for topics hidden from it gets the empty list back, which callers treat as
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

        /**
         * Drops the topics this institute does not see. A topic it sees can have a hidden
         * topic below it, so every "topic and everything below it" list goes through here.
         */
        public List<String> visibleOnly(Collection<String> ids) {
            if (ids == null) return List.of();
            if (manager) return new ArrayList<>(ids);
            Set<String> visible = nodeIds();
            return ids.stream().filter(visible::contains).distinct().toList();
        }

        /** For queries: null for the owner (any active topic), the csv of visible topics otherwise. */
        public String limitCsv() {
            return manager ? null : String.join(",", nodeIds());
        }
    }
}
