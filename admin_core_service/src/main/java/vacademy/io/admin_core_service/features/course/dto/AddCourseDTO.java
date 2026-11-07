package vacademy.io.admin_core_service.features.course.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategy;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Getter;
import lombok.Setter;
import vacademy.io.admin_core_service.features.session.dto.AddNewSessionDTO;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.List;

@Getter
@Setter
@JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
public class AddCourseDTO {
    private String id;
    private Boolean newCourse;
    // When TRUE, never merge into an existing course that happens to share this
    // name — create a fresh package, uniquifying the name with " (n)" if needed.
    // AI course creation sets this: generated names are deterministic, so a
    // regeneration would otherwise silently append its chapters into the old run.
    private Boolean forceNewCourse;
    private String courseName;
    private String thumbnailFileId;
    private Boolean containLevels;
    private List<AddNewSessionDTO> sessions;
    private Boolean isCoursePublishedToCatalaouge;
    private String coursePreviewImageMediaId;
    private String courseBannerMediaId;
    private String courseMediaId;
    private String whyLearnHtml;
    private String whoShouldLearnHtml;
    private String aboutTheCourseHtml;
    private List<String> tags;
    private Integer courseDepth;
    private String courseHtmlDescription;
    private List<AddFacultyToCourseDTO>addFacultyToCourse;
    
    // Fields for teacher approval workflow
    private String status;
    private String createdByUserId;
    private String originalCourseId;
    private Integer versionNumber;

    /**
     * Optional: whether this course's batches contain subgroups.
     * Backward compatible – if not sent or false, behaves as today.
     */
    private Boolean containsSubgroup;

    /**
     * Optional: definitions of subgroups to create as additional package sessions.
     * Only considered when contains_subgroup = true.
     */
    private List<SubgroupDTO> subgroups;

    /**
     * Optional: per-course advanced settings JSON stored on package.course_setting.
     * Open-ended envelope ({@code { "setting": { "<KEY>": { ... } } }}) consumed by
     * workflows; persisted verbatim when provided.
     */
    private String courseSetting;

    /**
     * Optional: course page content (FAQs, course mode, ...) as a JSON object string,
     * JSON name {@code course_page_json}; stored in package_page_content (V579).
     * On update: null/absent = leave as is, "" = clear, otherwise replace.
     */
    private String coursePageJson;
}
