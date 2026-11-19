package vacademy.io.assessment_service.features.assessment.manager;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.dto.RegistrationFieldDto;
import vacademy.io.assessment_service.features.assessment.dto.create_assessment.AssessmentRegistrationsDto.OpenTestDetails.RegistrationFormDetails;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentCustomField;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentCustomFieldRepository;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A save of the registration form never inserts a second row for a field_key the assessment
 * already has (the key is UNIQUE per assessment, soft-deleted rows included): the create wizard
 * re-sends every field as added on each save, and a removed field can be added back.
 */
class RegistrationFieldsSyncTest {

    private AssessmentParticipantsManager manager;
    private AssessmentCustomFieldRepository repo;
    private Assessment assessment;

    @BeforeEach
    void setUp() {
        manager = new AssessmentParticipantsManager();
        repo = mock(AssessmentCustomFieldRepository.class);
        ReflectionTestUtils.setField(manager, "assessmentCustomFieldRepository", repo);
        assessment = new Assessment();
        assessment.setId("a1");
    }

    private AssessmentCustomField row(String id, String key, String name, String status) {
        AssessmentCustomField f = new AssessmentCustomField();
        f.setId(id);
        f.setFieldKey(key);
        f.setFieldName(name);
        f.setFieldType("textfield");
        f.setFieldOrder(0);
        f.setIsMandatory(true);
        f.setStatus(status);
        f.setAssessment(assessment);
        return f;
    }

    private static RegistrationFieldDto field(String id, String name, String key, int order) {
        return RegistrationFieldDto.builder().id(id).name(name).key(key).type("textfield")
                .isMandatory(true).orderField(order).build();
    }

    private static RegistrationFormDetails form(List<RegistrationFieldDto> added,
            List<RegistrationFieldDto> updated, List<RegistrationFieldDto> removed) {
        RegistrationFormDetails form = new RegistrationFormDetails();
        form.setAddedCustomAddedFields(added);
        form.setUpdatedCustomAddedFields(updated);
        form.setRemovedCustomAddedFields(removed);
        return form;
    }

    private void existing(AssessmentCustomField... rows) {
        when(repo.findAllByAssessment(assessment)).thenReturn(List.of(rows));
    }

    @SuppressWarnings("unchecked")
    private List<AssessmentCustomField> finalSave() {
        ArgumentCaptor<List<AssessmentCustomField>> saved = ArgumentCaptor.forClass(List.class);
        verify(repo).saveAll(saved.capture());
        return saved.getValue();
    }

    private void sync(RegistrationFormDetails form) {
        ReflectionTestUtils.invokeMethod(manager, "syncRegistrationFields", form, assessment);
    }

    @Test
    void wizard_resave_reuses_the_saved_rows_and_adds_only_the_new_field() {
        AssessmentCustomField name = row("r1", "student_name", "Student Name", "ACTIVE");
        AssessmentCustomField city = row("r2", "city", "City", "ACTIVE");
        existing(name, city);

        // What the create wizard sends on a second save: local ids, every field as added.
        sync(form(List.of(field("0", "Student Name", "student_name", 0), field("new-1", "City", "", 1),
                field("new-2", "School", "", 2)), List.of(), List.of()));

        List<AssessmentCustomField> saved = finalSave();
        assertEquals(3, saved.size());
        assertSame(name, saved.get(0));
        assertSame(city, saved.get(1));
        assertEquals(1, city.getFieldOrder());
        assertEquals("school", saved.get(2).getFieldKey());
        assertEquals("ACTIVE", saved.get(2).getStatus());
    }

    @Test
    void a_soft_deleted_field_added_back_is_reactivated_not_inserted() {
        AssessmentCustomField city = row("r2", "city", "City", "DELETED");
        existing(city);

        sync(form(List.of(field("new-1", "City", "", 3)), List.of(), List.of()));

        List<AssessmentCustomField> saved = finalSave();
        assertEquals(1, saved.size());
        assertSame(city, saved.get(0));
        assertEquals("ACTIVE", city.getStatus());
        assertEquals(3, city.getFieldOrder());
    }

    @Test
    void removed_and_added_back_in_the_same_save_stays_active() {
        AssessmentCustomField city = row("r2", "city", "City", "ACTIVE");
        existing(city);

        sync(form(List.of(field("new-1", "City", "", 0)), List.of(), List.of(field("r2", "City", "city", 0))));

        assertEquals(1, finalSave().size());
        assertEquals("ACTIVE", city.getStatus());
    }

    @Test
    void removal_soft_deletes_by_id_and_falls_back_to_key() {
        AssessmentCustomField byId = row("r1", "school", "School", "ACTIVE");
        AssessmentCustomField byKey = row("r2", "current_class", "Current Class", "ACTIVE");
        AssessmentCustomField kept = row("r3", "email", "Email", "ACTIVE");
        existing(byId, byKey, kept);

        sync(form(List.of(), List.of(), List.of(field("r1", "School", "stale_key", 0),
                field("5", "Current Class", "current_class", 1))));

        assertEquals("DELETED", byId.getStatus());
        assertEquals("DELETED", byKey.getStatus());
        assertEquals("ACTIVE", kept.getStatus());
    }

    @Test
    void a_rename_is_flushed_before_a_new_field_takes_the_old_key() {
        AssessmentCustomField city = row("r2", "city", "City", "ACTIVE");
        existing(city);
        List<String> keysAtFlush = new ArrayList<>();
        doAnswer(inv -> {
            List<AssessmentCustomField> rows = inv.getArgument(0);
            rows.forEach(r -> keysAtFlush.add(r.getFieldKey()));
            return rows;
        }).when(repo).saveAllAndFlush(anyList());

        sync(form(List.of(field("new-1", "City", "", 1)), List.of(field("r2", "Town", "city", 0)), List.of()));

        // Only the rename is in the database when the flush runs; the new City comes after it.
        assertEquals(List.of("town"), keysAtFlush);
        InOrder order = inOrder(repo);
        order.verify(repo).saveAllAndFlush(anyList());
        order.verify(repo).saveAll(anyList());
        List<AssessmentCustomField> saved = finalSave();
        assertEquals(2, saved.size());
        assertEquals("town", city.getFieldKey());
        assertEquals("city", saved.get(1).getFieldKey());
    }

    @Test
    void the_same_name_twice_in_one_save_makes_one_row() {
        existing();

        sync(form(List.of(field("new-1", "City", "", 0), field("new-2", "City", "", 4)), List.of(), List.of()));

        List<AssessmentCustomField> saved = finalSave();
        assertEquals(1, saved.size());
        assertEquals(4, saved.get(0).getFieldOrder());
    }
}
