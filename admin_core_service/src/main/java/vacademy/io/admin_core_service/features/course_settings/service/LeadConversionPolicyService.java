package vacademy.io.admin_core_service.features.course_settings.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;

import java.util.Collection;

/**
 * Single answer to "does enrolling into THIS course count as converting the lead?".
 *
 * <p>Enrolment flows auto-flip {@code user_lead_profile.conversion_status} to {@code CONVERTED}
 * (see {@code UserLeadProfileService.markConverted*}), which drops the lead out of the default
 * leads list, shows the emerald "Converted" badge, and counts toward the conversion KPIs. That is
 * the right behaviour for a course you sell — but not for a free course, a trial, a webinar or a
 * lead magnet, where enrolment is a top-of-funnel action and the lead is still open.</p>
 *
 * <p><b>Read as {@code COURSE_SETTING.data.leads.countEnrollmentAsConversion}</b>, per course
 * first and institute-wide as a fallback:</p>
 * <ol>
 *   <li>{@code package.course_setting.setting.COURSE_SETTING.data.leads.countEnrollmentAsConversion}</li>
 *   <li>{@code INSTITUTE.setting.COURSE_SETTING.data.leads.countEnrollmentAsConversion}</li>
 *   <li>{@code true}</li>
 * </ol>
 *
 * <p>The two-level resolution mirrors {@link LmsExistingUserEditPolicyService}: a course that has
 * never seen the setting falls through to the institute default, while a course that has
 * explicitly set {@code false} is never overridden by an institute-wide {@code true}.</p>
 *
 * <p><b>Defaults to true, and every failure path returns true.</b> Auto-conversion on enrolment is
 * the behaviour every existing institute already has, so an unreadable settings blob must not
 * silently stop stamping conversions and skew their funnel reports. Opting out is the explicit
 * action.</p>
 *
 * <p>This gate only affects enrolments that happen after it is switched off — it never un-converts
 * a lead that was already stamped. The manual "mark as converted" action in the leads UI is also
 * unaffected: an admin saying a lead converted is not a course setting's business.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LeadConversionPolicyService {

    private static final String COURSE_SETTING_KEY = "COURSE_SETTING";
    /** Group under COURSE_SETTING.data that holds lead/CRM behaviour flags. */
    private static final String LEADS_GROUP = "leads";
    private static final String COUNT_ENROLLMENT_AS_CONVERSION = "countEnrollmentAsConversion";

    private final PackageSettingService packageSettingService;
    private final InstituteSettingService instituteSettingService;
    private final ObjectMapper objectMapper;

    /**
     * @param instituteId institute the learner is being enrolled into
     * @param packageId   course being enrolled into; null falls straight through to the
     *                    institute-level setting
     * @return whether this enrolment should flip the lead profile to CONVERTED
     */
    public boolean countsAsConversion(String instituteId, String packageId) {
        Boolean perCourse = readPackageFlag(packageId);
        if (perCourse != null) {
            return perCourse;
        }
        Boolean perInstitute = readInstituteFlag(instituteId);
        return perInstitute == null || perInstitute;
    }

    /**
     * Multi-course enrolment: converting if ANY of the courses counts.
     *
     * <p>Enrolling into a paid course alongside a free one is still a conversion — the opt-out is
     * about a course that on its own shouldn't convert, not about diluting a real sale it was
     * bundled with. An empty/blank set falls back to the institute default.</p>
     */
    public boolean anyCountsAsConversion(String instituteId, Collection<String> packageIds) {
        if (packageIds == null || packageIds.isEmpty()) {
            return countsAsConversion(instituteId, null);
        }
        boolean sawCourseLevelAnswer = false;
        for (String packageId : packageIds) {
            Boolean perCourse = readPackageFlag(packageId);
            if (perCourse == null) {
                continue;
            }
            sawCourseLevelAnswer = true;
            if (perCourse) {
                return true;
            }
        }
        // Every course that answered said "don't convert" → don't. If none answered, the
        // institute default (true unless set otherwise) decides.
        return sawCourseLevelAnswer ? false : countsAsConversion(instituteId, null);
    }

    /** @return the course-level flag, or null when the course has not set it either way. */
    private Boolean readPackageFlag(String packageId) {
        if (!StringUtils.hasText(packageId)) {
            return null;
        }
        try {
            Object data = packageSettingService.getSettingData(packageId, COURSE_SETTING_KEY);
            return readFlag(data);
        } catch (Exception e) {
            log.warn("Could not read course-level {}.{} for package {}: {}",
                    LEADS_GROUP, COUNT_ENROLLMENT_AS_CONVERSION, packageId, e.getMessage());
            return null;
        }
    }

    /** @return the institute-level flag, or null when the institute has not set it either way. */
    private Boolean readInstituteFlag(String instituteId) {
        if (!StringUtils.hasText(instituteId)) {
            return null;
        }
        try {
            Object data = instituteSettingService.getSettingByInstituteIdAndKey(instituteId, COURSE_SETTING_KEY);
            return readFlag(data);
        } catch (Exception e) {
            log.warn("Could not read institute-level {}.{} for institute {}: {}",
                    LEADS_GROUP, COUNT_ENROLLMENT_AS_CONVERSION, instituteId, e.getMessage());
            return null;
        }
    }

    /**
     * Pull {@code leads.countEnrollmentAsConversion} out of a COURSE_SETTING {@code data} blob.
     * Returns null for "not set", which is what makes the course → institute fallback work.
     */
    private Boolean readFlag(Object data) {
        if (data == null) {
            return null;
        }
        JsonNode node = objectMapper.valueToTree(data).path(LEADS_GROUP).path(COUNT_ENROLLMENT_AS_CONVERSION);
        if (node.isMissingNode() || node.isNull()) {
            return null;
        }
        // Tolerate a string "true"/"false" — settings blobs are hand-edited JSON in places.
        return node.isBoolean() ? node.asBoolean() : Boolean.parseBoolean(node.asText());
    }
}
