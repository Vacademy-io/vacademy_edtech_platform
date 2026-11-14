package vacademy.io.auth_service.feature.panel.phase2.release;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ReleaseCreateRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ReleasePatchRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ReleaseResponse;
import vacademy.io.auth_service.feature.panel.phase2.PanelCompat;
import vacademy.io.auth_service.feature.panel.phase2.PanelPhase2Properties;
import vacademy.io.auth_service.feature.panel.phase2.release.PanelReleaseRepository.NewRelease;
import vacademy.io.auth_service.feature.panel.phase2.release.PanelReleaseRepository.ReleaseRow;
import vacademy.io.auth_service.feature.panel.service.PanelApiException;
import vacademy.io.auth_service.feature.panel.service.PanelSecrets;

import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * The release registry for platform staff. The controller checks the caller is platform staff before
 * anything here runs. A release is registered as DRAFT and then stepped with PATCH: DRAFT to LIVE,
 * LIVE or DRAFT to PULLED. PULLED is final; a fixed build is a new version code.
 *
 * <p>A DIRECT release must carry everything the panel's updater verifies: an HTTPS link on an allowed
 * host, the APK's SHA-256 and size, and the build's package name and signing certificate, which must
 * match the identity this service is configured with. Nothing here downloads the file.
 */
@Service
public class PanelReleaseAdminService {

    /** Android's largest versionCode. */
    static final int MAX_VERSION_CODE = 2_100_000_000;

    private final PanelReleaseRepository repository;
    private final PanelReleaseService releases;
    private final PanelReleaseSettings settings;
    private final PanelPhase2Properties phase2;

    public PanelReleaseAdminService(PanelReleaseRepository repository, PanelReleaseService releases,
            PanelReleaseSettings settings, PanelPhase2Properties phase2) {
        this.repository = repository;
        this.releases = releases;
        this.settings = settings;
        this.phase2 = phase2;
    }

    public List<ReleaseResponse> list() {
        phase2.requireReleases();
        return repository.list().stream().map(this::response).toList();
    }

    public ReleaseResponse create(String actorUserId, ReleaseCreateRequest body) {
        phase2.requireReleases();
        if (body == null) {
            throw PanelApiException.badRequest("A release is required");
        }
        String channel = body.channel() == null ? "" : body.channel().trim().toUpperCase(Locale.ROOT);
        if (!PanelReleaseService.DIRECT.equals(channel) && !PanelReleaseService.PLAY.equals(channel)) {
            throw PanelApiException.badRequest("channel must be DIRECT or PLAY");
        }
        Integer code = body.versionCode();
        if (code == null || code < 1 || code > MAX_VERSION_CODE) {
            throw PanelApiException.badRequest("version_code is out of range");
        }
        String name = body.versionName() == null ? "" : body.versionName().trim();
        if (!name.matches("[0-9A-Za-z][0-9A-Za-z._+-]{0,31}")) {
            throw PanelApiException.badRequest("version_name is not valid");
        }
        int minSdk = body.minSdk() == null ? 24 : body.minSdk();
        if (minSdk < 21 || minSdk > 99) {
            throw PanelApiException.badRequest("min_sdk is out of range");
        }
        int rollout = rollout(body.rolloutPercent(), 0);
        String notes = body.notes() == null || body.notes().isBlank() ? null : body.notes().trim();
        if (notes != null && (notes.length() > 500 || PanelSecrets.hasControlChars(notes))) {
            throw PanelApiException.badRequest("notes are not valid");
        }

        String url = body.apkUrl() == null || body.apkUrl().isBlank() ? null : body.apkUrl().trim();
        String sha256 = null;
        Long size = body.sizeBytes();
        if (PanelReleaseService.DIRECT.equals(channel)) {
            if (url == null || !releases.downloadAllowed(url)) {
                throw PanelApiException.badRequest("apk_url must be an https link on an allowed host");
            }
            sha256 = PanelReleaseSettings.normaliseDigest(body.sha256());
            if (sha256 == null) {
                throw PanelApiException.badRequest("sha256 must be the file's SHA-256 in hex");
            }
            if (size == null || size < 1 || size > settings.getMaxSizeBytes()) {
                throw PanelApiException.badRequest("size_bytes is out of range");
            }
            requireBuildIdentity(body.packageName(), body.signingCertSha256());
        } else {
            // PLAY rows only record what the store ships: no link, nothing is offered from them.
            if (url != null) {
                throw PanelApiException.badRequest("PLAY releases carry no apk_url");
            }
            if (body.sha256() != null && !body.sha256().isBlank()) {
                sha256 = PanelReleaseSettings.normaliseDigest(body.sha256());
                if (sha256 == null) {
                    throw PanelApiException.badRequest("sha256 must be a SHA-256 in hex");
                }
            }
            if (size != null && (size < 1 || size > settings.getMaxSizeBytes())) {
                throw PanelApiException.badRequest("size_bytes is out of range");
            }
        }

        String id = UUID.randomUUID().toString();
        int inserted = repository.insert(new NewRelease(id, channel, code, name, url, sha256, size, minSdk, rollout,
                Boolean.TRUE.equals(body.required()), notes, actorUserId));
        if (inserted == 0) {
            throw new PanelApiException(HttpStatus.CONFLICT, "RELEASE_EXISTS",
                    "This channel already has a release with that version code");
        }
        releases.invalidate();
        return response(repository.findById(id).orElseThrow(() -> PanelApiException.notFound("No such release")));
    }

