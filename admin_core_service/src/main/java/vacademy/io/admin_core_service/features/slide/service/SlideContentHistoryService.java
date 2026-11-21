package vacademy.io.admin_core_service.features.slide.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.chapter.repository.ChapterToSlidesRepository;
import vacademy.io.admin_core_service.features.slide.dto.SlideContentHistoryDTO;
import vacademy.io.admin_core_service.features.slide.dto.SlideContentRestoreResponseDTO;
import vacademy.io.admin_core_service.features.slide.entity.AudioSlide;
import vacademy.io.admin_core_service.features.slide.entity.DocumentSlide;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.entity.SlideContentHistory;
import vacademy.io.admin_core_service.features.slide.entity.VideoSlide;
import vacademy.io.admin_core_service.features.slide.enums.SlideStatus;
import vacademy.io.admin_core_service.features.slide.enums.SlideTypeEnum;
import vacademy.io.admin_core_service.features.slide.repository.AudioSlideRepository;
import vacademy.io.admin_core_service.features.slide.repository.DocumentSlideRepository;
import vacademy.io.admin_core_service.features.slide.repository.SlideContentHistoryRepository;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import vacademy.io.admin_core_service.features.slide.repository.VideoSlideRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

/**
 * Read + restore API over the slide_content_history audit trail (V363).
 * History rows are written exclusively by DB triggers; this service lists
 * them per slide and can copy a snapshot back into the slide's DRAFT columns.
 * Restore never touches published content — the author reviews the restored
 * draft in the editor and re-publishes explicitly.
 */
@Service
@RequiredArgsConstructor
public class SlideContentHistoryService {

    private final SlideContentHistoryRepository slideContentHistoryRepository;
    private final SlideRepository slideRepository;
    private final DocumentSlideRepository documentSlideRepository;
    private final VideoSlideRepository videoSlideRepository;
    private final AudioSlideRepository audioSlideRepository;
    private final ChapterToSlidesRepository chapterToSlidesRepository;

    @PersistenceContext
    private EntityManager entityManager;

    public List<SlideContentHistoryDTO> getHistoryForSlide(String slideId, int page, int size) {
        Slide slide = getSlide(slideId);
        String sourceTable = resolveSourceTable(slide);
        return slideContentHistoryRepository
                .findBySourceTableAndSourceIdOrderByChangedAtDesc(sourceTable, slide.getSourceId(),
                        PageRequest.of(page, Math.min(Math.max(size, 1), 100)))
                .map(h -> toDTO(h, false))
                .getContent();
    }

    public SlideContentHistoryDTO getHistoryDetail(String slideId, Long historyId) {
        Slide slide = getSlide(slideId);
        return toDTO(getEntryForSlide(slide, historyId), true);
    }

    /**
     * Copy one snapshot column (the draft or the published value as it existed
     * at that point in time) back into the slide's DRAFT column. The V363
     * trigger snapshots the pre-restore state first, so a restore is itself
     * undoable. A PUBLISHED slide flips to UNSYNC — live content is untouched
     * until the author explicitly re-publishes.
     *
     * Course knowledge: deliberately not wired to ContentIndexMarker. A restore
     * changes only the draft; the later publish is what gets re-indexed.
     */
    @Transactional
    public SlideContentRestoreResponseDTO restore(String slideId, Long historyId, String source,
            String chapterId, CustomUserDetails user) {
        Slide slide = getSlide(slideId);
        SlideContentHistory entry = getEntryForSlide(slide, historyId);

        boolean fromPublished = "PUBLISHED".equalsIgnoreCase(source);
        String value = fromPublished ? entry.getPublishedValue() : entry.getDraftValue();
        if (!StringUtils.hasText(value)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "This version has no " + (fromPublished ? "published" : "draft")
                            + " content to restore.");
        }

        // Attribute the trigger-written snapshot of the pre-restore state to the
        // restoring user (set_config with is_local=true scopes it to this tx).
        if (user != null && StringUtils.hasText(user.getUserId())) {
            entityManager.createNativeQuery("SELECT set_config('app.user_id', :uid, true)")
                    .setParameter("uid", user.getUserId())
                    .getSingleResult();
        }

