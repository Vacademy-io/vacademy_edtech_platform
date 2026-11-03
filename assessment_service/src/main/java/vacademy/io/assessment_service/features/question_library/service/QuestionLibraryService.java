package vacademy.io.assessment_service.features.question_library.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.question_bank.dto.QuestionBankFilter;
import vacademy.io.assessment_service.features.question_bank.manager.GetQuestionBankManager;
import vacademy.io.assessment_service.features.question_bank.manager.GetQuestionPaperManager;
import vacademy.io.assessment_service.features.question_bank.repository.QuestionPaperRepository;
import vacademy.io.assessment_service.features.question_core.dto.QuestionDTO;
import vacademy.io.assessment_service.features.question_library.dto.*;
import vacademy.io.assessment_service.features.question_library.entity.QuestionLibraryNode;
import vacademy.io.assessment_service.features.question_library.repository.QuestionLibraryNodeRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.*;
import java.util.stream.Collectors;

import static vacademy.io.assessment_service.features.question_library.service.QuestionLibraryTreeResolver.ACTIVE;

/**
 * The question library: an institute's questions organised in a topic tree.
 * <p>
 * Topics never own questions. A question stays in the bank whatever happens to the
 * topics, and deleting a topic only takes its questions off it.
 */
@Service
public class QuestionLibraryService {

    /** Subject, chapter, topic, sub-topic. */
    public static final int MAX_DEPTH = 4;
    /** Upper bound for one bulk write, so a runaway "select all" cannot lock half the table. */
    private static final int MAX_QUESTIONS_PER_CALL = 500;
    private static final int MAX_NAME_LENGTH = 255;
    private static final String MODE_MOVE = "MOVE";

    @Autowired
    private QuestionLibraryNodeRepository nodeRepository;

    @Autowired
    private QuestionLibraryTreeResolver treeResolver;

    @Autowired
    private GetQuestionBankManager questionBankManager;

    @Autowired
    private GetQuestionPaperManager questionPaperManager;

    @Autowired
    private QuestionPaperRepository questionPaperRepository;

    // ---------------------------------------------------------------- tree

    public LibraryTreeResponse getTree(String instituteId) {
        List<QuestionLibraryNode> nodes = treeResolver.activeNodes(instituteId);
        Map<String, QuestionLibraryNode> byId = nodes.stream()
                .collect(Collectors.toMap(QuestionLibraryNode::getId, n -> n));

        Map<String, long[]> counts = new HashMap<>();
        for (Object[] row : nodeRepository.countQuestionsPerNode(instituteId)) {
            counts.put((String) row[0], new long[]{toLong(row[1]), toLong(row[2]), toLong(row[3]), toLong(row[4])});
        }

        List<LibraryNodeDto> dtos = new ArrayList<>();
        for (QuestionLibraryNode node : nodes) {
            // A node whose parent is gone (deleted from under it) would be unreachable in
            // the tree. Deletes take whole subtrees, so this is only a guard.
            if (node.getParentId() != null && !byId.containsKey(node.getParentId())) continue;
            long[] c = counts.getOrDefault(node.getId(), new long[4]);
            dtos.add(LibraryNodeDto.builder()
                    .id(node.getId())
                    .parentId(node.getParentId())
                    .name(node.getName())
                    .description(node.getDescription())
                    .displayOrder(node.getDisplayOrder())
                    .depth(QuestionLibraryTreeResolver.depthOf(node.getId(), byId))
                    .questionCount(c[0])
                    .easyCount(c[1])
                    .mediumCount(c[2])
                    .hardCount(c[3])
                    .build());
        }

        return LibraryTreeResponse.builder()
                .nodes(dtos)
                .summary(summary(instituteId, dtos.size()))
                .maxDepth(MAX_DEPTH)
                .build();
    }