    public ReleaseResponse patch(String releaseId, ReleasePatchRequest body) {
        phase2.requireReleases();
        if (releaseId == null || releaseId.length() > 36 || PanelSecrets.hasControlChars(releaseId)) {
            throw PanelApiException.notFound("No such release");
        }
        if (body == null) {
            throw PanelApiException.badRequest("Nothing to change");
        }
        ReleaseRow row = repository.findById(releaseId)
                .orElseThrow(() -> PanelApiException.notFound("No such release"));
        String status = body.status() == null ? row.status() : body.status().trim().toUpperCase(Locale.ROOT);
        if (!status.equals(row.status()) && !allowedStep(row.status(), status)) {
            throw new PanelApiException(HttpStatus.CONFLICT, "BAD_STATUS",
                    "A " + row.status() + " release cannot become " + status);
        }
        if ("PULLED".equals(row.status()) && (body.rolloutPercent() != null || body.required() != null)) {
            throw new PanelApiException(HttpStatus.CONFLICT, "BAD_STATUS", "A PULLED release cannot change");
        }
        int rollout = rollout(body.rolloutPercent(), row.rolloutPercent());
        boolean required = body.required() == null ? row.required() : body.required();
        if ("LIVE".equals(status) && PanelReleaseService.DIRECT.equals(row.channel())) {
            // The registry may have been filled before a host or the signing identity was changed.
            if (!releases.downloadAllowed(row.apkUrl())) {
                throw PanelApiException.badRequest("apk_url is not on an allowed host");
            }
            if (!settings.hasSigningCert()) {
                throw signingUnset();
            }
        }
        boolean raisesFloor = "LIVE".equals(status) && required && PanelReleaseService.DIRECT.equals(row.channel())
                && !("LIVE".equals(row.status()) && row.required());
        if (raisesFloor && !Boolean.TRUE.equals(body.forceFloor())) {
            // Panels this build cannot reach would be held below the floor with no update offered.
            int stranded = repository.countPanelsBelowWithoutUpdate(row.versionCode(), row.minSdk(),
                    PanelCompat.FIRST_PHASE2_VERSION_CODE);
            if (stranded > 0) {
                throw new PanelApiException(HttpStatus.CONFLICT, "FLOOR_WITHOUT_UPDATE",
                        stranded + " panels below this build cannot be offered it; send force_floor to go ahead")
                        .with("panels", stranded);
            }
        }
        if (repository.update(releaseId, row.status(), status, rollout, required) == 0) {
            throw PanelApiException.tryAgain();
        }
        releases.invalidate();
        return response(repository.findById(releaseId)
                .orElseThrow(() -> PanelApiException.notFound("No such release")));
    }

    private static boolean allowedStep(String from, String to) {
        return ("DRAFT".equals(from) && ("LIVE".equals(to) || "PULLED".equals(to)))
                || ("LIVE".equals(from) && "PULLED".equals(to));
    }

    private static int rollout(Integer value, int fallback) {
        if (value == null) {
            return fallback;
        }
        if (value < 0 || value > 100) {
            throw PanelApiException.badRequest("rollout_percent must be 0 to 100");
        }
        return value;
    }

    private void requireBuildIdentity(String packageName, String signingCert) {
        if (!settings.hasSigningCert()) {
            throw signingUnset();
        }
        if (packageName == null || !settings.getDirectPackageName().equals(packageName.trim())) {
            throw PanelApiException.badRequest("package_name does not match the direct build");
        }
        String digest = PanelReleaseSettings.normaliseDigest(signingCert);
        if (digest == null || !digest.equals(settings.getSigningCertSha256())) {
            throw PanelApiException.badRequest("signing_cert_sha256 does not match the direct signing certificate");
        }
    }

    private static PanelApiException signingUnset() {
        return new PanelApiException(HttpStatus.CONFLICT, "SIGNING_IDENTITY_UNSET",
                "Set panel.releases.signing-cert-sha256 before registering direct releases");
    }

    private ReleaseResponse response(ReleaseRow row) {
        boolean direct = PanelReleaseService.DIRECT.equals(row.channel());
        return new ReleaseResponse(row.id(), row.channel(), row.versionCode(), row.versionName(), row.apkUrl(),
                row.sha256(), row.sizeBytes(), row.minSdk(), row.rolloutPercent(), row.required(), row.status(),
                row.notes(), row.createdBy(), row.createdAt().toInstant().toString(),
                row.publishedAt() == null ? null : row.publishedAt().toInstant().toString(),
                direct ? settings.getDirectPackageName() : null,
                direct && settings.hasSigningCert() ? settings.getSigningCertSha256() : null);
    }
}
