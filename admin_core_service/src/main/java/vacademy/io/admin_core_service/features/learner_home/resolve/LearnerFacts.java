package vacademy.io.admin_core_service.features.learner_home.resolve;

import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc;

import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * What the server knows about one learner for targeting: batches, courses and tags in this
 * institute. {@code packageSessionByPackage} holds the most recently enrolled batch of each course
 * (the first row per course, since the enrolment query is ordered newest first).
 */
public record LearnerFacts(Set<String> packageSessionIds, Set<String> packageIds,
                           Map<String, String> packageSessionByPackage, Set<String> tagIds) {

    public static final LearnerFacts EMPTY = new LearnerFacts(Set.of(), Set.of(), Map.of(), Set.of());

    /** Q1 (and Q2 when {@code withTags}) for one learner, on the primary. */
    public static LearnerFacts load(LearnerHomeJdbc jdbc, String instituteId, String userId, boolean withTags) {
        return of(jdbc.enrolments(instituteId, userId), withTags ? jdbc.tagIds(instituteId, userId) : List.of());
    }

    public static LearnerFacts of(List<LearnerHomeJdbc.Enrolment> enrolments, Collection<String> tagIds) {
        Set<String> sessions = new LinkedHashSet<>();
        Set<String> packages = new LinkedHashSet<>();
        Map<String, String> byPackage = new LinkedHashMap<>();
        for (LearnerHomeJdbc.Enrolment e : enrolments) {
            if (e.packageSessionId() != null) sessions.add(e.packageSessionId());
            if (e.packageId() != null) {
                packages.add(e.packageId());
                if (e.packageSessionId() != null) byPackage.putIfAbsent(e.packageId(), e.packageSessionId());
            }
        }
        return new LearnerFacts(Collections.unmodifiableSet(sessions), Collections.unmodifiableSet(packages),
                Collections.unmodifiableMap(byPackage),
                tagIds == null ? Set.of() : Collections.unmodifiableSet(new LinkedHashSet<>(tagIds)));
    }
}
