package vacademy.io.admin_core_service.features.counselor_pool.service;

import vacademy.io.admin_core_service.features.counselor_pool.entity.CounselorPoolMember;

import java.util.*;
import java.util.stream.Collectors;

/**
 * The pool's rotation order, derived from the per-list {@code display_order} rows: the order
 * most lists share (ties go to the longer one, then the smallest audience id), followed by any
 * counselor it doesn't cover, in the order they first appear across the lists. Only the
 * relative order counts, so gaps left by removed counselors don't matter.
 *
 * The rotation pointer is pool-wide but "who is next" is read from each list's own order, so
 * lists in different orders silently skip some counselors and double others. Only for pools
 * with {@code unified_rotation_order} on: it is their rotation order, and a newly attached
 * list is seeded with it.
 */
final class PoolRotationOrder {

    private PoolRotationOrder() {
    }

    /** Counselor user ids in pool rotation order. Rows of every status count. */
    static List<String> canonical(List<CounselorPoolMember> poolMembers) {
        if (poolMembers == null || poolMembers.isEmpty()) {
            return List.of();
        }
        TreeMap<String, List<String>> orderByAudience = poolMembers.stream()
                .collect(Collectors.groupingBy(CounselorPoolMember::getAudienceId, TreeMap::new,
                        Collectors.collectingAndThen(Collectors.toList(), PoolRotationOrder::ordered)));

        Map<List<String>, Integer> votes = new LinkedHashMap<>();
        orderByAudience.values().forEach(order -> votes.merge(order, 1, Integer::sum));
        List<String> majority = votes.entrySet().stream()
                .max(Comparator.<Map.Entry<List<String>, Integer>>comparingInt(Map.Entry::getValue)
                        .thenComparingInt(e -> e.getKey().size()))
                .map(Map.Entry::getKey)
                .orElse(List.of());

        LinkedHashSet<String> result = new LinkedHashSet<>(majority);
        orderByAudience.values().forEach(result::addAll);
        return List.copyOf(result);
    }

    private static List<String> ordered(List<CounselorPoolMember> rows) {
        return rows.stream()
                .sorted(Comparator.comparing(CounselorPoolMember::getDisplayOrder)
                        .thenComparing(CounselorPoolMember::getCounselorUserId))
                .map(CounselorPoolMember::getCounselorUserId)
                .toList();
    }
}
