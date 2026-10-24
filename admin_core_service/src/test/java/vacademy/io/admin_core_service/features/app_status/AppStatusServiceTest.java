package vacademy.io.admin_core_service.features.app_status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import vacademy.io.admin_core_service.features.app_status.client.CommunityAppRegistryClient;
import vacademy.io.admin_core_service.features.app_status.dto.AppStatusResponse;
import vacademy.io.admin_core_service.features.app_status.service.AppStatusService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.ota_update.entity.OtaBundleVersion;
import vacademy.io.admin_core_service.features.ota_update.service.OtaUpdateService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.time.ZonedDateTime;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Who is allowed to read an institute's app registrations, and what happens when the service that
 * holds them cannot answer.
 *
 * <p>The shape of the data is {@link AppStatusMapperTest}'s job. This is about the boundary: one
 * institute's apps must never be readable by another's admin, and a flaky internal call must not
 * take down an unrelated settings page.
 */
@ExtendWith(MockitoExtension.class)
class AppStatusServiceTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Mock
    private CommunityAppRegistryClient communityAppRegistryClient;

    @Mock
    private InstituteRepository instituteRepository;

    @Mock
    private UserRoleRepository userRoleRepository;

    @Mock
    private OtaUpdateService otaUpdateService;

    @Mock
    private CustomUserDetails user;

    @InjectMocks
    private AppStatusService service;

    private static JsonNode json(String text) {
        try {
            return MAPPER.readTree(text);
        } catch (Exception e) {
            throw new IllegalArgumentException("bad test fixture", e);
        }
    }

    private static final String ONE_APP =
            "{\"id\":\"app-1\",\"basics\":{\"name\":\"Shiksha Nation\"},"
                    + "\"platforms\":{\"ANDROID\":{\"enabled\":true,\"status\":\"LIVE\"}}}";

    /**
     * Built before any other stubbing starts: Mockito treats a {@code when(...)} that runs while an
     * outer {@code when(...)} is still open as an unfinished stub, so this must never be inlined
     * into a {@code thenReturn(...)} argument.
     */
    private Institute institute(String id) {
        Institute institute = mock(Institute.class);
        when(institute.getId()).thenReturn(id);
        return institute;
    }

    @ParameterizedTest(name = "an instituteId of [{0}] is refused before anything is read")
    @NullSource
    @ValueSource(strings = {"", "   "})
    @DisplayName("a blank id would match every ownerless registration, so it is never answered")
    void blankInstituteIdIsRefused(String instituteId) {
        assertThrows(VacademyException.class, () -> service.getStatus(user, instituteId));

        verifyNoInteractions(communityAppRegistryClient, userRoleRepository, instituteRepository);
    }

    @Test
    @DisplayName("an unauthenticated caller is refused")
    void nullUserIsRefused() {
        assertThrows(VacademyException.class, () -> service.getStatus(null, "inst-1"));

        verifyNoInteractions(communityAppRegistryClient);
    }

    @Test
    @DisplayName("a root user may read any institute")
    void rootUserPasses() {
        when(user.isRootUser()).thenReturn(true);
        when(communityAppRegistryClient.fetchByInstitute("inst-1")).thenReturn(List.of(json(ONE_APP)));

        AppStatusResponse response = service.getStatus(user, "inst-1");

        assertEquals("inst-1", response.getInstituteId());
        assertEquals(1, response.getApps().size());
        assertEquals("Shiksha Nation", response.getApps().get(0).getName());
    }

    @Test
    @DisplayName("an ADMIN of that institute may read it")
    void instituteAdminPasses() {
        when(user.isRootUser()).thenReturn(false);
        when(user.getUserId()).thenReturn("u1");
        when(userRoleRepository.existsByUserIdAndInstituteIdAndRoleName("u1", "inst-1", "ADMIN"))
                .thenReturn(true);
        when(communityAppRegistryClient.fetchByInstitute("inst-1")).thenReturn(List.of());

        assertTrue(service.getStatus(user, "inst-1").getApps().isEmpty());
    }

    @Test
    @DisplayName("staff on the legacy institute table may read it, even without an ADMIN role row")
    void legacyStaffPasses() {
        when(user.isRootUser()).thenReturn(false);
        when(user.getUserId()).thenReturn("u1");
        when(userRoleRepository.existsByUserIdAndInstituteIdAndRoleName(anyString(), anyString(), anyString()))
                .thenReturn(false);
        Institute own = institute("inst-1");
        when(instituteRepository.findInstitutesByUserId("u1")).thenReturn(List.of(own));
        when(communityAppRegistryClient.fetchByInstitute("inst-1")).thenReturn(List.of());

        assertTrue(service.getStatus(user, "inst-1").getApps().isEmpty());
    }

    @Test
    @DisplayName("an admin of a different institute is refused, and never sees the other's apps")
    void otherInstitutesAdminIsRefused() {
        when(user.isRootUser()).thenReturn(false);
        when(user.getUserId()).thenReturn("u1");
        when(userRoleRepository.existsByUserIdAndInstituteIdAndRoleName(anyString(), anyString(), anyString()))
                .thenReturn(false);
        Institute other = institute("inst-OTHER");
        when(instituteRepository.findInstitutesByUserId("u1")).thenReturn(List.of(other));

        assertThrows(VacademyException.class, () -> service.getStatus(user, "inst-1"));

        verifyNoInteractions(communityAppRegistryClient);
    }

    @Test
    @DisplayName("a registry that cannot answer leaves the page with no apps, not an error")
    void registryFailureIsAnEmptyList() {
        // The client swallows its own failures and returns an empty list — see its javadoc. What
        // matters here is that the settings page still renders instead of 500-ing on a sibling
        // service being down.
        when(user.isRootUser()).thenReturn(true);
        when(communityAppRegistryClient.fetchByInstitute("inst-1")).thenReturn(List.of());

        AppStatusResponse response = service.getStatus(user, "inst-1");

        assertEquals("inst-1", response.getInstituteId());
        assertTrue(response.getApps().isEmpty());
    }

    @Test
    @DisplayName("a record that is not an object is skipped rather than mapped into a blank app")
    void junkRecordsAreSkipped() {
        when(user.isRootUser()).thenReturn(true);
        when(communityAppRegistryClient.fetchByInstitute("inst-1"))
                .thenReturn(java.util.Arrays.asList(null, json("\"a string\""), json("[]"), json(ONE_APP)));

        AppStatusResponse response = service.getStatus(user, "inst-1");

        assertEquals(1, response.getApps().size());
        assertEquals("app-1", response.getApps().get(0).getId());
    }

    private static final String APP_WITH_BUNDLE_ID =
            "{\"id\":\"app-1\",\"basics\":{\"name\":\"HCCA Learning\",\"packageName\":\"com.hcca.app\"},"
                    + "\"platforms\":{\"IOS\":{\"enabled\":true,\"status\":\"LIVE\","
                    + "\"fields\":{\"bundle_id\":\"io.hcca.app\"}}}}";

    private static OtaBundleVersion bundle(String version, String targets) {
        return OtaBundleVersion.builder()
                .version(version)
                .platform("IOS")
                .targetAppIds(targets)
                .minNativeVersion("1.0.0")
                .forceUpdate(false)
                .releaseNotes("Fixes")
                .createdAt(ZonedDateTime.parse("2026-06-16T10:00:00Z"))
                .build();
    }

    @Test
    @DisplayName("the OTA bundle is looked up under the platform's own store id, not the record's package name")
    void otaIsResolvedPerPlatformId() {
        when(user.isRootUser()).thenReturn(true);
        when(communityAppRegistryClient.fetchByInstitute("inst-1"))
                .thenReturn(List.of(json(APP_WITH_BUNDLE_ID)));
        when(otaUpdateService.resolveServedBundle("IOS", "io.hcca.app"))
                .thenReturn(Optional.of(bundle("2.5.1", "io.hcca.app")));

        AppStatusResponse.PlatformStatus platform =
                service.getStatus(user, "inst-1").getApps().get(0).getPlatforms().get(0);

        assertEquals("2.5.1", platform.getOta().getVersion());
        assertEquals("1.0.0", platform.getOta().getMinNativeVersion());
        assertFalse(platform.getOta().isSharedBundle());
        verify(otaUpdateService).resolveServedBundle("IOS", "io.hcca.app");
    }

    @Test
    @DisplayName("a bundle targeting nobody in particular is reported as shared — that is how a white-label app ends up on another app's JS")
    void untargetedBundleIsFlaggedShared() {
        when(user.isRootUser()).thenReturn(true);
        when(communityAppRegistryClient.fetchByInstitute("inst-1"))
                .thenReturn(List.of(json(APP_WITH_BUNDLE_ID)));
        when(otaUpdateService.resolveServedBundle("IOS", "io.hcca.app"))
                .thenReturn(Optional.of(bundle("2.2.2", "  ")));

        AppStatusResponse.PlatformStatus platform =
                service.getStatus(user, "inst-1").getApps().get(0).getPlatforms().get(0);

        assertTrue(platform.getOta().isSharedBundle());
    }

    @Test
    @DisplayName("an app no bundle serves reports no OTA at all, rather than an invented one")
    void noBundleMeansNoOtaBlock() {
        when(user.isRootUser()).thenReturn(true);
        when(communityAppRegistryClient.fetchByInstitute("inst-1"))
                .thenReturn(List.of(json(APP_WITH_BUNDLE_ID)));
        when(otaUpdateService.resolveServedBundle("IOS", "io.hcca.app")).thenReturn(Optional.empty());

        AppStatusResponse.PlatformStatus platform =
                service.getStatus(user, "inst-1").getApps().get(0).getPlatforms().get(0);

        assertNull(platform.getOta());
    }

    @Test
    @DisplayName("an OTA lookup that blows up costs the OTA line, not the whole settings page")
    void otaFailureDoesNotSinkTheResponse() {
        when(user.isRootUser()).thenReturn(true);
        when(communityAppRegistryClient.fetchByInstitute("inst-1"))
                .thenReturn(List.of(json(APP_WITH_BUNDLE_ID)));
        when(otaUpdateService.resolveServedBundle("IOS", "io.hcca.app"))
                .thenThrow(new RuntimeException("ota_bundle_version is unreachable"));

        AppStatusResponse.PlatformStatus platform =
                service.getStatus(user, "inst-1").getApps().get(0).getPlatforms().get(0);

        assertNull(platform.getOta());
        assertEquals("LIVE", platform.getStatus());
    }

    private static final String DESKTOP_APP =
            "{\"id\":\"app-1\",\"basics\":{\"name\":\"ZOE\",\"packageName\":\"com.zoeedtech.app\"},"
                    + "\"platforms\":{"
                    + "\"MACOS\":{\"enabled\":true,\"status\":\"LIVE\",\"fields\":{\"bundle_id\":\"io.zoeedtech.app\"}},"
                    + "\"WINDOWS\":{\"enabled\":true,\"status\":\"LIVE\",\"fields\":{\"store_id\":\"9NG12PX12ZSK\"}}}}";

    @Test
    @DisplayName("desktop rows carry no OTA line — the shells never receive a bundle")
    void desktopPlatformsAreNotGivenAnOtaBundle() {
        // The learner app's updater returns "no update" on anything that is not android or ios, so
        // an untargeted bundle would never reach the Windows or macOS build. Showing one — and
        // worse, warning that it is a "shared bundle" — describes something that cannot happen.
        when(user.isRootUser()).thenReturn(true);
        when(communityAppRegistryClient.fetchByInstitute("inst-1")).thenReturn(List.of(json(DESKTOP_APP)));

        List<AppStatusResponse.PlatformStatus> platforms =
                service.getStatus(user, "inst-1").getApps().get(0).getPlatforms();

        assertEquals(2, platforms.size());
        platforms.forEach(platform -> assertNull(platform.getOta(), platform.getPlatform()));
        verifyNoInteractions(otaUpdateService);
    }

    @Test
    @DisplayName("the institute asked for is the institute fetched — never one off the payload")
    void fetchesExactlyTheRequestedInstitute() {
        when(user.isRootUser()).thenReturn(true);
        when(communityAppRegistryClient.fetchByInstitute("inst-1")).thenReturn(List.of(json(ONE_APP)));

        service.getStatus(user, "inst-1");

        verify(communityAppRegistryClient).fetchByInstitute("inst-1");
    }
}
