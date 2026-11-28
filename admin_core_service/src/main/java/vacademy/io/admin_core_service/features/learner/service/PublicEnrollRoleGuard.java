package vacademy.io.admin_core_service.features.learner.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.utils.InstituteSettingUtils;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.institute.entity.Institute;

import java.util.ArrayList;
import java.util.List;

/**
 * The enrol routes that need no login pass the user in their body on to auth-service over a
 * trusted internal call, and auth-service saves whatever role names that user carries. So the
 * list is reduced here, at the public door, to what a learner may hold: STUDENT, plus TEACHER
 * only where the institute itself lets learners create courses. Other names are dropped, not
 * refused, so a learner app working from stale settings still enrols the learner. A null list
 * stays null and an empty one stays empty.
 *
 * <p>Roles the server decides afterwards (a sub-org invite's own role list) are not touched:
 * they replace this list inside the enrol service.
 */
@Slf4j
@Component
public class PublicEnrollRoleGuard {

    private static final String STUDENT = "STUDENT";
    private static final String TEACHER = "TEACHER";

    @Autowired
    private InstituteRepository instituteRepository;

    public void restrictToLearnerRoles(UserDTO user, String instituteId) {
        if (user == null || user.getRoles() == null) {
            return;
        }
        boolean asksForTeacher = user.getRoles().stream().anyMatch(name -> matches(TEACHER, name));
        boolean teacherAllowed = asksForTeacher && learnersMayCreateCourses(instituteRepository, instituteId);
        int dropped = reduce(user, teacherAllowed);
        if (dropped > 0) {
            log.warn("Public enrol asked for roles it cannot grant; dropped {} name(s) for institute {}",
                    dropped, instituteId);
        }
    }

    /**
     * For the routes that record a lead (an enquiry or a form response): the person becomes a
     * contact, and at most a learner. Every role name except STUDENT is dropped before the user
     * is passed to auth-service. The lead forms send no roles at all.
     */
    public static void keepLearnerRoleOnly(UserDTO user) {
        if (user == null || user.getRoles() == null) {
            return;
        }
        int dropped = reduce(user, false);
        if (dropped > 0) {
            log.warn("Lead submission asked for roles it cannot grant; dropped {} name(s)", dropped);
        }
    }

    /**
     * The public door decides TEACHER from the institute id in the request, but an enrolment
     * is written in the institute its invite belongs to. When the two differ, TEACHER stays
     * only if the invite's institute lets learners create courses. Other names are untouched.
     */
    public static void dropTeacherUnlessInstituteAllows(UserDTO user, String instituteId,
            InstituteRepository instituteRepository) {
        if (user == null || user.getRoles() == null
                || user.getRoles().stream().noneMatch(name -> matches(TEACHER, name))
                || learnersMayCreateCourses(instituteRepository, instituteId)) {
            return;
        }
        List<String> kept = new ArrayList<>();
        for (String name : user.getRoles()) {
            if (!matches(TEACHER, name)) {
                kept.add(name);
            }
        }
        log.warn("Enrol asked for TEACHER in institute {}, which does not give it to learners; dropped",
                instituteId);
        user.setRoles(kept);
    }

    /**
     * auth-service answers every get-or-create with all the role names the account holds, in
     * every institute. The enrol code keeps that answer as its user and posts it to
     * auth-service again, which would save those names in the enrolling institute: an admin of
     * one institute would become an admin of any institute they enrol in. So the answer's role
     * list is set back to what was asked for. When nothing was asked for, an account that
     * holds roles elsewhere is enrolled as a learner: STUDENT, and nothing else.
     *
     * @param asked    the role list that was sent (already reduced at the public door, or the
     *                 sub-org invite's own list)
     * @param returned the role list auth-service sent back
     */
    public static List<String> askedRolesOnly(List<String> asked, List<String> returned, String instituteId) {
        List<String> kept;
        if (asked != null && !asked.isEmpty()) {
            kept = new ArrayList<>(asked);
        } else if (returned != null && !returned.isEmpty()) {
            kept = new ArrayList<>(List.of(STUDENT));
        } else {
            return returned;
        }
        if (returned != null) {
            long notCarried = returned.stream()
                    .filter(name -> kept.stream().noneMatch(k -> matches(k, name)))
                    .count();
            if (notCarried > 0) {
                log.warn("Enrol did not carry over {} role name(s) the account holds elsewhere, for institute {}",
                        notCarried, instituteId);
            }
        }
        return kept;
    }

    /**
     * The same user with another role list, as a separate object: the original may be on its
     * way out in a response, which must read as it always has.
     */
    public static UserDTO copyWithRoles(UserDTO user, List<String> roles) {
        if (user == null) {
            return null;
        }
        UserDTO copy = new UserDTO();
        BeanUtils.copyProperties(user, copy);
        copy.setRoles(roles);
        return copy;
    }

    /** Rewrites the user's role list to the learner set; returns how many names were dropped. */
    private static int reduce(UserDTO user, boolean teacherAllowed) {
        List<String> granted = new ArrayList<>();
        int dropped = 0;
        for (String name : user.getRoles()) {
            if (matches(STUDENT, name)) {
                if (!granted.contains(STUDENT)) granted.add(STUDENT);
            } else if (teacherAllowed && matches(TEACHER, name)) {
                if (!granted.contains(TEACHER)) granted.add(TEACHER);
            } else {
                dropped++;
            }
        }
        user.setRoles(granted);
        return dropped;
    }

    private static boolean matches(String role, String name) {
        return name != null && role.equalsIgnoreCase(name.strip());
    }

    private static boolean learnersMayCreateCourses(InstituteRepository instituteRepository, String instituteId) {
        if (!StringUtils.hasText(instituteId) || instituteRepository == null) {
            return false;
        }
        try {
            return instituteRepository.findById(instituteId)
                    .map(Institute::getSetting)
                    .map(InstituteSettingUtils::isAllowLearnersToCreateCoursesEnabled)
                    .orElse(false);
        } catch (Exception e) {
            log.warn("Institute setting lookup failed for {}: {}", instituteId, e.getMessage());
            return false;
        }
    }
}
