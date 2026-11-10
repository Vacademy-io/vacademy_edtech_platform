package vacademy.io.admin_core_service.features.learner_offline.service;

import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.learner_offline.dto.OfflineAssetRefDTO;
import vacademy.io.admin_core_service.features.learner_offline.enums.OfflineDownloadReason;
import vacademy.io.admin_core_service.features.learner_study_library.dto.LearnerSlidesDetailDTO;
import vacademy.io.admin_core_service.features.slide.dto.AssignmentSlideDTO;
import vacademy.io.admin_core_service.features.slide.dto.AudioSlideDTO;
import vacademy.io.admin_core_service.features.slide.dto.DocumentSlideDTO;
import vacademy.io.admin_core_service.features.slide.cbe.CbeConfigSecrets;
import vacademy.io.admin_core_service.features.slide.dto.QuestionSlideDTO;
import vacademy.io.admin_core_service.features.slide.dto.QuizSlideDTO;
import vacademy.io.admin_core_service.features.slide.dto.VideoSlideDTO;

import java.util.ArrayList;
import java.util.List;

/**
 * The non-overridable platform gate from the offline plan (Part A1): a slide
 * is only ever downloadable if it is S3-backed. Third-party-hosted content
 * (YouTube/Vimeo/Drive/embeds) and ASSESSMENT/SCORM/HTML-video slides are
 * ONLINE_ONLY regardless of any permission rule — this check runs
 * independently of, and after, the OfflineAccessResolver permission pass.
 */
@Component
public class OfflineAssetExtractor {

    /** Result of extracting one slide: is it S3-backed, and what does it need offline. */
    public static final class Extraction {
        public final boolean s3Backed;
        public final List<OfflineAssetRefDTO> assets;
        public final Object inlinePayload;

        Extraction(boolean s3Backed, List<OfflineAssetRefDTO> assets, Object inlinePayload) {
            this.s3Backed = s3Backed;
            this.assets = assets;
            this.inlinePayload = inlinePayload;
        }
    }

    public Extraction extract(LearnerSlidesDetailDTO slide) {
        if (slide == null || slide.getSourceType() == null) {
            return notDownloadable();
        }
        List<OfflineAssetRefDTO> assets = new ArrayList<>();

        switch (slide.getSourceType()) {
            case "VIDEO": {
                VideoSlideDTO v = slide.getVideoSlide();
                if (v == null || !"FILE_ID".equalsIgnoreCase(v.getSourceType())
                        || !StringUtils.hasText(v.getPublishedUrl())) {
                    return notDownloadable();
                }
                assets.add(new OfflineAssetRefDTO(v.getPublishedUrl(), "VIDEO", null, null, null));
                return new Extraction(true, assets, null);
            }
            case "DOCUMENT": {
                DocumentSlideDTO d = slide.getDocumentSlide();
                if (d == null || !StringUtils.hasText(d.getPublishedData())) {
                    return notDownloadable();
                }
                // published_data is a media file id ONLY for PDF documents.
                // DOC/HTML (and PPT_ANIM etc.) store inline content there —
                // emitting it as an asset creates a phantom "file" the client
                // can never download, wedging the whole node in DOWNLOADING.
                // Those types ship as inline payload with no binary assets.
                if ("PDF".equalsIgnoreCase(d.getType())) {
                    assets.add(new OfflineAssetRefDTO(d.getPublishedData(), "DOCUMENT", null, null, null));
                    // PDF content IS the binary asset — no inline payload needed.
                    return new Extraction(true, assets, null);
                }
                // DOC/HTML (and PPT_ANIM etc.) keep their content inline in
                // published_data, so the slide DTO itself is the payload. Passing
                // null here shipped a slide that was downloadable:true with
                // neither an asset nor a payload — nothing to store, so the node
                // "downloaded" 0 bytes and rendered empty offline.
                return new Extraction(true, assets, d);
            }
            case "AUDIO": {
                AudioSlideDTO a = slide.getAudioSlide();
                if (a == null || !StringUtils.hasText(a.getPublishedAudioFileId())) {
                    return notDownloadable();
                }
                assets.add(new OfflineAssetRefDTO(a.getPublishedAudioFileId(), "AUDIO", null, null, null));
                return new Extraction(true, assets, null);
            }
            case "ASSIGNMENT": {
                AssignmentSlideDTO asg = slide.getAssignmentSlide();
                if (asg == null) {
                    return notDownloadable();
                }
                if (StringUtils.hasText(asg.getCommaSeparatedMediaIds())) {
                    for (String fileId : asg.getCommaSeparatedMediaIds().split(",")) {
                        if (StringUtils.hasText(fileId)) {
                            assets.add(new OfflineAssetRefDTO(fileId.trim(), "ASSIGNMENT_ATTACHMENT", null, null, null));
                        }
                    }
                }
                return new Extraction(true, assets, asg);
            }
            case "QUESTION": {
                QuestionSlideDTO q = slide.getQuestionSlide();
                if (q == null) {
                    return notDownloadable();
                }
                if (CbeConfigSecrets.isCbe(q.getQuestionType(), q.getAutoEvaluationJson())) {
                    // Spreadsheet & Written Response is checked by AI on submit: online only.
                    return notDownloadable();
                }
                return new Extraction(true, List.of(), q);
            }
            case "QUIZ": {
                QuizSlideDTO quiz = slide.getQuizSlide();
                if (quiz == null) {
                    return notDownloadable();
                }
                return new Extraction(true, List.of(), quiz);
            }
            // ASSESSMENT, SCORM, HTML_VIDEO, and anything else (YouTube/Vimeo/Drive
            // embeds live inside VIDEO with sourceType != FILE_ID, handled above)
            // are online-only.
            default:
                return notDownloadable();
        }
    }

    public OfflineDownloadReason reasonFor(boolean permissionAllowed, boolean s3Backed) {
        if (!s3Backed) {
            return OfflineDownloadReason.ONLINE_ONLY;
        }
        return permissionAllowed ? OfflineDownloadReason.ALLOWED : OfflineDownloadReason.PERMISSION_DENIED;
    }

    private Extraction notDownloadable() {
        return new Extraction(false, List.of(), null);
    }
}
