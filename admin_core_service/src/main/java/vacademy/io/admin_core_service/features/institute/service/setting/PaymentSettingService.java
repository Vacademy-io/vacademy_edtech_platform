package vacademy.io.admin_core_service.features.institute.service.setting;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.institute.enums.SettingKeyEnums;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;

import java.util.ArrayList;
import java.util.List;

/**
 * Reads the institute's PAYMENT_SETTING JSON (saved via the generic
 * /institute/setting/v1/save-setting endpoint with settingKey=PAYMENT_SETTING).
 * <p>
 * Everything here is opt-IN: an institute with no PAYMENT_SETTING block, or one
 * without {@code packageSessionRenewalSchedulerEnabled: true}, is treated as
 * disabled — the renewal scheduler never touches its user plans.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PaymentSettingService {

    /** Flag inside PAYMENT_SETTING.data that opts an institute into the daily scan. */
    public static final String RENEWAL_SCHEDULER_ENABLED_KEY = "packageSessionRenewalSchedulerEnabled";

    /**
     * Flag inside PAYMENT_SETTING.data that opts an institute into learner-facing plan
     * switching. Off (or absent) means learners never see a "change plan" affordance
     * anywhere, whatever the per-option and per-plan flags say — those configure WHICH
     * plans are switchable; this decides whether the feature is exposed at all.
     */
    public static final String PLAN_CHANGE_ENABLED_KEY = "planChangeEnabled";

    /**
     * Flag inside PAYMENT_SETTING.data that makes a manual renewal ("pay to continue") also
     * arm autopay, without the learner having to ask for it.
     *
     * <p>Opt-in, and deliberately so: turning it on means a member who pays one lapsed
     * invoice is enrolled into recurring billing, so it is the institute's decision to make
     * explicitly rather than a default anyone inherits. It still only applies to plans whose
     * invite offers autopay at all.
     */
    public static final String AUTOPAY_DEFAULT_ON_RENEWAL_KEY = "autopayDefaultOnManualRenewal";

    /**
     * Flag inside PAYMENT_SETTING.data that opts an institute into the daily AUTOPAY CHARGE
     * sweep -- the job that actually presents money to the gateway.
     *
     * <p>Separate from {@link #RENEWAL_SCHEDULER_ENABLED_KEY} on purpose. That one opts into
     * the enrolment-policy scan (notifications, waiting period, expiry), which moves no
     * money; this one authorises charging cards. An institute that wanted expiry handling
     * must not silently acquire auto-debit along with it, so the two are asked separately.
     */
    public static final String AUTOPAY_CHARGE_SCHEDULER_ENABLED_KEY = "autopayChargeSchedulerEnabled";

    private final InstituteRepository instituteRepository;
    private final ObjectMapper objectMapper;

    /**
     * Institutes that have explicitly enabled the package-session renewal
     * scheduler. The repository pre-filters on a LIKE over the raw setting
     * column (cheap, index-free but the institutes table is small); the JSON
     * envelope is then parsed here so formatting/spacing can't cause false
     * positives. Unparseable settings are skipped defensively — an institute
     * with corrupt JSON must never be swept into the scan by accident.
     */
    public List<String> getInstituteIdsWithRenewalSchedulerEnabled() {
        return getInstituteIdsWithFlag(RENEWAL_SCHEDULER_ENABLED_KEY);
    }

    /**
     * Institutes that have explicitly authorised the autopay charge sweep to present money
     * for them. Absent flag = not authorised, so no institute is auto-charged until someone
     * turns this on: the sweep itself is platform-wide, and this is the only thing scoping it.
     */
    public List<String> getInstituteIdsWithAutopayChargeEnabled() {
        return getInstituteIdsWithFlag(AUTOPAY_CHARGE_SCHEDULER_ENABLED_KEY);
    }

    /** Institutes whose PAYMENT_SETTING.data has {@code flagKey} set to true. */
    private List<String> getInstituteIdsWithFlag(String flagKey) {
        List<String> enabled = new ArrayList<>();
        for (Object[] row : instituteRepository.findIdAndSettingWithPaymentSetting()) {
            String instituteId = (String) row[0];
            String settingJson = (String) row[1];
            if (settingJson == null || settingJson.isBlank()) continue;
            try {
                JsonNode flag = objectMapper.readTree(settingJson)
                        .path("setting")
                        .path(SettingKeyEnums.PAYMENT_SETTING.name())
                        .path("data")
                        .path(flagKey);
                if (flag.asBoolean(false)) {
                    enabled.add(instituteId);
                }
            } catch (Exception e) {
                log.warn("[PaymentSetting] Could not parse setting JSON for institute {} — treating as disabled",
                        instituteId, e);
            }
        }
        return enabled;
    }

    /**
     * Whether this institute exposes learner-facing plan switching.
     *
     * <p>Opt-in like everything else in this blob: a missing PAYMENT_SETTING, a missing
     * flag, or unparseable JSON all mean disabled. An institute must choose to show its
     * members a way to move between plans rather than find it already on.
     */
    public boolean isPlanChangeEnabled(String instituteId) {
        return readFlag(instituteId, PLAN_CHANGE_ENABLED_KEY);
    }

    /**
     * Whether a manual renewal should arm autopay by default for this institute.
     *
     * <p>Off unless explicitly enabled. Note what "default" means here: it pre-selects the
     * choice, it does not remove it -- a learner on a checkout gateway still sees the
     * checkbox and can clear it.
     */
    public boolean isAutopayDefaultOnManualRenewal(String instituteId) {
        return readFlag(instituteId, AUTOPAY_DEFAULT_ON_RENEWAL_KEY);
    }

    /** Reads one boolean out of PAYMENT_SETTING.data. False on anything unexpected. */
    private boolean readFlag(String instituteId, String flagKey) {
        if (instituteId == null || instituteId.isBlank()) {
            return false;
        }
        try {
            String settingJson = instituteRepository.findById(instituteId)
                    .map(vacademy.io.common.institute.entity.Institute::getSetting)
                    .orElse(null);
            if (settingJson == null || settingJson.isBlank()) {
                return false;
            }
            return objectMapper.readTree(settingJson)
                    .path("setting")
                    .path(SettingKeyEnums.PAYMENT_SETTING.name())
                    .path("data")
                    .path(flagKey)
                    .asBoolean(false);
        } catch (Exception e) {
            log.warn("[PaymentSetting] Could not read {} for institute {} — treating as disabled",
                    flagKey, instituteId, e);
            return false;
        }
    }
}
