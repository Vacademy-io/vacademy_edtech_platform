package vacademy.io.auth_service.feature.panel.phase2;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

/**
 * Switches and thresholds for Classroom phase 2. Every switch defaults to off, so a deploy with no
 * property set behaves exactly like phase 1. Read once at boot like PanelProperties: changing one
 * means an env var and a rolling restart. PanelProperties is not grown; everything new lives here.
 *
 * <pre>
 *   panel.usage.enabled                 false  usage report endpoints (/admin/usage*, internal summary)
 *   panel.usage.recording-enabled       false  store "what was shown" events and the IDLE trim
 *   panel.usage.max-days                92     longest report window, in days
 *   panel.activity.retention-days       180    events older than this are purged
 *   panel.licence.enabled               false  room seats: endpoints, sync block, sign-in gate
 *   panel.licence.default-enforcement   OFF    OFF, SHADOW or LIVE for institutes without a setting row
 *   panel.licence.never-block           false  emergency switch: LIVE behaves as SHADOW everywhere
 *   panel.partners.enabled              false  installer organisations, invites and installer claims
 *   panel.partners.installer-roles      ADMIN  comma list of role names that count as installers
 *   panel.releases.enabled              false  app release registry and update offers
 *   panel.fleet.enabled                 false  fleet alerts
 *   panel.alerts.offline-hours          48
 *   panel.alerts.outdated-days          14
 *   panel.alerts.webview-warn-major     0      0 turns the WebView check off
 *   panel.alerts.unused-days            7
 * </pre>
 */
@Component
public class PanelPhase2Properties {

    public static final Set<String> ENFORCEMENTS = Set.of("OFF", "SHADOW", "LIVE");

    private final boolean usageEnabled;
    private final boolean usageRecording;
    private final int usageMaxDays;
    private final int activityRetentionDays;
    private final boolean licenceEnabled;
    private final String licenceDefaultEnforcement;
    private final boolean licenceNeverBlock;
    private final boolean partnersEnabled;
    private final List<String> installerRoles;
    private final boolean releasesEnabled;
    private final boolean fleetEnabled;
    private final int alertsOfflineHours;
    private final int alertsOutdatedDays;
    private final int alertsWebviewWarnMajor;
    private final int alertsUnusedDays;

    @Autowired
    public PanelPhase2Properties(Environment environment) {
        this(environment::getProperty);
    }

    private PanelPhase2Properties(Function<String, String> lookup) {
        this.usageEnabled = bool(lookup, "panel.usage.enabled", false);
        this.usageRecording = bool(lookup, "panel.usage.recording-enabled", false);
        this.usageMaxDays = Math.max(1, integer(lookup, "panel.usage.max-days", 92));
        this.activityRetentionDays = Math.max(1, integer(lookup, "panel.activity.retention-days", 180));
        this.licenceEnabled = bool(lookup, "panel.licence.enabled", false);
        String enforcement = text(lookup, "panel.licence.default-enforcement", "OFF").trim().toUpperCase();
        this.licenceDefaultEnforcement = ENFORCEMENTS.contains(enforcement) ? enforcement : "OFF";
        this.licenceNeverBlock = bool(lookup, "panel.licence.never-block", false);
        this.partnersEnabled = bool(lookup, "panel.partners.enabled", false);
        this.installerRoles = Arrays.stream(text(lookup, "panel.partners.installer-roles", "ADMIN").split(","))
                .map(String::trim).filter(role -> !role.isEmpty()).distinct().toList();
        this.releasesEnabled = bool(lookup, "panel.releases.enabled", false);
        this.fleetEnabled = bool(lookup, "panel.fleet.enabled", false);
        this.alertsOfflineHours = Math.max(1, integer(lookup, "panel.alerts.offline-hours", 48));
        this.alertsOutdatedDays = Math.max(0, integer(lookup, "panel.alerts.outdated-days", 14));
        this.alertsWebviewWarnMajor = Math.max(0, integer(lookup, "panel.alerts.webview-warn-major", 0));
        this.alertsUnusedDays = Math.max(1, integer(lookup, "panel.alerts.unused-days", 7));
    }

    /** For tests: the given properties, every other one at its default. */
    public static PanelPhase2Properties of(Map<String, String> values) {
        return new PanelPhase2Properties(values::get);
    }

    /** For tests: every switch off, every threshold at its default. */
    public static PanelPhase2Properties allOff() {
        return of(Map.of());
    }

    private static String text(Function<String, String> lookup, String key, String fallback) {
        String value = lookup.apply(key);
        return value == null || value.isBlank() ? fallback : value;
    }

    private static boolean bool(Function<String, String> lookup, String key, boolean fallback) {
        return Boolean.parseBoolean(text(lookup, key, String.valueOf(fallback)).trim());
    }

    private static int integer(Function<String, String> lookup, String key, int fallback) {
        try {
            return Integer.parseInt(text(lookup, key, String.valueOf(fallback)).trim());
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    // --------------------------------------------------------------- usage ---

    public boolean isUsageEnabled() {
        return usageEnabled;
    }

    /** Bearer usage endpoints: 404 FEATURE_OFF while panel.usage.enabled is false. */
    public void requireUsage() {
        if (!usageEnabled) {
            throw PanelPhase2Errors.featureOff();
        }
    }

    /** Activity events are stored and IDLE ends trimmed only while this is on. */
    public boolean isUsageRecording() {
        return usageRecording;
    }

    public int getUsageMaxDays() {
        return usageMaxDays;
    }

    public int getActivityRetentionDays() {
        return activityRetentionDays;
    }

    // ------------------------------------------------------------- licence ---

    public boolean isLicenceEnabled() {
        return licenceEnabled;
    }

    public void requireLicence() {
        if (!licenceEnabled) {
            throw PanelPhase2Errors.featureOff();
        }
    }

    /** OFF, SHADOW or LIVE. Anything else in the property reads as OFF. */
    public String getLicenceDefaultEnforcement() {
        return licenceDefaultEnforcement;
    }

    public boolean isLicenceNeverBlock() {
        return licenceNeverBlock;
    }

    // ------------------------------------------------------------ partners ---

    public boolean isPartnersEnabled() {
        return partnersEnabled;
    }

    public void requirePartners() {
        if (!partnersEnabled) {
            throw PanelPhase2Errors.featureOff();
        }
    }

    public List<String> getInstallerRoles() {
        return installerRoles;
    }

    // ------------------------------------------------------------ releases ---

    public boolean isReleasesEnabled() {
        return releasesEnabled;
    }

    public void requireReleases() {
        if (!releasesEnabled) {
            throw PanelPhase2Errors.featureOff();
        }
    }

    // --------------------------------------------------------------- fleet ---

    public boolean isFleetEnabled() {
        return fleetEnabled;
    }

    public void requireFleet() {
        if (!fleetEnabled) {
            throw PanelPhase2Errors.featureOff();
        }
    }

    public int getAlertsOfflineHours() {
        return alertsOfflineHours;
    }

    public int getAlertsOutdatedDays() {
        return alertsOutdatedDays;
    }

    public int getAlertsWebviewWarnMajor() {
        return alertsWebviewWarnMajor;
    }

    public int getAlertsUnusedDays() {
        return alertsUnusedDays;
    }
}
