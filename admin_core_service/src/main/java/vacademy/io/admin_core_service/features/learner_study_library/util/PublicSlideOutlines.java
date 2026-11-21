package vacademy.io.admin_core_service.features.learner_study_library.util;

import vacademy.io.admin_core_service.features.chapter.dto.ChapterDTO;
import vacademy.io.admin_core_service.features.learner_study_library.dto.LearnerSlidesDetailDTO;
import vacademy.io.admin_core_service.features.learner_study_library.dto.PublicChapterOutlineDTO;
import vacademy.io.admin_core_service.features.learner_study_library.dto.PublicSlideOutlineDTO;
import vacademy.io.admin_core_service.features.slide.dto.AssessmentSlideDTO;
import vacademy.io.admin_core_service.features.slide.dto.AssignmentSlideDTO;
import vacademy.io.admin_core_service.features.slide.dto.AudioSlideDTO;
import vacademy.io.admin_core_service.features.slide.dto.DocumentSlideDTO;
import vacademy.io.admin_core_service.features.slide.dto.HtmlVideoSlideDTO;
import vacademy.io.admin_core_service.features.slide.dto.QuestionSlideDTO;
import vacademy.io.admin_core_service.features.slide.dto.QuizSlideDTO;
import vacademy.io.admin_core_service.features.slide.dto.ScormSlideDTO;
import vacademy.io.admin_core_service.features.slide.dto.SlideDTO;
import vacademy.io.admin_core_service.features.slide.dto.VideoSlideDTO;
import vacademy.io.admin_core_service.features.slide.enums.SlideStatus;
import vacademy.io.admin_core_service.features.study_library.dto.ChapterDTOWithDetails;

import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * Reduces slides to the course outline that open (no login) endpoints may return. Those
 * responses need no login and are publicly cacheable, so they carry ids, titles, types, order,
 * status, sizes and durations only. Slide bodies, document data, media URLs and file ids,
 * questions, options, assignment text, SCORM launch details and drip rules stay on the
 * signed-in learner endpoints.
 *
 * <p>The platform has no per-slide free-preview flag, so no slide keeps its content here.
 */
public final class PublicSlideOutlines {

    /** Slide statuses a learner can see. Anything else (for example DRAFT) is left out. */
    private static final Set<String> VISIBLE_STATUSES = Set.of(
            SlideStatus.PUBLISHED.name(), SlideStatus.UNSYNC.name());

    private PublicSlideOutlines() {
    }

    /** Outline of learner slides. Hidden slides are left out. */
    public static List<PublicSlideOutlineDTO> fromLearnerSlides(List<LearnerSlidesDetailDTO> slides) {
        if (slides == null) {
            return List.of();
        }
        return slides.stream()
                .filter(Objects::nonNull)
                .filter(slide -> !Boolean.TRUE.equals(slide.getIsHidden()))
                .map(PublicSlideOutlines::outline)
                .toList();
    }

    /** Outline of chapters with their slides. Slides a learner cannot see yet are left out. */
    public static List<PublicChapterOutlineDTO> fromChapters(List<ChapterDTOWithDetails> chapters) {
        if (chapters == null) {
            return List.of();
        }
        return chapters.stream()
                .filter(Objects::nonNull)
                .map(PublicSlideOutlines::outline)
                .toList();
    }

    static PublicSlideOutlineDTO outline(LearnerSlidesDetailDTO slide) {
        PublicSlideOutlineDTO out = header(slide.getId(), slide.getSourceType(), slide.getTitle(),
                slide.getImageFileId(), slide.getStatus(), slide.getSlideOrder());
        parts(out, slide.getVideoSlide(), slide.getDocumentSlide(), slide.getQuestionSlide(),
                slide.getAssignmentSlide(), slide.getQuizSlide(), slide.getHtmlVideoSlide(),
                slide.getAudioSlide(), slide.getScormSlide(), slide.getAssessmentSlide());
        return out;
    }

    static PublicSlideOutlineDTO outline(SlideDTO slide) {
        PublicSlideOutlineDTO out = header(slide.getId(), slide.getSourceType(), slide.getTitle(),
                slide.getImageFileId(), slide.getStatus(), slide.getSlideOrder());
        parts(out, slide.getVideoSlide(), slide.getDocumentSlide(), slide.getQuestionSlide(),
                slide.getAssignmentSlide(), slide.getQuizSlide(), slide.getHtmlVideoSlide(),
                slide.getAudioSlide(), slide.getScormSlide(), slide.getAssessmentSlide());
        return out;
    }