    private LibrarySummaryDto summary(String instituteId, int topicCount) {
        Map<String, Long> byDifficulty = new LinkedHashMap<>();
        Map<String, Long> byType = new LinkedHashMap<>();
        long total = 0;
        for (Object[] row : nodeRepository.countLiveQuestionsByDifficultyAndType(instituteId)) {
            String difficulty = row[0] == null ? "UNKNOWN" : ((String) row[0]).toUpperCase(Locale.ROOT);
            String type = row[1] == null ? "UNKNOWN" : (String) row[1];
            long count = toLong(row[2]);
            total += count;
            byDifficulty.merge(difficulty, count, Long::sum);
            byType.merge(type, count, Long::sum);
        }
        return LibrarySummaryDto.builder()
                .totalQuestions(total)
                .unsortedQuestions(nodeRepository.countUnsortedQuestions(instituteId))
                .addedLastWeek(nodeRepository.countQuestionsAddedLastWeek(instituteId))
                .topicCount(topicCount)
                .byDifficulty(byDifficulty)
                .byType(byType)
                .build();
    }

    // ---------------------------------------------------------------- topics

    @Transactional
    public LibraryNodeDto createNode(CustomUserDetails user, String instituteId, LibraryNodeRequest request) {
        if (request == null) throw new VacademyException("Topic details are required");
        String name = cleanName(request.getName());
        String parentId = blankToNull(request.getParentId());

        List<QuestionLibraryNode> nodes = treeResolver.activeNodes(instituteId);
        Map<String, QuestionLibraryNode> byId = indexById(nodes);
        if (parentId != null) {
            if (!byId.containsKey(parentId)) throw new VacademyException("Parent topic not found");
            if (QuestionLibraryTreeResolver.depthOf(parentId, byId) >= MAX_DEPTH) {
                throw new VacademyException("Topics can be at most " + MAX_DEPTH + " levels deep");
            }
        }
        requireUniqueSiblingName(nodes, parentId, name, null);

        Integer maxOrder = nodeRepository.findMaxDisplayOrder(instituteId, parentId);
        QuestionLibraryNode node = nodeRepository.save(QuestionLibraryNode.builder()
                .instituteId(instituteId)
                .parentId(parentId)
                .name(name)
                .description(blankToNull(request.getDescription()))
                .displayOrder(maxOrder == null ? 0 : maxOrder + 1)
                .status(ACTIVE)
                .createdBy(user == null ? null : user.getUserId())
                .build());
        return LibraryNodeDto.builder()
                .id(node.getId())
                .parentId(node.getParentId())
                .name(node.getName())
                .description(node.getDescription())
                .displayOrder(node.getDisplayOrder())
                .depth(parentId == null ? 1 : QuestionLibraryTreeResolver.depthOf(parentId, byId) + 1)
                .questionCount(0L).easyCount(0L).mediumCount(0L).hardCount(0L)
                .build();
    }

    @Transactional
    public String updateNode(String instituteId, String nodeId, LibraryNodeRequest request) {
        if (request == null) throw new VacademyException("Topic details are required");
        QuestionLibraryNode node = requireNode(instituteId, nodeId);
        if (request.getName() != null) {
            String name = cleanName(request.getName());
            requireUniqueSiblingName(treeResolver.activeNodes(instituteId), node.getParentId(), name, node.getId());
            node.setName(name);
        }
        if (request.getDescription() != null) {
            node.setDescription(blankToNull(request.getDescription()));
        }
        node.setUpdatedAt(new Date());
        nodeRepository.save(node);
        return node.getId();
    }

