package vacademy.io.assessment_service.features.question_library.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.question_bank.manager.AddQuestionPaperFromImportManager;
import vacademy.io.assessment_service.features.question_core.dto.QuestionDTO;
import vacademy.io.assessment_service.features.rich_text.entity.AssessmentRichTextData;
import vacademy.io.assessment_service.features.question_core.entity.Option;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.OptionRepository;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;
import vacademy.io.assessment_service.features.question_library.dto.LibraryImportRequest;
import vacademy.io.assessment_service.features.question_library.dto.LibraryImportResponse;
import vacademy.io.assessment_service.features.question_library.entity.QuestionLibraryNode;
import vacademy.io.assessment_service.features.question_library.repository.QuestionLibraryNodeRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.*;

import static vacademy.io.assessment_service.features.question_library.service.QuestionLibraryTreeResolver.ACTIVE;

/**
 * Saves new questions straight into the library: a Word upload, AI questions, one written
 * by hand, or rows of the Excel template. Each question becomes a row of the owner
 * institute, is filed under its topic (missing topics are created on the way), and gets
 * its difficulty and library tags, all in one transaction.
 * <p>
 * One question that cannot be built does not cost the others: it is reported and skipped.
 * The controller limits this to the owner institute.
 */
@Slf4j
@Service
public class QuestionLibraryImportService {

    /** Same bound as the other bulk calls; the admin app sends bigger files in chunks. */
    static final int MAX_ITEMS_PER_CALL = 500;
    private static final int MAX_NAME_LENGTH = 255;
    private static final Set<String> DIFFICULTIES = Set.of("EASY", "MEDIUM", "HARD");

    @Autowired
    private QuestionLibraryNodeRepository nodeRepository;

    @Autowired
    private QuestionLibraryTreeResolver treeResolver;

    @Autowired
    private QuestionLibraryCurationService curationService;

    @Autowired
    private QuestionRepository questionRepository;

    @Autowired
    private OptionRepository optionRepository;

    @Autowired
    private AddQuestionPaperFromImportManager importManager;

    @Transactional
    public LibraryImportResponse importQuestions(CustomUserDetails user, String ownerId, LibraryImportRequest request) {
        if (request == null || request.getItems() == null || request.getItems().isEmpty()) {
            throw new VacademyException("Add at least one question");
        }
        if (request.getItems().size() > MAX_ITEMS_PER_CALL) {
            throw new VacademyException("At most " + MAX_ITEMS_PER_CALL + " questions at a time");
        }
        Topics topics = new Topics(ownerId, user == null ? null : user.getUserId());
        String parentId = blank(request.getParentId()) ? null : request.getParentId().trim();
        if (parentId != null && !topics.byId.containsKey(parentId)) throw new VacademyException("Topic not found");

        List<String> errors = new ArrayList<>();
        List<Question> saved = new ArrayList<>();
        List<QuestionDTO> savedDtos = new ArrayList<>();
        Map<String, List<String>> questionsByNode = new LinkedHashMap<>();
        // Keyed by kind + lower-cased name, so "Article 21" and "article 21" on two rows are one tag.
        Map<String, List<String>> questionsByTag = new LinkedHashMap<>();
        Map<String, String[]> tagByKey = new HashMap<>();

        List<LibraryImportRequest.Item> items = request.getItems();
        for (int i = 0; i < items.size(); i++) {
            LibraryImportRequest.Item item = items.get(i);
            String label = "Item " + (i + 1) + ": ";
            try {
                if (item == null || item.getQuestion() == null) throw new VacademyException("question is missing");
                List<String[]> tags = cleanTags(item.getTags());
                QuestionDTO dto = item.getQuestion();
                Question question = build(ownerId, dto, item.getDifficulty());
                // Topics last, so a question that cannot be built leaves no empty new topic behind.
                String nodeId = topics.resolve(parentId, item.getPath());
                if (nodeId == null) throw new VacademyException("choose a topic for this question");

                List<Option> options = new ArrayList<>(question.getOptions() == null ? List.of() : question.getOptions());
                Question row = questionRepository.save(question);
                if (!options.isEmpty()) optionRepository.saveAll(options);
                saved.add(row);
                savedDtos.add(dto);
                questionsByNode.computeIfAbsent(nodeId, k -> new ArrayList<>()).add(row.getId());
                for (String[] tag : tags) {
                    String key = tag[0] + "|" + tag[1].toLowerCase(Locale.ROOT);
                    tagByKey.putIfAbsent(key, tag);
                    questionsByTag.computeIfAbsent(key, k -> new ArrayList<>()).add(row.getId());
                }
            } catch (VacademyException e) {
                errors.add(label + e.getMessage());
            } catch (Exception e) {
                log.warn("Could not import library question {}: {}", i + 1, e.getMessage());
                errors.add(label + "the question could not be read");
            }
        }

        if (!saved.isEmpty()) {
            // The placements and tags below are native INSERT ... SELECT FROM question, so the
            // new rows must be in the database first.
            questionRepository.flush();
            optionRepository.flush();
            // Subject tags typed in the editor or the Word file, resolved inside the owner institute.
            importManager.addQuestionEntityTags(saved, savedDtos, ownerId);
            questionsByNode.forEach((nodeId, ids) ->
                    nodeRepository.addQuestionsToNode(ownerId, nodeId, String.join(",", ids)));
            questionsByTag.forEach((key, ids) -> {
                String[] tag = tagByKey.get(key);
                String tagId = curationService.resolveTagId(ownerId, tag[1]);
                nodeRepository.addLibraryTag(ownerId, String.join(",", ids), tagId, tag[0]);
            });
        }
        return LibraryImportResponse.builder()
                .created(saved.size())
                .nodesCreated(topics.created)
                .errors(errors)
                .build();
    }

