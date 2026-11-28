package vacademy.io.auth_service.feature.auth.service;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** The role names a public learner sign-up may be granted. */
class PublicSignupRolesTest {

    @Test
    void privilegedNamesAreNeverGranted() {
        for (String name : List.of("ADMIN", "EVALUATOR", "SUPER_ADMIN", "ROOT", "PARENT", "COUNSELLOR",
                "ASSESSMENT CREATOR", "Some Custom Role", "SUB_ORG_ADMIN")) {
            assertEquals(List.of(), PublicSignupRoles.reduce(List.of(name), true), name);
            assertEquals(List.of(), PublicSignupRoles.reduce(List.of(name), false), name);
        }
    }

    @Test
    void mixedListKeepsOnlyLearnerRoles() {
        assertEquals(List.of("STUDENT"),
                PublicSignupRoles.reduce(List.of("ADMIN", "STUDENT", "TEACHER", "EVALUATOR"), false));
        assertEquals(List.of("STUDENT", "TEACHER"),
                PublicSignupRoles.reduce(List.of("ADMIN", "STUDENT", "TEACHER", "EVALUATOR"), true));
    }

    @Test
    void oddCaseAndWhitespaceCannotSmuggleARole() {
        List<String> odd = Arrays.asList(" ADMIN ", "admin", "Admin\t", "ADMIN​", " ADMIN", "AD MIN",
                "ADMIN,STUDENT", "STUDENT ADMIN", null, "");
        assertEquals(List.of(), PublicSignupRoles.reduce(odd, true));
    }

    @Test
    void learnerNamesAreMatchedLooselyAndWrittenCanonically() {
        assertEquals(List.of("STUDENT"), PublicSignupRoles.reduce(List.of(" student "), false));
        assertEquals(List.of("STUDENT", "TEACHER"),
                PublicSignupRoles.reduce(List.of("Student", "teacher", "STUDENT", "TEACHER"), true));
    }

    @Test
    void teacherNeedsTheInstituteSetting() {
        assertEquals(List.of(), PublicSignupRoles.reduce(List.of("TEACHER"), false));
        assertEquals(List.of("TEACHER"), PublicSignupRoles.reduce(List.of("TEACHER"), true));
    }

    @Test
    void nullAndEmptyStayAsTheyWere() {
        assertNull(PublicSignupRoles.reduce(null, true));
        assertEquals(List.of(), PublicSignupRoles.reduce(List.of(), true));
        assertFalse(PublicSignupRoles.asksForTeacher(null));
    }

    @Test
    void droppedNamesAreSafeToLog() {
        List<String> requested = List.of("STUDENT", "admin\nFAKE LOG LINE", "x".repeat(200));
        List<String> dropped = PublicSignupRoles.dropped(requested, PublicSignupRoles.reduce(requested, false));
        assertEquals(2, dropped.size());
        assertEquals("ADMIN?FAKE LOG LINE", dropped.get(0));
        assertEquals(40, dropped.get(1).length());
    }
}