    @Transactional
    public String moveNode(String instituteId, MoveLibraryNodeRequest request) {
        if (request == null || blankToNull(request.getNodeId()) == null) {
            throw new VacademyException("node_id is required");
        }
        List<QuestionLibraryNode> nodes = treeResolver.activeNodes(instituteId);
        Map<String, QuestionLibraryNode> byId = indexById(nodes);
        Map<String, List<QuestionLibraryNode>> children = QuestionLibraryTreeResolver.childrenByParent(nodes);

        QuestionLibraryNode node = byId.get(request.getNodeId());
        if (node == null) throw new VacademyException("Topic not found");
        String parentId = blankToNull(request.getParentId());
        if (Objects.equals(parentId, node.getParentId())) return node.getId();

        int newDepth = 1;
        if (parentId != null) {
            if (!byId.containsKey(parentId)) throw new VacademyException("Parent topic not found");
            Set<String> ownSubtree = QuestionLibraryTreeResolver.subtreeIds(children, List.of(node.getId()));
            if (ownSubtree.contains(parentId)) {
                throw new VacademyException("A topic cannot be moved inside itself");
            }
            newDepth = QuestionLibraryTreeResolver.depthOf(parentId, byId) + 1;
        }
        int height = QuestionLibraryTreeResolver.heightOf(node.getId(), children);
        if (newDepth + height - 1 > MAX_DEPTH) {
            throw new VacademyException("Topics can be at most " + MAX_DEPTH + " levels deep");
        }
        requireUniqueSiblingName(nodes, parentId, node.getName(), node.getId());

        Integer maxOrder = nodeRepository.findMaxDisplayOrder(instituteId, parentId);
        node.setParentId(parentId);
        node.setDisplayOrder(maxOrder == null ? 0 : maxOrder + 1);
        node.setUpdatedAt(new Date());
        nodeRepository.save(node);
        return node.getId();
    }

    @Transactional
    public String reorderNodes(String instituteId, ReorderLibraryNodesRequest request) {
        if (request == null || request.getOrderedNodeIds() == null || request.getOrderedNodeIds().isEmpty()) {
            return "OK";
        }
        String parentId = blankToNull(request.getParentId());
        Map<String, QuestionLibraryNode> siblings = treeResolver.activeNodes(instituteId).stream()
                .filter(n -> Objects.equals(n.getParentId(), parentId))
                .collect(Collectors.toMap(QuestionLibraryNode::getId, n -> n));
        int order = 0;
        List<QuestionLibraryNode> changed = new ArrayList<>();
        for (String id : request.getOrderedNodeIds()) {
            QuestionLibraryNode node = siblings.get(id);
            if (node == null) continue;
            node.setDisplayOrder(order++);
            changed.add(node);
        }
        nodeRepository.saveAll(changed);
        return "OK";
    }

    /** Deletes the topic and everything below it. Questions stay in the bank. */
    @Transactional
    public LibraryActionResponse deleteNode(String instituteId, String nodeId) {
        requireNode(instituteId, nodeId);
        Set<String> subtree = QuestionLibraryTreeResolver.subtreeIds(
                QuestionLibraryTreeResolver.childrenByParent(treeResolver.activeNodes(instituteId)), List.of(nodeId));
        String csv = String.join(",", subtree);
        int removed = nodeRepository.removeAllQuestionsFromNodes(instituteId, csv);
        nodeRepository.markNodesDeleted(instituteId, csv);
        return LibraryActionResponse.builder().nodesCreated(0).affected(removed).build();
    }

    // ---------------------------------------------------------------- placing questions

    @Transactional
    public LibraryActionResponse assignQuestions(String instituteId, AssignLibraryQuestionsRequest request) {
        if (request == null) throw new VacademyException("Request body is required");
        String questionCsv = questionIdsCsv(request.getQuestionIds());
        List<String> nodeIds = cleanIds(request.getNodeIds());
        if (nodeIds.isEmpty()) throw new VacademyException("Choose at least one topic");
        List<QuestionLibraryNode> nodes = nodeRepository.findByInstituteIdAndStatusAndIdIn(instituteId, ACTIVE, nodeIds);
        if (nodes.size() != nodeIds.size()) throw new VacademyException("Topic not found");

        if (MODE_MOVE.equalsIgnoreCase(request.getMode())) {
            String from = blankToNull(request.getFromNodeId());
            nodeRepository.removeQuestionsFromNodes(instituteId, questionCsv, from);
        }
        int placed = 0;
        for (String nodeId : nodeIds) {
            placed += nodeRepository.addQuestionsToNode(instituteId, nodeId, questionCsv);
        }
        return LibraryActionResponse.builder().nodesCreated(0).affected(placed).build();
    }

