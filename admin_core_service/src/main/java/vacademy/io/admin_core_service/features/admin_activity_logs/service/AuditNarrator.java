package vacademy.io.admin_core_service.features.admin_activity_logs.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.institute_learner.dto.StudentStatusUpdateRequest;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;

/**
 * Turns raw ids on an audited request into the human-readable phrases stored in
 * {@code admin_activity_log.description}.
 *
 * <p>Exists because the interesting endpoints carry ids, not names: a
 * termination request knows a {@code userId} and a {@code packageSessionId},
 * but the log has to read "terminated Amit Kumar from Physics 201". Resolving
 * that in SpEL directly would mean unreadable expressions repeated across
 * annotations, so the lookups live here and the annotations call
 * {@code @auditNarrator.<method>(...)}.
 *
 * <p>The actor is not included in any phrase — the read UI prepends
 * {@code actor_name} to the description when rendering the row.
 *
 * <p>Every method is total: no method here throws, and each degrades to a
 * count or an id rather than propagating. Audit must never break a mutation.
 */
@Component
public class AuditNarrator {

    private static final Logger logger = LoggerFactory.getLogger(AuditNarrator.class);

    @Autowired
    private PackageSessionRepository packageSessionRepository;

    @Autowired
    private InstituteStudentRepository instituteStudentRepository;

    // ── Courses ───────────────────────────────────────────────────────────

    /**
     * Names the courses behind {@code packageSessionIds}, deduplicated — several
     * batches of one course read as that single course, not as "3 courses".
     * One course gives its name; several give a count, since listing every name
     * makes the sentence unreadable once a bulk action spans a dozen courses.
     * Null when nothing resolves, so callers can omit the "in ..." clause.
     */
    public String coursesFor(List<String> packageSessionIds) {
        List<String> ids = distinctNonBlank(packageSessionIds);
        if (ids.isEmpty()) {
            return null;
        }
        try {
            List<PackageSession> sessions = packageSessionRepository.findAllById(ids);
            LinkedHashSet<String> names = new LinkedHashSet<>();
            for (PackageSession session : sessions) {
                if (session == null || session.getPackageEntity() == null) {
                    continue;
                }
                String name = session.getPackageEntity().getPackageName();
                if (name != null && !name.isBlank()) {
                    names.add(name.trim());
                }
            }
            if (names.isEmpty()) {
                return null;
            }
            if (names.size() == 1) {
                return names.iterator().next();
            }
            return names.size() + " courses";
        } catch (Exception e) {
            logger.warn("Could not resolve course names for package sessions {}: {}", ids, e.getMessage());
            return null;
        }
    }

    // ── Learners ──────────────────────────────────────────────────────────

    /** Full name for one learner, falling back to the raw user id. */
    public String learnerFor(String userId) {
        if (userId == null || userId.isBlank()) {
            return null;
        }
        try {
            List<Student> students = instituteStudentRepository.findByUserIdIn(List.of(userId));
            String name = students.stream()
                    .map(Student::getFullName)
                    .filter(Objects::nonNull)
                    .filter(n -> !n.isBlank())
                    .findFirst()
                    .orElse(null);
            return name != null ? name.trim() : userId;
        } catch (Exception e) {
            logger.warn("Could not resolve learner name for {}: {}", userId, e.getMessage());
            return userId;
        }
    }

    /**
     * Names one learner, or counts several — "Amit Kumar" vs "5 learner(s)".
     * A bulk action naming every learner would not fit the row, and the count
     * is what an admin scanning the log actually needs.
     */
    public String learnersFor(List<String> userIds) {
        List<String> ids = distinctNonBlank(userIds);
        if (ids.isEmpty()) {
            return null;
        }
        if (ids.size() > 1) {
            return ids.size() + " learner(s)";
        }
        return learnerFor(ids.get(0));
    }

    // ── Enrollments ───────────────────────────────────────────────────────

    /**
     * Phrases an enrollment of one named learner, e.g. "enrolled learner Amit
     * Kumar in Physics 201". {@code verb} is the caller's ("enrolled",
     * "re-enrolled"). Used where the request body already carries the name, so
     * no lookup is needed. Falls back to the bare verb when the name is absent.
     */
    public String enrollmentOf(String verb, String learnerName, List<String> packageSessionIds) {
        if (learnerName == null || learnerName.isBlank()) {
            return verb + " learner" + inClause("in", coursesFor(packageSessionIds));
        }
        return verb + " learner " + learnerName.trim() + inClause("in", coursesFor(packageSessionIds));
    }

    /**
     * Phrases a bulk enrollment, e.g. "enrolled 5 learner(s) in Physics 201".
     * Resolves the single-learner case to a name so a one-row bulk call still
     * reads like the individual one.
     */
    public String bulkEnrollmentOf(String verb, List<String> userIds, List<String> packageSessionIds) {
        String who = learnersFor(userIds);
        if (who == null) {
            return null;
        }
        return verb + " " + who + inClause("in", coursesFor(packageSessionIds));
    }

    // ── Bulk assign / de-assign (v3) ──────────────────────────────────────

