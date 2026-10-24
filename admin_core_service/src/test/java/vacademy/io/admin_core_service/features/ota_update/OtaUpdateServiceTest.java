package vacademy.io.admin_core_service.features.ota_update;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.ota_update.entity.OtaBundleVersion;
import vacademy.io.admin_core_service.features.ota_update.repository.OtaBundleVersionRepository;
import vacademy.io.admin_core_service.features.ota_update.service.OtaUpdateService;

import java.time.ZonedDateTime;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * Which OTA bundle an app is actually being served.
 *
 * <p>{@code checkForUpdate} answers a device's question and has always been exercised by hand;
 * {@code resolveServedBundle} answers an operator's — it is what an institute admin now reads on
 * Settings → App Status — and the two share one targeting rule so they can never disagree about
 * what a client is running. These cases pin that rule, particularly its sharp edge: an untargeted
 * "all apps" bundle IS served to a white-label app that nothing targets, which is how a client's
 * app ends up running another client's JavaScript.
 */
@ExtendWith(MockitoExtension.class)
class OtaUpdateServiceTest {

    @Mock
    private OtaBundleVersionRepository repository;

    @InjectMocks
    private OtaUpdateService service;

    @BeforeEach
    void setStrictTargets() {
        // Mirrors the property default; the @Value is not populated outside a Spring context.
        ReflectionTestUtils.setField(service, "strictTargetAppIdsRaw", "io.vacademy.admin.app");
    }

    /** Bundles come back from the repository newest-first — the query orders by createdAt DESC. */
    private static OtaBundleVersion bundle(String version, String targets, String createdAt) {
        return OtaBundleVersion.builder()
                .version(version)
                .platform("ANDROID")
                .targetAppIds(targets)
                .minNativeVersion("1.0.0")
                .forceUpdate(false)
                .isActive(true)
                .createdAt(ZonedDateTime.parse(createdAt))
                .build();
    }

    private void active(OtaBundleVersion... bundles) {
        when(repository.findActiveVersionsForPlatform("ANDROID")).thenReturn(List.of(bundles));
    }

    @Nested
    @DisplayName("targeting")
    class Targeting {

        @Test
        @DisplayName("a bundle listing this app wins over an older one that also lists it")
        void newestTargetedBundleWins() {
            active(bundle("2.5.6", "com.hcca.app", "2026-08-26T00:00:00Z"),
                    bundle("2.5.2", "com.hcca.app", "2026-08-21T00:00:00Z"));

            assertEquals("2.5.6",
                    service.resolveServedBundle("ANDROID", "com.hcca.app").orElseThrow().getVersion());
        }

        @Test
        @DisplayName("a bundle targeting other apps is not this app's bundle")
        void otherAppsBundleIsSkipped() {
            active(bundle("2.5.6", "com.shikshanation.new.app", "2026-08-26T00:00:00Z"));

            assertTrue(service.resolveServedBundle("ANDROID", "com.hcca.app").isEmpty());
        }

        @Test
        @DisplayName("targets are matched whole, and tolerate the spaces ops leave after commas")
        void targetListIsTrimmed() {
            active(bundle("2.5.5", "io.vacademy.student.app, com.hcca.app", "2026-08-26T00:00:00Z"));

            assertEquals("2.5.5",
                    service.resolveServedBundle("ANDROID", "com.hcca.app").orElseThrow().getVersion());
        }

        @Test
        @DisplayName("an untargeted bundle IS served to an app nothing targets — the trap worth seeing")
        void untargetedBundleReachesEveryone() {
            active(bundle("2.2.4", null, "2026-06-16T00:00:00Z"));

            Optional<OtaBundleVersion> served = service.resolveServedBundle("ANDROID", "com.hcca.app");

            assertEquals("2.2.4", served.orElseThrow().getVersion());
        }

        @Test
        @DisplayName("a targeted bundle listed first beats an untargeted one behind it")
        void newerUntargetedBundleStillWinsByOrder() {
            // Order is the repository's (createdAt DESC): whatever the client would be handed first.
            active(bundle("2.2.4", "", "2026-06-16T00:00:00Z"),
                    bundle("2.1.0", "com.hcca.app", "2026-05-01T00:00:00Z"));

            assertEquals("2.2.4",
                    service.resolveServedBundle("ANDROID", "com.hcca.app").orElseThrow().getVersion());
        }

        @Test
        @DisplayName("a strict-target app is never handed an untargeted bundle")
        void strictAppsRefuseUntargetedBundles() {
            active(bundle("2.2.4", null, "2026-06-16T00:00:00Z"));

            assertTrue(service.resolveServedBundle("ANDROID", "io.vacademy.admin.app").isEmpty());
        }

        @Test
        @DisplayName("a strict-target app still gets a bundle that names it")
        void strictAppsAcceptTargetedBundles() {
            active(bundle("1.0.4", "io.vacademy.admin.app", "2026-08-19T00:00:00Z"));

            assertEquals("1.0.4",
                    service.resolveServedBundle("ANDROID", "io.vacademy.admin.app").orElseThrow().getVersion());
        }
    }

    @Nested
    @DisplayName("what it refuses to answer")
    class Refusals {

        @Test
        @DisplayName("no app id means no lookup — an untargeted bundle would otherwise match anything")
        void blankAppIdIsNotAWildcard() {
            assertTrue(service.resolveServedBundle("ANDROID", "  ").isEmpty());
            assertTrue(service.resolveServedBundle("ANDROID", null).isEmpty());

            verifyNoInteractions(repository);
        }

        @Test
        @DisplayName("a platform nobody named is not queried either")
        void blankPlatformIsRefused() {
            assertTrue(service.resolveServedBundle("", "com.hcca.app").isEmpty());
            assertTrue(service.resolveServedBundle(null, "com.hcca.app").isEmpty());

            verifyNoInteractions(repository);
        }
    }

    @Test
    @DisplayName("the platform is matched case-insensitively, like the device-facing check")
    void platformIsUpperCased() {
        active(bundle("2.5.6", "com.hcca.app", "2026-08-26T00:00:00Z"));

        assertEquals("2.5.6",
                service.resolveServedBundle("android", "com.hcca.app").orElseThrow().getVersion());
    }

    @Test
    @DisplayName("the native-version floor does not hide a bundle here — there is no device to compare")
    void minNativeVersionIsReportedNotApplied() {
        OtaBundleVersion demanding = OtaBundleVersion.builder()
                .version("2.5.6")
                .platform("ANDROID")
                .targetAppIds("com.hcca.app")
                .minNativeVersion("9.9.9")
                .isActive(true)
                .createdAt(ZonedDateTime.parse("2026-08-26T00:00:00Z"))
                .build();
        active(demanding);

        assertEquals("9.9.9",
                service.resolveServedBundle("ANDROID", "com.hcca.app").orElseThrow().getMinNativeVersion());
    }
}
