package vacademy.io.admin_core_service.features.packages.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.course.dto.AddCourseDTO;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;
import vacademy.io.admin_core_service.features.session.service.SessionService;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.PackageEntity;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The admin edit form saves through update-course-details (PackageService.addOrUpdatePackage).
 * course_page_json there: null keeps, "" clears, a bad value is a 400 before the course is touched.
 */
@ExtendWith(MockitoExtension.class)
class PackageServiceCoursePageJsonTest {

    @Mock private PackageRepository packageRepository;
    @Mock private SessionService sessionService;
    @Mock private PackagePageContentService packagePageContentService;

    @InjectMocks
    private PackageService service;

    private static AddCourseDTO edit(String coursePageJson) {
        AddCourseDTO dto = new AddCourseDTO();
        dto.setId("p1");
        dto.setNewCourse(false);
        dto.setCourseName("Course");
        dto.setSessions(List.of());
        dto.setCoursePageJson(coursePageJson);
        return dto;
    }

    private void existingCourse() {
        PackageEntity pkg = new PackageEntity();
        pkg.setId("p1");
        when(packageRepository.findById("p1")).thenReturn(Optional.of(pkg));
    }

    @Test
    @DisplayName("A non-object course_page_json is a 400 and the course is not touched")
    void badValueRejectedBeforeAnyWrite() {
        VacademyException e = assertThrows(VacademyException.class,
                () -> service.addOrUpdatePackage(edit("[1]"), "i1", null));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        verifyNoInteractions(packageRepository, packagePageContentService);
    }

    @Test
    @DisplayName("Edit passes null (field absent) and \"\" (clear) through with update semantics")
    void editUsesUpdateSemantics() {
        existingCourse();
        service.addOrUpdatePackage(edit(null), "i1", null);
        verify(packagePageContentService).applyOnUpdate("p1", null);

        service.addOrUpdatePackage(edit(""), "i1", null);
        verify(packagePageContentService).applyOnUpdate("p1", "");

        String content = "{\"v\":1,\"faqs\":[]}";
        service.addOrUpdatePackage(edit(content), "i1", null);
        verify(packagePageContentService).applyOnUpdate("p1", content);
    }
}
