package vacademy.io.assessment_service.features.assessment.manager;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import vacademy.io.assessment_service.features.assessment.dto.AssessmentUserFilter;
import vacademy.io.assessment_service.features.assessment.dto.export.ResultExportRowDto;
import vacademy.io.assessment_service.features.assessment.dto.RegistrationCustomFieldAnswerDto;
import vacademy.io.assessment_service.features.assessment.dto.export.ResultExportColumnsDto;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentCustomField;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentInstituteMapping;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentCustomFieldRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentInstituteMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentUserRegistrationRepository;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The result CSV carries what external participants answered on the public
 * registration form, so an admin exporting submissions gets the phone number /
 * college / roll number they collected — not just name and marks.
 *
 * <p>Locks in the parts that are easy to break silently: a form field named like
 * a result column must not produce two identically-named columns, a participant
 * who skipped a field still needs its (empty) cell so the row stays aligned, and
 * an explicit empty selection means "no form columns" while no selection at all
 * (older client) means "all of them".
 */
class AdminExportManagerResultCsvTest {

    private static final String ASSESSMENT_ID = "assessment-1";
    private static final String INSTITUTE_ID = "institute-1";

    private AdminExportManager manager;
    private AssessmentUserRegistrationRepository registrationRepository;
    private AssessmentCustomFieldRepository customFieldRepository;
    private AssessmentInstituteMappingRepository instituteMappingRepository;

    @BeforeEach
    void setUp() {
        manager = new AdminExportManager();
        registrationRepository = mock(AssessmentUserRegistrationRepository.class);
        customFieldRepository = mock(AssessmentCustomFieldRepository.class);
        SectionRepository sectionRepository = mock(SectionRepository.class);

        instituteMappingRepository = mock(AssessmentInstituteMappingRepository.class);
        // Batch names come from admin_core. Stubbed empty so these tests stay about the
        // sheet's shape; the Batch cell then falls back to the (unstubbed, null) batch id
        // and must render as empty rather than "null".
        var adminCoreServiceClient =
                mock(vacademy.io.assessment_service.features.client.AdminCoreServiceClient.class);
        when(adminCoreServiceClient.getBatchNames(anyList())).thenReturn(java.util.Map.of());

        manager.adminCoreServiceClient = adminCoreServiceClient;
        manager.assessmentUserRegistrationRepository = registrationRepository;
        manager.assessmentCustomFieldRepository = customFieldRepository;
        manager.sectionRepository = sectionRepository;
        manager.assessmentInstituteMappingRepository = instituteMappingRepository;

        when(instituteMappingRepository.findByAssessmentIdAndInstituteId(ASSESSMENT_ID, INSTITUTE_ID))
                .thenReturn(Optional.of(new AssessmentInstituteMapping()));

        Section section = new Section();
        section.setTotalMarks(100.0);
        when(sectionRepository.findByAssessmentIdAndStatusNotIn(anyString(), anyList()))
                .thenReturn(List.of(section));

        List<AssessmentCustomField> fields = List.of(
                customField("field-phone", "Phone Number", 0),
                customField("field-email", "Email", 1),
                customField("field-college", "College Name", 2));
        when(customFieldRepository.findActiveFieldsByAssessmentId(ASSESSMENT_ID)).thenReturn(fields);

        // Built before the stubbing calls — these are mocks themselves, and
        // Mockito rejects a mock being stubbed inside an unfinished when(...).
        List<ResultExportRowDto> participants = List.of(
                participant("reg-1", "Anand M", "anand@example.com", 80.0, 600L),
                participant("reg-2", "Adithya M", "adithya@example.com", 60.0, 700L));
        List<RegistrationCustomFieldAnswerDto> answers = List.of(
                answer("reg-1", "field-phone", "+919999999999"),
                answer("reg-1", "field-email", "anand.form@example.com"),
                answer("reg-1", "field-college", "GEC, Kozhikode"),
                answer("reg-2", "field-phone", "+918888888888"));

        when(registrationRepository.findAllEndedParticipantsForResultExport(ASSESSMENT_ID, INSTITUTE_ID))
                .thenReturn(participants);
        when(registrationRepository.findCustomFieldAnswersForAssessment(ASSESSMENT_ID, INSTITUTE_ID))
                .thenReturn(answers);
    }

