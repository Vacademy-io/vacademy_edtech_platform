package vacademy.io.assessment_service.features.question_library.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.assessment_service.features.assessment.client.AiServiceLlmClient;
import vacademy.io.assessment_service.features.question_core.dto.OptionDTO;
import vacademy.io.assessment_service.features.question_core.dto.QuestionDTO;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;
import vacademy.io.assessment_service.features.question_library.dto.LibraryAutoTagRequest;
import vacademy.io.assessment_service.features.question_library.dto.LibraryAutoTagResponse;
import vacademy.io.assessment_service.features.question_library.dto.LibraryTagDto;
import vacademy.io.assessment_service.features.question_library.dto.LibraryTagRequest;
import vacademy.io.assessment_service.features.question_library.entity.QuestionLibraryNode;
import vacademy.io.assessment_service.features.question_library.repository.QuestionLibraryNodeRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Duration;
import java.util.*;
import java.util.stream.Collectors;

/**
 * AI concept tags for the library: the owner picks a topic and the questions under it with no
 * concept tag get one to three, a batch at a time. The model is asked to reuse the concept
 * tags already used under that topic, so the filter panel stays short.
 * <p>
 * One call does one batch and returns what it tried, so the page drives the run, shows
 * progress and can stop. The model is chosen by ai_service for the question_metadata use
 * case, which records the usage. No credits are charged: this is the library owner curating
 * its own content.
 */
@Service
@Slf4j
public class QuestionLibraryAutoTagService {

    static final String USE_CASE = "question_metadata";
    static final int DEFAULT_BATCH = 20;
    static final int MAX_BATCH = 25;
    static final int MAX_TAGS_PER_QUESTION = 3;
    static final int MAX_TAG_LENGTH = 60;
    private static final int MAX_EXISTING_IN_PROMPT = 80;
    private static final int MAX_TEXT_CHARS = 700;
    private static final int MAX_OPTION_CHARS = 120;
    private static final int MAX_EXCLUDED = 10000;
    private static final int MAX_COMPLETION_TOKENS = 3000;
    private static final Duration TIMEOUT = Duration.ofSeconds(120);

    static final String SYSTEM_PROMPT = """
            You tag exam questions with the concepts they test, for a question bank that teachers filter by topic.
            Rules:
            1. Give each question 1 to 3 concept tags, the most specific first.
            2. A tag is a short noun phrase of 1 to 5 words in Title Case, for example "Projectile Motion", "Ohm's Law", "Article 21".
            3. When a tag from EXISTING TAGS fits, use it spelled exactly as given. Make a new tag only when none fits.
            4. Never use the chapter, subject or course name itself, the difficulty, the question type, or vague words such as Question, Basics, General, Misc.
            5. Write tags in the language of the question.
            6. Answer with JSON only: {"questions":[{"id":"<id>","tags":["..."]}]} with one entry for every id given. Use "tags":[] when you cannot tell.
            """;

    @Autowired
    private QuestionLibraryNodeRepository nodeRepository;

    @Autowired
    private QuestionLibraryTreeResolver treeResolver;

    @Autowired
    private QuestionLibraryCurationService curationService;

    @Autowired
    private QuestionRepository questionRepository;

    @Autowired
    private AiServiceLlmClient llmClient;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private PlatformTransactionManager transactionManager;