    @Transactional
    public LibraryActionResponse removeQuestions(String instituteId, RemoveLibraryQuestionsRequest request) {
        if (request == null || blankToNull(request.getNodeId()) == null) {
            throw new VacademyException("node_id is required");
        }
        requireNode(instituteId, request.getNodeId());
        int removed = nodeRepository.removeQuestionsFromNodes(
                instituteId, questionIdsCsv(request.getQuestionIds()), request.getNodeId());
        return LibraryActionResponse.builder().nodesCreated(0).affected(removed).build();
    }

    @Transactional
    public LibraryActionResponse addPaperToNode(String instituteId, AddPaperToLibraryNodeRequest request) {
        if (request == null || blankToNull(request.getQuestionPaperId()) == null) {
            throw new VacademyException("question_paper_id is required");
        }
        requireNode(instituteId, request.getNodeId());
        if (questionPaperRepository.countInstituteQuestionPaperLink(request.getQuestionPaperId(), instituteId) == 0) {
            throw new VacademyException("Question paper not found");
        }
        int placed = nodeRepository.addPaperQuestionsToNode(instituteId, request.getNodeId(), request.getQuestionPaperId());
        return LibraryActionResponse.builder().nodesCreated(0).affected(placed).build();
    }

    // ---------------------------------------------------------------- subject tags -> topics

    public List<LibrarySubjectTagDto> listSubjectTags(String instituteId) {
        List<LibrarySubjectTagDto> tags = new ArrayList<>();
        for (Object[] row : nodeRepository.findSubjectTagsWithCounts(instituteId)) {
            tags.add(LibrarySubjectTagDto.builder()
                    .tagId((String) row[0])
                    .tagName((String) row[1])
                    .questionCount(toLong(row[2]))
                    .build());
        }
        return tags;
    }

    /**
     * One topic per chosen tag (reusing a same-named topic under the same parent, so
     * running the import twice does not duplicate anything), with the tag's questions
     * filed under it.
     */
    @Transactional
    public LibraryActionResponse importSubjectTags(CustomUserDetails user, String instituteId, ImportLibraryTagsRequest request) {
        if (request == null || request.getTagIds() == null || request.getTagIds().isEmpty()) {
            throw new VacademyException("Choose at least one tag");
        }
        String parentId = blankToNull(request.getParentId());
        List<QuestionLibraryNode> nodes = treeResolver.activeNodes(instituteId);
        Map<String, QuestionLibraryNode> byId = indexById(nodes);
        if (parentId != null) {
            if (!byId.containsKey(parentId)) throw new VacademyException("Parent topic not found");
            if (QuestionLibraryTreeResolver.depthOf(parentId, byId) >= MAX_DEPTH) {
                throw new VacademyException("Topics can be at most " + MAX_DEPTH + " levels deep");
            }
        }

        Map<String, QuestionLibraryNode> siblingsByName = new HashMap<>();
        for (QuestionLibraryNode node : nodes) {
            if (Objects.equals(node.getParentId(), parentId)) {
                siblingsByName.put(node.getName().trim().toLowerCase(Locale.ROOT), node);
            }
        }
        Set<String> wanted = new HashSet<>(cleanIds(request.getTagIds()));
        Integer maxOrder = nodeRepository.findMaxDisplayOrder(instituteId, parentId);
        int nextOrder = maxOrder == null ? 0 : maxOrder + 1;

        int created = 0;
        int placed = 0;
        for (LibrarySubjectTagDto tag : listSubjectTags(instituteId)) {
            if (!wanted.contains(tag.getTagId())) continue;
            String name = displayName(tag.getTagName());
            if (name.isEmpty()) continue;
            QuestionLibraryNode node = siblingsByName.get(name.toLowerCase(Locale.ROOT));
            if (node == null) {
                node = nodeRepository.save(QuestionLibraryNode.builder()
                        .instituteId(instituteId)
                        .parentId(parentId)
                        .name(name)
                        .displayOrder(nextOrder++)
                        .status(ACTIVE)
                        .createdBy(user == null ? null : user.getUserId())
                        .build());
                siblingsByName.put(name.toLowerCase(Locale.ROOT), node);
                created++;
            }
            placed += nodeRepository.addTaggedQuestionsToNode(instituteId, node.getId(), tag.getTagId());
        }
        return LibraryActionResponse.builder().nodesCreated(created).affected(placed).build();
    }

