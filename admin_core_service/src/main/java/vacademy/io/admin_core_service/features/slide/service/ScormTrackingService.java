package vacademy.io.admin_core_service.features.slide.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.learner_tracking.service.LearnerTrackingAsyncService;
import vacademy.io.admin_core_service.features.slide.dto.ScormTrackingDTO;
import vacademy.io.admin_core_service.features.slide.entity.ScormLearnerProgress;
import vacademy.io.admin_core_service.features.slide.repository.ScormLearnerProgressRepository;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.Optional;

@Service
@RequiredArgsConstructor
@Slf4j
public class ScormTrackingService {

    private final ScormLearnerProgressRepository scormLearnerProgressRepository;
    private final ObjectMapper objectMapper;
    private final LearnerTrackingAsyncService learnerTrackingAsyncService;

    @Transactional
    public ScormTrackingDTO initializeSession(String userId, String slideId) {
        // Find latest attempt
        Optional<ScormLearnerProgress> progressOpt = scormLearnerProgressRepository
                .findTopByUserIdAndSlideIdOrderByAttemptNumberDesc(userId, slideId);

        ScormLearnerProgress progress;
        boolean isResume;
        if (progressOpt.isPresent()) {
            progress = progressOpt.get();
            // Optional: Logic to decide if we need a new attempt (e.g., if previous was
            // completed)
            // For simplicity, we reuse the attempt if not strictly completed/finalized, or
            // create new if needed.
            // Here we just return the latest state to resume.
            isResume = true;
        } else {
            // Create first attempt
            progress = new ScormLearnerProgress();
            progress.setId(UUID.randomUUID().toString());
            progress.setUserId(userId);
            progress.setSlideId(slideId);
            progress.setAttemptNumber(1);
            progress.setCompletionStatus("not attempted");
            progress.setSuccessStatus("unknown");
            progress = scormLearnerProgressRepository.save(progress);
            isResume = false;
        }

        ScormTrackingDTO dto = mapToDTO(progress);
        // Inject cmi.entry per SCORM 2004 spec. Tells the lesson runtime
        // whether to treat this launch as a fresh attempt (ab-initio) or a
        // continuation that should attempt to restore cmi.suspend_data /
        // cmi.location. Without this, well-authored packages that strictly
        // check cmi.entry before reading suspend_data start fresh on every
        // launch — even when valid resume state exists on the server.
        //
        // Permissive interpretation: emit "resume" whenever an existing row
        // is found, regardless of the previous cmi.exit value. Strict spec
        // would require cmi.exit == "suspend"; in practice many lessons
        // never set cmi.exit on close (tab close, navigation away), so
        // strict mode would miss the common case. Packages that don't write
        // suspend_data themselves will see "resume" but have nothing to
        // restore — they fall back to fresh start. No harm.
        Map<String, Object> cmi = dto.getCmiJson() != null
                ? new HashMap<>(dto.getCmiJson())
                : new HashMap<>();
        cmi.put("cmi.entry", isResume ? "resume" : "ab-initio");
        // Learner identity (1.2 and 2004 spellings). Packages that keep their
        // own browser-storage copy of progress key it on this; without it every
        // account opened in the same browser reads the same copy.
        cmi.put("cmi.core.student_id", userId);
        cmi.put("cmi.learner_id", userId);
        dto.setCmiJson(cmi);
        return dto;
    }

    @Transactional
    public void commitSession(String userId, String slideId, ScormTrackingDTO trackingDTO) {
        Optional<ScormLearnerProgress> progressOpt = scormLearnerProgressRepository
                .findTopByUserIdAndSlideIdOrderByAttemptNumberDesc(userId, slideId);

        if (progressOpt.isEmpty()) {
            throw new RuntimeException("No active session found for committing. Call initialize first.");
        }

        ScormLearnerProgress progress = progressOpt.get();
        updateProgressFromDTO(progress, trackingDTO);
        scormLearnerProgressRepository.save(progress);

        // Compute percentage and trigger the learner_operation cascade so the
        // slide / chapter / module / subject / package_session rollups stay in
        // sync with what the SCORM runtime is reporting. Skip the cascade if
        // any of the parent IDs is missing — the commit still persists; we
        // just can't roll up without context.
        Double percentage = computeScormCompletionPercentage(progress);
        if (percentage == null) {
            log.debug("[SCORM] No percentage derivable yet for slide {} user {} — skip cascade", slideId, userId);
            return;
        }
        if (trackingDTO.getChapterId() == null || trackingDTO.getModuleId() == null
                || trackingDTO.getSubjectId() == null || trackingDTO.getPackageSessionId() == null) {
            log.warn("[SCORM] Cascade IDs missing for slide {} user {} — persisted commit but skipping cascade. "
                    + "chapterId={}, moduleId={}, subjectId={}, packageSessionId={}",
                    slideId, userId, trackingDTO.getChapterId(), trackingDTO.getModuleId(),
                    trackingDTO.getSubjectId(), trackingDTO.getPackageSessionId());
            return;
        }
        learnerTrackingAsyncService.updateLearnerOperationsForScorm(userId, slideId, percentage,
                trackingDTO.getChapterId(), trackingDTO.getModuleId(), trackingDTO.getSubjectId(),
                trackingDTO.getPackageSessionId());
    }

