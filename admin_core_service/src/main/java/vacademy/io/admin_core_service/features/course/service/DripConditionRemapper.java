package vacademy.io.admin_core_service.features.course.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.chapter.entity.Chapter;
import vacademy.io.admin_core_service.features.chapter.repository.ChapterRepository;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * Walks `drip_condition_json` on cloned chapters/slides after a deep-clone copy
 * and rewrites the `prerequisite` rule's `required_chapters` / `required_slides`
 * arrays so they reference the NEW cloned ids instead of the source course's ids.
 *
 * - date_based, completion_based, sequential rules contain no ids and are left alone.
 * - prerequisite rule ids that fall outside the clone scope are dropped and a
 *   human-readable warning is appended to the result.
 *
 * Course knowledge: deliberately not wired to ContentIndexMarker. Drip rules
 * change only access, and course knowledge resolves access at query time.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class DripConditionRemapper {

    private final ChapterRepository chapterRepository;
    private final SlideRepository slideRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * Remap drip-condition prerequisite ids on the clone targets.
     *
     * @param chapterIdMap oldChapterId -> newChapterId for everything cloned in this pass
     * @param slideIdMap   oldSlideId   -> newSlideId for everything cloned in this pass
     * @return a list of warning strings (one per dropped id reference)
     */
    public List<String> remap(Map<String, String> chapterIdMap, Map<String, String> slideIdMap) {
        List<String> warnings = new ArrayList<>();
        if ((chapterIdMap == null || chapterIdMap.isEmpty())
                && (slideIdMap == null || slideIdMap.isEmpty())) {
            return warnings;
        }

        // Process new chapters
        if (chapterIdMap != null && !chapterIdMap.isEmpty()) {
            List<Chapter> newChapters = chapterRepository.findAllById(chapterIdMap.values());
            List<Chapter> dirty = new ArrayList<>();
            for (Chapter chapter : newChapters) {
                String json = chapter.getDripConditionJson();
                if (json == null || json.trim().isEmpty()) continue;
                String remapped = remapJson(json, chapterIdMap, slideIdMap, warnings,
                        "chapter '" + safeName(chapter.getChapterName()) + "'");
                if (remapped != null && !remapped.equals(json)) {
                    chapter.setDripConditionJson(remapped);
                    dirty.add(chapter);
                }
            }
            if (!dirty.isEmpty()) chapterRepository.saveAll(dirty);
        }

        // Process new slides
        if (slideIdMap != null && !slideIdMap.isEmpty()) {
            List<Slide> newSlides = slideRepository.findAllById(slideIdMap.values());
            List<Slide> dirty = new ArrayList<>();
            for (Slide slide : newSlides) {
                String json = slide.getDripConditionJson();
                if (json == null || json.trim().isEmpty()) continue;
                String remapped = remapJson(json, chapterIdMap, slideIdMap, warnings,
                        "slide '" + safeName(slide.getTitle()) + "'");
                if (remapped != null && !remapped.equals(json)) {
                    slide.setDripConditionJson(remapped);
                    dirty.add(slide);
                }
            }
            if (!dirty.isEmpty()) slideRepository.saveAll(dirty);
        }

        return warnings;
    }

    private String remapJson(String json,
                             Map<String, String> chapterMap,
                             Map<String, String> slideMap,
                             List<String> warnings,
                             String contextLabel) {
        try {
            JsonNode root = objectMapper.readTree(json);
            if (root.isArray()) {
                for (JsonNode condition : root) {
                    remapCondition(condition, chapterMap, slideMap, warnings, contextLabel);
                }
            } else if (root.isObject()) {
                remapCondition(root, chapterMap, slideMap, warnings, contextLabel);
            }
            return objectMapper.writeValueAsString(root);
        } catch (Exception e) {
            log.warn("Failed to parse/remap drip_condition_json for {}: {}", contextLabel, e.getMessage());
            // Leave the original json untouched rather than risk corrupting it.
            return json;
        }
    }

    private void remapCondition(JsonNode condition,
                                Map<String, String> chapterMap,
                                Map<String, String> slideMap,
                                List<String> warnings,
                                String contextLabel) {
        if (condition == null || !condition.isObject()) return;
        JsonNode rules = condition.get("rules");
        if (rules == null || !rules.isArray()) return;

        for (JsonNode rule : rules) {
            if (rule == null || !rule.isObject()) continue;
            JsonNode typeNode = rule.get("type");
            if (typeNode == null || !"prerequisite".equalsIgnoreCase(typeNode.asText())) continue;

            JsonNode params = rule.get("params");
            if (params == null || !params.isObject()) continue;

            remapIdArray((ObjectNode) params, "required_chapters", chapterMap, warnings, contextLabel, "chapter");
            remapIdArray((ObjectNode) params, "required_slides", slideMap, warnings, contextLabel, "slide");
        }
    }

    private void remapIdArray(ObjectNode params,
                              String field,
                              Map<String, String> idMap,
                              List<String> warnings,
                              String contextLabel,
                              String idLabel) {
        JsonNode arr = params.get(field);
        if (arr == null || !arr.isArray()) return;

        ArrayNode rebuilt = objectMapper.createArrayNode();
        Iterator<JsonNode> it = arr.elements();
        while (it.hasNext()) {
            JsonNode el = it.next();
            if (el == null || !el.isTextual()) continue;
            String oldId = el.asText();
            String newId = idMap == null ? null : idMap.get(oldId);
            if (newId != null) {
                rebuilt.add(newId);
            } else {
                warnings.add("Prerequisite " + idLabel + " in " + contextLabel
                        + " was outside the copy scope and was removed.");
            }
        }
        params.set(field, rebuilt);
    }

    private String safeName(String name) {
        if (name == null || name.isEmpty()) return "<unnamed>";
        return name;
    }
}
