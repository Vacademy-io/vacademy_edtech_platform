package vacademy.io.admin_core_service.features.audience.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.audience.dto.AdmissionCheckResponseDTO;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.entity.LeadStatus;
import vacademy.io.admin_core_service.features.audience.entity.UserLeadProfile;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadStatusRepository;
import vacademy.io.admin_core_service.features.audience.repository.UserLeadProfileRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The per-institute rule for moving a lead to CONVERTED when the person has no course or fee
 * plan yet: OFF by default, WARN lets the change through, BLOCK refuses staff changes.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AdmissionCourseRuleServiceTest {

    private static final String INST = "inst-1";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Mock private InstituteRepository instituteRepository;
    @Mock private AdmissionCourseDao dao;
    @Mock private LeadStatusRepository leadStatusRepository;
    @Mock private AudienceResponseRepository audienceResponseRepository;
    @Mock private UserLeadProfileRepository userLeadProfileRepository;

    private AdmissionCourseRuleService service;

    private final LeadStatus converted = LeadStatus.builder().id("st-won").statusKey("CONVERTED")
            .label("Admission Taken").instituteId(INST).build();
    private final LeadStatus interested = LeadStatus.builder().id("st-int").statusKey("INTERESTED")
            .label("Interested").instituteId(INST).build();

    @BeforeEach
    void setUp() {
        service = new AdmissionCourseRuleService(instituteRepository, MAPPER, dao, leadStatusRepository,
                audienceResponseRepository, userLeadProfileRepository);
        when(leadStatusRepository.findById("st-won")).thenReturn(Optional.of(converted));
        when(leadStatusRepository.findById("st-int")).thenReturn(Optional.of(interested));
        when(leadStatusRepository.findByInstituteIdOrderByDisplayOrderAsc(INST))
                .thenReturn(List.of(interested, converted));
        when(audienceResponseRepository.findById(anyString())).thenAnswer(inv -> Optional.of(
                AudienceResponse.builder().id(inv.getArgument(0)).leadStatusId("st-int").build()));
        mode(null);
    }

    private void mode(String mode) {
        String json = mode == null ? "{\"setting\":{\"LEAD_SETTING\":{\"data\":{\"enabled\":true}}}}"
                : "{\"setting\":{\"LEAD_SETTING\":{\"data\":{\"admissionCourseRule\":{\"mode\":\"" + mode + "\"}}}}}";
        Institute institute = mock(Institute.class);
        when(institute.getSetting()).thenReturn(json);
        when(instituteRepository.findById(INST)).thenReturn(Optional.of(institute));
    }

    private void courses(Map<String, Boolean> byLead) {
        when(dao.courseByResponse(any(), anyCollection())).thenAnswer(inv -> {
            Map<String, Boolean> out = new LinkedHashMap<>();
            for (Object id : (java.util.Collection<?>) inv.getArgument(1)) {
                if (byLead.containsKey(id)) out.put((String) id, byLead.get(id));
            }
            return out;
        });
    }

    // ── the setting ──────────────────────────────────────────────────────────

    @Test
    void theRuleIsOffUnlessTheInstituteChoseWarnOrBlock() {
        assertThat(AdmissionCourseRuleService.modeFromSettingJson(MAPPER, null))
                .isEqualTo(AdmissionCourseRuleService.Mode.OFF);
        assertThat(AdmissionCourseRuleService.modeFromSettingJson(MAPPER, "{}"))
                .isEqualTo(AdmissionCourseRuleService.Mode.OFF);
        assertThat(AdmissionCourseRuleService.modeFromSettingJson(MAPPER, "not json"))
                .isEqualTo(AdmissionCourseRuleService.Mode.OFF);
        assertThat(AdmissionCourseRuleService.modeFromSettingJson(MAPPER,
                "{\"setting\":{\"LEAD_SETTING\":{\"data\":{\"admissionCourseRule\":{\"mode\":\"sometimes\"}}}}}"))
                .isEqualTo(AdmissionCourseRuleService.Mode.OFF);
        assertThat(AdmissionCourseRuleService.modeFromSettingJson(MAPPER,
                "{\"setting\":{\"LEAD_SETTING\":{\"data\":{\"admissionCourseRule\":{\"mode\":\"warn\"}}}}}"))
                .isEqualTo(AdmissionCourseRuleService.Mode.WARN);
        assertThat(AdmissionCourseRuleService.modeFromSettingJson(MAPPER,
                "{\"setting\":{\"LEAD_SETTING\":{\"data\":{\"admissionCourseRule\":{\"mode\":\"BLOCK\"}}}}}"))
                .isEqualTo(AdmissionCourseRuleService.Mode.BLOCK);
        when(instituteRepository.findById("inst-missing")).thenReturn(Optional.empty());
        assertThat(service.modeFor("inst-missing")).isEqualTo(AdmissionCourseRuleService.Mode.OFF);
    }

    // ── single staff change ──────────────────────────────────────────────────

    @Test
    void blockRefusesAConversionWhenThePersonHasNoCourse() {
        mode("BLOCK");
        courses(Map.of("r-1", false));
        assertThatThrownBy(() -> service.requireAllowedForStaff("r-1", "st-won"))
                .isInstanceOf(VacademyException.class)
                .hasMessageContaining("no course or fee plan")
                .hasMessageContaining("Admission Taken")
                .satisfies(e -> assertThat(((VacademyException) e).getStatus()).isEqualTo(HttpStatus.CONFLICT));
    }

    @Test
    void blockLetsAConversionThroughWhenThePersonHasACourse() {
        mode("BLOCK");
        courses(Map.of("r-1", true));
        service.requireAllowedForStaff("r-1", "st-won");
    }

    @Test
    void blockRefusesALeadOutsideTheStatusInstitute() {
        mode("BLOCK");
        courses(Map.of());
        assertThatThrownBy(() -> service.requireAllowedForStaff("r-elsewhere", "st-won"))
                .isInstanceOf(VacademyException.class);
    }

    @Test
    void offAndWarnNeverRefuseAndNeverLookUpCourses() {
        mode("OFF");
        service.requireAllowedForStaff("r-1", "st-won");
        mode("WARN");
        service.requireAllowedForStaff("r-1", "st-won");
        verify(dao, never()).courseByResponse(any(), anyCollection());
    }

    @Test
    void otherStatusesAndALeadAlreadyConvertedAreLeftAlone() {
        mode("BLOCK");
        courses(Map.of("r-1", false));
        service.requireAllowedForStaff("r-1", "st-int");
        when(audienceResponseRepository.findById("r-1")).thenReturn(Optional.of(
                AudienceResponse.builder().id("r-1").leadStatusId("st-won").build()));
        service.requireAllowedForStaff("r-1", "st-won");
        verify(dao, never()).courseByResponse(any(), anyCollection());
    }

    // ── bulk staff change ────────────────────────────────────────────────────

    @Test
    void bulkUnderBlockNamesTheLeadsWithoutACourse() {
        mode("BLOCK");
        courses(Map.of("r-1", true, "r-2", false));
        assertThat(service.refusedForStaff("st-won", List.of("r-1", "r-2", "r-3")))
                .containsExactly("r-2", "r-3");
        assertThat(service.refusedForStaff("st-int", List.of("r-2"))).isEmpty();
        mode("WARN");
        assertThat(service.refusedForStaff("st-won", List.of("r-2"))).isEmpty();
    }

    // ── the read-only check ──────────────────────────────────────────────────

    @Test
    void checkReportsTheModeAndWhoHasNoCourse() {
        mode("WARN");
        courses(Map.of("r-1", true, "r-2", false));
        AdmissionCheckResponseDTO out = service.check(INST, List.of("r-1", "r-2", "r-2", " ", "r-other"));
        assertThat(out.getMode()).isEqualTo("WARN");
        assertThat(out.getStatusKey()).isEqualTo("CONVERTED");
        assertThat(out.getChecked()).isEqualTo(2);
        assertThat(out.getWithoutCourseCount()).isEqualTo(1);
        assertThat(out.getWithoutCourse()).containsExactly("r-2");
    }

    @Test
    void checkWithTheRuleOffLooksNothingUp() {
        AdmissionCheckResponseDTO out = service.check(INST, List.of("r-1"));
        assertThat(out.getMode()).isEqualTo("OFF");
        assertThat(out.getWithoutCourse()).isEmpty();
        verify(dao, never()).courseByResponse(any(), anyCollection());
    }

    @Test
    void checkTakesABoundedNumberOfLeads() {
        mode("WARN");
        List<String> many = new ArrayList<>();
        for (int i = 0; i <= AdmissionCourseRuleService.MAX_CHECK_IDS; i++) many.add("r-" + i);
        assertThatThrownBy(() -> service.check(INST, many)).isInstanceOf(VacademyException.class)
                .satisfies(e -> assertThat(((VacademyException) e).getStatus()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    // ── the profile endpoints ────────────────────────────────────────────────

    @Test
    void profileChangeByTheInstituteLabelFollowsTheRule() {
        mode("BLOCK");
        when(dao.personHasCourse(INST, "u-1")).thenReturn(false);
        assertThatThrownBy(() -> service.requireAllowedForProfile("u-1", INST, "admission taken"))
                .isInstanceOf(VacademyException.class).hasMessageContaining("Admission Taken");
        assertThatThrownBy(() -> service.requireAllowedForProfile("u-1", INST, "CONVERTED"))
                .isInstanceOf(VacademyException.class);
        service.requireAllowedForProfile("u-1", INST, "Interested");
        when(dao.personHasCourse(INST, "u-2")).thenReturn(true);
        service.requireAllowedForProfile("u-2", INST, "CONVERTED");
    }

    @Test
    void profileAlreadyConvertedIsLeftAlone() {
        mode("BLOCK");
        when(userLeadProfileRepository.findByUserIdAndInstituteId("u-1", INST)).thenReturn(Optional.of(
                UserLeadProfile.builder().userId("u-1").instituteId(INST).conversionStatus("CONVERTED").build()));
        service.requireAllowedForProfile("u-1", INST, "CONVERTED");
        verify(dao, never()).personHasCourse(any(), any());
    }

    // ── same rule as the admissions report ───────────────────────────────────

    @Test
    void theCourseRuleMatchesTheAdmissionsReport() throws Exception {
        Path report = Path.of("..", "ai_service", "app", "services", "crm_admissions.py");
        assumeTrue(Files.exists(report), "the ai_service source is not next to this module");
        String py = Files.readString(report);
        assertThat(py).contains("_ENDED_PLAN = \"" + AdmissionCourseDao.ENDED_PLAN + "\"");
        assertThat(py).contains("{m}.status IN ('ACTIVE', 'COMPLETED', 'INVITED') ");
        assertThat(py).contains("AND NOT ({m}.status = 'INVITED' AND COALESCE({m}.source, '') = 'TERMINATED')");
        String sql = AdmissionCourseDao.hasCourse("pe.pid");
        assertThat(sql).contains("s.status IN ('ACTIVE', 'COMPLETED', 'INVITED')")
                .contains("AND NOT (s.status = 'INVITED' AND COALESCE(s.source, '') = 'TERMINATED')")
                .contains("up.status NOT IN " + AdmissionCourseDao.ENDED_PLAN)
                .contains("ei.institute_id = :instituteId")
                .doesNotContain("::");
    }
}
