package vacademy.io.admin_core_service.features.institute_learner.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.common.service.CustomFieldListFilterResolver.Resolution;
import vacademy.io.admin_core_service.features.institute_learner.dto.student_list_dto.LearnerLocationFilterOptionsDTO;
import vacademy.io.admin_core_service.features.institute_learner.dto.student_list_dto.StudentListFilter;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * City / region filters on the learner list: values are typed free-hand, so they are compared
 * trimmed and lower-cased, and an empty selection must never turn into a filter.
 */
class LearnerLocationFilterServiceTest {

    private static final String INSTITUTE = "inst-1";

    private InstituteStudentRepository repository;
    private LearnerLocationFilterService service;

    @BeforeEach
    void setUp() {
        repository = mock(InstituteStudentRepository.class);
        service = new LearnerLocationFilterService(repository);
    }

    private static StudentListFilter filter(List<String> cities, List<String> regions) {
        StudentListFilter filter = new StudentListFilter();
        filter.setInstituteIds(List.of(INSTITUTE));
        filter.setCities(cities);
        filter.setRegions(regions);
        return filter;
    }

    @Test
    void normalizeTrimsLowerCasesAndDropsDuplicatesAndBlanks() {
        StudentListFilter filter = filter(
                new ArrayList<>(Arrays.asList(" Pune ", "pune", "", null, "NAGPUR")),
                List.of("  Maharashtra"));

        LearnerLocationFilterService.normalizeFilter(filter);

        assertEquals(List.of("pune", "nagpur"), filter.getCities());
        assertEquals(List.of("maharashtra"), filter.getRegions());
        assertTrue(LearnerLocationFilterService.hasFilter(filter));
    }

    @Test
    void emptyOrBlankSelectionIsNoFilter() {
        StudentListFilter filter = filter(new ArrayList<>(), new ArrayList<>(Arrays.asList(" ", null)));

        LearnerLocationFilterService.normalizeFilter(filter);

        assertNull(filter.getCities());
        assertNull(filter.getRegions());
        assertFalse(LearnerLocationFilterService.hasFilter(filter));
        assertNull(service.resolve(filter));
        verify(repository, never()).findInstituteUserIdsByCityAndRegion(anyList(), any(), any());
    }

    @Test
    void resolveReturnsTheMatchingLearnersAsAMatchedSet() {
        StudentListFilter filter = filter(List.of("pune"), null);
        when(repository.findInstituteUserIdsByCityAndRegion(List.of(INSTITUTE), List.of("pune"), null))
                .thenReturn(List.of("u1", "u2"));

        Resolution resolution = service.resolve(filter);

        assertEquals(Set.of("u1", "u2"), resolution.matchedIds);
        assertNull(resolution.excludedIds);
        assertFalse(resolution.shortCircuitsToEmpty());
    }

    @Test
    void noMatchingLearnerMeansAnEmptyList() {
        StudentListFilter filter = filter(null, List.of("kerala"));
        when(repository.findInstituteUserIdsByCityAndRegion(anyList(), any(), any())).thenReturn(List.of());

        assertTrue(service.resolve(filter).shortCircuitsToEmpty());
    }

    @Test
    void withoutAnInstituteItMatchesNobodyInsteadOfSearchingEveryInstitute() {
        StudentListFilter filter = filter(List.of("pune"), null);
        filter.setInstituteIds(List.of());

        assertTrue(service.resolve(filter).shortCircuitsToEmpty());
        verify(repository, never()).findInstituteUserIdsByCityAndRegion(anyList(), any(), any());
    }

    @Test
    void optionsKeepValueAndCountAndSkipBlankRows() {
        List<Object[]> cities = new ArrayList<>();
        cities.add(new Object[] {"Pune", 30L});
        cities.add(new Object[] {"  ", 3L});
        cities.add(new Object[] {null, 1L});
        cities.add(new Object[] {"Nagpur", 8});
        List<Object[]> regions = new ArrayList<>();
        regions.add(new Object[] {"Maharashtra", 3L});
        when(repository.findCityFilterOptions(INSTITUTE)).thenReturn(cities);
        when(repository.findRegionFilterOptions(INSTITUTE)).thenReturn(regions);

        LearnerLocationFilterOptionsDTO options = service.getOptions(INSTITUTE);

        assertEquals(2, options.getCities().size());
        assertEquals("Pune", options.getCities().get(0).getValue());
        assertEquals(30L, options.getCities().get(0).getCount());
        assertEquals("Nagpur", options.getCities().get(1).getValue());
        assertEquals(8L, options.getCities().get(1).getCount());
        assertEquals(1, options.getRegions().size());
        assertEquals("Maharashtra", options.getRegions().get(0).getValue());
    }
}