    // ---------------------------------------------------------------- browsing

    public Page<LibraryQuestionDto> listQuestions(CustomUserDetails user, String instituteId, QuestionBankFilter filter,
                                                  int pageNo, int pageSize) {
        Page<QuestionDTO> page = questionBankManager.getQuestions(user, filter, instituteId, pageNo, pageSize);
        List<QuestionDTO> questions = page.getContent();
        if (questions.isEmpty()) return page.map(q -> LibraryQuestionDto.builder().question(q).build());

        // Without the saved subject tags the editor would send an empty list back and
        // the save would wipe them (tags are replace-on-save).
        questionPaperManager.attachSubjectTags(questions);

        String csv = questions.stream().map(QuestionDTO::getId).filter(Objects::nonNull)
                .collect(Collectors.joining(","));
        Map<String, List<String>> nodesByQuestion = new HashMap<>();
        for (Object[] row : nodeRepository.findNodesOfQuestions(instituteId, csv)) {
            nodesByQuestion.computeIfAbsent((String) row[0], k -> new ArrayList<>()).add((String) row[1]);
        }
        Map<String, Long> usage = new HashMap<>();
        for (Object[] row : nodeRepository.countAssessmentsUsingQuestions(csv)) {
            usage.put((String) row[0], toLong(row[1]));
        }
        return page.map(q -> LibraryQuestionDto.builder()
                .question(q)
                .nodeIds(nodesByQuestion.getOrDefault(q.getId(), new ArrayList<>()))
                .assessmentCount(usage.getOrDefault(q.getId(), 0L))
                .build());
    }

    // ---------------------------------------------------------------- helpers

    private QuestionLibraryNode requireNode(String instituteId, String nodeId) {
        if (blankToNull(nodeId) == null) throw new VacademyException("node_id is required");
        return nodeRepository.findByIdAndInstituteIdAndStatus(nodeId, instituteId, ACTIVE)
                .orElseThrow(() -> new VacademyException("Topic not found"));
    }

    private static void requireUniqueSiblingName(List<QuestionLibraryNode> nodes, String parentId, String name, String selfId) {
        String key = name.toLowerCase(Locale.ROOT);
        for (QuestionLibraryNode node : nodes) {
            if (Objects.equals(node.getParentId(), parentId)
                    && !node.getId().equals(selfId)
                    && node.getName().trim().toLowerCase(Locale.ROOT).equals(key)) {
                throw new VacademyException("A topic named \"" + name + "\" already exists here");
            }
        }
    }

    private static Map<String, QuestionLibraryNode> indexById(List<QuestionLibraryNode> nodes) {
        return nodes.stream().collect(Collectors.toMap(QuestionLibraryNode::getId, n -> n));
    }

    private static String cleanName(String raw) {
        String name = raw == null ? "" : raw.trim().replaceAll("\\s+", " ");
        if (name.isEmpty()) throw new VacademyException("Topic name is required");
        if (name.length() > MAX_NAME_LENGTH) throw new VacademyException("Topic name is too long");
        return name;
    }

    /** Subject tags are stored lowercased. "organic chemistry" reads better as "Organic chemistry". */
    static String displayName(String tagName) {
        if (tagName == null) return "";
        String name = tagName.trim().replaceAll("\\s+", " ");
        if (name.length() > MAX_NAME_LENGTH) name = name.substring(0, MAX_NAME_LENGTH);
        if (name.isEmpty()) return name;
        return name.substring(0, 1).toUpperCase(Locale.ROOT) + name.substring(1);
    }

    private static String questionIdsCsv(List<String> questionIds) {
        List<String> ids = cleanIds(questionIds);
        if (ids.isEmpty()) throw new VacademyException("Choose at least one question");
        if (ids.size() > MAX_QUESTIONS_PER_CALL) {
            throw new VacademyException("At most " + MAX_QUESTIONS_PER_CALL + " questions at a time");
        }
        return String.join(",", ids);
    }

    /** Drops blanks, duplicates and anything with a comma (it would split in string_to_array). */
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
