package vacademy.io.admin_core_service.features.audience.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.audience.dto.AdmissionCheckResponseDTO;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.entity.LeadStatus;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadStatusRepository;
import vacademy.io.admin_core_service.features.audience.repository.UserLeadProfileRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * What happens when staff move a lead to CONVERTED (the institute's "admission" status,
 * whatever its label) and the person has no course or fee plan at the institute yet.
 *
 * <p>Per institute, in the {@code LEAD_SETTING} blob the Settings UI saves:</p>
 * <pre>
 * institute.setting → setting → LEAD_SETTING → data → admissionCourseRule → { "mode": "OFF" | "WARN" | "BLOCK" }
 * </pre>
 * <ul>
 *   <li>{@code OFF} (the default, and what a missing or unreadable value means): no check.</li>
 *   <li>{@code WARN}: the dashboard asks the user to confirm first; the server lets it through.</li>
 *   <li>{@code BLOCK}: the change is refused until the person has a course or plan.</li>
 * </ul>
 *
 * <p>Only staff actions call this: the single and bulk status endpoints, the profile status
 * endpoints, the call log's bulk status action and a call outcome mapped to a status.
 * Automations, AI calls, engagement actions and enrolment go straight to
 * {@link LeadStatusService#changeLeadStatus} and are never checked, so an enrolment, which is
 * what attaches a course, always converts.</p>
 *
 * <p>The setting is read on each check (no cache): checks happen only for a move to CONVERTED,
 * and an admin who switches the rule expects the next change to follow it.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AdmissionCourseRuleService {

    public enum Mode { OFF, WARN, BLOCK }

    public static final String CONVERTED_KEY = "CONVERTED";
    /** Ids the check endpoint takes in one call. */
    public static final int MAX_CHECK_IDS = 10000;

    private final InstituteRepository instituteRepository;
    private final ObjectMapper objectMapper;
    private final AdmissionCourseDao admissionCourseDao;
    private final LeadStatusRepository leadStatusRepository;
    private final AudienceResponseRepository audienceResponseRepository;
    private final UserLeadProfileRepository userLeadProfileRepository;

    // ── The setting ──────────────────────────────────────────────────────────

    public Mode modeFor(String instituteId) {
        if (instituteId == null || instituteId.isBlank()) return Mode.OFF;
        try {
            String json = instituteRepository.findById(instituteId).map(i -> i.getSetting()).orElse(null);
            return modeFromSettingJson(objectMapper, json);
        } catch (Exception e) {
            log.warn("[AdmissionCourseRule] Could not read the setting for institute {}: {}", instituteId,
                    e.getMessage());
            return Mode.OFF;
        }
    }

    /** The mode in an institute's settings JSON; anything missing or unknown is OFF. */
    static Mode modeFromSettingJson(ObjectMapper mapper, String settingJson) {
        if (settingJson == null || settingJson.isBlank()) return Mode.OFF;
        try {
            JsonNode rule = mapper.readTree(settingJson).path("setting").path("LEAD_SETTING").path("data")
                    .path("admissionCourseRule");
            return parseMode(rule.path("mode").asText(null));
        } catch (Exception e) {
            return Mode.OFF;
        }
    }

    static Mode parseMode(String value) {
        if (value == null) return Mode.OFF;
        try {
            return Mode.valueOf(value.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            return Mode.OFF;
        }
    }

    // ── The read-only check the dashboard runs before saving ─────────────────

    /**
     * For each given lead of the institute, whether its person has a course here, plus the
     * institute's mode. With the rule OFF nothing is looked up.
     */
    public AdmissionCheckResponseDTO check(String instituteId, Collection<String> responseIds) {
        List<String> ids = cleanIds(responseIds);
        if (ids.size() > MAX_CHECK_IDS) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "Check at most " + MAX_CHECK_IDS + " leads at a time.");
        }
        Mode mode = modeFor(instituteId);
        AdmissionCheckResponseDTO.AdmissionCheckResponseDTOBuilder out = AdmissionCheckResponseDTO.builder()
                .mode(mode.name())
                .statusKey(CONVERTED_KEY);
        if (mode == Mode.OFF || ids.isEmpty()) {
            return out.checked(0).withoutCourseCount(0).withoutCourse(List.of()).build();
        }
        Map<String, Boolean> byLead = admissionCourseDao.courseByResponse(instituteId, ids);
        List<String> without = new ArrayList<>();
        byLead.forEach((id, has) -> {
            if (!Boolean.TRUE.equals(has)) without.add(id);
        });
        return out.checked(byLead.size()).withoutCourseCount(without.size()).withoutCourse(without).build();
    }

    // ── The staff guards ─────────────────────────────────────────────────────

    /** The refusal a staff member sees under BLOCK. */
    public static String refusalMessage(LeadStatus target) {
        String label = target != null && target.getLabel() != null && !target.getLabel().isBlank()
                ? target.getLabel() : "Converted";
        return "This person has no course or fee plan here yet. Add the course or fee plan first, then move "
                + "them to " + label + ".";
    }

    /**
     * Throws the BLOCK refusal when staff move this lead to CONVERTED and its person has no
     * course here. Leaves every other change alone, including a lead already on the status.
     */
    public void requireAllowedForStaff(String responseId, String statusId) {
        if (responseId == null || statusId == null) return;
        LeadStatus target = leadStatusRepository.findById(statusId).orElse(null);
        if (!isConverted(target)) return;
        AudienceResponse lead = audienceResponseRepository.findById(responseId).orElse(null);
        if (lead != null && Objects.equals(lead.getLeadStatusId(), statusId)) return;
        if (modeFor(target.getInstituteId()) != Mode.BLOCK) return;
        Boolean has = admissionCourseDao.courseByResponse(target.getInstituteId(), List.of(responseId))
                .get(responseId);
        if (!Boolean.TRUE.equals(has)) {
            throw new VacademyException(HttpStatus.CONFLICT, refusalMessage(target));
        }
    }

    /**
     * The leads a staff bulk move to this status must leave alone under BLOCK (their person has
     * no course here). Empty for any other status or mode.
     */
    public Set<String> refusedForStaff(String statusId, Collection<String> responseIds) {
        List<String> ids = cleanIds(responseIds);
        if (statusId == null || ids.isEmpty()) return Set.of();
        LeadStatus target = leadStatusRepository.findById(statusId).orElse(null);
        if (!isConverted(target) || modeFor(target.getInstituteId()) != Mode.BLOCK) return Set.of();
        Map<String, Boolean> byLead = admissionCourseDao.courseByResponse(target.getInstituteId(), ids);
        Set<String> refused = new LinkedHashSet<>();
        for (String id : ids) {
            if (!Boolean.TRUE.equals(byLead.get(id))) refused.add(id);
        }
        return refused;
    }

    /** The BLOCK message for a status id, for callers that report per lead. */
    public String refusalMessageFor(String statusId) {
        return refusalMessage(statusId == null ? null : leadStatusRepository.findById(statusId).orElse(null));
    }

    /**
     * The profile endpoints take a status key or label for a person. Throws the BLOCK refusal
     * when that means CONVERTED, the person is not already converted, and they have no course.
     */
    public void requireAllowedForProfile(String userId, String instituteId, String status) {
        if (userId == null || instituteId == null || status == null) return;
        List<LeadStatus> catalog = leadStatusRepository.findByInstituteIdOrderByDisplayOrderAsc(instituteId);
        if (!CONVERTED_KEY.equals(resolveKey(status, catalog))) return;
        boolean already = userLeadProfileRepository.findByUserIdAndInstituteId(userId, instituteId)
                .map(p -> CONVERTED_KEY.equals(p.getConversionStatus())).orElse(false);
        if (already) return;
        if (modeFor(instituteId) != Mode.BLOCK) return;
        if (!admissionCourseDao.personHasCourse(instituteId, userId)) {
            LeadStatus target = catalog.stream().filter(st -> CONVERTED_KEY.equals(st.getStatusKey()))
                    .findFirst().orElse(null);
            throw new VacademyException(HttpStatus.CONFLICT, refusalMessage(target));
        }
    }

    /**
     * The status key a status given as a key or label resolves to, the same way the profile
     * endpoint stores it (UserLeadProfileService.canonicalStatusKey): an exact key, then a key
     * or a label ignoring case, spaces, hyphens and underscores ("Admission Taken" → CONVERTED).
     */
    static String resolveKey(String status, List<LeadStatus> catalog) {
        if (status == null || status.isBlank()) return status;
        String wanted = normalize(status);
        List<LeadStatus> all = catalog == null ? List.of() : catalog;
        for (LeadStatus s : all) {
            if (status.equals(s.getStatusKey())) return status;
        }
        for (LeadStatus s : all) {
            if (s.getStatusKey() != null && normalize(s.getStatusKey()).equals(wanted)) return s.getStatusKey();
        }
        for (LeadStatus s : all) {
            if (s.getLabel() != null && normalize(s.getLabel()).equals(wanted)) return s.getStatusKey();
        }
        return wanted;
    }

    private static String normalize(String value) {
        return value.trim().toUpperCase(Locale.ROOT).replaceAll("[\\s_-]+", "_");
    }

    static boolean isConverted(LeadStatus status) {
        return status != null && CONVERTED_KEY.equals(status.getStatusKey()) && status.getInstituteId() != null;
    }

    private static List<String> cleanIds(Collection<String> ids) {
        if (ids == null) return List.of();
        Set<String> out = new LinkedHashSet<>();
        for (String id : ids) {
            if (id != null && !id.isBlank()) out.add(id.trim());
        }
        return new ArrayList<>(out);
    }
}