    /** Tags one batch under the topic, or with limit 0 only counts what is left. */
    public LibraryAutoTagResponse autoTag(String ownerId, LibraryAutoTagRequest request) {
        if (request == null || blank(request.getNodeId())) throw new VacademyException("node_id is required");
        String nodeId = request.getNodeId().trim();
        List<QuestionLibraryNode> nodes = treeResolver.activeNodes(ownerId);
        Map<String, QuestionLibraryNode> byId = nodes.stream()
                .collect(Collectors.toMap(QuestionLibraryNode::getId, n -> n));
        if (!byId.containsKey(nodeId)) throw new VacademyException("Topic not found");

        String scopeCsv = String.join(",", QuestionLibraryTreeResolver.subtreeIds(
                QuestionLibraryTreeResolver.childrenByParent(nodes), List.of(nodeId)));
        List<String> excluded = cleanIds(request.getExcludeQuestionIds());
        if (excluded.size() > MAX_EXCLUDED) excluded = excluded.subList(0, MAX_EXCLUDED);
        int limit = request.getLimit() == null ? DEFAULT_BATCH : Math.max(0, Math.min(request.getLimit(), MAX_BATCH));

        if (limit == 0) {
            return LibraryAutoTagResponse.builder()
                    .attemptedIds(List.of())
                    .tagged(0)
                    .remaining(nodeRepository.countQuestionsWithoutConcept(ownerId, scopeCsv, csvOrNull(excluded)))
                    .tags(List.of())
                    .build();
        }

        List<String> ids = nodeRepository.findQuestionsWithoutConcept(ownerId, scopeCsv, csvOrNull(excluded), limit);
        if (ids.isEmpty()) {
            return LibraryAutoTagResponse.builder().attemptedIds(List.of()).tagged(0).remaining(0L).tags(List.of()).build();
        }

        Map<String, List<String>> pathByQuestion = pathsOf(ownerId, ids, byId);
        List<String> existing = curationService.listTags(ownerId, nodeId).stream()
                .filter(tag -> "CONCEPT".equals(tag.getKind()))
                .sorted(Comparator.comparing((LibraryTagDto tag) -> tag.getQuestionCount() == null ? 0L : tag.getQuestionCount())
                        .reversed())
                .limit(MAX_EXISTING_IN_PROMPT)
                .map(LibraryTagDto::getTagName)
                .toList();
        // Read in a short transaction of its own: the model call below can take a minute and
        // must not hold a connection.
        TransactionTemplate read = new TransactionTemplate(transactionManager);
        read.setReadOnly(true);
        Map<String, QuestionDTO> questions = read.execute(status -> questionRepository.findAllById(ids).stream()
                .collect(Collectors.toMap(Question::getId, q -> new QuestionDTO(q, false))));

        String answer = complete(ownerId, buildPrompt(ids, questions, pathByQuestion, existing));
        Map<String, List<String>> tagsByQuestion = parse(answer, new HashSet<>(ids), pathByQuestion);

        // One write per tag name. Case is folded so "projectile motion" and "Projectile Motion"
        // land on one tag; resolveTagId keeps the spelling of a tag that already exists.
        Map<String, String> spelling = new LinkedHashMap<>();
        existing.forEach(name -> spelling.putIfAbsent(name.toLowerCase(Locale.ROOT), name));
        Map<String, List<String>> questionsByTag = new LinkedHashMap<>();
        tagsByQuestion.forEach((questionId, names) -> names.forEach(name -> {
            String key = name.toLowerCase(Locale.ROOT);
            spelling.putIfAbsent(key, name);
            questionsByTag.computeIfAbsent(key, k -> new ArrayList<>()).add(questionId);
        }));
        List<String> used = new ArrayList<>();
        questionsByTag.forEach((key, questionIds) -> {
            String name = spelling.get(key);
            curationService.addTag(ownerId, LibraryTagRequest.builder()
                    .questionIds(questionIds)
                    .kind("CONCEPT")
                    .name(name)
                    .build());
            used.add(name);
        });

        List<String> tried = new ArrayList<>(excluded);
        tried.addAll(ids);
        long tagged = tagsByQuestion.values().stream().filter(names -> !names.isEmpty()).count();
        log.info("Library AI tagging under {}: {} tried, {} tagged, {} tag names", nodeId, ids.size(), tagged, used.size());
        return LibraryAutoTagResponse.builder()
                .attemptedIds(ids)
                .tagged((int) tagged)
                .remaining(nodeRepository.countQuestionsWithoutConcept(ownerId, scopeCsv, csvOrNull(tried)))
                .tags(used)
                .build();
    }

    private String complete(String ownerId, String prompt) {
        List<Map<String, String>> messages = List.of(
                Map.of("role", "system", "content", SYSTEM_PROMPT),
                Map.of("role", "user", "content", prompt));
        try {
            AiServiceLlmClient.Completion completion = llmClient.complete(USE_CASE, messages, true,
                    MAX_COMPLETION_TOKENS, "low", ownerId, TIMEOUT);
            return completion.content();
        } catch (AiServiceLlmClient.PolicyRefusalException e) {
            throw new VacademyException(e.getMessage());
        } catch (AiServiceLlmClient.UnavailableException e) {
            log.warn("Library AI tagging: ai_service unavailable: {}", e.getMessage());
            throw new VacademyException("AI tagging is not available right now. Please try again later.");
        } catch (AiServiceLlmClient.CompletionException e) {
            log.error("Library AI tagging: model call failed: {}", e.getMessage());
            throw new VacademyException("AI tagging failed for this batch. Please try again.");
        }
    }