    private Question build(String ownerId, QuestionDTO dto, String difficulty) throws Exception {
        // A new question owns all of its rows. Ids left on the payload would make the builder
        // re-parent existing options or rich texts onto this question.
        QuestionLibraryEditService.detachFromOldRows(dto);
        dto.setId(null);
        dto.setAiDifficultyLevel(difficultyOf(difficulty, dto.getAiDifficultyLevel()));
        if (dto.getQuestionType() == null || dto.getQuestionType().isBlank()) {
            throw new VacademyException("question type is missing");
        }
        Question question = importManager.makeQuestionAndOptionFromImportQuestion(dto, false, null);
        if (dto.getParentRichText() != null) {
            question.setParentRichText(AssessmentRichTextData.fromDTO(dto.getParentRichText()));
        }
        question.setInstituteId(ownerId);
        return question;
    }

    /** The asked difficulty, else the question's own, else MEDIUM. An unknown asked value is an error. */
    static String difficultyOf(String asked, String own) {
        if (!blank(asked)) {
            String level = asked.trim().toUpperCase(Locale.ROOT);
            if (!DIFFICULTIES.contains(level)) throw new VacademyException("difficulty must be Easy, Medium or Hard");
            return level;
        }
        String level = own == null ? "" : own.trim().toUpperCase(Locale.ROOT);
        return DIFFICULTIES.contains(level) ? level : "MEDIUM";
    }

    /** [kind, name] pairs, blanks dropped, duplicates (any case) merged. */
    private static List<String[]> cleanTags(List<LibraryImportRequest.TagInput> raw) {
        if (raw == null || raw.isEmpty()) return List.of();
        Map<String, String[]> unique = new LinkedHashMap<>();
        for (LibraryImportRequest.TagInput tag : raw) {
            if (tag == null || blank(tag.getName())) continue;
            String kind = QuestionLibraryCurationService.kindOf(tag.getKind());
            String name = tag.getName().trim().replaceAll("\\s+", " ");
            if (name.length() > 100) throw new VacademyException("tag \"" + name.substring(0, 20) + "...\" is too long");
            unique.putIfAbsent(kind + "|" + name.toLowerCase(Locale.ROOT), new String[]{kind, name});
        }
        return new ArrayList<>(unique.values());
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }

    /**
     * The owner's topic tree during one import: finds a topic by name under its parent
     * (ignoring case) and creates it when it is missing, so the same new chapter named on
     * fifty rows is created once.
     */
    private final class Topics {
        private final String ownerId;
        private final String userId;
        private final Map<String, QuestionLibraryNode> byId = new HashMap<>();
        private final Map<String, String> idByParentAndName = new HashMap<>();
        private final Map<String, Integer> nextOrder = new HashMap<>();
        private int created;

        Topics(String ownerId, String userId) {
            this.ownerId = ownerId;
            this.userId = userId;
            for (QuestionLibraryNode node : treeResolver.activeNodes(ownerId)) {
                byId.put(node.getId(), node);
                idByParentAndName.put(key(node.getParentId(), node.getName()), node.getId());
            }
        }

        private String key(String parentId, String name) {
            return (parentId == null ? "" : parentId) + "\u0000" + name.trim().toLowerCase(Locale.ROOT);
        }

        /** The topic at path below parentId, created as needed. Null when both are empty. */
        String resolve(String parentId, List<String> path) {
            List<String> names = path == null ? List.of() : path.stream()
                    .filter(name -> !blank(name))
                    .map(name -> name.trim().replaceAll("\\s+", " "))
                    .toList();
            int depth = parentId == null ? 0 : QuestionLibraryTreeResolver.depthOf(parentId, byId);
            if (depth + names.size() > QuestionLibraryService.MAX_DEPTH) {
                throw new VacademyException("topics can be at most " + QuestionLibraryService.MAX_DEPTH + " levels deep");
            }
            String current = parentId;
            for (String name : names) {
                if (name.length() > MAX_NAME_LENGTH) throw new VacademyException("topic name is too long");
                String existing = idByParentAndName.get(key(current, name));
                current = existing != null ? existing : create(current, name);
            }
            return current;
        }

        private String create(String parentId, String name) {
            int order = nextOrder.computeIfAbsent(parentId == null ? "" : parentId, k -> {
                Integer max = nodeRepository.findMaxDisplayOrder(ownerId, parentId);
                return max == null ? 0 : max + 1;
            });
            nextOrder.put(parentId == null ? "" : parentId, order + 1);
            QuestionLibraryNode node = nodeRepository.save(QuestionLibraryNode.builder()
                    .instituteId(ownerId)
                    .parentId(parentId)
                    .name(name)
                    .displayOrder(order)
                    .status(ACTIVE)
                    .createdBy(userId)
                    .build());
            byId.put(node.getId(), node);
            idByParentAndName.put(key(parentId, name), node.getId());
            created++;
            return node.getId();
        }
    }
}
