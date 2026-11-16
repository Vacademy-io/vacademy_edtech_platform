package vacademy.io.assessment_service.features.question_library.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.assessment_service.features.question_library.dto.*;
import vacademy.io.assessment_service.features.question_library.entity.QuestionLibraryNode;
import vacademy.io.assessment_service.features.question_library.repository.QuestionLibraryNodeRepository;
import vacademy.io.assessment_service.features.tags.entities.repository.TagCommunityRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.*;

import static vacademy.io.assessment_service.features.question_library.service.QuestionLibraryTreeResolver.ACTIVE;

/**
 * The owner's tools for shaping what institutes see in the Question Library: which
 * topic is hidden from which institute, the concept / past-paper / source tags on questions, and
 * difficulty in bulk. Tag lists are read by everyone, scoped to what each one sees.
 * <p>
 * Every write method expects the controller to have checked the caller is the owner.
 */
@Service
public class QuestionLibraryCurationService {

    /** entity_tags.tag_source of the library's own tags. Kept apart from SUBJECT (the editor's) and the AI ones. */
    public static final List<String> TAG_KINDS = List.of("CONCEPT", "PYQ", "SOURCE");
    private static final Set<String> DIFFICULTIES = Set.of("EASY", "MEDIUM", "HARD");
    private static final int MAX_QUESTIONS_PER_CALL = 500;
    private static final int MAX_TAG_LENGTH = 100;

    @Autowired
    private QuestionLibraryNodeRepository nodeRepository;

    @Autowired
    private QuestionLibraryTreeResolver treeResolver;

    @Autowired
    private QuestionLibraryScope scope;

    @Autowired
    private TagCommunityRepository tagRepository;

    @Autowired
    private AdminCoreServiceClient adminCoreServiceClient;

    // ---------------------------------------------------------------- hidden topics

    /** Institutes a topic is hidden from. Every other institute sees it. */
    public List<LibraryAccessDto> listHidden(String ownerId, String nodeId) {
        QuestionLibraryNode node = requireNode(ownerId, nodeId);
        List<LibraryAccessDto> result = new ArrayList<>();
        for (Object[] row : nodeRepository.findHiddenOfNode(node.getId())) {
            result.add(LibraryAccessDto.builder()
                    .instituteId((String) row[0])
                    .instituteName((String) row[1])
                    .createdAt(toDate(row[2]))
                    .build());
        }
        return result;
    }

    /** Hides the topic and everything below it from an institute. Hiding it twice only refreshes the name. */
    @Transactional
    public LibraryAccessDto hide(CustomUserDetails user, String ownerId, LibraryAccessRequest request) {
        if (request == null) throw new VacademyException("Request body is required");
        QuestionLibraryNode node = requireNode(ownerId, request.getNodeId());
        String target = blankToNull(request.getInstituteId());
        if (target == null) throw new VacademyException("Institute ID is required");
        if (target.equals(ownerId)) throw new VacademyException("This institute owns the library and always sees all of it");
        String name = adminCoreServiceClient.getInstituteName(target);
        if (name == null || name.isBlank()) throw new VacademyException("No institute found with this ID");
        nodeRepository.hideNode(node.getId(), target, name.trim(), user == null ? null : user.getUserId());
        return LibraryAccessDto.builder().instituteId(target).instituteName(name.trim()).createdAt(new Date()).build();
    }

    /** Shows a hidden topic to the institute again. */
    @Transactional
    public LibraryActionResponse unhide(String ownerId, LibraryAccessRequest request) {
        if (request == null) throw new VacademyException("Request body is required");
        QuestionLibraryNode node = requireNode(ownerId, request.getNodeId());
        String target = blankToNull(request.getInstituteId());
        if (target == null) throw new VacademyException("Institute ID is required");
        int removed = nodeRepository.unhideNode(node.getId(), target);
        return LibraryActionResponse.builder().nodesCreated(0).affected(removed).build();
    }

    // ---------------------------------------------------------------- tags

    /**
     * Tags in use under a topic (and the topics below it), or across everything the caller
     * sees. The owner's list without a topic also covers questions not filed anywhere yet.
     */
    public List<LibraryTagDto> listTags(String callerInstituteId, String nodeId) {
        QuestionLibraryScope.View view = scope.of(callerInstituteId);
        if (view.empty()) return List.of();
        String placedOnly = "1";
        String nodeIdsCsv;
        String topic = blankToNull(nodeId);
        if (topic != null) {
            if (!view.sees(topic)) return List.of();
            nodeIdsCsv = String.join(",", view.visibleOnly(treeResolver.withDescendants(view.owner(), List.of(topic))));
        } else if (view.manager()) {
            placedOnly = null;
            nodeIdsCsv = null;
        } else {
            nodeIdsCsv = view.limitCsv();
        }
        List<LibraryTagDto> tags = new ArrayList<>();
        for (Object[] row : nodeRepository.findLibraryTagsWithCounts(view.owner(), placedOnly, nodeIdsCsv)) {
            tags.add(LibraryTagDto.builder()
                    .tagId((String) row[0])
                    .tagName((String) row[1])
                    .kind((String) row[2])
                    .questionCount(toLong(row[3]))
                    .build());
        }
        return tags;
    }

