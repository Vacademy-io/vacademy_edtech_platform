package vacademy.io.admin_core_service.features.slide.service;

import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.chapter.entity.Chapter;
import vacademy.io.admin_core_service.features.chapter.repository.ChapterRepository;
import vacademy.io.admin_core_service.features.course_knowledge.service.ContentIndexMarker;
import vacademy.io.admin_core_service.features.slide.dto.AddAudioSlideDTO;
import vacademy.io.admin_core_service.features.slide.dto.AudioSlideDTO;
import vacademy.io.admin_core_service.features.slide.dto.SlideDTO;
import vacademy.io.admin_core_service.features.slide.entity.AudioSlide;
import vacademy.io.admin_core_service.features.chapter.entity.ChapterToSlides;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.enums.SlideStatus;
import vacademy.io.admin_core_service.features.slide.enums.SlideTypeEnum;
import vacademy.io.admin_core_service.features.slide.repository.AudioSlideRepository;
import vacademy.io.admin_core_service.features.chapter.repository.ChapterToSlidesRepository;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.util.Optional;
import java.util.UUID;

/**
 * Service for managing AudioSlide operations.
 * Handles CRUD operations for audio slides.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AudioSlideService {

    private final AudioSlideRepository audioSlideRepository;
    private final SlideRepository slideRepository;
    private final ChapterToSlidesRepository chapterToSlidesRepository;
    private final ChapterRepository chapterRepository;
    private final SlideNotificationService slideNotificationService;
    private final ContentIndexMarker contentIndexMarker;

    /**
     * Add or update an audio slide using the full SlideDTO.
     */
    @Transactional
    public String addOrUpdateAudioSlide(SlideDTO slideDTO, String chapterId,
            String packageSessionId, String moduleId,
            String subjectId, CustomUserDetails userDetails) {
        if (slideDTO.isNewSlide()) {
            return addAudioSlide(slideDTO, chapterId);
        } else {
            return updateAudioSlide(slideDTO, chapterId, moduleId, subjectId, packageSessionId);
        }
    }

    /**
     * Add or update an audio slide using the simplified AddAudioSlideDTO.
     */
    @Transactional
    public String addOrUpdateAudioSlideSimple(AddAudioSlideDTO dto, String chapterId,
            String moduleId, String subjectId,
            String packageSessionId, String instituteId) {

        String status = dto.getStatus() != null ? dto.getStatus() : SlideStatus.DRAFT.name();

        if (dto.isNewSlide()) {
            // Create new audio slide
            return createNewAudioSlide(dto, chapterId, instituteId, status);
        } else {
            // Update existing audio slide
            return updateExistingAudioSlide(dto, chapterId, moduleId, subjectId, packageSessionId, instituteId, status);
        }
    }

    /**
     * Create a new audio slide.
     */
    private String createNewAudioSlide(AddAudioSlideDTO dto, String chapterId,
            String instituteId, String status) {
        // Validate chapter exists
        Chapter chapter = chapterRepository.findById(chapterId)
                .orElseThrow(() -> new VacademyException("Chapter not found: " + chapterId));

        // Generate IDs
        String slideId = dto.getId() != null ? dto.getId() : UUID.randomUUID().toString();
        String audioSlideId = dto.getAudioSlide().getId() != null
                ? dto.getAudioSlide().getId()
                : UUID.randomUUID().toString();

        // Create AudioSlide entity
        AudioSlideDTO audioSlideDTO = dto.getAudioSlide();
        audioSlideDTO.setId(audioSlideId);
        AudioSlide audioSlide = new AudioSlide(audioSlideDTO, status);
        audioSlideRepository.save(audioSlide);

        // Create Slide entity
        Slide slide = new Slide();
        slide.setId(slideId);
        slide.setSourceId(audioSlideId);
        slide.setSourceType(SlideTypeEnum.AUDIO.name());
        slide.setTitle(dto.getTitle());
        slide.setImageFileId(dto.getImageFileId());
        slide.setDescription(dto.getDescription());
        slide.setStatus(status);
        if (status.equals(SlideStatus.PUBLISHED.name())) {
            slide.setLastSyncDate(new Timestamp(System.currentTimeMillis()));
        }
        slideRepository.save(slide);

        // Create chapter-to-slide mapping
        Integer slideOrder = dto.getSlideOrder() != null
                ? dto.getSlideOrder()
                : getNextSlideOrder(chapterId);

        ChapterToSlides chapterToSlides = new ChapterToSlides();
        chapterToSlides.setId(UUID.randomUUID().toString());
        chapterToSlides.setChapter(chapter);
        chapterToSlides.setSlide(slide);
        chapterToSlides.setSlideOrder(slideOrder);
        chapterToSlides.setStatus(status);
        chapterToSlidesRepository.save(chapterToSlides);

        // Notify if published
        if (status.equals(SlideStatus.PUBLISHED.name()) && dto.isNotify()) {
            slideNotificationService.sendNotificationForAddingSlide(instituteId, chapter, slide);
        }

        contentIndexMarker.mark(slideId, chapterId, "AUDIO_SLIDE_ADDED");
        log.info("Created new audio slide: slideId={}, audioSlideId={}", slideId, audioSlideId);
        return slideId;
    }

    /**
     * Update an existing audio slide.
     */
    private String updateExistingAudioSlide(AddAudioSlideDTO dto, String chapterId,
            String moduleId, String subjectId,
            String packageSessionId, String instituteId,
            String status) {
        String slideId = dto.getId();
        if (slideId == null) {
            throw new VacademyException("Slide ID is required for update");
        }

        // Fetch existing slide
        Slide slide = slideRepository.findById(slideId)
                .orElseThrow(() -> new VacademyException("Slide not found: " + slideId));

        // Fetch and update audio slide
        AudioSlide audioSlide = audioSlideRepository.findById(slide.getSourceId())
                .orElseThrow(() -> new VacademyException("Audio slide not found: " + slide.getSourceId()));

        audioSlide.updateFromDTO(dto.getAudioSlide(), status);
        audioSlideRepository.save(audioSlide);

        // Update slide
        if (dto.getTitle() != null)
            slide.setTitle(dto.getTitle());
        if (dto.getImageFileId() != null)
            slide.setImageFileId(dto.getImageFileId());
        if (dto.getDescription() != null)
            slide.setDescription(dto.getDescription());
        slide.setStatus(status);
        if (status.equals(SlideStatus.PUBLISHED.name())) {
            slide.setLastSyncDate(new Timestamp(System.currentTimeMillis()));
        }
        slideRepository.save(slide);

        // Update chapter-to-slide mapping
        Optional<ChapterToSlides> mappingOpt = chapterToSlidesRepository
                .findByChapterIdAndSlideId(chapterId, slideId);

        if (mappingOpt.isPresent()) {
            ChapterToSlides mapping = mappingOpt.get();
            if (dto.getSlideOrder() != null) {
                mapping.setSlideOrder(dto.getSlideOrder());
            }
            mapping.setStatus(status);
            chapterToSlidesRepository.save(mapping);

            // Notify if published
            if (status.equals(SlideStatus.PUBLISHED.name()) && dto.isNotify()) {
                slideNotificationService.sendNotificationForAddingSlide(instituteId, mapping.getChapter(),
                        mapping.getSlide());
            }
        }

        contentIndexMarker.mark(slideId, chapterId, "AUDIO_SLIDE_UPDATED");
        log.info("Updated audio slide: slideId={}", slideId);
        return slideId;
    }

    /**
     * Add audio slide using SlideDTO.
     */
    private String addAudioSlide(SlideDTO slideDTO, String chapterId) {
        Chapter chapter = chapterRepository.findById(chapterId)
                .orElseThrow(() -> new VacademyException("Chapter not found: " + chapterId));

        AudioSlideDTO audioSlideDTO = slideDTO.getAudioSlide();
        if (audioSlideDTO == null) {
            throw new VacademyException("Audio slide data is required");
        }

        String slideId = slideDTO.getId() != null ? slideDTO.getId() : UUID.randomUUID().toString();
        String audioSlideId = audioSlideDTO.getId() != null
                ? audioSlideDTO.getId()
                : UUID.randomUUID().toString();
        String status = slideDTO.getStatus() != null ? slideDTO.getStatus() : SlideStatus.DRAFT.name();

        // Create AudioSlide
        audioSlideDTO.setId(audioSlideId);
        AudioSlide audioSlide = new AudioSlide(audioSlideDTO, status);
        audioSlideRepository.save(audioSlide);

        // Create Slide
        Slide slide = new Slide();
        slide.setId(slideId);
        slide.setSourceId(audioSlideId);
        slide.setSourceType(SlideTypeEnum.AUDIO.name());
        slide.setTitle(slideDTO.getTitle());
        slide.setImageFileId(slideDTO.getImageFileId());
        slide.setDescription(slideDTO.getDescription());
        slide.setStatus(status);
        slide.setParentId(slideDTO.getParentId());
        slide.setDripConditionJson(slideDTO.getDripConditionJson());
        if (status.equals(SlideStatus.PUBLISHED.name())) {
            slide.setLastSyncDate(new Timestamp(System.currentTimeMillis()));
        }
        slideRepository.save(slide);

        // Create mapping
        Integer slideOrder = slideDTO.getSlideOrder() != null
                ? slideDTO.getSlideOrder()
                : getNextSlideOrder(chapterId);

        ChapterToSlides mapping = new ChapterToSlides();
        mapping.setId(UUID.randomUUID().toString());
        mapping.setChapter(chapter);
        mapping.setSlide(slide);
        mapping.setSlideOrder(slideOrder);
        mapping.setStatus(status);
        chapterToSlidesRepository.save(mapping);
        contentIndexMarker.mark(slideId, chapterId, "AUDIO_SLIDE_ADDED");

        return slideId;
    }

    /**
     * Update audio slide using SlideDTO.
     */
    private String updateAudioSlide(SlideDTO slideDTO, String chapterId,
            String moduleId, String subjectId,
            String packageSessionId) {
        String slideId = slideDTO.getId();
        String status = slideDTO.getStatus() != null ? slideDTO.getStatus() : SlideStatus.DRAFT.name();

        Slide slide = slideRepository.findById(slideId)
                .orElseThrow(() -> new VacademyException("Slide not found: " + slideId));

        AudioSlide audioSlide = audioSlideRepository.findById(slide.getSourceId())
                .orElseThrow(() -> new VacademyException("Audio slide not found"));

        AudioSlideDTO audioSlideDTO = slideDTO.getAudioSlide();
        if (audioSlideDTO != null) {
            audioSlide.updateFromDTO(audioSlideDTO, status);
            audioSlideRepository.save(audioSlide);
        }

        // Update slide
        if (slideDTO.getTitle() != null)
            slide.setTitle(slideDTO.getTitle());
        if (slideDTO.getImageFileId() != null)
            slide.setImageFileId(slideDTO.getImageFileId());
        if (slideDTO.getDescription() != null)
            slide.setDescription(slideDTO.getDescription());
        if (slideDTO.getParentId() != null)
            slide.setParentId(slideDTO.getParentId());
        if (slideDTO.getDripConditionJson() != null)
            slide.setDripConditionJson(slideDTO.getDripConditionJson());
        slide.setStatus(status);
        if (status.equals(SlideStatus.PUBLISHED.name())) {
            slide.setLastSyncDate(new Timestamp(System.currentTimeMillis()));
        }
        slideRepository.save(slide);

        // Update mapping
        Optional<ChapterToSlides> mappingOpt = chapterToSlidesRepository
                .findByChapterIdAndSlideId(chapterId, slideId);
        if (mappingOpt.isPresent()) {
            ChapterToSlides mapping = mappingOpt.get();
            if (slideDTO.getSlideOrder() != null) {
                mapping.setSlideOrder(slideDTO.getSlideOrder());
            }
            mapping.setStatus(status);
            chapterToSlidesRepository.save(mapping);
        }
        contentIndexMarker.mark(slideId, chapterId, "AUDIO_SLIDE_UPDATED");

        return slideId;
    }

    /**
     * Get the next slide order for a chapter.
     */
    private Integer getNextSlideOrder(String chapterId) {
        Integer maxOrder = chapterToSlidesRepository.findMaxSlideOrderByChapterId(chapterId);
        return maxOrder != null ? maxOrder + 1 : 1;
    }

    /**
     * Get audio slide by ID.
     */
    public AudioSlide getAudioSlideById(String id) {
        return audioSlideRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Audio slide not found: " + id));
    }

    /**
     * Get audio slide DTO by slide ID.
     */
    public AudioSlideDTO getAudioSlideDTOBySlideId(String slideId) {
        Slide slide = slideRepository.findById(slideId)
                .orElseThrow(() -> new VacademyException("Slide not found: " + slideId));

        AudioSlide audioSlide = audioSlideRepository.findById(slide.getSourceId())
                .orElseThrow(() -> new VacademyException("Audio slide not found"));

        return audioSlide.toDTO();
    }
}
