package vacademy.io.assessment_service.features.assessment.copy_intake.scan.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Switches for the scan station. Off by default, and set in no properties file:
 * while off, every /copy-intake/v1/scan route except /config answers 404,
 * /config says enabled:false, and the runner's sweep does nothing.
 *
 * <p>The institute list fails closed: empty means no institute, {@code *} means all.
 */
@Component
public class ScanStationProperties {

    private final boolean enabled;
    private final Set<String> institutes;
    private final boolean allInstitutes;
    private final long sweepMs;

    public ScanStationProperties(
            @Value("${assessment.copy-intake.scan-station.enabled:false}") boolean enabled,
            @Value("${assessment.copy-intake.scan-station.institutes:}") String institutes,
            @Value("${assessment.copy-intake.scan-station.sweep-ms:60000}") long sweepMs) {
        this.enabled = enabled;
        this.institutes = parse(institutes);
        this.allInstitutes = this.institutes.contains("*");
        this.sweepMs = sweepMs;
    }

    private static Set<String> parse(String csv) {
        if (!StringUtils.hasText(csv)) return Set.of();
        return Arrays.stream(csv.split(","))
                .map(String::trim)
                .filter(StringUtils::hasText)
                .collect(Collectors.toUnmodifiableSet());
    }

    /** The master switch; the runner works only while it is on. */
    public boolean isEnabled() {
        return enabled;
    }

    /** On for this institute: the switch is on and the institute is on the list (or the list is '*'). */
    public boolean isOn(String instituteId) {
        if (!enabled || !StringUtils.hasText(instituteId)) return false;
        return allInstitutes || institutes.contains(instituteId.trim());
    }

    /** The list is '*': every institute is on while the switch is. */
    public boolean isAllInstitutes() {
        return allInstitutes;
    }

    /** The institutes listed by id (never '*'); the sweep reads only their rows. */
    public Set<String> getInstitutes() {
        return institutes.stream().filter(i -> !"*".equals(i)).collect(Collectors.toUnmodifiableSet());
    }

    public long getSweepMs() {
        return sweepMs;
    }
}
