package vacademy.io.community_service.feature.trainingvideo.dto;

import lombok.Data;

import java.util.List;

@Data
public class UpsertTrainingVideoRequest {
    private String title;
    private String description;
    private String fileId;
    /** Public S3 URL returned by media-service when the super admin uploaded the video. */
    private String fileUrl;
    /** 1..3 breadcrumb segments, e.g. ["LMS","Course creation","AI based course"]. */
    private List<String> modulePath;
    private Boolean active;
    /** Extra search words. On update: null = unchanged, empty list = clear. */
    private List<String> keywords;
    /** Step number inside its section. On update: null = unchanged, 0 or less = clear. */
    private Integer sortOrder;
}
