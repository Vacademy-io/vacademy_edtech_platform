package vacademy.io.assessment_service.features.question_library.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.question_bank.dto.QuestionBankFilter;
import vacademy.io.assessment_service.features.question_bank.manager.GetQuestionBankManager;
import vacademy.io.assessment_service.features.question_bank.manager.GetQuestionPaperManager;
import vacademy.io.assessment_service.features.question_bank.repository.QuestionPaperRepository;
import vacademy.io.assessment_service.features.question_core.dto.QuestionDTO;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;
import vacademy.io.assessment_service.features.question_library.dto.*;
import vacademy.io.assessment_service.features.question_library.entity.QuestionLibraryNode;
import vacademy.io.assessment_service.features.question_library.repository.QuestionLibraryNodeRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.*;
import java.util.stream.Collectors;

import static vacademy.io.assessment_service.features.question_library.service.QuestionLibraryTreeResolver.ACTIVE;

/**
 * The question library: the questions and papers the platform provides, in a topic tree.
 * <p>
 * All of it lives under one owner institute (see {@link QuestionLibraryAccess}). Its staff
 * manage it through the write methods here, which the controller limits to that institute.
 * Every other institute reads the placed questions and takes copies of what it picks.
 * <p>
 * Topics never own questions. A question stays in the owner's bank whatever happens to the
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
    private static final List<String> PICK_LEVELS = List.of("EASY", "MEDIUM", "HARD");
    /** Keeps one random pick within what the copy endpoint accepts in one call (500). */
    private static final int MAX_PICK_PER_LEVEL = 150;

    @Autowired
    private QuestionLibraryAccess access;

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

    @Autowired
    private QuestionRepository questionRepository;

    // ---------------------------------------------------------------- tree

    public LibraryTreeResponse getTree(String callerInstituteId) {
        String instituteId = access.ownerInstituteId();
        boolean manager = access.isOwner(callerInstituteId);
        if (instituteId == null) {
            return LibraryTreeResponse.builder()
                    .nodes(List.of())
                    .summary(LibrarySummaryDto.builder()
                            .totalQuestions(0L)
                            .unsortedQuestions(0L)
                            .addedLastWeek(0L)
                            .topicCount(0)
                            .byDifficulty(Map.of())
                            .byType(Map.of())
                            .build())
                    .maxDepth(MAX_DEPTH)
                    .canManage(false)
                    .build();
        }
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
                .summary(summary(instituteId, dtos.size(), manager))
                .maxDepth(MAX_DEPTH)
                .canManage(manager)
                .build();
    }

    /** The owner sees its whole working set. Everyone else counts only what is on offer. */
    private LibrarySummaryDto summary(String instituteId, int topicCount, boolean manager) {
        Map<String, Long> byDifficulty = new LinkedHashMap<>();
        Map<String, Long> byType = new LinkedHashMap<>();
        long total = 0;
        List<Object[]> rows = manager
                ? nodeRepository.countLiveQuestionsByDifficultyAndType(instituteId)
                : nodeRepository.countPlacedQuestionsByDifficultyAndType(instituteId);
        for (Object[] row : rows) {
            String difficulty = row[0] == null ? "UNKNOWN" : ((String) row[0]).toUpperCase(Locale.ROOT);
            String type = row[1] == null ? "UNKNOWN" : (String) row[1];
            long count = toLong(row[2]);
            total += count;
            byDifficulty.merge(difficulty, count, Long::sum);
            byType.merge(type, count, Long::sum);
        }
        return LibrarySummaryDto.builder()
                .totalQuestions(total)
                .unsortedQuestions(manager ? nodeRepository.countUnsortedQuestions(instituteId) : 0L)
                .addedLastWeek(manager
                        ? nodeRepository.countQuestionsAddedLastWeek(instituteId)
                        : nodeRepository.countPlacedQuestionsAddedLastWeek(instituteId))
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
        nodeRepository.addPaperToNode(instituteId, request.getNodeId(), request.getQuestionPaperId());
        return LibraryActionResponse.builder().nodesCreated(0).affected(placed).build();
    }

    /** Takes the paper off the topic. Its questions stay filed there; they are managed one by one. */
    @Transactional
    public LibraryActionResponse removePaperFromNode(String instituteId, AddPaperToLibraryNodeRequest request) {
        if (request == null || blankToNull(request.getQuestionPaperId()) == null) {
            throw new VacademyException("question_paper_id is required");
        }
        requireNode(instituteId, request.getNodeId());
        int removed = nodeRepository.removePaperFromNode(instituteId, request.getNodeId(), request.getQuestionPaperId());
        return LibraryActionResponse.builder().nodesCreated(0).affected(removed).build();
    }

    /** Papers on a topic and every topic below it, or on the whole library when no topic is given. */
    public List<LibraryPaperDto> listPapers(String nodeId) {
        String owner = access.ownerInstituteId();
        if (owner == null) return List.of();
        String nodeIdsCsv = null;
        if (blankToNull(nodeId) != null) {
            List<String> expanded = treeResolver.withDescendants(owner, List.of(nodeId));
            if (expanded.isEmpty()) return List.of();
            nodeIdsCsv = String.join(",", expanded);
        }
        // One paper can sit on several topics. It is still one paper in this list.
        Map<String, LibraryPaperDto> papers = new LinkedHashMap<>();
        for (Object[] row : nodeRepository.findPapersOnNodes(owner, nodeIdsCsv)) {
            papers.putIfAbsent((String) row[1], LibraryPaperDto.builder()
                    .nodeId((String) row[0])
                    .id((String) row[1])
                    .title((String) row[2])
                    .questionCount(toLong(row[3]))
                    .build());
        }
        return new ArrayList<>(papers.values());
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
        String owner = access.ownerInstituteId();
        if (owner == null) return Page.empty(PageRequest.of(pageNo, pageSize));
        boolean manager = access.isOwner(instituteId);
        QuestionBankFilter scoped = manager ? filter : readerFilter(owner, filter);
        if (scoped == null) return Page.empty(PageRequest.of(pageNo, pageSize));

        Page<QuestionDTO> page = questionBankManager.getQuestions(user, scoped, owner, pageNo, pageSize);
        List<QuestionDTO> questions = page.getContent();
        if (questions.isEmpty()) return page.map(q -> LibraryQuestionDto.builder().question(q).build());
        Map<String, LibraryQuestionDto> rows = toRows(owner, manager, questions).stream()
                .collect(Collectors.toMap(row -> row.getQuestion().getId(), row -> row));
        return page.map(q -> rows.get(q.getId()));
    }

    /**
     * Random questions per difficulty from the given topics, for building a test quickly.
     * Nothing is written and nothing is copied: the caller shows these first, and adding
     * them goes through the copy endpoint. Only questions placed on a topic can come back.
     */
    @Transactional(readOnly = true)
    public LibraryRandomPickResponse randomPick(String instituteId, LibraryRandomPickRequest request) {
        LibraryRandomPickRequest safe = request == null ? new LibraryRandomPickRequest() : request;
        Map<String, Long> available = new LinkedHashMap<>();
        PICK_LEVELS.forEach(level -> available.put(level, 0L));
        String owner = access.ownerInstituteId();
        String nodeIdsCsv = owner == null ? null : pickNodesCsv(owner, safe.getLibraryNodeIds());
        if (nodeIdsCsv == null) {
            return LibraryRandomPickResponse.builder().available(available).questions(List.of()).build();
        }
        String typesCsv = csvOrNull(safe.getQuestionTypes());
        String excludeCsv = sourcesInSectionCsv(safe.getExcludeQuestionIds());
        for (Object[] row : nodeRepository.countPickableByDifficulty(owner, nodeIdsCsv, typesCsv, excludeCsv)) {
            if (row[0] != null && available.containsKey(row[0])) available.put((String) row[0], toLong(row[1]));
        }
        Map<String, Integer> wanted = Map.of("EASY", clampPick(safe.getEasy()), "MEDIUM", clampPick(safe.getMedium()), "HARD", clampPick(safe.getHard()));
        List<String> ids = new ArrayList<>();
        for (String level : PICK_LEVELS) {
            int limit = wanted.get(level);
            if (limit > 0) ids.addAll(nodeRepository.pickRandomQuestionIds(owner, nodeIdsCsv, typesCsv, excludeCsv, level, limit));
        }
        return LibraryRandomPickResponse.builder()
                .available(available)
                .questions(ids.isEmpty() ? List.of() : toRows(owner, access.isOwner(instituteId), loadInOrder(ids)))
                .build();
    }

    private String pickNodesCsv(String owner, List<String> requested) {
        List<String> nodeIds = requested == null || requested.isEmpty()
                ? treeResolver.activeNodes(owner).stream().map(QuestionLibraryNode::getId).toList()
                : treeResolver.withDescendants(owner, requested);
        return nodeIds.isEmpty() ? null : String.join(",", nodeIds);
    }

    private static int clampPick(Integer count) {
        return count == null ? 0 : Math.max(0, Math.min(count, MAX_PICK_PER_LEVEL));
    }

    private static String csvOrNull(List<String> values) {
        if (values == null) return null;
        String csv = values.stream()
                .filter(v -> v != null && !v.isBlank() && !v.contains(","))
                .collect(Collectors.joining(","));
        return csv.isEmpty() ? null : csv;
    }

    /** The section holds copies, so what must be skipped is the library questions they came from. */
    private String sourcesInSectionCsv(List<String> questionIdsInSection) {
        String csv = csvOrNull(questionIdsInSection);
        return csv == null ? null : csvOrNull(nodeRepository.findLibrarySourcesOfCopies(csv));
    }

    private List<QuestionDTO> loadInOrder(List<String> ids) {
        Map<String, QuestionDTO> byId = questionRepository.findAllById(ids).stream()
                .collect(Collectors.toMap(Question::getId, q -> new QuestionDTO(q, true)));
        return ids.stream().map(byId::get).filter(Objects::nonNull).toList();
    }

    private List<LibraryQuestionDto> toRows(String owner, boolean manager, List<QuestionDTO> questions) {
        // Without the saved subject tags the editor would send an empty list back and
        // the save would wipe them (tags are replace-on-save).
        questionPaperManager.attachSubjectTags(questions);

        String csv = questions.stream().map(QuestionDTO::getId).filter(Objects::nonNull)
                .collect(Collectors.joining(","));
        Map<String, List<String>> nodesByQuestion = new HashMap<>();
        for (Object[] row : nodeRepository.findNodesOfQuestions(owner, csv)) {
            nodesByQuestion.computeIfAbsent((String) row[0], k -> new ArrayList<>()).add((String) row[1]);
        }
        // Usage and provenance describe the owner's own work, not what a reader is choosing.
        Map<String, Long> usage = new HashMap<>();
        if (manager) {
            for (Object[] row : nodeRepository.countAssessmentsUsingQuestions(csv)) {
                usage.put((String) row[0], toLong(row[1]));
            }
        } else {
            questions.forEach(q -> {
                q.setInstituteId(null);
                q.setSourceType(null);
                q.setSourceMeta(null);
            });
        }
        return questions.stream().map(q -> LibraryQuestionDto.builder()
                .question(q)
                .nodeIds(nodesByQuestion.getOrDefault(q.getId(), new ArrayList<>()))
                .assessmentCount(usage.getOrDefault(q.getId(), 0L))
                .build()).toList();
    }

    /**
     * What a non-owner institute may filter on. The owner institute's other questions live
     * in the same table, so the list is always limited to questions placed on a topic:
     * only those are offered. Null means nothing can match.
     */
    private QuestionBankFilter readerFilter(String owner, QuestionBankFilter filter) {
        QuestionBankFilter requested = filter == null ? new QuestionBankFilter() : filter;
        List<String> nodeIds = requested.getLibraryNodeIds();
        if (nodeIds == null || nodeIds.isEmpty()) {
            nodeIds = treeResolver.activeNodes(owner).stream().map(QuestionLibraryNode::getId).toList();
            if (nodeIds.isEmpty()) return null;
        }
        QuestionBankFilter scoped = new QuestionBankFilter();
        scoped.setName(requested.getName());
        scoped.setQuestionTypes(requested.getQuestionTypes());
        scoped.setDifficulties(requested.getDifficulties());
        scoped.setLibraryNodeIds(nodeIds);
        // The section holds copies, so hide the library questions those copies came from.
        List<String> inSection = requested.getExcludeQuestionIds();
        if (inSection != null && !inSection.isEmpty()) {
            String csv = inSection.stream()
                    .filter(id -> id != null && !id.isBlank() && !id.contains(","))
                    .collect(Collectors.joining(","));
            if (!csv.isEmpty()) scoped.setExcludeQuestionIds(nodeRepository.findLibrarySourcesOfCopies(csv));
        }
        return scoped;
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