    static PublicChapterOutlineDTO outline(ChapterDTOWithDetails details) {
        PublicChapterOutlineDTO out = new PublicChapterOutlineDTO();
        ChapterDTO chapter = details.getChapter();
        if (chapter != null) {
            PublicChapterOutlineDTO.Chapter c = new PublicChapterOutlineDTO.Chapter();
            c.setId(chapter.getId());
            c.setChapterName(chapter.getChapterName());
            c.setStatus(chapter.getStatus());
            c.setFileId(chapter.getFileId());
            c.setDescription(chapter.getDescription());
            c.setChapterOrder(chapter.getChapterOrder());
            out.setChapter(c);
        }
        List<SlideDTO> slides = details.getSlides() == null ? List.of() : details.getSlides();
        out.setSlides(slides.stream()
                .filter(Objects::nonNull)
                .filter(slide -> slide.getStatus() != null && VISIBLE_STATUSES.contains(slide.getStatus()))
                .map(PublicSlideOutlines::outline)
                .toList());
        return out;
    }

    private static PublicSlideOutlineDTO header(String id, String sourceType, String title,
            String imageFileId, String status, Integer slideOrder) {
        PublicSlideOutlineDTO out = new PublicSlideOutlineDTO();
        out.setId(id);
        out.setSourceType(sourceType);
        out.setTitle(title);
        out.setImageFileId(imageFileId);
        out.setStatus(status);
        out.setSlideOrder(slideOrder);
        return out;
    }

    private static void parts(PublicSlideOutlineDTO out, VideoSlideDTO video, DocumentSlideDTO document,
            QuestionSlideDTO question, AssignmentSlideDTO assignment, QuizSlideDTO quiz,
            HtmlVideoSlideDTO htmlVideo, AudioSlideDTO audio, ScormSlideDTO scorm,
            AssessmentSlideDTO assessment) {
        out.setVideoSlide(video(video));
        out.setDocumentSlide(document(document));
        out.setQuestionSlide(question == null ? null : new PublicSlideOutlineDTO.Part());
        out.setAssignmentSlide(assignment == null ? null : new PublicSlideOutlineDTO.Part());
        out.setQuizSlide(quiz(quiz));
        out.setHtmlVideoSlide(htmlVideo(htmlVideo));
        out.setAudioSlide(audio(audio));
        out.setScormSlide(scorm == null ? null : new PublicSlideOutlineDTO.Part());
        out.setAssessmentSlide(assessment == null ? null : new PublicSlideOutlineDTO.Part());
    }

    private static PublicSlideOutlineDTO.Part video(VideoSlideDTO video) {
        if (video == null) {
            return null;
        }
        PublicSlideOutlineDTO.Part part = new PublicSlideOutlineDTO.Part();
        part.setVideoLengthInMillis(video.getVideoLengthInMillis());
        part.setPublishedVideoLengthInMillis(video.getPublishedVideoLengthInMillis());
        return part;
    }

    private static PublicSlideOutlineDTO.Part document(DocumentSlideDTO document) {
        if (document == null) {
            return null;
        }
        PublicSlideOutlineDTO.Part part = new PublicSlideOutlineDTO.Part();
        part.setType(document.getType());
        part.setTotalPages(document.getTotalPages());
        part.setPublishedDocumentTotalPages(document.getPublishedDocumentTotalPages());
        return part;
    }

    private static PublicSlideOutlineDTO.Part quiz(QuizSlideDTO quiz) {
        if (quiz == null) {
            return null;
        }
        PublicSlideOutlineDTO.Part part = new PublicSlideOutlineDTO.Part();
        part.setTimeLimitInMinutes(quiz.getTimeLimitInMinutes());
        return part;
    }

    private static PublicSlideOutlineDTO.Part htmlVideo(HtmlVideoSlideDTO htmlVideo) {
        if (htmlVideo == null) {
            return null;
        }
        PublicSlideOutlineDTO.Part part = new PublicSlideOutlineDTO.Part();
        part.setVideoLengthInMillis(htmlVideo.getVideoLengthInMillis());
        return part;
    }

    private static PublicSlideOutlineDTO.Part audio(AudioSlideDTO audio) {
        if (audio == null) {
            return null;
        }
        PublicSlideOutlineDTO.Part part = new PublicSlideOutlineDTO.Part();
        part.setAudioLengthInMillis(audio.getAudioLengthInMillis());
        part.setPublishedAudioLengthInMillis(audio.getPublishedAudioLengthInMillis());
        return part;
    }
}
