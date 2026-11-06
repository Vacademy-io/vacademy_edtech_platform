package vacademy.io.admin_core_service.features.learner_notes.service;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.learner_notes.dto.LearnerNoteDTO;
import vacademy.io.admin_core_service.features.learner_notes.dto.NotebookPageDTO;
import vacademy.io.admin_core_service.features.learner_notes.entity.LearnerNote;
import vacademy.io.admin_core_service.features.learner_notes.repository.LearnerNoteRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * A learner's own highlights, marked areas, bookmarks and notes. Every read and
 * write is scoped to the user id from the token, so nobody can reach another
 * learner's notes, whichever ids they send. Institute and course fields only
 * sort the learner's own notebook; they grant nothing.
 */
@Service
public class LearnerNoteService {

    static final Set<String> KINDS = Set.of("HIGHLIGHT", "AREA", "BOOKMARK", "NOTE");
    static final Set<String> COLORS = Set.of("yellow", "green", "blue", "pink");
    private static final Pattern UUID_SHAPE = Pattern.compile(
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");

    static final int MAX_NOTE_CHARS = 10_000;
    static final int MAX_QUOTE_CHARS = 4_000;
    static final int MAX_ANCHOR_CHARS = 20_000;
    static final int MAX_LABEL_CHARS = 500;
    static final int MAX_NOTES_PER_LEARNER = 20_000;
    static final int MAX_PAGE_SIZE = 200;
    static final int MAX_DUE_ITEMS = 50;

    /** Days until the next review, by how many times in a row it was remembered. */
    static final int[] REVIEW_GAP_DAYS = { 1, 3, 7, 16, 35 };

    private final LearnerNoteRepository repository;

    public LearnerNoteService(LearnerNoteRepository repository) {
        this.repository = repository;
    }

    public List<LearnerNoteDTO> forSlide(String userId, String slideId) {
        return repository.findByUserIdAndSlideIdAndDeletedAtIsNullOrderByCreatedAtAsc(userId, slideId)
                .stream().map(LearnerNoteService::toDto).toList();
    }

    public NotebookPageDTO notebook(String userId, String instituteId, String kind, String query, int pageNo,
            int pageSize) {
        requireText(instituteId, "institute_id");
        String kindFilter = StringUtils.hasText(kind) ? validKind(kind) : "";
        int size = Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE);
        Page<LearnerNote> page = repository.searchNotebook(userId, instituteId, kindFilter, likePattern(query),
                PageRequest.of(Math.max(pageNo, 0), size));
        return new NotebookPageDTO(page.getContent().stream().map(LearnerNoteService::toDto).toList(),
                page.getNumber(), page.getSize(), page.getTotalElements(), page.isLast());
    }

    public List<LearnerNoteDTO> due(String userId, String instituteId, int limit) {
        requireText(instituteId, "institute_id");
        int size = Math.min(Math.max(limit, 1), MAX_DUE_ITEMS);
        return repository.findDue(userId, instituteId, Instant.now(), PageRequest.of(0, size))
                .stream().map(LearnerNoteService::toDto).toList();
    }

    public long dueCount(String userId, String instituteId) {
        requireText(instituteId, "institute_id");
        return repository.countDue(userId, instituteId, Instant.now());
    }

    /**
     * Creates or updates by the device-generated id, so a note retried after a
     * lost response stays one note. An id owned by someone else answers exactly
     * like an id that does not exist on read, and never changes their row.
     */
    @Transactional
    public LearnerNoteDTO save(String userId, String id, LearnerNoteDTO body) {
        if (id == null || !UUID_SHAPE.matcher(id).matches()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "id must be a UUID");
        }
        validate(body);

        Instant now = Instant.now();
        LearnerNote note = repository.findById(id).orElse(null);
        if (note != null && !userId.equals(note.getUserId())) {
            throw new VacademyException(HttpStatus.CONFLICT, "This note id cannot be used");
        }
        // A delete is final. A save that was already on its way (a slow request, a
        // second tab) must not bring the note back.
        if (note != null && note.getDeletedAt() != null) {
            return toDto(note);
        }
        boolean creating = note == null;
        if (creating) {
            if (repository.countByUserIdAndDeletedAtIsNull(userId) >= MAX_NOTES_PER_LEARNER) {
                throw new VacademyException(HttpStatus.BAD_REQUEST, "Notebook is full");
            }
            note = new LearnerNote();
            note.setId(id);
            note.setUserId(userId);
            note.setCreatedAt(now);
            note.setReviewStage(0);
        }

