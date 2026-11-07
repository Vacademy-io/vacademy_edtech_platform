package vacademy.io.admin_core_service.features.course_knowledge.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.course_knowledge.service.ContentIndexQueueWriter.Mark;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Course knowledge (V600): lesson writers call this after they change a lesson's
 * content or placement, so the ai_service worker re-indexes it. One line per
 * writer, passing the chapter it knows about as the hint.
 *
 * <p>Inside a transaction the marks are collected per transaction and written
 * ONCE, after commit, through {@link ContentIndexQueueWriter} (its own
 * REQUIRES_NEW transaction). After commit and not just REQUIRES_NEW, because a
 * rolled-back edit must never enqueue and the worker must never read the state
 * from before the commit. Same shape as CourseRestructureService.scheduleRecompute.
 *
 * <p>Three promises to every authoring save: it never fails because of this
 * class (everything is caught), it is not slowed down (nothing runs before the
 * commit, and the writer short-circuits on a cached "nobody enabled it"), and
 * institutes without course knowledge get no rows (the writer joins
 * course_knowledge_setting.enabled). {@code course.knowledge.index-marker.enabled=false}
 * turns every method into a no-op.
 */
@Service
@Slf4j
public class ContentIndexMarker {

    private static final Object BATCH_KEY = new Object() {
        @Override
        public String toString() {
            return "ContentIndexMarker.batch";
        }
    };

    private final ContentIndexQueueWriter writer;
    private final boolean enabled;

    public ContentIndexMarker(ContentIndexQueueWriter writer,
            @Value("${course.knowledge.index-marker.enabled:true}") boolean enabled) {
        this.writer = writer;
        this.enabled = enabled;
    }

    /** One lesson changed. {@code chapterIdHint} may be null. Never throws. */
    public void mark(String slideId, String chapterIdHint, String reason) {
        if (!enabled || !StringUtils.hasText(slideId)) {
            return;
        }
        markAll(List.of(new Mark(slideId, chapterIdHint)), reason);
    }

    /** Several lessons changed. Never throws. */
    public void markAll(Collection<Mark> marks, String reason) {
        if (!enabled || marks == null || marks.isEmpty()) {
            return;
        }
        try {
            List<Mark> valid = new ArrayList<>(marks.size());
            for (Mark m : marks) {
                if (m != null && StringUtils.hasText(m.slideId())) {
                    valid.add(m);
                }
            }
            if (!valid.isEmpty()) {
                submit(valid, List.of(), reason);
            }
        } catch (Exception e) {
            log.warn("Course knowledge: could not mark {} lesson(s) for re-indexing ({}): {}",
                    marks.size(), reason, e.getMessage());
        }
    }

    /**
     * Every live lesson of a chapter changed (a whole chapter was copied). The
     * chapter's lessons are resolved by the writer after commit, with this chapter
     * as the scope, so no statement runs inside the caller's transaction (a failed
     * one there would abort the authoring save). Never throws.
     */
    public void markChapter(String chapterId, String reason) {
        if (!enabled || !StringUtils.hasText(chapterId)) {
            return;
        }
        try {
            submit(List.of(), List.of(chapterId), reason);
        } catch (Exception e) {
            log.warn("Course knowledge: could not mark chapter {} for re-indexing ({}): {}",
                    chapterId, reason, e.getMessage());
        }
    }

    private void submit(List<Mark> marks, List<String> chapterIds, String reason) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            write(marks, chapterIds, reason);
            return;
        }
        Batch batch = (Batch) TransactionSynchronizationManager.getResource(BATCH_KEY);
        if (batch == null) {
            batch = new Batch();
            TransactionSynchronizationManager.bindResource(BATCH_KEY, batch);
            TransactionSynchronizationManager.registerSynchronization(batch);
        } else if (batch.flushed) {
            // Marked from another afterCommit callback of the same transaction: the
            // batch already went out, so this one goes straight away.
            write(marks, chapterIds, reason);
            return;
        } else if (!TransactionSynchronizationManager.getSynchronizations().contains(batch)) {
            // A REQUIRES_NEW inside the transaction that owns the bound batch: give
            // the inner transaction its own after-commit write so its marks follow
            // its own commit or rollback, not the outer one.
            Batch inner = new Batch();
            inner.add(marks, chapterIds, reason);
            TransactionSynchronizationManager.registerSynchronization(inner);
            return;
        }
        batch.add(marks, chapterIds, reason);
    }

    private void write(Collection<Mark> marks, Collection<String> chapterIds, String reason) {
        try {
            if (!writer.mightBeEnabled()) {
                return;
            }
            if (chapterIds.isEmpty()) {
                writer.enqueue(marks, reason);
            } else {
                writer.enqueue(marks, chapterIds, reason);
            }
        } catch (Exception e) {
            log.warn("Course knowledge: re-index enqueue failed for {} lesson(s), {} chapter(s) ({}): {}",
                    marks.size(), chapterIds.size(), reason, e.getMessage());
        }
    }

    /**
     * Marks of one transaction, written once after it commits. The reasons of
     * the transaction are joined (the writer clips them to the column width);
     * they only tell an operator why a row was queued.
     */
    private final class Batch implements TransactionSynchronization {

        private final Set<Mark> marks = new LinkedHashSet<>();
        private final Set<String> chapterIds = new LinkedHashSet<>();
        private final Set<String> reasons = new LinkedHashSet<>();
        private volatile boolean flushed;

        void add(List<Mark> newMarks, List<String> newChapterIds, String reason) {
            marks.addAll(newMarks);
            chapterIds.addAll(newChapterIds);
            if (StringUtils.hasText(reason)) {
                reasons.add(reason.trim());
            }
        }

        @Override
        public void afterCommit() {
            flushed = true;
            try {
                if (!marks.isEmpty() || !chapterIds.isEmpty()) {
                    write(new ArrayList<>(marks), new ArrayList<>(chapterIds),
                            reasons.isEmpty() ? null : String.join(",", reasons));
                }
            } catch (Exception e) {
                log.warn("Course knowledge: after-commit re-index enqueue failed: {}", e.getMessage());
            }
        }

        @Override
        public void afterCompletion(int status) {
            flushed = true;
            try {
                if (TransactionSynchronizationManager.getResource(BATCH_KEY) == this) {
                    TransactionSynchronizationManager.unbindResource(BATCH_KEY);
                }
            } catch (Exception e) {
                log.warn("Course knowledge: could not release the re-index batch: {}", e.getMessage());
            }
        }
    }
}
