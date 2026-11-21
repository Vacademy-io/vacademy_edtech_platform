package vacademy.io.auth_service.feature.auth.service;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Role names a public (no token, no HMAC) learner sign-up may ask for.
 *
 * <p>The list arrives in a request body anyone can write, so it is reduced to learner roles
 * before anything is saved: STUDENT, plus TEACHER only where the institute itself lets
 * learners create courses. Everything else (ADMIN, staff, system and custom roles) is dropped,
 * never refused: the learner app decides TEACHER from settings it cached, and a stale cache
 * must not fail a real sign-up.
 */
public final class PublicSignupRoles {

    public static final String STUDENT = "STUDENT";
    public static final String TEACHER = "TEACHER";

    private PublicSignupRoles() {
    }

    /**
     * @param requested      role names from the request body (may be null)
     * @param teacherAllowed the institute's own "learners can create courses" setting
     * @return the names that may be granted, in canonical spelling; null stays null and an
     *         empty list stays empty, as before
     */
    public static List<String> reduce(List<String> requested, boolean teacherAllowed) {
        if (requested == null) {
            return null;
        }
        List<String> granted = new ArrayList<>();
        for (String name : requested) {
            String canonical = name == null ? "" : name.strip();
            if (STUDENT.equalsIgnoreCase(canonical)) {
                if (!granted.contains(STUDENT)) granted.add(STUDENT);
            } else if (teacherAllowed && TEACHER.equalsIgnoreCase(canonical)) {
                if (!granted.contains(TEACHER)) granted.add(TEACHER);
            }
        }
        return granted;
    }

    /** True when the body names TEACHER, i.e. the institute's setting has to be looked up. */
    public static boolean asksForTeacher(List<String> requested) {
        return requested != null && requested.stream()
                .anyMatch(name -> name != null && TEACHER.equalsIgnoreCase(name.strip()));
    }

    /** The names {@link #reduce} dropped, made safe to write to a log line. */
    public static List<String> dropped(List<String> requested, List<String> granted) {
        List<String> dropped = new ArrayList<>();
        if (requested == null) {
            return dropped;
        }
        for (String name : requested) {
            String canonical = name == null ? "" : name.strip().toUpperCase(Locale.ROOT);
            if (granted == null || !granted.contains(canonical)) {
                String printable = canonical.replaceAll("[^A-Z0-9_ -]", "?");
                dropped.add(printable.length() > 40 ? printable.substring(0, 40) : printable);
            }
        }
        return dropped;
    }
}
