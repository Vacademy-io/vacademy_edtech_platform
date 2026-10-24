package vacademy.io.admin_core_service.features.app_status.service;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.app_status.client.CommunityAppRegistryClient;
import vacademy.io.admin_core_service.features.app_status.dto.AppStatusResponse;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.ota_update.entity.OtaBundleVersion;
import vacademy.io.admin_core_service.features.ota_update.service.OtaUpdateService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;

@Service
@RequiredArgsConstructor
@Slf4j
public class AppStatusService {

    private static final String ROLE_NAME_ADMIN = "ADMIN";

    /** The platforms that actually run the OTA updater. See {@link #attachOtaBundles}. */
    private static final Set<String> OTA_PLATFORMS = Set.of("ANDROID", "IOS");

    private final CommunityAppRegistryClient communityAppRegistryClient;
    private final OtaUpdateService otaUpdateService;
    private final InstituteRepository instituteRepository;
    private final UserRoleRepository userRoleRepository;

    public AppStatusResponse getStatus(CustomUserDetails user, String instituteId) {
        // Registry rows written before the institute field existed store a blank owner, so a blank
        // id here would match them all and hand one institute another's registrations. A root user
        // passes the access check, which is exactly who would hit this by accident.
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException("instituteId is required");
        }
        assertInstituteAccess(user, instituteId);

        List<AppStatusResponse.RegisteredApp> apps = new ArrayList<>();
        for (JsonNode record : communityAppRegistryClient.fetchByInstitute(instituteId)) {
            if (record == null || !record.isObject()) {
                continue;
            }
            AppStatusResponse.RegisteredApp app = AppStatusMapper.toRegisteredApp(record);
            attachOtaBundles(app);
            apps.add(app);
        }

        return AppStatusResponse.builder()
                .instituteId(instituteId)
                .apps(apps)
                .build();
    }

    /**
     * Fills in what each platform is running over the air.
     *
     * <p>The store version is the shell; the OTA bundle is the code inside it, and asking about a
     * white-label app's version without it answers the wrong question — a shell can sit on the
     * store for months while the bundle changes weekly, and the difference between "your app is on
     * 1.0.4" and "your app is running a bundle from June that was never built for you" is the whole
     * point of showing it.
     *
     * <p>Mobile only, and that is not an oversight. The learner app's updater bails out before it
     * ever asks — {@code ota-update.ts} returns "no update" on anything that is not android or ios
     * — so the Windows and macOS shells never receive a bundle at all. They load the deployed web
     * app directly, which means an OTA version on a desktop row would describe something that
     * cannot happen to it, and the "shared bundle" warning would be raising an alarm about a
     * bundle that is never delivered.
     *
     * <p>Never fatal: the registry half of this screen is worth showing on its own, so a failure
     * here leaves {@code ota} null rather than taking the settings page down with it.
     */
    private void attachOtaBundles(AppStatusResponse.RegisteredApp app) {
        if (app.getPlatforms() == null) {
            return;
        }
        for (AppStatusResponse.PlatformStatus platform : app.getPlatforms()) {
            if (!OTA_PLATFORMS.contains(platform.getPlatform())) {
                continue;
            }
            try {
                Optional<OtaBundleVersion> served =
                        otaUpdateService.resolveServedBundle(platform.getPlatform(), platform.getAppId());
                served.ifPresent(bundle -> platform.setOta(toOtaBundle(bundle)));
            } catch (Exception e) {
                log.warn("[AppStatus] OTA lookup failed for appId={} platform={}: {}",
                        platform.getAppId(), platform.getPlatform(), e.getMessage());
            }
        }
    }

    private AppStatusResponse.OtaBundle toOtaBundle(OtaBundleVersion bundle) {
        String targets = bundle.getTargetAppIds();
        return AppStatusResponse.OtaBundle.builder()
                .version(bundle.getVersion())
                .publishedAt(bundle.getCreatedAt() == null ? "" : bundle.getCreatedAt().toString())
                .releaseNotes(bundle.getReleaseNotes() == null ? "" : bundle.getReleaseNotes())
                .minNativeVersion(bundle.getMinNativeVersion() == null ? "" : bundle.getMinNativeVersion())
                .forceUpdate(Boolean.TRUE.equals(bundle.getForceUpdate()))
                .sharedBundle(targets == null || targets.isBlank())
                .build();
    }

    /**
     * Same three-tier check as WhiteLabelService#assertInstituteAccess (root bypass → user_role
     * ADMIN row → legacy staff-table fallback) — duplicated rather than shared because
     * WhiteLabelService keeps it private, and this endpoint has the identical authorization
     * requirement: only that institute's admins (or a root user) may read its data.
     */
    private void assertInstituteAccess(CustomUserDetails user, String instituteId) {
        if (user == null) {
            throw new VacademyException("Access denied: no authenticated user");
        }

        if (user.isRootUser()) {
            return;
        }

        if (userRoleRepository.existsByUserIdAndInstituteIdAndRoleName(
                user.getUserId(), instituteId, ROLE_NAME_ADMIN)) {
            return;
        }

        boolean isStaff = instituteRepository.findInstitutesByUserId(user.getUserId())
                .stream()
                .anyMatch(i -> i.getId().equals(instituteId));
        if (!isStaff) {
            log.warn("[AppStatus] Unauthorized attempt by userId={} on instituteId={}",
                    user.getUserId(), instituteId);
            throw new VacademyException("Access denied: you are not a member of institute " + instituteId);
        }
    }
}