    @Test
    void exportsEveryRegistrationFieldWhenNoSelectionIsSent() {
        String[] lines = exportLines(filterWithCustomFieldIds(null));

        // "Email" and "Phone Number" both clash with a result column, so their form twins
        // are disambiguated. A CSV cannot carry two identically named headers, and the
        // suffix is what tells the reader which value came off the registration form.
        assertThat(lines[0]).isEqualTo(
                "Name,Email,Phone Number,Username,Batch,Marks Obtained,Total Marks,Percentage,Rank,Duration,Attempt Date,"
                        + "Phone Number (Form),Email (Form),College Name");
        assertThat(lines[1]).contains("+919999999999,anand.form@example.com,\"GEC, Kozhikode\"");
    }

    @Test
    void keepsRowsAlignedWhenAParticipantSkippedFields() {
        String[] lines = exportLines(filterWithCustomFieldIds(null));

        // reg-2 answered only the phone field — the other two cells stay empty.
        assertThat(lines[2]).endsWith(",+918888888888,,");
        assertThat(lines[2].split(",", -1)).hasSameSizeAs(lines[0].split(",", -1));
    }

    @Test
    void exportsOnlyTheTickedFields() {
        String[] lines = exportLines(filterWithCustomFieldIds(List.of("field-college")));

        assertThat(lines[0]).endsWith(",Attempt Date,College Name");
        assertThat(lines[1]).endsWith(",\"GEC, Kozhikode\"");
    }

    @Test
    void untickingEveryFieldLeavesTheResultColumnsAlone() {
        String[] lines = exportLines(filterWithCustomFieldIds(List.of()));

        assertThat(lines[0]).isEqualTo(
                "Name,Email,Phone Number,Username,Batch,Marks Obtained,Total Marks,Percentage,Rank,Duration,Attempt Date");
    }

    @Test
    void emptyAssessmentStillReturnsTheFullHeaderRow() {
        when(registrationRepository.findAllEndedParticipantsForResultExport(ASSESSMENT_ID, INSTITUTE_ID))
                .thenReturn(List.of());

        String[] lines = exportLines(filterWithCustomFieldIds(null));

        assertThat(lines).hasSize(1);
        assertThat(lines[0]).endsWith("Phone Number (Form),Email (Form),College Name");
    }

    @Test
    void unticklingOneFieldDoesNotRenameAnother() {
        // "Email (Form 2)" only exists because a first Email field is above it —
        // dropping that first field must not shuffle the surviving header, or the
        // sheet's columns would silently change name between two exports.
        List<AssessmentCustomField> twoEmails = List.of(
                customField("field-email", "Email", 0),
                customField("field-alt-email", "Email", 1));
        when(customFieldRepository.findActiveFieldsByAssessmentId(ASSESSMENT_ID)).thenReturn(twoEmails);

        String[] both = exportLines(filterWithCustomFieldIds(null));
        String[] secondOnly = exportLines(filterWithCustomFieldIds(List.of("field-alt-email")));

        assertThat(both[0]).endsWith(",Email (Form),Email (Form 2)");
        assertThat(secondOnly[0]).endsWith(",Email (Form 2)");
    }

    @Test
    void exportsLegacyAssessmentsThatHaveNoInstituteMappingRow() {
        // A few live assessments pre-date assessment_institute_mapping; the
        // columns endpoint must not treat them as someone else's assessment.
        when(instituteMappingRepository.findByAssessmentIdAndInstituteId(ASSESSMENT_ID, INSTITUTE_ID))
                .thenReturn(Optional.empty());
        when(instituteMappingRepository.findTopByAssessmentId(ASSESSMENT_ID))
                .thenReturn(Optional.empty());

        ResultExportColumnsDto columns =
                manager.getResultExportColumns(null, INSTITUTE_ID, ASSESSMENT_ID, false).getBody();

        assertThat(columns).isNotNull();
        assertThat(columns.getCustomFields()).hasSize(3);
    }

