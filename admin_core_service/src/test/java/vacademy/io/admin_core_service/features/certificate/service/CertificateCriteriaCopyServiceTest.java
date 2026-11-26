package vacademy.io.admin_core_service.features.certificate.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.certificate.dao.CertificateCriteriaDao;
import vacademy.io.admin_core_service.features.certificate.dao.CertificateCriteriaDao.CopyKind;
import vacademy.io.admin_core_service.features.certificate.dto.CertificateCriteriaDto;
import vacademy.io.admin_core_service.features.certificate.dto.CourseCertificateSettingDto;
import vacademy.io.admin_core_service.features.course_settings.service.PackageSettingService;
import vacademy.io.admin_core_service.features.institute.dto.settings.GenericSettingRequest;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** A duplicated course's "picked tests" rule must point at the copy's own content. */
class CertificateCriteriaCopyServiceTest {

    private static final String NEW_COURSE = "pkg-copy";
    private static final List<String> NEW_BATCHES = List.of("ps-copy");

    private CertificateSettingsResolver resolver;
    private PackageSettingService packageSettings;
    private CertificateCriteriaDao dao;
    private CertificateCriteriaCopyService service;

    @BeforeEach
    void setUp() {
        resolver = mock(CertificateSettingsResolver.class);
        packageSettings = mock(PackageSettingService.class);
        dao = mock(CertificateCriteriaDao.class);
        service = new CertificateCriteriaCopyService(resolver, packageSettings, dao);
        when(dao.findPackageSessionIds(NEW_COURSE)).thenReturn(NEW_BATCHES);
        when(dao.findCopies(any(), anyList(), eq(NEW_BATCHES))).thenReturn(Map.of());
    }

    private void storedRule(CertificateCriteriaDto criteria) {
        when(resolver.getCourseOverride(NEW_COURSE)).thenReturn(
                CourseCertificateSettingDto.builder().enabled(true).criteria(criteria).build());
    }

    @Test
    void picksMoveToTheCopiesAndUnknownIdsAreKept() {
        storedRule(CertificateCriteriaDto.builder().mode("SCORE").testScope("CUSTOM")
                .moduleIds(List.of("m-old")).chapterIds(List.of("c-old", "c-gone")).slideIds(List.of("s-old")).build());
        when(dao.findCopies(CopyKind.MODULE, List.of("m-old"), NEW_BATCHES)).thenReturn(Map.of("m-old", List.of("m-new")));
        when(dao.findCopies(CopyKind.CHAPTER, List.of("c-old", "c-gone"), NEW_BATCHES))
                .thenReturn(Map.of("c-old", List.of("c-new")));
        // one original copied into two batches -> both copies count
        when(dao.findCopies(CopyKind.SLIDE, List.of("s-old"), NEW_BATCHES))
                .thenReturn(Map.of("s-old", List.of("s-new-1", "s-new-2")));

        assertTrue(service.remapAfterCourseCopy(NEW_COURSE));

        ArgumentCaptor<GenericSettingRequest> saved = ArgumentCaptor.forClass(GenericSettingRequest.class);
        verify(packageSettings).saveGenericSetting(eq(NEW_COURSE), eq("CERTIFICATE_SETTING"), saved.capture());
        CertificateCriteriaDto after = ((CourseCertificateSettingDto) saved.getValue().getSettingData()).getCriteria();
        assertEquals(List.of("m-new"), after.getModuleIds());
        assertEquals(List.of("c-new", "c-gone"), after.getChapterIds());
        assertEquals(List.of("s-new-1", "s-new-2"), after.getSlideIds());
        assertEquals("SCORE", after.getMode());
    }

    @Test
    void wholeCourseRuleNeedsNothing() {
        storedRule(CertificateCriteriaDto.builder().mode("SCORE").testScope("ALL").build());
        assertFalse(service.remapAfterCourseCopy(NEW_COURSE));
        verify(packageSettings, never()).saveGenericSetting(any(), any(), any());
    }

    @Test
    void courseWithoutARuleIsLeftAlone() {
        when(resolver.getCourseOverride(NEW_COURSE)).thenReturn(null);
        assertFalse(service.remapAfterCourseCopy(NEW_COURSE));
        verify(packageSettings, never()).saveGenericSetting(any(), any(), any());
    }

    @Test
    void nothingCopiedMeansNoWrite() {
        storedRule(CertificateCriteriaDto.builder().mode("SCORE").testScope("CUSTOM").slideIds(List.of("s-old")).build());
        assertFalse(service.remapAfterCourseCopy(NEW_COURSE));
        verify(packageSettings, never()).saveGenericSetting(any(), any(), any());
    }
}
