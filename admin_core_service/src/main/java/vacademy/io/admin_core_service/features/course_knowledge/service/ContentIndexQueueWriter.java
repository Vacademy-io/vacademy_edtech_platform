package vacademy.io.admin_core_service.features.course_knowledge.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Query;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Course knowledge (V600): upserts debounced rows into {@code content_index_queue}
 * so the ai_service worker re-reads a lesson after its content or placement
 * changed. Rows are written only for institutes with
 * {@code course_knowledge_setting.enabled = TRUE}; everyone else gets nothing.
 *
 * <p>A separate bean on purpose: {@link ContentIndexMarker} calls it through the
 * Spring proxy so REQUIRES_NEW really opens its own transaction (a self-call
 * would skip the proxy, the OfflineManifestVersionService.bumpAll pitfall).
 * The marker calls it only after the authoring transaction committed, so the
 * worker never reads the state from before the commit.
 *
 * <p>Never throws from its own statements: a failed upsert only means the 30
 * minute drift sweep in ai_service picks the lesson up later.
 */
@Service
@Slf4j
public class ContentIndexQueueWriter {

    /** A lesson to re-index; {@code chapterIdHint} names a chapter it was (or still is) in, or null. */
    public record Mark(String slideId, String chapterIdHint) {
    }

    static final int BATCH_SIZE = 500;
    static final long ENABLED_CACHE_MILLIS = 60_000L;
    /** content_index_queue.reason is VARCHAR(48). */
    static final int REASON_MAX = 48;

    static final String ANY_ENABLED_SQL =
            "SELECT EXISTS (SELECT 1 FROM course_knowledge_setting WHERE enabled = TRUE)";

    /** Shared tail of every upsert. Leaves allow_paid, run_id and budget_id alone so a paid run keeps its authorisation. */
    static final String ON_CONFLICT_SQL = """
            ON CONFLICT (institute_id, slide_id) DO UPDATE SET
                generation = content_index_queue.generation + 1,
                not_before = EXCLUDED.not_before,
                reason = EXCLUDED.reason,
                attempts = 0,
                last_error = NULL,
                status = CASE WHEN content_index_queue.status = 'PROCESSING' THEN 'PROCESSING' ELSE 'PENDING' END,
                updated_at = now()
            """;

    /** Statement A: institutes resolved through the lesson's own live mappings (partial indexes on status). */
    static final String UPSERT_BY_SLIDE_SQL = """
            INSERT INTO content_index_queue
                (institute_id, slide_id, reason, status, generation, not_before, attempts, created_at, updated_at)
            SELECT DISTINCT pi.institute_id, cts.slide_id, :reason, 'PENDING', 1,
                now() + interval '30 seconds', 0, now(), now()
            FROM chapter_to_slides cts
            JOIN chapter_package_session_mapping cpsm
                ON cpsm.chapter_id = cts.chapter_id AND cpsm.status <> 'DELETED'
            JOIN package_session ps ON ps.id = cpsm.package_session_id
            JOIN package_institute pi ON pi.package_id = ps.package_id
            JOIN course_knowledge_setting cks ON cks.institute_id = pi.institute_id AND cks.enabled = TRUE
            WHERE cts.slide_id IN (:slideIds) AND cts.status <> 'DELETED'
            """ + ON_CONFLICT_SQL;

    /** Statement A by chapter: every live lesson of the given chapters (copies of a whole chapter). */
    static final String UPSERT_BY_CHAPTER_SQL = """
            INSERT INTO content_index_queue
                (institute_id, slide_id, reason, status, generation, not_before, attempts, created_at, updated_at)
            SELECT DISTINCT pi.institute_id, cts.slide_id, :reason, 'PENDING', 1,
                now() + interval '30 seconds', 0, now(), now()
            FROM chapter_to_slides cts
            JOIN chapter_package_session_mapping cpsm
                ON cpsm.chapter_id = cts.chapter_id AND cpsm.status <> 'DELETED'
            JOIN package_session ps ON ps.id = cpsm.package_session_id
            JOIN package_institute pi ON pi.package_id = ps.package_id
            JOIN course_knowledge_setting cks ON cks.institute_id = pi.institute_id AND cks.enabled = TRUE
            WHERE cts.chapter_id IN (:chapterIds) AND cts.status <> 'DELETED'
            """ + ON_CONFLICT_SQL;

    /**
     * Statement B: institutes resolved through a hinted chapter, with the slide ids
     * selected as literals. Covers deletes, unmaps and moves, where the lesson's own
     * mapping may already be DELETED and Statement A finds nothing.
     */
    static final String UPSERT_BY_HINT_HEAD_SQL = """
            INSERT INTO content_index_queue
                (institute_id, slide_id, reason, status, generation, not_before, attempts, created_at, updated_at)
            SELECT DISTINCT pi.institute_id, v.slide_id, :reason, 'PENDING', 1,
                now() + interval '30 seconds', 0, now(), now()
            FROM chapter_package_session_mapping cpsm
            JOIN package_session ps ON ps.id = cpsm.package_session_id
            JOIN package_institute pi ON pi.package_id = ps.package_id
            JOIN course_knowledge_setting cks ON cks.institute_id = pi.institute_id AND cks.enabled = TRUE
            CROSS JOIN (VALUES
            """;