    /** Puts a tag on questions, creating the tag when the owner has none by that name (any case). */
    @Transactional
    public LibraryActionResponse addTag(String ownerId, LibraryTagRequest request) {
        if (request == null) throw new VacademyException("Request body is required");
        String kind = kindOf(request.getKind());
        String name = request.getName() == null ? "" : request.getName().trim().replaceAll("\\s+", " ");
        if (name.isEmpty()) throw new VacademyException("Tag name is required");
        if (name.length() > MAX_TAG_LENGTH) throw new VacademyException("Tag name is too long");
        String questionCsv = questionIdsCsv(request.getQuestionIds());

        String tagId = resolveTagId(ownerId, name);
        int added = nodeRepository.addLibraryTag(ownerId, questionCsv, tagId, kind);
        return LibraryActionResponse.builder().nodesCreated(0).affected(added).build();
    }

    @Transactional
    public LibraryActionResponse removeTag(String ownerId, LibraryTagRequest request) {
        if (request == null || blankToNull(request.getTagId()) == null) throw new VacademyException("tag_id is required");
        int removed = nodeRepository.removeLibraryTag(ownerId, questionIdsCsv(request.getQuestionIds()), request.getTagId().trim());
        return LibraryActionResponse.builder().nodesCreated(0).affected(removed).build();
    }

    // ---------------------------------------------------------------- difficulty

    /** Difficulty is a label, not content, so it changes in place even on questions tests already use. */
    @Transactional
    public LibraryActionResponse setDifficulty(String ownerId, LibraryDifficultyRequest request) {
        if (request == null) throw new VacademyException("Request body is required");
        String difficulty = request.getDifficulty() == null ? "" : request.getDifficulty().trim().toUpperCase(Locale.ROOT);
        if (!DIFFICULTIES.contains(difficulty)) throw new VacademyException("Difficulty must be EASY, MEDIUM or HARD");
        int changed = nodeRepository.setDifficulty(ownerId, questionIdsCsv(request.getQuestionIds()), difficulty);
        return LibraryActionResponse.builder().nodesCreated(0).affected(changed).build();
    }

    // ---------------------------------------------------------------- helpers

    /** The owner's tag with this name (any case), created when it has none. */
    String resolveTagId(String ownerId, String name) {
        String tagId = nodeRepository.findTagIdByName(ownerId, name);
        return tagId != null ? tagId : tagRepository.insertTagIfNotExists(UUID.randomUUID().toString(), name, ownerId);
    }

    static String kindOf(String raw) {
        String kind = raw == null ? "" : raw.trim().toUpperCase(Locale.ROOT);
        if (!TAG_KINDS.contains(kind)) throw new VacademyException("Tag kind must be CONCEPT, PYQ or SOURCE");
        return kind;
    }

    private QuestionLibraryNode requireNode(String ownerId, String nodeId) {
        if (blankToNull(nodeId) == null) throw new VacademyException("node_id is required");
        return nodeRepository.findByIdAndInstituteIdAndStatus(nodeId.trim(), ownerId, ACTIVE)
                .orElseThrow(() -> new VacademyException("Topic not found"));
    }

    private static String questionIdsCsv(List<String> questionIds) {
        List<String> ids = questionIds == null ? List.of() : questionIds.stream()
                .filter(id -> id != null && !id.isBlank() && !id.contains(","))
                .map(String::trim)
                .distinct()
                .toList();
        if (ids.isEmpty()) throw new VacademyException("Choose at least one question");
        if (ids.size() > MAX_QUESTIONS_PER_CALL) {
            throw new VacademyException("At most " + MAX_QUESTIONS_PER_CALL + " questions at a time");
        }
        return String.join(",", ids);
    }

    private static String blankToNull(String value) {
        return (value == null || value.isBlank()) ? null : value.trim();
    }

    /** Native timestamps come back as java.sql.Timestamp or java.time types depending on the driver path. */
    static Date toDate(Object value) {
        if (value instanceof Date date) return date;
        if (value instanceof java.time.LocalDateTime local) return java.sql.Timestamp.valueOf(local);
        if (value instanceof java.time.Instant instant) return Date.from(instant);
        if (value instanceof java.time.OffsetDateTime offset) return Date.from(offset.toInstant());
        return null;
    }

    private static long toLong(Object value) {
        return value == null ? 0L : ((Number) value).longValue();
    }
}
