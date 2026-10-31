package vacademy.io.admin_core_service.features.admin_activity_logs;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.parser.PartTree;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.admin_activity_logs.service.CrmAuditNarrator;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.entity.UserLeadProfile;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadFollowupRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadStatusRepository;
import vacademy.io.admin_core_service.features.audience.repository.UserLeadProfileRepository;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * How a CRM audit row gets a person's name.
 *
 * <p>Written after the first version shipped and wrote UUIDs into production:
 * it resolved people through {@code UserRepository}, and the {@code users} table
 * belongs to auth_service — it does not exist in admin_core's database. Every
 * lookup threw, the narrator's own catch swallowed it (correctly — audit must
 * never break a mutation), and each description degraded to the raw id. Nothing
 * failed loudly; the rows just read
 * "changed lead tier of 664d3077-29b4-4dcb-8c64-d2ed9417f529".
 *
 * <p>So these tests pin two things: the fallback chain inside admin_core's own
 * schema, and the structural rule that the narrator never reaches into another
 * service's database again.
 */
class CrmAuditNarratorNamingTest {

    private CrmAuditNarrator narrator;
    private AudienceResponseRepository audienceResponses;
    private InstituteStudentRepository students;
    private UserLeadProfileRepository leadProfiles;

    @BeforeEach
    void setUp() {
        narrator = new CrmAuditNarrator();
        audienceResponses = mock(AudienceResponseRepository.class);
        students = mock(InstituteStudentRepository.class);
        leadProfiles = mock(UserLeadProfileRepository.class);

        ReflectionTestUtils.setField(narrator, "audienceRepository", mock(AudienceRepository.class));
        ReflectionTestUtils.setField(narrator, "audienceResponseRepository", audienceResponses);
        ReflectionTestUtils.setField(narrator, "leadStatusRepository", mock(LeadStatusRepository.class));
        ReflectionTestUtils.setField(narrator, "leadFollowupRepository", mock(LeadFollowupRepository.class));
        ReflectionTestUtils.setField(narrator, "userLeadProfileRepository", leadProfiles);
        ReflectionTestUtils.setField(narrator, "instituteStudentRepository", students);

        when(students.findByUserId(anyString())).thenReturn(List.of());
        when(audienceResponses.findByUserId(anyString())).thenReturn(List.of());
        when(leadProfiles.findFirstByAssignedCounselorIdAndAssignedCounselorNameIsNotNull(anyString()))
                .thenReturn(Optional.empty());
    }

    @Test
    @DisplayName("a lead who enrolled is named by their learner record")
    void namesAnEnrolledLeadFromTheStudentRecord() {
        Student student = new Student();
        student.setFullName("Amit Kumar");
        when(students.findByUserId("user-1")).thenReturn(List.of(student));

        assertEquals("Amit Kumar", narrator.leadUserFor("user-1"));
    }

    @Test
    @DisplayName("a lead who only ever filled in a form is named by that form's contact details")
    void fallsBackToTheContactOnTheForm() {
        when(audienceResponses.findByUserId("user-2")).thenReturn(List.of(response(null, "kaif@example.com", null)));
        assertEquals("kaif@example.com", narrator.leadUserFor("user-2"));

        when(audienceResponses.findByUserId("user-3")).thenReturn(List.of(response("Chandrama", "c@example.com", null)));
        assertEquals("Chandrama", narrator.leadUserFor("user-3"), "a name on the form beats the email");

        when(audienceResponses.findByUserId("user-4")).thenReturn(List.of(response(null, null, "917355167749")));
        assertEquals("917355167749", narrator.leadUserFor("user-4"));
    }

    @Test
    @DisplayName("a lead with nothing recorded degrades to the id, and a blank id to null")
    void degradesToTheIdRatherThanThrowing() {
        assertEquals("user-unknown", narrator.leadUserFor("user-unknown"));
        assertNull(narrator.leadUserFor(null));
        assertNull(narrator.leadUserFor("  "));
    }

    @Test
    @DisplayName("a counsellor is named from the profile the CRM denormalized their name onto")
    void namesStaffFromTheLeadProfile() {
        UserLeadProfile profile = new UserLeadProfile();
        profile.setAssignedCounselorId("counsellor-1");
        profile.setAssignedCounselorName("Riya Sharma");
        when(leadProfiles.findFirstByAssignedCounselorIdAndAssignedCounselorNameIsNotNull("counsellor-1"))
                .thenReturn(Optional.of(profile));

        assertEquals("Riya Sharma", narrator.personFor("counsellor-1"));
        assertEquals("counsellor-unknown", narrator.personFor("counsellor-unknown"));
    }

    @Test
    @DisplayName("an assignment phrase names the lead by contact, not by uuid")
    void phrasesAnAssignmentWithRealNames() {
        when(audienceResponses.findByUserId("lead-1")).thenReturn(List.of(response("Amit Kumar", null, null)));

        assertEquals("assigned lead Amit Kumar to Riya Sharma",
                narrator.counsellorAssignment("lead-1", "counsellor-1", "Riya Sharma"));
        assertEquals("unassigned counsellor from lead Amit Kumar",
                narrator.counsellorAssignment("lead-1", null, null));
    }

    @Test
    @DisplayName("a repository that blows up degrades to an id — it never propagates")
    void survivesARepositoryFailure() {
        when(students.findByUserId(anyString())).thenThrow(new IllegalStateException("relation \"users\" does not exist"));
        when(audienceResponses.findByUserId(anyString())).thenThrow(new IllegalStateException("boom"));
        when(leadProfiles.findFirstByAssignedCounselorIdAndAssignedCounselorNameIsNotNull(anyString()))
                .thenThrow(new IllegalStateException("boom"));

        assertEquals("user-9", narrator.leadUserFor("user-9"));
        assertEquals("user-9", narrator.personFor("user-9"));
    }

    @Test
    @DisplayName("the derived queries on the repository it uses resolve against the entity")
    void derivedQueriesResolve() {
        // Spring validates derived query names when it builds the repository —
        // at context startup, in the pod, where a typo is not a failed test but
        // an admin_core_service that will not boot for anyone. PartTree is that
        // same parser without a database, so the mistake surfaces here instead.
        for (Method method : UserLeadProfileRepository.class.getDeclaredMethods()) {
            if (method.isAnnotationPresent(Query.class)) {
                continue; // hand-written JPQL, not derived from the name
            }
            String name = method.getName();
            if (!name.startsWith("find") && !name.startsWith("count") && !name.startsWith("delete")) {
                continue;
            }
            assertDoesNotThrow(() -> new PartTree(name, UserLeadProfile.class),
                    () -> "UserLeadProfileRepository." + name + " does not resolve against "
                            + "UserLeadProfile — this would fail every pod at startup");
        }
    }

    @Test
    @DisplayName("the narrator never queries another service's database")
    void staysInsideItsOwnSchema() {
        for (Field field : CrmAuditNarrator.class.getDeclaredFields()) {
            String type = field.getType().getName();
            assertFalse(type.startsWith("vacademy.io.common.auth.repository"),
                    "CrmAuditNarrator must not depend on " + type + ": auth_service's tables "
                            + "(users, user_role, …) are not in admin_core's database, so every query "
                            + "throws and the description silently degrades to a raw id");
        }
    }

    private static AudienceResponse response(String name, String email, String mobile) {
        AudienceResponse response = new AudienceResponse();
        response.setParentName(name);
        response.setParentEmail(email);
        response.setParentMobile(mobile);
        return response;
    }
}
