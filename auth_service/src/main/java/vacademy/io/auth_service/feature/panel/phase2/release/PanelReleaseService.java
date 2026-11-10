package vacademy.io.auth_service.feature.panel.phase2.release;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Component;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.SyncUpdate;
import vacademy.io.auth_service.feature.panel.phase2.PanelCompat;
import vacademy.io.auth_service.feature.panel.phase2.PanelPhase2Errors;
import vacademy.io.auth_service.feature.panel.phase2.PanelPhase2Properties;
import vacademy.io.auth_service.feature.panel.phase2.PanelReleaseOffer;
import vacademy.io.auth_service.feature.panel.phase2.release.PanelReleaseRepository.ReleaseRow;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.DeviceRow;
import vacademy.io.auth_service.feature.panel.service.PanelProperties;

import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import java.util.function.LongSupplier;

/**
 * The real {@link PanelReleaseOffer}: update offers for direct-channel panels and the version floor.
 *
 * <ul>
 *   <li>Offers go only to a panel on the DIRECT channel (a panel that never reported a channel counts
 *       as DIRECT) and only on a signed-out sync; the session service never asks during a class.</li>
 *   <li>The offer is the highest LIVE DIRECT release above the panel's version whose min_sdk the panel
 *       meets, whose download link is on an allowed host, and whose rollout covers the panel. A
 *       panel's rollout position is a fixed number from 0 to 99 taken from its id, so raising the
 *       percentage only ever adds panels.</li>
 *   <li>The floor of a channel is the larger of panel.min-app-version-code and the highest LIVE
 *       release of that channel marked required. Below it a panel may not start a session. The floor
 *       is per channel: it is not limited to panels that can be offered the build. A required release
 *       is offered whatever its rollout, but a panel whose SDK is unknown or below the build's
 *       min_sdk, whose build has no updater, or whose link host is no longer allowed gets no offer and
 *       stays below the floor. Staff are warned before such a floor is set (PanelReleaseAdminService)
 *       and the fleet marks those panels with no_update_offer.</li>
 * </ul>
 *
 * <p>With panel.releases.enabled off every method is phase 1: no offer, no floor, no database read.
 * The LIVE list is read at most once per cache period per pod, and a failed read keeps the last list,
 * so neither /sync nor sign-in depends on this table being reachable. No HTTP call is made.
 */
@Component
public class PanelReleaseService implements PanelReleaseOffer {

    private static final Logger log = LoggerFactory.getLogger(PanelReleaseService.class);

    public static final String DIRECT = "DIRECT";
    public static final String PLAY = "PLAY";

    private final PanelReleaseRepository repository;
    private final PanelPhase2Properties phase2;
    private final PanelProperties properties;
    private final PanelReleaseSettings settings;
    private final PanelCompat compat;
    private final LongSupplier nanoClock;
    private final Object loadLock = new Object();
    private volatile Snapshot snapshot;
    private final java.util.Set<String> warnedUnreachable = java.util.concurrent.ConcurrentHashMap.newKeySet();

    private record Snapshot(long loadedAtNanos, List<ReleaseRow> live) {
    }

    @Autowired
    public PanelReleaseService(PanelReleaseRepository repository, PanelPhase2Properties phase2,
            PanelProperties properties, PanelReleaseSettings settings, PanelCompat compat) {
        this(repository, phase2, properties, settings, compat, System::nanoTime);
    }

    /** For tests: a controllable monotonic clock for the cache. */
    PanelReleaseService(PanelReleaseRepository repository, PanelPhase2Properties phase2, PanelProperties properties,
            PanelReleaseSettings settings, PanelCompat compat, LongSupplier nanoClock) {
        this.repository = repository;
        this.phase2 = phase2;
        this.properties = properties;
        this.settings = settings;
        this.compat = compat;
        this.nanoClock = nanoClock;
    }

    // --------------------------------------------------------------- seam ---

    @Override
    public SyncUpdate syncBlock(DeviceRow device) {
        if (!phase2.isReleasesEnabled() || device == null) {
            return null;
        }
        return offerFor(device.id(), channelOf(device), device.appVersionCode(), device.sdkInt(), liveReleases());
    }

    /**
     * The offer for a panel from its reported values and a LIVE list, or null. Shared with the fleet
     * alerts, which already hold the row and the list, so nothing is read again.
     */
    public SyncUpdate offerFor(String deviceId, String channel, Integer current, Integer sdk, List<ReleaseRow> live) {
        if (!DIRECT.equals(channel) || current == null || sdk == null) {
            return null;
        }
        int floor = floorOf(DIRECT, live);
        boolean below = current < floor;
        int bucket = bucket(deviceId);

        ReleaseRow best = null;
        for (ReleaseRow release : live) {
            if (offerable(release, current, sdk) && (release.required() || bucket < release.rolloutPercent())
                    && (best == null || release.versionCode() > best.versionCode())) {
                best = release;
            }
        }
        if (below && (best == null || best.versionCode() < floor)) {
            // Below the floor with nothing in its rollout that lifts it: the smallest build that does.
            ReleaseRow lift = null;
            for (ReleaseRow release : live) {
                if (offerable(release, current, sdk) && release.versionCode() >= floor
                        && (lift == null || release.versionCode() < lift.versionCode())) {
                    lift = release;
                }
            }
            if (lift != null) {
                best = lift;
            }
        }
        if (best == null) {
            return null;
        }
        return new SyncUpdate(best.versionCode(), best.versionName(), best.apkUrl(), best.sha256(),
                best.sizeBytes(), below);
    }

