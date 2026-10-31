package vacademy.io.admin_core_service.features.course_settings.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.chapter.repository.ChapterRepository;
import vacademy.io.admin_core_service.features.course_settings.dto.DripConditionItemDTO;
import vacademy.io.admin_core_service.features.course_settings.dto.DripConditionSettingsDTO;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;

// Course knowledge: deliberately not wired to ContentIndexMarker. Drip rules change
// only access, and course knowledge resolves access at query time.
@Slf4j
@Service
@RequiredArgsConstructor
public class DripConditionService {

        private final PackageRepository packageRepository;
        private final ChapterRepository chapterRepository;
        private final SlideRepository slideRepository;
        private final ObjectMapper objectMapper;

        @Transactional
        public void saveDripConditionSettings(DripConditionSettingsDTO settingsDTO) {
                log.info("[DRIP_DEBUG] saveDripConditionSettings called");

                if (settingsDTO == null) {
                        log.warn("[DRIP_DEBUG] settingsDTO is null");
                        return;
                }

                if (settingsDTO.getConditions() == null) {
                        log.warn("[DRIP_DEBUG] conditions list is null");
                        return;
                }

                log.info("[DRIP_DEBUG] Processing {} conditions", settingsDTO.getConditions().size());

                for (DripConditionItemDTO condition : settingsDTO.getConditions()) {
                        log.info("[DRIP_DEBUG] Processing condition: level={}, levelId={}, enabled={}",
                                        condition != null ? condition.getLevel() : null,
                                        condition != null ? condition.getLevelId() : null,
                                        condition != null ? condition.getEnabled() : null);
                        saveDripCondition(condition);
                }

                log.info("[DRIP_DEBUG] Finished processing all conditions");
        }

        private void saveDripCondition(DripConditionItemDTO condition) {
                if (condition == null) {
                        log.warn("[DRIP_DEBUG] condition is null");
                        return;
                }

                if (condition.getLevel() == null) {
                        log.warn("[DRIP_DEBUG] condition.level is null");
                        return;
                }

                if (condition.getLevelId() == null) {
                        log.warn("[DRIP_DEBUG] condition.levelId is null");
                        return;
                }

                // Convert drip condition object to JSON string
                String dripConditionJson = null;
                if (condition.getEnabled() != null && condition.getEnabled() && condition.getDripCondition() != null) {
                        try {
                                dripConditionJson = objectMapper.writeValueAsString(condition.getDripCondition());
                                log.info("[DRIP_DEBUG] Serialized drip condition JSON: {}", dripConditionJson);
                        } catch (Exception e) {
                                log.error("[DRIP_DEBUG] Failed to serialize drip condition: {}", e.getMessage(), e);
                                return;
                        }
                } else {
                        log.info("[DRIP_DEBUG] Condition disabled or dripCondition is null - enabled: {}, dripCondition: {}",
                                        condition.getEnabled(),
                                        condition.getDripCondition() != null ? "present" : "null");
                }

                // Save to appropriate entity based on level
                String level = condition.getLevel().toLowerCase();
                log.info("[DRIP_DEBUG] Saving to level: {}, levelId: {}", level, condition.getLevelId());

                switch (level) {
                        case "package":
                                saveToPackage(condition.getLevelId(), dripConditionJson);
                                break;
                        case "chapter":
                                saveToChapter(condition.getLevelId(), dripConditionJson);
                                break;
                        case "slide":
                                saveToSlide(condition.getLevelId(), dripConditionJson);
                                break;
                        default:
                                log.error("[DRIP_DEBUG] Unknown level: {}", condition.getLevel());
                }
        }

        private void saveToPackage(String packageId, String dripConditionJson) {
                log.info("[DRIP_DEBUG] saveToPackage called - packageId: {}, json: {}", packageId, dripConditionJson);
                packageRepository.findById(packageId).ifPresentOrElse(
                                packageEntity -> {
                                        log.info("[DRIP_DEBUG] Package found, setting drip condition JSON");
                                        packageEntity.setDripConditionJson(dripConditionJson);
                                        packageRepository.save(packageEntity);
                                        log.info("[DRIP_DEBUG] Package saved successfully with drip condition");
                                },
                                () -> log.warn("[DRIP_DEBUG] Package not found with id: {}", packageId));
        }

        private void saveToChapter(String chapterId, String dripConditionJson) {
                log.info("[DRIP_DEBUG] saveToChapter called - chapterId: {}, json: {}", chapterId, dripConditionJson);
                chapterRepository.findById(chapterId).ifPresentOrElse(
                                chapter -> {
                                        log.info("[DRIP_DEBUG] Chapter found, setting drip condition JSON");
                                        chapter.setDripConditionJson(dripConditionJson);
                                        chapterRepository.save(chapter);
                                        log.info("[DRIP_DEBUG] Chapter saved successfully with drip condition");
                                },
                                () -> log.warn("[DRIP_DEBUG] Chapter not found with id: {}", chapterId));
        }

        private void saveToSlide(String slideId, String dripConditionJson) {
                log.info("[DRIP_DEBUG] saveToSlide called - slideId: {}, json: {}", slideId, dripConditionJson);
                slideRepository.findById(slideId).ifPresentOrElse(
                                slide -> {
                                        log.info("[DRIP_DEBUG] Slide found, setting drip condition JSON");
                                        slide.setDripConditionJson(dripConditionJson);
                                        slideRepository.save(slide);
                                        log.info("[DRIP_DEBUG] Slide saved successfully with drip condition");
                                },
                                () -> log.warn("[DRIP_DEBUG] Slide not found with id: {}", slideId));
        }
}
