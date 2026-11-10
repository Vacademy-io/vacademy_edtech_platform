package vacademy.io.auth_service.feature.panel.phase2.fleet;

import org.springframework.stereotype.Service;
import vacademy.io.auth_service.feature.institute_oauth.service.InstituteOAuthClientAccessGuard;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.FleetAlert;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.FleetResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.RoomRef;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.SyncUpdate;
import vacademy.io.auth_service.feature.panel.phase2.PanelCompat;
import vacademy.io.auth_service.feature.panel.phase2.PanelLicenceGate;
import vacademy.io.auth_service.feature.panel.phase2.PanelLicenceGate.InstituteLicenceView;
import vacademy.io.auth_service.feature.panel.phase2.PanelPhase2Properties;
import vacademy.io.auth_service.feature.panel.phase2.fleet.PanelFleetRepository.FleetDevice;
import vacademy.io.auth_service.feature.panel.phase2.release.PanelReleaseRepository.ReleaseRow;
import vacademy.io.auth_service.feature.panel.phase2.release.PanelReleaseService;
import vacademy.io.auth_service.feature.panel.service.PanelApiException;
import vacademy.io.auth_service.feature.panel.service.PanelSecrets;
import vacademy.io.auth_service.feature.panel.service.PanelTx;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.sql.Timestamp;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * Fleet alerts, computed on every read from the panels of one institute, their last counted session,
 * the release registry and the seat picture. Nothing is stored and nothing is sent from here; the
 * daily digest is another service's job. Thresholds are properties (PanelPhase2Properties and
 * PanelFleetSettings).
 *
 * <ul>
 *   <li>OFFLINE: an ACTIVE, APPROVED panel not seen for offline-hours (never seen counts from its
 *       confirmation). warn, bad after offline-bad-days.</li>
 *   <li>NOT_CONFIRMED: claimed more than not-confirmed-hours ago and pairing never finished.</li>
 *   <li>AWAITING_APPROVAL: set up by an installer and waiting for the school.</li>
 *   <li>UPDATE_REQUIRED: below its channel's floor, so nobody can sign in on it (releases on).</li>
 *   <li>APP_OUTDATED: a newer build for its channel has been LIVE for outdated-days (releases on).
 *       For DIRECT only a build this panel is actually offered counts.</li>
 *   <li>WEBVIEW_OLD: WebView major below webview-warn-major (0 turns it off). warn on PLAY, where it
 *       means WebView updates are switched off; info elsewhere.</li>
 *   <li>UNUSED: online in the window but no counted session in the last unused-days school days.
 *       Not raised for a panel that is OFFLINE or newer than the window.</li>
 *   <li>LICENCE_ROOM, LICENCE_ENDING: from {@link PanelLicenceGate#view}, only while licences are on.</li>
 * </ul>
 *
 * <p>incident_key changes when a new incident starts (for example a panel that came back and went
 * offline again), so a digest can send each incident once.
 */
@Service
public class PanelFleetService {

    static final String INFO = "info";
    static final String WARN = "warn";
    static final String BAD = "bad";

    private static final Map<String, Integer> SEVERITY_ORDER = Map.of(BAD, 0, WARN, 1, INFO, 2);

    private final PanelFleetRepository repository;
    private final PanelPhase2Properties phase2;
    private final PanelFleetSettings settings;
    private final PanelReleaseService releases;
    private final PanelLicenceGate licence;
    private final InstituteOAuthClientAccessGuard accessGuard;
    private final PanelTx tx;

    public PanelFleetService(PanelFleetRepository repository, PanelPhase2Properties phase2,
            PanelFleetSettings settings, PanelReleaseService releases, PanelLicenceGate licence,
            InstituteOAuthClientAccessGuard accessGuard, PanelTx tx) {
        this.repository = repository;
        this.phase2 = phase2;
        this.settings = settings;
        this.releases = releases;
        this.licence = licence;
        this.accessGuard = accessGuard;
        this.tx = tx;
    }

    /** GET /admin/fleet: an ACTIVE ADMIN of this institute only. */
    public FleetResponse forAdmin(CustomUserDetails user, String instituteId) {
        phase2.requireFleet();
        return tx.run(() -> {
            accessGuard.requireInstituteAdmin(user, instituteId);
            return compute(instituteId);
        });
    }

    /** The internal /fleet: the caller is another service, checked by the internal request filter. */
    public FleetResponse forService(String instituteId) {
        phase2.requireFleet();
        if (instituteId == null || instituteId.isBlank() || instituteId.length() > 255
                || PanelSecrets.hasControlChars(instituteId)) {
            throw PanelApiException.badRequest("institute_id is required");
        }
        return tx.run(() -> compute(instituteId));
    }

    private FleetResponse compute(String instituteId) {
        List<FleetDevice> devices = repository.listLiveDevices(instituteId);
        Instant now = (devices.isEmpty() ? repository.dbNow() : devices.get(0).dbNow()).toInstant();
        InstituteLicenceView seats = phase2.isLicenceEnabled() ? licence.view(instituteId) : null;
        return respond(now, evaluate(devices, now, seats, releases.liveReleases()));
    }

    static FleetResponse respond(Instant now, List<FleetAlert> alerts) {
        Map<String, Integer> counts = new TreeMap<>();
        for (FleetAlert alert : alerts) {
            counts.merge(alert.kind(), 1, Integer::sum);
        }
        return new FleetResponse(now.toString(), counts, alerts);
    }

    /** The rules, without I/O. live is empty while releases are off. seats is null while licences are off. */
    List<FleetAlert> evaluate(List<FleetDevice> devices, Instant now, InstituteLicenceView seats,
            List<ReleaseRow> live) {
        boolean releasesOn = phase2.isReleasesEnabled();
        Instant offlineCutoff = now.minus(Duration.ofHours(phase2.getAlertsOfflineHours()));
        Instant badCutoff = now.minus(Duration.ofDays(settings.getOfflineBadDays()));
        Instant claimCutoff = now.minus(Duration.ofHours(settings.getNotConfirmedHours()));
        Instant outdatedCutoff = now.minus(Duration.ofDays(phase2.getAlertsOutdatedDays()));
        Instant unusedStart = unusedWindowStart(now, settings.getZone(), settings.getSchoolDays(),
                phase2.getAlertsUnusedDays());
        int webviewWarn = phase2.getAlertsWebviewWarnMajor();
        boolean seatsManaged = seats != null && !"OFF".equals(seats.enforcement());

        List<FleetAlert> alerts = new ArrayList<>();
        for (FleetDevice d : devices) {
            String approval = d.approvalState() == null ? "APPROVED" : d.approvalState();
            if ("REJECTED".equals(approval)) {
                continue;
            }
            RoomRef room = new RoomRef(d.roomId(), d.roomName());
            if ("PENDING".equals(approval)) {
                alerts.add(alert("AWAITING_APPROVAL", WARN, d, room, d.claimedAt(), d.id(),
                        detail("claimed_at", iso(d.claimedAt()))));
            }
            if ("CLAIMED".equals(d.status())) {
                if (d.claimedAt() != null && d.claimedAt().toInstant().isBefore(claimCutoff)) {
                    alerts.add(alert("NOT_CONFIRMED", WARN, d, room, d.claimedAt(), epochKey(d.claimedAt()),
                            detail("claimed_at", iso(d.claimedAt()))));
                }
                continue;
            }
            boolean approved = "APPROVED".equals(approval);

            boolean offline = false;
            Timestamp seen = firstNonNull(d.lastSeenAt(), d.confirmedAt(), d.claimedAt());
            if (approved && seen != null && seen.toInstant().isBefore(offlineCutoff)) {
                offline = true;
                Map<String, Object> detail = detail("last_seen_at", iso(d.lastSeenAt()));
                detail.put("app_version_code", d.appVersionCode());
                alerts.add(alert("OFFLINE", seen.toInstant().isBefore(badCutoff) ? BAD : WARN, d, room, seen,
                        epochKey(seen), detail));
            }

            String channel = d.appChannel() == null || d.appChannel().isBlank() ? PanelReleaseService.DIRECT
                    : d.appChannel();
            Integer version = d.appVersionCode();
            boolean updateRequired = false;
            if (releasesOn && version != null) {
                int floor = releases.floorOf(channel, live);
                if (version < floor) {
                    updateRequired = true;
                    Map<String, Object> detail = detail("app_version_code", version);
                    detail.put("required_version_code", floor);
                    detail.put("app_channel", channel);
                    if (PanelReleaseService.DIRECT.equals(channel)) {
                        // Waiting to update, or unable to: no build that lifts it can be offered.
                        SyncUpdate offer = releases.offerFor(d.id(), channel, version, d.sdkInt(), live);
                        detail.put("no_update_offer", !PanelCompat.understandsPhase2(version) || offer == null
                                || offer.versionCode() < floor);
                    }
                    alerts.add(alert("UPDATE_REQUIRED", BAD, d, room, null, String.valueOf(floor), detail));
                }
            }
            if (releasesOn && version != null && !updateRequired) {
                ReleaseRow newer = outdatedBy(d, channel, version, live, outdatedCutoff);
                if (newer != null) {
                    Map<String, Object> detail = detail("app_version_code", version);
                    detail.put("latest_version_code", newer.versionCode());
                    detail.put("latest_version_name", newer.versionName());
                    detail.put("app_channel", channel);
                    alerts.add(alert("APP_OUTDATED", INFO, d, room, newer.publishedAt(),
                            String.valueOf(newer.versionCode()), detail));
                }
            }

            if (webviewWarn > 0 && d.webviewMajor() != null && d.webviewMajor() < webviewWarn) {
                Map<String, Object> detail = detail("webview_major", d.webviewMajor());
                detail.put("app_channel", channel);
                alerts.add(alert("WEBVIEW_OLD", PanelReleaseService.PLAY.equals(channel) ? WARN : INFO, d, room,
                        null, String.valueOf(d.webviewMajor()), detail));
            }

            Timestamp liveSince = firstNonNull(d.confirmedAt(), d.claimedAt());
            if (approved && !offline && d.lastSeenAt() != null && !d.lastSeenAt().toInstant().isBefore(unusedStart)
                    && liveSince != null && liveSince.toInstant().isBefore(unusedStart)
                    && (d.lastSessionAt() == null || d.lastSessionAt().toInstant().isBefore(unusedStart))) {
                alerts.add(alert("UNUSED", WARN, d, room, d.lastSessionAt() == null ? liveSince : d.lastSessionAt(),
                        d.lastSessionId() == null ? "none" : d.lastSessionId(),
                        detail("last_session_at", iso(d.lastSessionAt()))));
            }

            if (seatsManaged) {
                String state = seats.roomState(d.roomId());
                if ("OVER_LIMIT".equals(state) || "UNLICENSED".equals(state)) {
                    Map<String, Object> detail = detail("licence_state", state);
                    detail.put("enforcement", seats.enforcement());
                    alerts.add(alert("LICENCE_ROOM", WARN, d, room, d.roomLicensedAt(),
                            state + ":" + (d.roomLicensedAt() == null ? "none" : epochKey(d.roomLicensedAt())),
                            detail));
                }
            }
        }

        if (seats != null) {
            alerts.addAll(licenceEnding(seats, now));
        }

        alerts.sort(Comparator.comparingInt((FleetAlert a) -> SEVERITY_ORDER.getOrDefault(a.severity(), 3))
                .thenComparing(FleetAlert::kind)
                .thenComparing(a -> a.room() == null || a.room().name() == null ? ""
                        : a.room().name().toLowerCase(Locale.ROOT))
                .thenComparing(a -> a.deviceId() == null ? "" : a.deviceId()));
        return alerts;
    }

    /** The highest build of the panel's channel above its version that has been LIVE since the cutoff. */
    private ReleaseRow outdatedBy(FleetDevice d, String channel, int version, List<ReleaseRow> live,
            Instant cutoff) {
        ReleaseRow newest = null;
        for (ReleaseRow release : live) {
            if (!release.live() || !release.channel().equals(channel) || release.versionCode() <= version
                    || release.publishedAt() == null || release.publishedAt().toInstant().isAfter(cutoff)
                    || (d.sdkInt() != null && release.minSdk() > d.sdkInt())) {
                continue;
            }
            if (PanelReleaseService.DIRECT.equals(channel) && (!releases.downloadAllowed(release.apkUrl())
                    || !(release.required() || PanelReleaseService.bucket(d.id()) < release.rolloutPercent()))) {
                continue;
            }
            if (newest == null || release.versionCode() > newest.versionCode()) {
                newest = release;
            }
        }
        return newest;
    }

    /**
     * LICENCE_ENDING: the institute is in grace (key GRACE:grant); or, while a grant covers, the
     * earliest-ending covering grant whose end takes a seat a room holds ends within
     * licence-ending-days (key: that grant); or rooms beyond the covering seats are kept only by an
     * ended grant's grace days (key GRACE:grant).
     */
    private List<FleetAlert> licenceEnding(InstituteLicenceView seats, Instant now) {
        List<FleetAlert> out = new ArrayList<>();
        String state = seats.state();
        if ("GRACE".equals(state)) {
            Map<String, Object> detail = detail("state", state);
            detail.put("ends_at", seats.endsAt() == null ? null : seats.endsAt().toString());
            detail.put("grace_ends_at", seats.graceEndsAt() == null ? null : seats.graceEndsAt().toString());
            out.add(new FleetAlert("LICENCE_ENDING", WARN, null, null,
                    seats.endsAt() == null ? null : seats.endsAt().toString(), "GRACE:" + graceKey(seats), detail));
            return out;
        }
        if (!"ACTIVE".equals(state) && !"TRIAL".equals(state)) {
            return out;
        }
        Instant firstEnd = seats.firstEndsAt();
        if (firstEnd != null && !firstEnd.isAfter(now.plus(Duration.ofDays(settings.getLicenceEndingDays())))) {
            Map<String, Object> detail = detail("state", state);
            detail.put("ends_at", firstEnd.toString());
            out.add(new FleetAlert("LICENCE_ENDING", WARN, null, null, null,
                    seats.endingGrantId() == null ? "none" : seats.endingGrantId(), detail));
        }
        if (seats.graceSeats() > 0) {
            Map<String, Object> detail = detail("state", state);
            detail.put("grace_seats", seats.graceSeats());
            detail.put("grace_ends_at", seats.graceEndsAt() == null ? null : seats.graceEndsAt().toString());
            out.add(new FleetAlert("LICENCE_ENDING", WARN, null, null, null, "GRACE:" + graceKey(seats), detail));
        }
        return out;
    }

    private static String graceKey(InstituteLicenceView seats) {
        String id = seats.graceGrantId() != null ? seats.graceGrantId() : seats.endingGrantId();
        return id == null ? "none" : id;
    }

    /**
     * The start of the local day that is the given number of school days before today. Today never
     * counts, so a panel used earlier today or on any of those days is not unused.
     */
    static Instant unusedWindowStart(Instant now, ZoneId zone, Set<DayOfWeek> schoolDays, int days) {
        LocalDate date = now.atZone(zone).toLocalDate();
        int counted = 0;
        while (counted < days) {
            date = date.minusDays(1);
            if (schoolDays.contains(date.getDayOfWeek())) {
                counted++;
            }
        }
        return date.atStartOfDay(zone).toInstant();
    }

    private static FleetAlert alert(String kind, String severity, FleetDevice d, RoomRef room, Timestamp since,
            String incidentKey, Map<String, Object> detail) {
        return new FleetAlert(kind, severity, d.id(), room, iso(since), incidentKey, detail);
    }

    private static Map<String, Object> detail(String key, Object value) {
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put(key, value);
        return detail;
    }

    private static String iso(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant().toString();
    }

    private static String epochKey(Timestamp timestamp) {
        return String.valueOf(timestamp.toInstant().getEpochSecond());
    }

    @SafeVarargs
    private static <T> T firstNonNull(T... values) {
        for (T value : values) {
            if (value != null) {
                return value;
            }
        }
        return null;
    }
}