    /**
     * Phrases a bulk assign, e.g. "enrolled 5 learner(s) in Physics 201".
     *
     * <p>{@code successful} comes from the response summary rather than the
     * request: these endpoints select users by explicit ids, inline new users,
     * or a filter, and individual items may fail or be skipped — so the request
     * does not say how many learners were actually enrolled.
     */
    public String bulkAssignmentOf(Integer successful, List<String> userIds, List<String> packageSessionIds) {
        String who = appliedLearners(successful, userIds);
        if (who == null) {
            return null;
        }
        return "enrolled " + who + inClause("in", coursesFor(packageSessionIds));
    }

    /**
     * Phrases a bulk de-assign. A HARD de-assign revokes access immediately and
     * is a termination; a SOFT one leaves access until expiry, so the two must
     * not read alike in the log. A HARD de-assign carries the admin's reason, when
     * one was given — this row is the only place that reason is kept.
     */
    public String bulkDeassignmentOf(String mode, Integer successful, List<String> userIds,
            List<String> packageSessionIds, String reason) {
        String who = appliedLearners(successful, userIds);
        if (who == null) {
            return null;
        }
        String where = coursesFor(packageSessionIds);
        if (!"HARD".equalsIgnoreCase(mode)) {
            return "cancelled enrollment of " + who + inClause("in", where);
        }
        String because = reason == null || reason.isBlank() ? "" : " — reason: " + reason.trim();
        return "terminated " + who + inClause("from", where) + because;
    }

    /**
     * Names the learner when exactly one was targeted by id, otherwise reports
     * the count the call actually applied to.
     */
    private String appliedLearners(Integer successful, List<String> userIds) {
        List<String> ids = distinctNonBlank(userIds);
        if (ids.size() == 1) {
            return learnerFor(ids.get(0));
        }
        if (successful != null && successful > 0) {
            return successful + " learner(s)";
        }
        return ids.isEmpty() ? null : ids.size() + " learner(s)";
    }

    // ── Learner status changes ────────────────────────────────────────────

    /**
     * Describes one call to the learner status endpoint, whose {@code operation}
     * field selects between six different mutations. Mirrors the switch in
     * {@code StudentSessionManager#updateStudentStatus} — keep the two in step
     * if an operation is added there.
     */
    public String statusChangeFor(String operation, List<StudentStatusUpdateRequest> requests) {
        if (operation == null || requests == null || requests.isEmpty()) {
            return null;
        }
        try {
            String who = learnersFor(requests.stream().map(StudentStatusUpdateRequest::getUserId).toList());
            String from = coursesFor(affectedPackageSessionIds(requests));
            if (who == null) {
                return null;
            }

            return switch (operation) {
                case "TERMINATE" -> "terminated " + who + inClause("from", from);
                case "MAKE_INACTIVE" -> "deactivated " + who + inClause("in", from);
                case "MAKE_ACTIVE" -> "reactivated " + who + inClause("in", from);
                case "UPDATE_BATCH" -> {
                    // For a batch move `newState` carries the destination package session.
                    String to = coursesFor(requests.stream()
                            .map(StudentStatusUpdateRequest::getNewState)
                            .toList());
                    yield "moved " + who + inClause("from", from) + inClause("to", to);
                }
                case "ADD_EXPIRY" -> "changed expiry date of " + who + inClause("in", from)
                        + toClause(distinctStates(requests));
                case "UPDATE_STATUS" -> "changed status of " + who + inClause("in", from)
                        + toClause(distinctStates(requests));
                default -> operation.toLowerCase().replace('_', ' ') + " for " + who + inClause("in", from);
            };
        } catch (Exception e) {
            logger.warn("Could not describe status change '{}': {}", operation, e.getMessage());
            return null;
        }
    }

    // ── Internals ─────────────────────────────────────────────────────────

    /**
     * MAKE_INACTIVE may carry a list of package sessions; the other operations
     * act on the single current one.
     */
    private List<String> affectedPackageSessionIds(List<StudentStatusUpdateRequest> requests) {
        List<String> ids = new ArrayList<>();
        for (StudentStatusUpdateRequest request : requests) {
            if (request == null) {
                continue;
            }
            if (request.getPackageSessionIds() != null && !request.getPackageSessionIds().isEmpty()) {
                ids.addAll(request.getPackageSessionIds());
            } else if (request.getCurrentPackageSessionId() != null) {
                ids.add(request.getCurrentPackageSessionId());
            }
        }
        return ids;
    }

    /** The distinct target values of an operation, when they read as plain text. */
    private String distinctStates(List<StudentStatusUpdateRequest> requests) {
        List<String> states = distinctNonBlank(requests.stream()
                .map(StudentStatusUpdateRequest::getNewState)
                .toList());
        return states.size() == 1 ? states.get(0) : null;
    }

    private String inClause(String preposition, String value) {
        return value == null ? "" : " " + preposition + " " + value;
    }

    private String toClause(String value) {
        return value == null ? "" : " to " + value;
    }

    private List<String> distinctNonBlank(List<String> values) {
        if (values == null) {
            return List.of();
        }
        return values.stream()
                .filter(Objects::nonNull)
                .filter(v -> !v.isBlank())
                .distinct()
                .toList();
    }
}