        writeDraftValue(slide, value);

        if (SlideStatus.PUBLISHED.name().equalsIgnoreCase(slide.getStatus())) {
            slide.setStatus(SlideStatus.UNSYNC.name());
            slideRepository.save(slide);
            if (StringUtils.hasText(chapterId)) {
                chapterToSlidesRepository.findByChapterIdAndSlideId(chapterId, slideId)
                        .ifPresent(cts -> {
                            cts.setStatus(SlideStatus.UNSYNC.name());
                            chapterToSlidesRepository.save(cts);
                        });
            }
        }

        return SlideContentRestoreResponseDTO.builder()
                .restoredValue(value)
                .slideStatus(slide.getStatus())
                .build();
    }

    private void writeDraftValue(Slide slide, String value) {
        String sourceType = slide.getSourceType();
        if (SlideTypeEnum.DOCUMENT.name().equalsIgnoreCase(sourceType)) {
            DocumentSlide documentSlide = documentSlideRepository.findById(slide.getSourceId())
                    .orElseThrow(() -> new VacademyException("Document slide not found"));
            documentSlide.setData(value);
            documentSlideRepository.save(documentSlide);
        } else if (SlideTypeEnum.VIDEO.name().equalsIgnoreCase(sourceType)) {
            VideoSlide videoSlide = videoSlideRepository.findById(slide.getSourceId())
                    .orElseThrow(() -> new VacademyException("Video slide not found"));
            videoSlide.setUrl(value);
            videoSlideRepository.save(videoSlide);
        } else if (SlideTypeEnum.AUDIO.name().equalsIgnoreCase(sourceType)) {
            AudioSlide audioSlide = audioSlideRepository.findById(slide.getSourceId())
                    .orElseThrow(() -> new VacademyException("Audio slide not found"));
            audioSlide.setAudioFileId(value);
            audioSlideRepository.save(audioSlide);
        } else {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "Content history is not tracked for slide type: " + sourceType);
        }
    }

    private Slide getSlide(String slideId) {
        return slideRepository.findById(slideId)
                .orElseThrow(() -> new VacademyException("Slide not found"));
    }

    /** History rows must belong to this slide's source row — no cross-slide reads. */
    private SlideContentHistory getEntryForSlide(Slide slide, Long historyId) {
        SlideContentHistory entry = slideContentHistoryRepository.findById(historyId)
                .orElseThrow(() -> new VacademyException("History entry not found"));
        String sourceTable = resolveSourceTable(slide);
        if (!entry.getSourceTable().equals(sourceTable)
                || !entry.getSourceId().equals(slide.getSourceId())) {
            throw new VacademyException(HttpStatus.FORBIDDEN,
                    "History entry does not belong to this slide");
        }
        return entry;
    }

    private String resolveSourceTable(Slide slide) {
        String sourceType = slide.getSourceType();
        if (SlideTypeEnum.DOCUMENT.name().equalsIgnoreCase(sourceType)) {
            return "document_slide";
        }
        if (SlideTypeEnum.VIDEO.name().equalsIgnoreCase(sourceType)) {
            return "video";
        }
        if (SlideTypeEnum.AUDIO.name().equalsIgnoreCase(sourceType)) {
            return "audio_slide";
        }
        throw new VacademyException(HttpStatus.BAD_REQUEST,
                "Content history is not tracked for slide type: " + sourceType);
    }

    private SlideContentHistoryDTO toDTO(SlideContentHistory entry, boolean includeValues) {
        return SlideContentHistoryDTO.builder()
                .id(entry.getId())
                .sourceTable(entry.getSourceTable())
                .changedAt(entry.getChangedAt())
                .changedBy(entry.getChangedBy())
                .draftLength(entry.getDraftValue() == null ? 0 : entry.getDraftValue().length())
                .publishedLength(
                        entry.getPublishedValue() == null ? 0 : entry.getPublishedValue().length())
                .draftValue(includeValues ? entry.getDraftValue() : null)
                .publishedValue(includeValues ? entry.getPublishedValue() : null)
                .build();
    }
}
