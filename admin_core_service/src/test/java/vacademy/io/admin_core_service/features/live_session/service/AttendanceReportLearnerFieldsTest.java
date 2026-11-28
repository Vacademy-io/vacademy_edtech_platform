package vacademy.io.admin_core_service.features.live_session.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import vacademy.io.admin_core_service.features.common.dto.CustomFieldDTO;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.live_session.dto.LearnerReportFieldsDTO;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionRepository;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Manage Column on the admin attendance table: the extra learner columns (profile fields and
 * institute custom fields) must come from the class's own institute and show current answers.
 */
@ExtendWith(MockitoExtension.class)
class AttendanceReportLearnerFieldsTest {

    private static final String SESSION_ID = "session-1";
    private static final String INSTITUTE_ID = "inst-1";

    @Mock
    private LiveSessionRepository liveSessionRepository;
    @Mock
    private CustomFieldValuesRepository customFieldValuesRepository;
    @Mock
    private StudentSessionInstituteGroupMappingRepository mappingRepository;
    @Mock
    private InstituteStudentRepository studentRepository;

    @InjectMocks
    private AttendanceReportService service;

    private void sessionInInstitute() {
        LiveSession session = new LiveSession();
        session.setId(SESSION_ID);
        session.setInstituteId(INSTITUTE_ID);
        when(liveSessionRepository.findById(SESSION_ID)).thenReturn(Optional.of(session));
    }

    private static Object[] cfRow(String userId, String fieldId, String key, String name, String value) {
        return new Object[]{userId, fieldId, key, name, "TEXT", value, "USER"};
    }

    @Test
    @DisplayName("Custom fields: newest answer per field wins, blank current answers are dropped")
    void customFieldsLatestAnswerAndBlanks() {
        sessionInInstitute();
        List<Object[]> rows = new ArrayList<>();
        // Repository order is newest first per learner.
        rows.add(cfRow("u1", "f1", "school", "School", "New School"));
        rows.add(cfRow("u1", "f1", "school", "School", "Old School"));
        rows.add(cfRow("u1", "f2", "roll_no", "Roll No", " "));
        rows.add(cfRow("u1", "f2", "roll_no", "Roll No", "42"));
        when(customFieldValuesRepository.findActiveInstituteCustomFieldsByUserIds(
                eq("USER"), anyList(), eq(INSTITUTE_ID))).thenReturn(rows);
        when(mappingRepository.findUserIdsInInstitute(eq(INSTITUTE_ID), any())).thenReturn(List.of());

        LearnerReportFieldsDTO result = service.getLearnerReportFields(SESSION_ID, List.of("u1"));

        List<CustomFieldDTO> fields = result.getCustomFields().get("u1");
        assertEquals(1, fields.size(), "the cleared Roll No must not fall back to the older 42");
        assertEquals("school", fields.get(0).getFieldKey());
        assertEquals("New School", fields.get(0).getCustomFieldValue());
    }

    @Test
    @DisplayName("System fields: only learners mapped to the class's institute, newest student row first")
    void systemFieldsScopedToInstitute() {
        sessionInInstitute();
        when(customFieldValuesRepository.findActiveInstituteCustomFieldsByUserIds(
                anyString(), anyList(), anyString())).thenReturn(List.of());
        when(mappingRepository.findUserIdsInInstitute(eq(INSTITUTE_ID), any())).thenReturn(List.of("u1"));

        Student older = new Student();
        older.setUserId("u1");
        older.setUsername("old_name");
        older.setCity("Pune");
        older.setUpdatedAt(Timestamp.valueOf("2026-01-01 00:00:00"));
        Student newer = new Student();
        newer.setUserId("u1");
        newer.setUsername("new_name");
        newer.setUpdatedAt(Timestamp.valueOf("2026-06-01 00:00:00"));
        when(studentRepository.findByUserIdIn(List.of("u1"))).thenReturn(List.of(older, newer));

        LearnerReportFieldsDTO result = service.getLearnerReportFields(SESSION_ID, List.of("u1", "outsider"));

        Map<String, String> u1 = result.getSystemFields().get("u1");
        assertEquals("new_name", u1.get("USERNAME"));
        assertEquals("Pune", u1.get("CITY"), "an older row still fills a field the newer one left blank");
        assertFalse(result.getSystemFields().containsKey("outsider"));
    }

    @Test
    @DisplayName("Unknown session or no ids: empty, and nothing is queried")
    void unknownSessionIsEmpty() {
        when(liveSessionRepository.findById("missing")).thenReturn(Optional.empty());

        LearnerReportFieldsDTO result = service.getLearnerReportFields("missing", List.of("u1"));
        LearnerReportFieldsDTO noIds = service.getLearnerReportFields(SESSION_ID, List.of());

        assertTrue(result.getCustomFields().isEmpty());
        assertTrue(result.getSystemFields().isEmpty());
        assertTrue(noIds.getCustomFields().isEmpty());
        verifyNoInteractions(customFieldValuesRepository, mappingRepository, studentRepository);
        verify(liveSessionRepository, never()).findById(SESSION_ID);
    }
}
