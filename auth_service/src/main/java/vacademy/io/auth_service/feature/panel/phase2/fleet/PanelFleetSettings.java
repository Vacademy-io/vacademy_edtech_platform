package vacademy.io.auth_service.feature.panel.phase2.fleet;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.time.DateTimeException;
import java.time.DayOfWeek;
import java.time.ZoneId;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

/**
 * Fleet alert thresholds beyond the four in PanelPhase2Properties (offline hours, outdated days,
 * WebView major, unused days). The switch is panel.fleet.enabled there. Read once at boot.
 *
 * <pre>
 *   panel.alerts.offline-bad-days       7                        OFFLINE turns from warn to bad
 *   panel.alerts.not-confirmed-hours    24                       a claimed panel that never confirmed
 *   panel.alerts.licence-ending-days    14                       covering seats end within this many days
 *   panel.alerts.school-days            MON,TUE,WED,THU,FRI,SAT  days that count for UNUSED
 *   panel.alerts.zone                   Asia/Kolkata             the zone school days are counted in
 * </pre>
 */
@Component
public class PanelFleetSettings {

    private final int offlineBadDays;
    private final int notConfirmedHours;
    private final int licenceEndingDays;
    private final Set<DayOfWeek> schoolDays;
    private final ZoneId zone;

    @Autowired
    public PanelFleetSettings(Environment environment) {
        this(environment::getProperty);
    }

    private PanelFleetSettings(Function<String, String> lookup) {
        this.offlineBadDays = Math.max(1, integer(lookup, "panel.alerts.offline-bad-days", 7));
        this.notConfirmedHours = Math.max(1, integer(lookup, "panel.alerts.not-confirmed-hours", 24));
        this.licenceEndingDays = Math.max(0, integer(lookup, "panel.alerts.licence-ending-days", 14));
        Set<DayOfWeek> days = EnumSet.noneOf(DayOfWeek.class);
        for (String token : text(lookup, "panel.alerts.school-days", "MON,TUE,WED,THU,FRI,SAT").split(",")) {
            DayOfWeek day = dayOf(token.trim().toUpperCase(Locale.ROOT));
            if (day != null) {
                days.add(day);
            }
        }
        if (days.isEmpty()) {
            days = EnumSet.range(DayOfWeek.MONDAY, DayOfWeek.SATURDAY);
        }
        this.schoolDays = Set.copyOf(days);
        ZoneId parsed;
        try {
            parsed = ZoneId.of(text(lookup, "panel.alerts.zone", "Asia/Kolkata").trim());
        } catch (DateTimeException e) {
            parsed = ZoneId.of("Asia/Kolkata");
        }
        this.zone = parsed;
    }

    /** For tests: the given properties, every other one at its default. */
    public static PanelFleetSettings of(Map<String, String> values) {
        return new PanelFleetSettings(values::get);
    }

    private static DayOfWeek dayOf(String token) {
        return Arrays.stream(DayOfWeek.values())
                .filter(day -> day.name().equals(token) || day.name().startsWith(token) && token.length() >= 3)
                .findFirst()
                .orElse(null);
    }

    private static String text(Function<String, String> lookup, String key, String fallback) {
        String value = lookup.apply(key);
        return value == null || value.isBlank() ? fallback : value;
    }

    private static int integer(Function<String, String> lookup, String key, int fallback) {
        try {
            return Integer.parseInt(text(lookup, key, String.valueOf(fallback)).trim());
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    public int getOfflineBadDays() {
        return offlineBadDays;
    }

    public int getNotConfirmedHours() {
        return notConfirmedHours;
    }

    public int getLicenceEndingDays() {
        return licenceEndingDays;
    }

    public Set<DayOfWeek> getSchoolDays() {
        return schoolDays;
    }

    public ZoneId getZone() {
        return zone;
    }
}
