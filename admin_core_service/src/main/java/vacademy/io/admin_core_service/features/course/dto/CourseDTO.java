package vacademy.io.admin_core_service.features.course.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategy;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import jakarta.persistence.Column;
import jakarta.persistence.Lob;
import lombok.Getter;
import lombok.Setter;
import vacademy.io.common.institute.entity.PackageEntity;

@Getter
@Setter
@JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
public class CourseDTO {
    private String id;
    private String packageName;
    private String thumbnailFileId;
    private String status;
    private Boolean isCoursePublishedToCatalaouge;
    private String coursePreviewImageMediaId;
    private String courseBannerMediaId;
    private String courseMediaId;
    private String whyLearn;
    private String whoShouldLearn;
    private String aboutTheCourse;
    private String tags;
    private Integer courseDepth;
    private String courseHtmlDescription;
    private Double percentageCompleted;
    /**
     * Course page content (FAQs, course mode, ...) as a JSON object string from
     * package_page_content. Filled by course-init only (single-course reads); null otherwise.
     */
    private String coursePageJson;

    public CourseDTO(PackageEntity packageEntity) {
        this.id = packageEntity.getId();
        this.packageName = packageEntity.getPackageName();
        this.thumbnailFileId = packageEntity.getThumbnailFileId();
        this.status = packageEntity.getStatus();
        this.courseDepth = packageEntity.getCourseDepth();
        this.isCoursePublishedToCatalaouge = packageEntity.getIsCoursePublishedToCatalaouge();
        this.coursePreviewImageMediaId = packageEntity.getCoursePreviewImageMediaId();
        this.courseBannerMediaId = packageEntity.getCourseBannerMediaId();
        this.courseMediaId = packageEntity.getCourseMediaId();
        this.whyLearn = packageEntity.getWhyLearn();
        this.whoShouldLearn = packageEntity.getWhoShouldLearn();
        this.aboutTheCourse = packageEntity.getAboutTheCourse();
        this.tags = packageEntity.getTags();
        this.courseHtmlDescription = packageEntity.getCourseHtmlDescription();
    }
}
