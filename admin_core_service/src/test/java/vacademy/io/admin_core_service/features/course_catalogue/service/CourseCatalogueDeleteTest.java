package vacademy.io.admin_core_service.features.course_catalogue.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.course_catalogue.entity.CatalogueInstituteMapping;
import vacademy.io.admin_core_service.features.course_catalogue.entity.CourseCatalogue;
import vacademy.io.admin_core_service.features.course_catalogue.repository.CatalogueInstituteMappingRepository;
import vacademy.io.admin_core_service.features.course_catalogue.repository.CourseCatalogueRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Deleting a site from Manage Pages: a soft delete that hides it from every
 * ACTIVE/DRAFT reader.
 */
class CourseCatalogueDeleteTest {

    private static final String CATALOGUE = "cat-1";

    private CourseCatalogueRepository catalogueRepository;
    private CatalogueInstituteMappingRepository mappingRepository;
    private CourseCatalogueService service;
    private CourseCatalogue catalogue;
    private CatalogueInstituteMapping mapping;

    @BeforeEach
    void setUp() {
        catalogueRepository = mock(CourseCatalogueRepository.class);
        mappingRepository = mock(CatalogueInstituteMappingRepository.class);
        Institute institute = new Institute();
        institute.setId("inst-1");
        catalogue = CourseCatalogue.builder().id(CATALOGUE).tagName("store").status("ACTIVE").build();
        mapping = CatalogueInstituteMapping.builder()
                .id("map-1").courseCatalogue(catalogue).institute(institute).status("ACTIVE").build();
        when(catalogueRepository.findById(CATALOGUE)).thenReturn(Optional.of(catalogue));
        when(mappingRepository.findByCourseCatalogueId(CATALOGUE)).thenReturn(Optional.of(mapping));
        when(mappingRepository.findByCourseCatalogueId("missing")).thenReturn(Optional.empty());

        service = new CourseCatalogueService();
        ReflectionTestUtils.setField(service, "courseCatalogueRepository", catalogueRepository);
        ReflectionTestUtils.setField(service, "catalogueInstituteMappingRepository", mappingRepository);
        ReflectionTestUtils.setField(service, "catalogueRevisionService", mock(CatalogueRevisionService.class));
    }

    @Test
    void deleteMarksSiteAndMappingDeleted() {
        service.deleteCatalogue(CATALOGUE);

        assertEquals("DELETED", mapping.getStatus());
        assertEquals("DELETED", catalogue.getStatus());
        verify(mappingRepository).save(mapping);
        verify(catalogueRepository).save(catalogue);
    }

    @Test
    void deletingTwiceIsANoOp() {
        mapping.setStatus("DELETED");

        service.deleteCatalogue(CATALOGUE);

        verify(mappingRepository, never()).save(any());
        verify(catalogueRepository, never()).save(any());
    }

    @Test
    void unknownSiteIs404() {
        VacademyException ex = assertThrows(VacademyException.class, () -> service.deleteCatalogue("missing"));
        assertEquals(HttpStatus.NOT_FOUND, ex.getStatus());
    }
}
