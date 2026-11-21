package vacademy.io.admin_core_service.features.ota_update.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.ota_update.dto.OtaCheckResponse;
import vacademy.io.admin_core_service.features.ota_update.dto.OtaRegisterRequest;
import vacademy.io.admin_core_service.features.ota_update.dto.OtaVersionDTO;
import vacademy.io.admin_core_service.features.ota_update.entity.OtaBundleVersion;
import vacademy.io.admin_core_service.features.ota_update.repository.OtaBundleVersionRepository;

import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class OtaUpdateService {

    private final OtaBundleVersionRepository repository;

    // Apps that require STRICT explicit targeting: an untargeted bundle (blank
    // target_app_ids) is NOT served to them. This protects apps that share the
    // OTA backend with the learner app — whose bundles are intentionally
    // untargeted ("all apps") — from receiving another app's JS. Without this,
    // a learner bundle (higher global version) would be delivered to e.g. the
    // Vacademy Admin shell. Comma-separated, ops-overridable.
    @Value("${ota.strict-target-app-ids:io.vacademy.admin.app}")
    private String strictTargetAppIdsRaw;

    private Set<String> strictTargetAppIds() {
        if (strictTargetAppIdsRaw == null || strictTargetAppIdsRaw.isBlank()) {
            return Set.of();
        }
        return Arrays.stream(strictTargetAppIdsRaw.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .collect(Collectors.toSet());
    }

    public OtaCheckResponse checkForUpdate(String platform, String currentBundleVersion,
                                           String nativeVersion, String appId) {
        List<OtaBundleVersion> activeVersions = repository.findActiveVersionsForPlatform(platform.toUpperCase());
        Set<String> strictAppIds = strictTargetAppIds();

        for (OtaBundleVersion version : activeVersions) {
            if (!servesApp(version, appId, strictAppIds)) {
                continue;
            }

            // Check minimum native version compatibility
            if (compareVersions(nativeVersion, version.getMinNativeVersion()) < 0) {
                continue;
            }

            // Check if this version is newer than what the client has
            if (compareVersions(version.getVersion(), currentBundleVersion) > 0) {
                log.info("OTA update available: {} -> {} for platform={}, appId={}",
                        currentBundleVersion, version.getVersion(), platform, appId);
                return OtaCheckResponse.builder()
                        .updateAvailable(true)
                        .version(version.getVersion())
                        .bundleDownloadUrl(version.getBundleDownloadUrl())
                        .checksum(version.getChecksum())
                        .bundleSizeBytes(version.getBundleSizeBytes())
                        .forceUpdate(version.getForceUpdate())
                        .releaseNotes(version.getReleaseNotes())
                        .targetAppIds(version.getTargetAppIds())
                        .build();
            }
        }

        return OtaCheckResponse.noUpdate();
    }

    /**
     * Would this bundle be handed to {@code appId} at all? Targeting only — the caller decides
     * whether it also wants the native-version floor and the "newer than what you have" test.
     *
     * <p>Shared by {@link #checkForUpdate} and {@link #resolveServedBundle} on purpose: the rule
     * that an untargeted bundle is served to everyone *except* the strict-target apps is the one
     * piece of OTA logic that has bitten us before, and two copies of it would eventually disagree
     * about what a client is actually running.
     */
    private boolean servesApp(OtaBundleVersion version, String appId, Set<String> strictAppIds) {
        String targets = version.getTargetAppIds();
        if (targets != null && !targets.isBlank()) {
            Set<String> targetIds = Arrays.stream(targets.split(","))
                    .map(String::trim)
                    .collect(Collectors.toSet());
            return appId != null && targetIds.contains(appId);
        }
        // Untargeted bundle ("all apps") — withheld from strict apps so a foreign app's bundle can
        // never land in their WebView.
        return appId == null || !strictAppIds.contains(appId);
    }

    /**
     * The OTA bundle this app is currently being served — the newest active bundle for the
     * platform whose targeting includes it. Read-only, for status screens.
     *
     * <p>Two deliberate differences from {@link #checkForUpdate}, which answers a device's
     * question rather than an operator's:
     * <ul>
     *   <li>No {@code minNativeVersion} floor, because there is no device here to compare against.
     *       The floor is reported instead, so a bundle that some installs are too old to receive
     *       is visible rather than silently absent.</li>
     *   <li>No "newer than what you have" test — this is what the app is pointed at, not a diff.</li>
     * </ul>
     *
     * <p>An app that no bundle targets legitimately resolves to the untargeted "all apps" bundle,
     * which is usually a surprise worth seeing: it is how a white-label app ends up running another
     * app's JavaScript.
     */
    public Optional<OtaBundleVersion> resolveServedBundle(String platform, String appId) {
        if (platform == null || platform.isBlank() || appId == null || appId.isBlank()) {
            return Optional.empty();
        }
        Set<String> strictAppIds = strictTargetAppIds();
        return repository.findActiveVersionsForPlatform(platform.toUpperCase()).stream()
                .filter(version -> servesApp(version, appId, strictAppIds))
                .findFirst();
    }

    public OtaVersionDTO registerVersion(OtaRegisterRequest request, String publishedBy) {
        if (repository.findByVersion(request.getVersion()).isPresent()) {
            throw new IllegalArgumentException("Version " + request.getVersion() + " already exists");
        }

        OtaBundleVersion entity = OtaBundleVersion.builder()
                .version(request.getVersion())
                .platform(request.getPlatform() != null ? request.getPlatform().toUpperCase() : "ALL")
                .bundleFileId(request.getBundleFileId())
                .bundleDownloadUrl(request.getBundleDownloadUrl())
                .checksum(request.getChecksum())
                .bundleSizeBytes(request.getBundleSizeBytes())
                .minNativeVersion(request.getMinNativeVersion() != null ? request.getMinNativeVersion() : "1.0.0")
                .forceUpdate(request.getForceUpdate() != null ? request.getForceUpdate() : false)
                .targetAppIds(request.getTargetAppIds())
                .releaseNotes(request.getReleaseNotes())
                .publishedBy(publishedBy)
                .build();

        OtaBundleVersion saved = repository.save(entity);
        log.info("Registered OTA version {} by {}", saved.getVersion(), publishedBy);
        return OtaVersionDTO.fromEntity(saved);
    }

    public void deactivateVersion(String versionId) {
        OtaBundleVersion version = repository.findById(versionId)
                .orElseThrow(() -> new IllegalArgumentException("Version not found: " + versionId));
        version.setIsActive(false);
        repository.save(version);
        log.info("Deactivated OTA version {}", version.getVersion());
    }

    public void activateVersion(String versionId) {
        OtaBundleVersion version = repository.findById(versionId)
                .orElseThrow(() -> new IllegalArgumentException("Version not found: " + versionId));
        version.setIsActive(true);
        repository.save(version);
        log.info("Activated OTA version {}", version.getVersion());
    }

    public Page<OtaVersionDTO> listVersions(Pageable pageable) {
        return repository.findAllByOrderByCreatedAtDesc(pageable).map(OtaVersionDTO::fromEntity);
    }

    /**
     * Compare two semver-like version strings (e.g. "2.1.6" vs "2.0.0").
     * Returns positive if v1 > v2, negative if v1 < v2, 0 if equal.
     */
    static int compareVersions(String v1, String v2) {
        if (v1 == null || v2 == null) return 0;

        String[] parts1 = v1.split("\\.");
        String[] parts2 = v2.split("\\.");
        int length = Math.max(parts1.length, parts2.length);

        for (int i = 0; i < length; i++) {
            int num1 = i < parts1.length ? parseIntSafe(parts1[i]) : 0;
            int num2 = i < parts2.length ? parseIntSafe(parts2[i]) : 0;
            if (num1 != num2) return num1 - num2;
        }
        return 0;
    }

    private static int parseIntSafe(String s) {
        try {
            return Integer.parseInt(s.trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