    @Override
    public void requireNotBelowFloor(DeviceRow device) {
        if (!phase2.isReleasesEnabled() || device == null || device.appVersionCode() == null) {
            return;
        }
        if (device.appVersionCode() < floorOf(channelOf(device), liveReleases())) {
            throw compat.refusal(device, PanelPhase2Errors.UPDATE_REQUIRED);
        }
    }

    @Override
    public Integer requiredVersionCode(DeviceRow device) {
        if (!phase2.isReleasesEnabled() || device == null) {
            return null;
        }
        return floorOf(channelOf(device), liveReleases());
    }

    // ------------------------------------------------------- shared rules ---

    /** The channel a panel's offers and floor come from. Phase 1 builds send none: they count as DIRECT. */
    public static String channelOf(DeviceRow device) {
        String channel = device.appChannel();
        return channel == null || channel.isBlank() ? DIRECT : channel;
    }

    /** The floor of a channel with releases on; the fleet alerts use the same number. */
    public int floorOf(String channel) {
        return floorOf(channel, liveReleases());
    }

    /** The floor of a channel given a LIVE list (from {@link #liveReleases()}). */
    public int floorOf(String channel, List<ReleaseRow> live) {
        int floor = properties.getMinAppVersionCode();
        for (ReleaseRow release : live) {
            if (release.required() && release.channel().equals(channel)) {
                floor = Math.max(floor, release.versionCode());
            }
        }
        return floor;
    }

    private boolean offerable(ReleaseRow release, int current, int sdk) {
        return DIRECT.equals(release.channel()) && release.live() && release.versionCode() > current
                && release.minSdk() <= sdk && release.sha256() != null && release.sizeBytes() != null
                && release.sizeBytes() > 0 && downloadAllowed(release.apkUrl());
    }

    /**
     * HTTPS on the default port, a host on panel.releases.allowed-hosts, no user info and no fragment.
     * Checked when a release is registered and again before every offer, so removing a host from the
     * property stops its offers at the next restart.
     */
    public boolean downloadAllowed(String url) {
        if (url == null || url.length() > 500) {
            return false;
        }
        try {
            URI uri = new URI(url);
            return "https".equals(uri.getScheme() == null ? null : uri.getScheme().toLowerCase(Locale.ROOT))
                    && uri.getRawUserInfo() == null && uri.getRawFragment() == null
                    && (uri.getPort() == -1 || uri.getPort() == 443)
                    && uri.getRawPath() != null && uri.getRawPath().length() > 1
                    && settings.isAllowedHost(uri.getHost());
        } catch (URISyntaxException e) {
            return false;
        }
    }

    /**
     * A panel's fixed rollout position, 0 to 99: the first four bytes of SHA-256(device id) as a
     * signed big-endian int, floor-modulo 100. The same id always lands in the same place.
     */
    public static int bucket(String deviceId) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(deviceId.getBytes(StandardCharsets.UTF_8));
            int value = ((digest[0] & 0xff) << 24) | ((digest[1] & 0xff) << 16) | ((digest[2] & 0xff) << 8)
                    | (digest[3] & 0xff);
            return Math.floorMod(value, 100);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    // -------------------------------------------------------------- cache ---

    /** The LIVE rows of every channel, from this pod's cache. Empty while releases are off. */
    public List<ReleaseRow> liveReleases() {
        if (!phase2.isReleasesEnabled()) {
            return List.of();
        }
        long ttl = TimeUnit.SECONDS.toNanos(settings.getCacheSeconds());
        Snapshot current = snapshot;
        if (current != null && nanoClock.getAsLong() - current.loadedAtNanos() < ttl) {
            return current.live();
        }
        synchronized (loadLock) {
            current = snapshot;
            long now = nanoClock.getAsLong();
            if (current != null && now - current.loadedAtNanos() < ttl) {
                return current.live();
            }
            List<ReleaseRow> rows;
            try {
                rows = List.copyOf(repository.listLive());
            } catch (DataAccessException e) {
                log.warn("Panel release list could not be read; keeping the previous list: {}",
                        e.getClass().getSimpleName());
                rows = current == null ? List.of() : current.live();
            }
            snapshot = new Snapshot(now, rows);
            warnUnreachableRequired(rows);
            return rows;
        }
    }

    /** Once per release and pod: a required DIRECT build whose link host is not allowed is offered to nobody. */
    private void warnUnreachableRequired(List<ReleaseRow> rows) {
        for (ReleaseRow row : rows) {
            if (row.required() && DIRECT.equals(row.channel()) && !downloadAllowed(row.apkUrl())
                    && warnedUnreachable.add(row.id())) {
                log.warn("Required panel release {} (version {}) has a link host that is not allowed: "
                        + "it is offered to no panel while it sets the floor", row.id(), row.versionCode());
            }
        }
    }

    /** After a registry change on this pod. Other pods pick it up within the cache period. */
    public void invalidate() {
        snapshot = null;
    }
}
