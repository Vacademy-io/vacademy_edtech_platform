package vacademy.io.admin_core_service.features.study_library.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import vacademy.io.admin_core_service.features.course.dto.CourseDTOWithDetails;
import vacademy.io.admin_core_service.features.packages.enums.PackageStatusEnum;
import vacademy.io.admin_core_service.features.packages.repository.PackageInstituteRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.packages.service.PackagePageContentService;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.institute.entity.PackageInstitute;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** course-init (admin and public) exposes the course page content as course.course_page_json. */
@ExtendWith(MockitoExtension.class)
class StudyLibraryCoursePageJsonTest {

    private static final String CONTENT = "{\"v\":1,\"mode\":\"LIVE\",\"faqs\":[{\"q\":\"Q\",\"a\":\"A\"}]}";

    @Mock private PackageRepository packageRepository;
    @Mock private PackageInstituteRepository packageInstituteRepository;
    @Mock private PackageSessionRepository packageSessionRepository;
    @Mock private PackagePageContentService packagePageContentService;

    @InjectMocks
    private StudyLibraryService service;

    private PackageEntity course;

    @BeforeEach
    void setUp() {
        course = new PackageEntity();
        course.setId("c1");
        course.setPackageName("Course");
        course.setStatus(PackageStatusEnum.ACTIVE.name());
        when(packageRepository.findById("c1")).thenReturn(Optional.of(course));
        when(packageInstituteRepository.findByPackageIdAndInstituteId("c1", "i1"))
                .thenReturn(Optional.of(new PackageInstitute()));
    }

    @Test
    @DisplayName("The stored string is returned on course, with one lookup by package id")
    void returnsStoredString() {
        when(packagePageContentService.getContentJson("c1")).thenReturn(CONTENT);

        List<CourseDTOWithDetails> result = service.getCourseInitDetails("c1", "i1");

        assertEquals(1, result.size());
        assertEquals(CONTENT, result.get(0).getCourse().getCoursePageJson());
        verify(packagePageContentService, times(1)).getContentJson("c1");
    }

    @Test
    @DisplayName("A course without page content returns null")
    void nullWhenNoRow() {
        when(packagePageContentService.getContentJson("c1")).thenReturn(null);

        List<CourseDTOWithDetails> result = service.getCourseInitDetails("c1", "i1");

        assertNull(result.get(0).getCourse().getCoursePageJson());
    }
}