    @Test
    void rejectsAnAssessmentMappedToAnotherInstitute() {
        when(instituteMappingRepository.findByAssessmentIdAndInstituteId(ASSESSMENT_ID, INSTITUTE_ID))
                .thenReturn(Optional.empty());
        when(instituteMappingRepository.findTopByAssessmentId(ASSESSMENT_ID))
                .thenReturn(Optional.of(new AssessmentInstituteMapping()));

        assertThatThrownBy(() -> manager.getResultExportColumns(null, INSTITUTE_ID, ASSESSMENT_ID, false))
                .isInstanceOf(VacademyException.class);
    }

    @Test
    void columnListMatchesTheHeadersTheCsvWillProduce() {
        ResultExportColumnsDto columns =
                manager.getResultExportColumns(null, INSTITUTE_ID, ASSESSMENT_ID, false).getBody();

        assertThat(columns).isNotNull();
        assertThat(columns.getBaseColumns())
                .startsWith("Name", "Email", "Phone Number", "Username", "Batch");
        assertThat(columns.getCustomFields())
                .extracting(ResultExportColumnsDto.CustomFieldColumn::getColumnLabel)
                .containsExactly("Phone Number (Form)", "Email (Form)", "College Name");
    }

    private String[] exportLines(AssessmentUserFilter filter) {
        ResponseEntity<byte[]> response =
                manager.getRegisteredCsvExport(null, INSTITUTE_ID, ASSESSMENT_ID, filter);
        assertThat(response.getBody()).isNotNull();
        return new String(response.getBody(), StandardCharsets.UTF_8).split("\n");
    }

    // registration_source "" is what the submissions-tab export sends: every
    // participant, however they enrolled.
    private AssessmentUserFilter filterWithCustomFieldIds(List<String> customFieldIds) {
        AssessmentUserFilter filter = new AssessmentUserFilter();
        filter.setRegistrationSource("");
        filter.setAttemptType(List.of("ENDED"));
        filter.setStatus(List.of("ACTIVE"));
        filter.setCustomFieldIds(customFieldIds);
        return filter;
    }

    private AssessmentCustomField customField(String id, String name, int order) {
        return AssessmentCustomField.builder()
                .id(id)
                .fieldName(name)
                .fieldKey(name.toLowerCase().replace(' ', '_'))
                .fieldOrder(order)
                .fieldType("text")
                .isMandatory(true)
                .status("ACTIVE")
                .build();
    }

    private ResultExportRowDto participant(String registrationId, String name, String email,
                                          Double score, Long duration) {
        // Phone / username / batch are left unstubbed (null) here on purpose: the sheet must
        // render an empty cell for a learner missing them, not drop the row or print "null".
        ResultExportRowDto dto = mock(ResultExportRowDto.class);
        when(dto.getRegistrationId()).thenReturn(registrationId);
        when(dto.getStudentName()).thenReturn(name);
        when(dto.getUserEmail()).thenReturn(email);
        when(dto.getScore()).thenReturn(score);
        when(dto.getRankMarks()).thenReturn(score);
        when(dto.getDuration()).thenReturn(duration);
        when(dto.getAttemptDate()).thenReturn(new Date(0L));
        return dto;
    }

    private RegistrationCustomFieldAnswerDto answer(String registrationId, String fieldId, String answer) {
        RegistrationCustomFieldAnswerDto dto = mock(RegistrationCustomFieldAnswerDto.class);
        when(dto.getRegistrationId()).thenReturn(registrationId);
        when(dto.getFieldId()).thenReturn(fieldId);
        when(dto.getAnswer()).thenReturn(answer);
        return dto;
    }
}