        note.setInstituteId(body.getInstituteId());
        note.setSlideId(body.getSlideId());
        note.setSlideType(body.getSlideType());
        note.setSlideTitle(clean(body.getSlideTitle()));
        note.setChapterName(clean(body.getChapterName()));
        note.setCourseName(clean(body.getCourseName()));
        note.setCourseId(body.getCourseId());
        note.setLevelId(body.getLevelId());
        note.setSubjectId(body.getSubjectId());
        note.setModuleId(body.getModuleId());
        note.setChapterId(body.getChapterId());
        note.setPackageSessionId(body.getPackageSessionId());
        note.setKind(validKind(body.getKind()));
        note.setColor(body.getColor());
        note.setPageIndex(body.getPageIndex());
        note.setTimeMs(body.getTimeMs());
        note.setAnchorJson(clean(body.getAnchorJson()));
        note.setQuoteText(clean(body.getQuoteText()));
        note.setNoteText(clean(body.getNoteText()));
        note.setUpdatedAt(now);
        if (isReviewable(note)) {
            if (note.getNextReviewAt() == null) {
                note.setNextReviewAt(now.plus(Duration.ofDays(REVIEW_GAP_DAYS[0])));
            }
        } else {
            note.setNextReviewAt(null);
        }
        return toDto(repository.save(note));
    }

    @Transactional
    public void delete(String userId, String id) {
        repository.findById(id).filter(n -> userId.equals(n.getUserId())).ifPresent(n -> {
            Instant now = Instant.now();
            n.setDeletedAt(now);
            n.setUpdatedAt(now);
            n.setNextReviewAt(null);
            repository.save(n);
        });
    }

    @Transactional
    public LearnerNoteDTO recordReview(String userId, String id, boolean remembered) {
        LearnerNote note = repository.findById(id)
                .filter(n -> userId.equals(n.getUserId()) && n.getDeletedAt() == null)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Note not found"));
        Instant now = Instant.now();
        int stage = remembered ? note.getReviewStage() + 1 : 0;
        note.setReviewStage(stage);
        note.setLastReviewedAt(now);
        note.setNextReviewAt(now.plus(Duration.ofDays(gapDays(stage))));
        note.setUpdatedAt(now);
        return toDto(repository.save(note));
    }

    /** PDF text can carry NUL characters, which Postgres text columns refuse. */
    static String clean(String value) {
        return value == null ? null : value.replace("\u0000", "");
    }

    /** Stage 0 comes back tomorrow; the gap then widens and holds at the longest. */
    static int gapDays(int stage) {
        return REVIEW_GAP_DAYS[Math.min(Math.max(stage, 0), REVIEW_GAP_DAYS.length - 1)];
    }

    /** A bookmark only remembers a place, and an empty mark has nothing to recall. */
    static boolean isReviewable(LearnerNote note) {
        if ("BOOKMARK".equals(note.getKind())) {
            return false;
        }
        return StringUtils.hasText(note.getQuoteText()) || StringUtils.hasText(note.getNoteText());
    }

    /** Lower-cases and escapes LIKE wildcards with '!', or returns "" for no search. */
    static String likePattern(String query) {
        if (!StringUtils.hasText(query)) {
            return "";
        }
        String escaped = query.trim().toLowerCase(Locale.ROOT)
                .replace("!", "!!")
                .replace("%", "!%")
                .replace("_", "!_");
        return "%" + escaped + "%";
    }

    private static void validate(LearnerNoteDTO body) {
        if (body == null) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Body is required");
        }
        requireText(body.getInstituteId(), "institute_id");
        requireText(body.getSlideId(), "slide_id");
        validKind(body.getKind());
        if (body.getColor() != null && !COLORS.contains(body.getColor())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Unknown color");
        }
        if (body.getPageIndex() != null && body.getPageIndex() < 0) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "page_index cannot be negative");
        }
        if (body.getTimeMs() != null && body.getTimeMs() < 0) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "time_ms cannot be negative");
        }
        limit(body.getNoteText(), MAX_NOTE_CHARS, "note_text");
        limit(body.getQuoteText(), MAX_QUOTE_CHARS, "quote_text");
        limit(body.getAnchorJson(), MAX_ANCHOR_CHARS, "anchor_json");
        limit(body.getSlideTitle(), MAX_LABEL_CHARS, "slide_title");
        limit(body.getChapterName(), MAX_LABEL_CHARS, "chapter_name");
        limit(body.getCourseName(), MAX_LABEL_CHARS, "course_name");
    }

    private static String validKind(String kind) {
        if (kind == null || !KINDS.contains(kind)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Unknown kind");
        }
        return kind;
    }

    private static void requireText(String value, String field) {
        if (!StringUtils.hasText(value)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, field + " is required");
        }
    }

    private static void limit(String value, int max, String field) {
        if (value != null && value.length() > max) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, field + " is too long");
        }
    }

    static LearnerNoteDTO toDto(LearnerNote n) {
        LearnerNoteDTO dto = new LearnerNoteDTO();
        dto.setId(n.getId());
        dto.setInstituteId(n.getInstituteId());
        dto.setSlideId(n.getSlideId());
        dto.setSlideType(n.getSlideType());
        dto.setSlideTitle(n.getSlideTitle());
        dto.setChapterName(n.getChapterName());
        dto.setCourseName(n.getCourseName());
        dto.setCourseId(n.getCourseId());
        dto.setLevelId(n.getLevelId());
        dto.setSubjectId(n.getSubjectId());
        dto.setModuleId(n.getModuleId());
        dto.setChapterId(n.getChapterId());
        dto.setPackageSessionId(n.getPackageSessionId());
        dto.setKind(n.getKind());
        dto.setColor(n.getColor());
        dto.setPageIndex(n.getPageIndex());
        dto.setTimeMs(n.getTimeMs());
        dto.setAnchorJson(n.getAnchorJson());
        dto.setQuoteText(n.getQuoteText());
        dto.setNoteText(n.getNoteText());
        dto.setReviewStage(n.getReviewStage());
        dto.setNextReviewAt(n.getNextReviewAt());
        dto.setLastReviewedAt(n.getLastReviewedAt());
        dto.setCreatedAt(n.getCreatedAt());
        dto.setUpdatedAt(n.getUpdatedAt());
        return dto;
    }
}
