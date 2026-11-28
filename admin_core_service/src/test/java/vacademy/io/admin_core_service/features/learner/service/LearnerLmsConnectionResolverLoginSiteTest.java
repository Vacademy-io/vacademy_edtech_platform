package vacademy.io.admin_core_service.features.learner.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.course_settings.service.PackageSettingService;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.util.Date;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The login link in credential emails must land the learner on the LMS their coursework is
 * on - the newest active enrolment's site, the institute's site when no course has one, and
 * nothing (caller falls back to the learner portal) when no LMS is connected at all.
 */
class LearnerLmsConnectionResolverLoginSiteTest {

    private final StudentSessionRepository repo = mock(StudentSessionRepository.class);
    private final PackageSettingService packageSettings = mock(PackageSettingService.class);
    private final InstituteSettingService instituteSettings = mock(InstituteSettingService.class);
    private final LearnerLmsConnectionResolver resolver =
            new LearnerLmsConnectionResolver(repo, packageSettings, instituteSettings, new ObjectMapper());

    private static Map<String, Object> wpSetting(String site) {
        return Map.of("data", Map.of("apiUrl", site + "/wp-json/wp/v2", "apiKey", "k", "apiSecret", "s"));
    }

    private static StudentSessionInstituteGroupMapping mapping(String packageId, String instituteId, long createdAt) {
        PackageEntity pkg = new PackageEntity();
        pkg.setId(packageId);
        PackageSession ps = new PackageSession();
        ps.setId("ps-" + packageId);
        ps.setPackageEntity(pkg);
        Institute inst = new Institute();
        inst.setId(instituteId);
        StudentSessionInstituteGroupMapping m = new StudentSessionInstituteGroupMapping();
        m.setPackageSession(ps);
        m.setInstitute(inst);
        m.setCreatedAt(new Date(createdAt));
        return m;
    }

    @Test
    @DisplayName("Newest active enrolment's LMS site wins")
    void newestEnrolmentWins() {
        when(repo.findAllByUserIdAndStatusIn(eq("u1"), anyList())).thenReturn(List.of(
                mapping("old", "inst", 1_000L), mapping("new", "inst", 2_000L)));
        when(packageSettings.getSettingData("old", "LMS_SETTING")).thenReturn(wpSetting("https://greencross.example.org"));
        when(packageSettings.getSettingData("new", "LMS_SETTING")).thenReturn(wpSetting("https://mycpd.example.org"));

        assertEquals("https://mycpd.example.org", resolver.resolveLoginSiteUrl("u1", null));
    }

    @Test
    @DisplayName("Falls back to the institute's LMS when no enrolled course has its own")
    void instituteLevelFallback() {
        when(repo.findAllByUserIdAndStatusIn(eq("u1"), anyList())).thenReturn(List.of(mapping("p", "inst", 1_000L)));
        when(instituteSettings.getSettingByInstituteIdAndKey("inst", "LMS_SETTING"))
                .thenReturn(wpSetting("https://lms.example.org"));

        assertEquals("https://lms.example.org", resolver.resolveLoginSiteUrl("u1", null));
    }

    @Test
    @DisplayName("instituteId limits the search to that institute, and its own setting still applies with no enrolment there")
    void instituteScoped() {
        when(repo.findAllByUserIdAndStatusIn(eq("u1"), anyList())).thenReturn(List.of(mapping("other-pkg", "other", 5_000L)));
        when(packageSettings.getSettingData("other-pkg", "LMS_SETTING")).thenReturn(wpSetting("https://other.example.org"));
        when(instituteSettings.getSettingByInstituteIdAndKey("inst", "LMS_SETTING"))
                .thenReturn(wpSetting("https://lms.example.org"));

        assertEquals("https://lms.example.org", resolver.resolveLoginSiteUrl("u1", "inst"));
    }

    @Test
    @DisplayName("No connected LMS -> null, so the caller keeps the learner-portal link")
    void nothingConnected() {
        when(repo.findAllByUserIdAndStatusIn(eq("u1"), anyList())).thenReturn(List.of(mapping("p", "inst", 1_000L)));

        assertNull(resolver.resolveLoginSiteUrl("u1", "inst"));
    }
}
