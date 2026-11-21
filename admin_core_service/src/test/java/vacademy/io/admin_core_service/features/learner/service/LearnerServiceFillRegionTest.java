package vacademy.io.admin_core_service.features.learner.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The bulk import writes the region (state) on the learner profile itself, because the auth
 * service has no region column. It must only fill an empty region, never replace one.
 */
class LearnerServiceFillRegionTest {

    private static final String USER = "user-1";

    private InstituteStudentRepository repository;
    private LearnerService learnerService;

    @BeforeEach
    void setUp() {
        repository = mock(InstituteStudentRepository.class);
        learnerService = new LearnerService();
        ReflectionTestUtils.setField(learnerService, "instituteStudentRepository", repository);
    }

    private Student studentWithRegion(String region) {
        Student student = new Student();
        student.setUserId(USER);
        student.setRegion(region);
        when(repository.findTopByUserIdOrderByCreatedAtDesc(USER)).thenReturn(Optional.of(student));
        return student;
    }

    @Test
    void fillsRegionWhenProfileHasNone() {
        Student student = studentWithRegion(null);

        assertTrue(learnerService.fillRegionIfBlank(USER, "  Andhra Pradesh "));

        assertEquals("Andhra Pradesh", student.getRegion());
        verify(repository).save(student);
    }

    @Test
    void fillsRegionWhenProfileRegionIsBlankText() {
        Student student = studentWithRegion("  ");

        assertTrue(learnerService.fillRegionIfBlank(USER, "Andhra Pradesh"));

        assertEquals("Andhra Pradesh", student.getRegion());
        verify(repository).save(student);
    }

    @Test
    void neverReplacesARegionAlreadySaved() {
        Student student = studentWithRegion("Karnataka");

        assertFalse(learnerService.fillRegionIfBlank(USER, "Andhra Pradesh"));

        assertEquals("Karnataka", student.getRegion());
        verify(repository, never()).save(any());
    }

    @Test
    void doesNothingWhenNoStudentRow() {
        when(repository.findTopByUserIdOrderByCreatedAtDesc(USER)).thenReturn(Optional.empty());

        assertFalse(learnerService.fillRegionIfBlank(USER, "Andhra Pradesh"));

        verify(repository, never()).save(any());
    }

    @Test
    void doesNothingWithoutRegionOrUser() {
        assertFalse(learnerService.fillRegionIfBlank(USER, null));
        assertFalse(learnerService.fillRegionIfBlank(USER, "   "));
        assertFalse(learnerService.fillRegionIfBlank(null, "Andhra Pradesh"));

        verify(repository, never()).findTopByUserIdOrderByCreatedAtDesc(anyString());
        verify(repository, never()).save(any());
    }
}