    /** Names from the course down to the topic, for each question (its first topic). */
    private Map<String, List<String>> pathsOf(String ownerId, List<String> ids, Map<String, QuestionLibraryNode> byId) {
        Map<String, List<String>> paths = new HashMap<>();
        for (Object[] row : nodeRepository.findNodesOfQuestions(ownerId, String.join(",", ids))) {
            String questionId = (String) row[0];
            if (paths.containsKey(questionId)) continue;
            List<String> names = new ArrayList<>();
            Set<String> seen = new HashSet<>();
            QuestionLibraryNode node = byId.get((String) row[1]);
            while (node != null && seen.add(node.getId())) {
                names.add(0, node.getName());
                node = node.getParentId() == null ? null : byId.get(node.getParentId());
            }
            if (!names.isEmpty()) paths.put(questionId, names);
        }
        return paths;
    }

    static String buildPrompt(List<String> ids, Map<String, QuestionDTO> questions,
                              Map<String, List<String>> pathByQuestion, List<String> existing) {
        StringBuilder prompt = new StringBuilder();
        prompt.append("EXISTING TAGS: ").append(existing.isEmpty() ? "(none yet)" : String.join("; ", existing)).append("\n\n");
        prompt.append("QUESTIONS:\n");
        int n = 1;
        for (String id : ids) {
            QuestionDTO question = questions.get(id);
            if (question == null) continue;
            prompt.append('[').append(n++).append("] id: ").append(id).append('\n');
            List<String> path = pathByQuestion.get(id);
            if (path != null) prompt.append("chapter: ").append(String.join(" > ", path)).append('\n');
            prompt.append("text: ").append(plain(question.getText() == null ? null : question.getText().getContent(), MAX_TEXT_CHARS)).append('\n');
            List<String> options = new ArrayList<>();
            char letter = 'A';
            for (OptionDTO option : question.getOptions() == null ? List.<OptionDTO>of() : question.getOptions()) {
                String text = plain(option.getText() == null ? null : option.getText().getContent(), MAX_OPTION_CHARS);
                if (!text.isEmpty()) options.add(letter + ") " + text);
                letter++;
            }
            if (!options.isEmpty()) prompt.append("options: ").append(String.join(" | ", options)).append('\n');
            prompt.append('\n');
        }
        return prompt.toString();
    }

    /**
     * The model's tags per question id, cleaned: only ids that were asked about, at most three
     * tags each, no repeats (any case), no chapter or course names, nothing over 60 characters.
     */
    Map<String, List<String>> parse(String answer, Set<String> asked, Map<String, List<String>> pathByQuestion) {
        Map<String, List<String>> result = new LinkedHashMap<>();
        JsonNode root;
        try {
            root = objectMapper.readTree(answer == null ? "" : answer.trim());
        } catch (Exception e) {
            log.warn("Library AI tagging: answer is not JSON: {}", e.getMessage());
            throw new VacademyException("AI tagging returned an unreadable answer. Please try again.");
        }
        JsonNode list = root == null ? null : root.path("questions");
        if (list == null || !list.isArray()) return result;
        for (JsonNode item : list) {
            String id = item.path("id").asText("").trim();
            if (!asked.contains(id) || result.containsKey(id)) continue;
            Set<String> banned = pathByQuestion.getOrDefault(id, List.of()).stream()
                    .map(name -> name.trim().toLowerCase(Locale.ROOT))
                    .collect(Collectors.toSet());
            List<String> names = new ArrayList<>();
            Set<String> seen = new HashSet<>();
            for (JsonNode tag : item.path("tags")) {
                String name = cleanTag(tag.asText(""));
                String key = name.toLowerCase(Locale.ROOT);
                if (name.isEmpty() || banned.contains(key) || !seen.add(key)) continue;
                names.add(name);
                if (names.size() == MAX_TAGS_PER_QUESTION) break;
            }
            result.put(id, names);
        }
        return result;
    }

    static String cleanTag(String raw) {
        if (raw == null) return "";
        String name = raw.replaceAll("[\\r\\n\\t]", " ")
                .replaceAll("^[\\s\"'`#*.,;:-]+|[\\s\"'`#*.,;:-]+$", "")
                .replaceAll("\\s+", " ")
                .trim();
        return name.length() > MAX_TAG_LENGTH ? "" : name;
    }

    private static String plain(String html, int max) {
        if (html == null) return "";
        String text = html.replaceAll("<[^>]*>", " ")
                .replace("&nbsp;", " ")
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replaceAll("\\s+", " ")
                .trim();
        return text.length() <= max ? text : text.substring(0, max - 1) + "…";
    }

    private static List<String> cleanIds(List<String> ids) {
        if (ids == null) return List.of();
        return ids.stream()
                .filter(id -> id != null && !id.isBlank() && !id.contains(","))
                .map(String::trim)
                .distinct()
                .collect(Collectors.toCollection(ArrayList::new));
    }

    private static String csvOrNull(List<String> ids) {
        return ids == null || ids.isEmpty() ? null : String.join(",", ids);
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
