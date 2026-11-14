package vacademy.io.admin_core_service.features.course.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategy;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Getter;
import lombok.Setter;
import vacademy.io.admin_core_service.features.packages.dto.ComingSoonDTO;
import vacademy.io.admin_core_service.features.study_library.dto.SessionDTOWithDetails;
import vacademy.io.common.institute.dto.PackageSessionDTO;

import java.util.List;

@Getter
@Setter
@JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
public class CourseDTOWithDetails {
    private CourseDTO course;
    private List<SessionDTOWithDetails> sessions;
    private List<PackageSessionDTO> packageSessions;
    /** Null unless the course is switched to "Coming Soon". Only set by course-init. */
    private ComingSoonDTO comingSoon;

    public CourseDTOWithDetails(CourseDTO course, List<SessionDTOWithDetails> sessions) {
        this.course = course;
        this.sessions = sessions;
    }

    public CourseDTOWithDetails(CourseDTO course, List<SessionDTOWithDetails> sessions,
            List<PackageSessionDTO> packageSessions) {
        this.course = course;
        this.sessions = sessions;
        this.packageSessions = packageSessions;
    }
}
