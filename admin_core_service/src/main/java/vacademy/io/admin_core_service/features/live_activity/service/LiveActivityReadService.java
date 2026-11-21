package vacademy.io.admin_core_service.features.live_activity.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.criteria.Predicate;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.live_activity.core.LiveActivityEventMapper;
import vacademy.io.admin_core_service.features.live_activity.dto.LiveActivityFeedItemDTO;
import vacademy.io.admin_core_service.features.live_activity.entity.UserLiveEvent;
import vacademy.io.admin_core_service.features.live_activity.repository.LiveActivitySeenRepository;
import vacademy.io.admin_core_service.features.live_activity.repository.UserLiveEventRepository;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * The history side: initial backfill, the historical view, the counter strip, the unseen
 * badge and CSV export.
 *
 * <p>Every read intersects the requested categories with the caller's allowed set, so a
 * category the caller's role cannot see is unreachable even by hand-crafting a query
 * parameter.
 */
@Service
@RequiredArgsConstructor
public class LiveActivityReadService {

    /** Matches the audit log's cap so a runaway export cannot pin a connection. */
    private static final int EXPORT_MAX_ROWS = 50_000;

    private final UserLiveEventRepository repository;
    private final LiveActivitySeenRepository seenRepository;
    private final ObjectMapper objectMapper;

    public Page<LiveActivityFeedItemDTO> feed(String instituteId,
                                              Set<String> allowedCategories,
                                              String categoriesCsv,
                                              Long fromEpochMillis,
                                              Long toEpochMillis,
                                              String counsellorUserId,
                                              int page,
                                              int size) {
        Set<String> categories = effectiveCategories(allowedCategories, categoriesCsv);
        if (categories.isEmpty()) {
            return Page.empty();
        }
        Specification<UserLiveEvent> spec = specification(
                instituteId, categories, fromEpochMillis, toEpochMillis, counsellorUserId);

        return repository.findAll(spec,
                        PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "occurredAt")))
                .map(row -> LiveActivityEventMapper.toFeedItem(row, objectMapper));
    }

    public List<LiveActivityFeedItemDTO> exportRows(String instituteId,
                                                    Set<String> allowedCategories,
                                                    String categoriesCsv,
                                                    Long fromEpochMillis,
                                                    Long toEpochMillis,
                                                    String counsellorUserId) {
        Set<String> categories = effectiveCategories(allowedCategories, categoriesCsv);
        if (categories.isEmpty()) {
            return List.of();
        }
        Specification<UserLiveEvent> spec = specification(
                instituteId, categories, fromEpochMillis, toEpochMillis, counsellorUserId);
        return repository.findAll(spec,
                        PageRequest.of(0, EXPORT_MAX_ROWS,
                                Sort.by(Sort.Direction.DESC, "occurredAt")))
                .map(row -> LiveActivityEventMapper.toFeedItem(row, objectMapper))
                .getContent();
    }

    /** Counter strip: today's volume per category, one indexed pass. */
    public Map<String, Long> counts(String instituteId, Set<String> allowedCategories, long sinceEpochMillis) {
        Map<String, Long> out = new LinkedHashMap<>();
        for (Object[] row : repository.countByCategorySince(instituteId, new Timestamp(sinceEpochMillis))) {
            String category = String.valueOf(row[0]);
            if (!allowedCategories.contains(category)) {
                continue;
            }
            out.put(category, ((Number) row[1]).longValue());
        }
        return out;
    }

    /** Unseen badge. Counts only categories this caller may actually open. */
    public long unseenCount(String userId, String instituteId, Set<String> allowedCategories) {
        if (allowedCategories.isEmpty()) {
            return 0L;
        }
        Timestamp since = seenRepository.findByUserIdAndInstituteId(userId, instituteId)
                .map(seen -> seen.getLastSeenAt())
                .orElse(new Timestamp(System.currentTimeMillis() - 24L * 60 * 60 * 1000));
        return repository.countSince(instituteId, since, new ArrayList<>(allowedCategories));
    }

    public void markSeen(String userId, String instituteId) {
        seenRepository.markSeen(userId, instituteId, new Timestamp(System.currentTimeMillis()));
    }

    /**
     * Intersect what was asked for with what the caller may see. An empty result means
     * "nothing visible", which callers render as an empty feed rather than an error -- a
     * 403 here would leak which categories exist.
     */
    private Set<String> effectiveCategories(Set<String> allowed, String categoriesCsv) {
        if (categoriesCsv == null || categoriesCsv.isBlank()) {
            return allowed;
        }
        // Comma-separated rather than repeated params: the ingress rejects raw brackets in a
        // query string with a 400 before the request ever reaches the service.
        Set<String> requested = Arrays.stream(categoriesCsv.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .map(String::toUpperCase)
                .collect(Collectors.toSet());
        requested.retainAll(allowed);
        return requested;
    }

    private Specification<UserLiveEvent> specification(String instituteId,
                                                       Set<String> categories,
                                                       Long fromEpochMillis,
                                                       Long toEpochMillis,
                                                       String counsellorUserId) {
        return (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            predicates.add(cb.equal(root.get("instituteId"), instituteId));
            predicates.add(root.get("category").in(categories));
            if (fromEpochMillis != null) {
                predicates.add(cb.greaterThanOrEqualTo(
                        root.get("occurredAt"), new Timestamp(fromEpochMillis)));
            }
            if (toEpochMillis != null) {
                predicates.add(cb.lessThanOrEqualTo(
                        root.get("occurredAt"), new Timestamp(toEpochMillis)));
            }
            if (counsellorUserId != null && !counsellorUserId.isBlank()) {
                predicates.add(cb.equal(root.get("counsellorUserId"), counsellorUserId));
            }
            return cb.and(predicates.toArray(new Predicate[0]));
        };
    }
}