    /**
     * SCORM 2004 4th Ed. data-model priority for "% complete":
     *   1. cmi.progress_measure (0.0–1.0) — the spec's canonical fraction
     *      of completion. Authoring tools that care about progress reporting
     *      populate this.
     *   2. cmi.score.scaled (0.0–1.0; spec allows negatives, clamp at 0)
     *      — fallback for tools that ship score but not progress_measure.
     *   3. cmi.score.raw / cmi.score.max — final fallback for traditional
     *      score reporting (incl. SCORM 1.2 packages, which never report
     *      progress_measure / scaled).
     *   4. Status-only — packages that report neither (narrative SCOs) get
     *      0% until they declare themselves done.
     *
     * Safety lock: once completion_status='completed' (2004) or
     * lesson_status ∈ {'completed','passed'} (1.2) arrives, force 100%.
     * Slide-level B9 monotonic guard prevents subsequent backslides if a
     * later commit recomputes lower.
     *
     * Returns null when the package hasn't reported enough to derive any
     * percentage yet — caller should skip the cascade rather than write 0.
     */
    Double computeScormCompletionPercentage(ScormLearnerProgress progress) {
        String completion = progress.getCompletionStatus();
        boolean lockedComplete = "completed".equalsIgnoreCase(completion)
                || "passed".equalsIgnoreCase(completion);
        if (lockedComplete) {
            return 100.0;
        }

        Double progressMeasure = progress.getProgressMeasure();
        if (progressMeasure != null) {
            return clampPercent(progressMeasure * 100.0);
        }

        Double scaled = progress.getScoreScaled();
        if (scaled != null) {
            return clampPercent(scaled * 100.0);
        }

        Double raw = progress.getScoreRaw();
        Double max = progress.getScoreMax();
        if (raw != null && max != null && max > 0.0) {
            return clampPercent((raw / max) * 100.0);
        }

        // No completion signals, no progress, no score. Don't write a row —
        // the slide stays at whatever it was before (typically 0%).
        return null;
    }

    private static Double clampPercent(double value) {
        if (Double.isNaN(value) || Double.isInfinite(value)) return null;
        if (value < 0.0) return 0.0;
        if (value > 100.0) return 100.0;
        return value;
    }

    private ScormTrackingDTO mapToDTO(ScormLearnerProgress progress) {
        return ScormTrackingDTO.builder()
                .cmiSuspendData(progress.getCmiSuspendData())
                .cmiLocation(progress.getCmiLocation())
                .cmiExit(progress.getCmiExit())
                .completionStatus(progress.getCompletionStatus())
                .successStatus(progress.getSuccessStatus())
                .scoreRaw(progress.getScoreRaw())
                .scoreMin(progress.getScoreMin())
                .scoreMax(progress.getScoreMax())
                .scoreScaled(progress.getScoreScaled())
                .progressMeasure(progress.getProgressMeasure())
                .totalTime(progress.getTotalTime())
                .cmiJson(parseJson(progress.getCmiJson()))
                .build();
    }

    private void updateProgressFromDTO(ScormLearnerProgress progress, ScormTrackingDTO dto) {
        if (dto.getCmiSuspendData() != null)
            progress.setCmiSuspendData(dto.getCmiSuspendData());
        if (dto.getCmiLocation() != null)
            progress.setCmiLocation(dto.getCmiLocation());
        if (dto.getCmiExit() != null)
            progress.setCmiExit(dto.getCmiExit());
        if (dto.getCompletionStatus() != null)
            progress.setCompletionStatus(dto.getCompletionStatus());
        if (dto.getSuccessStatus() != null)
            progress.setSuccessStatus(dto.getSuccessStatus());
        if (dto.getScoreRaw() != null)
            progress.setScoreRaw(dto.getScoreRaw());
        if (dto.getScoreMin() != null)
            progress.setScoreMin(dto.getScoreMin());
        if (dto.getScoreMax() != null)
            progress.setScoreMax(dto.getScoreMax());
        if (dto.getScoreScaled() != null)
            progress.setScoreScaled(dto.getScoreScaled());
        if (dto.getProgressMeasure() != null)
            progress.setProgressMeasure(dto.getProgressMeasure());
        if (dto.getTotalTime() != null)
            progress.setTotalTime(dto.getTotalTime());
        if (dto.getCmiJson() != null)
            progress.setCmiJson(toJson(dto.getCmiJson()));
    }

    private java.util.Map<String, Object> parseJson(String json) {
        if (json == null)
            return null;
        try {
            return objectMapper.readValue(json,
                    new com.fasterxml.jackson.core.type.TypeReference<java.util.Map<String, Object>>() {
                    });
        } catch (JsonProcessingException e) {
            log.error("Failed to parse CMI JSON", e);
            return null;
        }
    }

    private String toJson(java.util.Map<String, Object> map) {
        try {
            return objectMapper.writeValueAsString(map);
        } catch (JsonProcessingException e) {
            log.error("Failed to write CMI JSON", e);
            return null;
        }
    }
}