    static final String UPSERT_BY_HINT_TAIL_SQL = """
            ) AS v (slide_id)
            WHERE cpsm.chapter_id = :chapterId AND cpsm.status <> 'DELETED'
            """ + ON_CONFLICT_SQL;

    @PersistenceContext
    private EntityManager entityManager;

    private volatile boolean anyEnabled;
    private volatile long anyEnabledCheckedAt;

    /**
     * Cheap pre-check the marker runs before going through the proxy: false only when
     * the cached answer is fresh and says no institute enabled the feature, so a
     * platform with the feature off never opens the REQUIRES_NEW transaction.
     */
    public boolean mightBeEnabled() {
        return anyEnabled || System.currentTimeMillis() - anyEnabledCheckedAt >= ENABLED_CACHE_MILLIS;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void enqueue(Collection<Mark> marks, String reason) {
        enqueue(marks, List.of(), reason);
    }

    /**
     * Upserts queue rows for the marked lessons and for every live lesson of
     * {@code chapterIds}. Never throws.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void enqueue(Collection<Mark> marks, Collection<String> chapterIds, String reason) {
        try {
            Set<String> slideIds = new LinkedHashSet<>();
            Map<String, Set<String>> hintedByChapter = new LinkedHashMap<>();
            if (marks != null) {
                for (Mark mark : marks) {
                    if (mark == null || !StringUtils.hasText(mark.slideId())) {
                        continue;
                    }
                    slideIds.add(mark.slideId());
                    if (StringUtils.hasText(mark.chapterIdHint())) {
                        hintedByChapter.computeIfAbsent(mark.chapterIdHint(), k -> new LinkedHashSet<>())
                                .add(mark.slideId());
                    }
                }
            }
            Set<String> chapters = new LinkedHashSet<>();
            if (chapterIds != null) {
                chapterIds.stream().filter(StringUtils::hasText).forEach(chapters::add);
            }
            if ((slideIds.isEmpty() && chapters.isEmpty()) || !isAnyInstituteEnabled()) {
                return;
            }
            String safeReason = clipReason(reason);
            int rows = 0;
            for (List<String> batch : partition(slideIds)) {
                rows += entityManager.createNativeQuery(UPSERT_BY_SLIDE_SQL)
                        .setParameter("reason", safeReason)
                        .setParameter("slideIds", batch)
                        .executeUpdate();
            }
            for (List<String> batch : partition(chapters)) {
                rows += entityManager.createNativeQuery(UPSERT_BY_CHAPTER_SQL)
                        .setParameter("reason", safeReason)
                        .setParameter("chapterIds", batch)
                        .executeUpdate();
            }
            for (Map.Entry<String, Set<String>> hinted : hintedByChapter.entrySet()) {
                for (List<String> batch : partition(hinted.getValue())) {
                    Query query = entityManager.createNativeQuery(hintSql(batch.size()))
                            .setParameter("reason", safeReason)
                            .setParameter("chapterId", hinted.getKey());
                    for (int i = 0; i < batch.size(); i++) {
                        query.setParameter("s" + i, batch.get(i));
                    }
                    rows += query.executeUpdate();
                }
            }
            if (rows > 0) {
                log.debug("Course knowledge: {} content_index_queue row(s) upserted ({}, {} slide(s), {} chapter(s))",
                        rows, safeReason, slideIds.size(), chapters.size());
            }
        } catch (Exception e) {
            log.warn("Course knowledge: could not enqueue {} lesson(s) for re-indexing ({}): {}",
                    marks == null ? 0 : marks.size(), reason, e.getMessage());
        }
    }

    /** Statement B with one VALUES row per slide id, bound as :s0, :s1, ... */
    static String hintSql(int slideCount) {
        StringBuilder sql = new StringBuilder(UPSERT_BY_HINT_HEAD_SQL);
        for (int i = 0; i < slideCount; i++) {
            sql.append(i == 0 ? "    " : ",\n    ").append("(CAST(:s").append(i).append(" AS VARCHAR))");
        }
        sql.append('\n').append(UPSERT_BY_HINT_TAIL_SQL);
        return sql.toString();
    }

    private boolean isAnyInstituteEnabled() {
        long now = System.currentTimeMillis();
        if (now - anyEnabledCheckedAt < ENABLED_CACHE_MILLIS) {
            return anyEnabled;
        }
        Object result = entityManager.createNativeQuery(ANY_ENABLED_SQL).getSingleResult();
        anyEnabled = Boolean.TRUE.equals(result);
        anyEnabledCheckedAt = now;
        return anyEnabled;
    }

    private static String clipReason(String reason) {
        String r = StringUtils.hasText(reason) ? reason.trim() : "LESSON_CHANGED";
        return r.length() > REASON_MAX ? r.substring(0, REASON_MAX) : r;
    }

    private static List<List<String>> partition(Collection<String> ids) {
        List<List<String>> out = new ArrayList<>();
        List<String> current = new ArrayList<>(Math.min(ids.size(), BATCH_SIZE));
        for (String id : ids) {
            current.add(id);
            if (current.size() == BATCH_SIZE) {
                out.add(current);
                current = new ArrayList<>(BATCH_SIZE);
            }
        }
        if (!current.isEmpty()) {
            out.add(current);
        }
        return out;
    }
}
