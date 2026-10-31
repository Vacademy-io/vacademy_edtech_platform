package vacademy.io.admin_core_service.features.course.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.course.dto.restructure.CourseRestructureRequestDTO;
import vacademy.io.admin_core_service.features.course.dto.restructure.CourseRestructureRequestDTO.ChapterNode;
import vacademy.io.admin_core_service.features.course.dto.restructure.CourseRestructureRequestDTO.ModuleNode;
import vacademy.io.admin_core_service.features.course.dto.restructure.CourseRestructureRequestDTO.SubjectNode;
import vacademy.io.admin_core_service.features.course.dto.restructure.CourseRestructureResponseDTO;
import vacademy.io.admin_core_service.features.course.dto.restructure.CourseRestructureResponseDTO.Ref;
import vacademy.io.admin_core_service.features.course_knowledge.service.ContentIndexMarker;
import vacademy.io.admin_core_service.features.learner_tracking.service.LearnerTrackingAsyncService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Changes a course's depth (2-5) and/or regroups its content, atomically, for every batch.
 *
 * <p>Course structure is a set of link rows — subject_session (subject ↔ batch),
 * subject_module_mapping, module_chapter_mapping + chapter_package_session_mapping (chapter ↔
 * batch, holding the order), chapter_to_slides — plus package.course_depth. Hidden levels are
 * real containers named DEFAULT. So a restructure never copies content: it re-points link rows,
 * creates the new containers, soft-deletes (status DELETED) the ones left empty and sets the
 * depth. Slides and kept containers keep their ids, so learner progress on them survives; the
 * chapter / module / subject / course percentages are recomputed after commit.
 *
 * <p>Refused, with nothing written:
 * <ul>
 *   <li>a target that does not account for every current slide exactly once, or uses ids
 *       outside the course;</li>
 *   <li>hidden levels that are not a single DEFAULT container;</li>
 *   <li>containers SHARED with another course (copy-chapter reuses the same rows) — regrouping
 *       them here would reshape the other course too;</li>
 *   <li>batches of the course whose content differs (the restructure applies to all of them).</li>
 * </ul>
 *
 * <p>Drip rules live on package / chapter / slide rows ({@code drip_condition_json}). A merged-away
 * chapter's prerequisite references are re-pointed to the chapter that received its slides; its
 * own rule moves there when that chapter has none, otherwise it is dropped. Every such change
 * is reported, so a dry run shows it before anything happens.
 *
 * <p>{@code dryRun}: the exact same code path runs, then the transaction is rolled back.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CourseRestructureService {

    private static final String DEFAULT = "DEFAULT";
    private static final String DELETED = "DELETED";
    private static final String ACTIVE = "ACTIVE";
    private static final int MAX_NAME = 255;

    private final NamedParameterJdbcTemplate jdbc;
    private final PlatformTransactionManager transactionManager;
    private final LearnerTrackingAsyncService learnerTrackingAsyncService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    /** Optional (field-injected) so the plain-JDBC constructor stays as it is; null in tests built by hand. */
    @Autowired(required = false)
    private ContentIndexMarker contentIndexMarker;

    /** The course as it is now (shared by every batch, checked). */
    private record Current(
            int depth,
            List<String> batchIds,
            Map<String, String> subjectNames,          // id → name
            Map<String, String> moduleNames,
            Map<String, String> chapterNames,
            Map<String, String> chapterDrip,           // chapter id → drip_condition_json
            Map<String, String> slideRow,              // slide id → chapter_to_slides.id
            Map<String, String> slideChapter,          // slide id → chapter id
            Map<String, Integer> slideOrder) {
    }

    /** One transaction (TransactionTemplate, so a dry run can roll back without relying on a proxy). */
    public CourseRestructureResponseDTO restructure(String instituteId, String courseId,
                                                    CourseRestructureRequestDTO request, String userId) {
        return new TransactionTemplate(transactionManager).execute(status -> {
            CourseRestructureResponseDTO out = run(instituteId, courseId, request, userId);
            if (request != null && request.isDryRun()) {
                status.setRollbackOnly();
            }
            return out;
        });
    }

    private CourseRestructureResponseDTO run(String instituteId, String courseId,
                                             CourseRestructureRequestDTO request, String userId) {
        if (request == null || request.getTargetDepth() == null) {
            throw new VacademyException("target_depth is required");
        }
        int depth = request.getTargetDepth();
        if (depth < 2 || depth > 5) {
            throw new VacademyException("target_depth must be between 2 and 5");
        }
        Current cur = load(instituteId, courseId);
        validateTarget(request, depth, cur);

        CourseRestructureResponseDTO out = new CourseRestructureResponseDTO();
        out.setDryRun(request.isDryRun());
        out.setDepthFrom(cur.depth());
        out.setDepthTo(depth);
        out.setBatches(cur.batchIds().size());
        out.setLearnersAffected(countLearners(cur.batchIds()));

        Map<String, String> targetChapterOfSlide = new HashMap<>();
        List<String[]> recompute = new ArrayList<>(); // [chapterId, moduleId, subjectId]
        apply(request, cur, userId, out, targetChapterOfSlide, recompute);

        jdbc.update("UPDATE package SET course_depth = :d WHERE id = :c",
                new MapSqlParameterSource().addValue("d", depth).addValue("c", courseId));

        remapDrip(courseId, cur, out, targetChapterOfSlide);

        if (!request.isDryRun()) {
            scheduleRecompute(cur.batchIds(), recompute);
            log.info("Course {} restructured: depth {} -> {}, {} slides moved, {} created, {} removed",
                    courseId, cur.depth(), depth, out.getSlidesMoved(), out.getCreated().size(), out.getRemoved().size());
        }
        return out;
    }

    // ── load + checks ─────────────────────────────────────────────────────

    private Current load(String instituteId, String courseId) {
        MapSqlParameterSource p = new MapSqlParameterSource().addValue("c", courseId).addValue("i", instituteId);
        List<Integer> depths = jdbc.query(
                "SELECT p.course_depth FROM package p JOIN package_institute pi ON pi.package_id = p.id "
                        + "WHERE p.id = :c AND pi.institute_id = :i",
                p, (rs, n) -> (Integer) rs.getObject(1));
        if (depths.isEmpty()) {
            throw new VacademyException("Course not found in this institute");
        }
        int depth = depths.get(0) == null ? 5 : depths.get(0);

        // Every live batch that carries content. (The INVITED sentinel batch has none.)
        List<String> batches = jdbc.queryForList(
                "SELECT ps.id FROM package_session ps WHERE ps.package_id = :c AND ps.status <> 'DELETED' "
                        + "AND EXISTS (SELECT 1 FROM subject_session ss WHERE ss.session_id = ps.id) ORDER BY ps.created_at",
                p, String.class);
        if (batches.isEmpty()) {
            throw new VacademyException("This course has no content to restructure");
        }
        MapSqlParameterSource b = new MapSqlParameterSource().addValue("b", batches);

        // Subjects per batch — every batch must carry the same ones.
        Map<String, Set<String>> subjectsPerBatch = new HashMap<>();
        Map<String, String> subjectNames = new LinkedHashMap<>();
        jdbc.query("SELECT ss.session_id, s.id, s.subject_name FROM subject_session ss JOIN subject s ON s.id = ss.subject_id "
                        + "WHERE ss.session_id IN (:b) AND COALESCE(s.status, 'ACTIVE') <> 'DELETED' "
                        + "ORDER BY ss.subject_order NULLS LAST, s.created_at", b, rs -> {
            subjectsPerBatch.computeIfAbsent(rs.getString(1), k -> new HashSet<>()).add(rs.getString(2));
            subjectNames.putIfAbsent(rs.getString(2), rs.getString(3));
        });
        requireSameAcrossBatches(batches, subjectsPerBatch, "subjects");

        Map<String, String> moduleNames = new LinkedHashMap<>();
        Map<String, Integer> moduleParents = new HashMap<>();
        if (!subjectNames.isEmpty()) {
            jdbc.query("SELECT m.id, m.module_name FROM subject_module_mapping smm JOIN modules m ON m.id = smm.module_id "
                            + "WHERE smm.subject_id IN (:s) AND COALESCE(m.status, 'ACTIVE') <> 'DELETED' "
                            + "ORDER BY smm.module_order NULLS LAST, smm.created_at",
                    new MapSqlParameterSource("s", subjectNames.keySet()), rs -> {
                        moduleNames.putIfAbsent(rs.getString(1), rs.getString(2));
                        moduleParents.merge(rs.getString(1), 1, Integer::sum);
                    });
        }
        List<String> multiParent = moduleParents.entrySet().stream().filter(e -> e.getValue() > 1)
                .map(e -> moduleNames.get(e.getKey())).toList();
        if (!multiParent.isEmpty()) {
            throw new VacademyException("These modules sit under several subjects of the course, so their place is "
                    + "ambiguous: " + String.join(", ", multiParent));
        }

        Map<String, String> chapterNames = new LinkedHashMap<>();
        Map<String, String> chapterDrip = new HashMap<>();
        Map<String, Set<String>> chaptersPerBatch = new HashMap<>();
        Map<String, Set<String>> chapterModules = new HashMap<>();
        if (!moduleNames.isEmpty()) {
            jdbc.query("SELECT mcm.module_id, c.id, c.chapter_name, c.drip_condition_json, cpsm.package_session_id "
                            + "FROM module_chapter_mapping mcm JOIN chapter c ON c.id = mcm.chapter_id "
                            + "JOIN chapter_package_session_mapping cpsm ON cpsm.chapter_id = c.id AND cpsm.package_session_id IN (:b) "
                            + "WHERE mcm.module_id IN (:m) AND cpsm.status <> 'DELETED' AND COALESCE(c.status, 'ACTIVE') <> 'DELETED' "
                            + "ORDER BY cpsm.chapter_order NULLS LAST, c.created_at",
                    new MapSqlParameterSource().addValue("b", batches).addValue("m", moduleNames.keySet()), rs -> {
                        chapterNames.putIfAbsent(rs.getString(2), rs.getString(3));
                        if (StringUtils.hasText(rs.getString(4))) chapterDrip.put(rs.getString(2), rs.getString(4));
                        chaptersPerBatch.computeIfAbsent(rs.getString(5), k -> new HashSet<>()).add(rs.getString(2));
                        chapterModules.computeIfAbsent(rs.getString(2), k -> new HashSet<>()).add(rs.getString(1));
                    });
        }
        requireSameAcrossBatches(batches, chaptersPerBatch, "chapters");
        List<String> multiModule = chapterModules.entrySet().stream().filter(e -> e.getValue().size() > 1)
                .map(e -> chapterNames.get(e.getKey())).toList();
        if (!multiModule.isEmpty()) {
            throw new VacademyException("These chapters sit under several modules of the course, so their place is "
                    + "ambiguous: " + String.join(", ", multiModule));
        }

        Map<String, String> slideRow = new HashMap<>();
        Map<String, String> slideChapter = new HashMap<>();
        Map<String, Integer> slideOrder = new HashMap<>();
        List<String> doubled = new ArrayList<>();
        if (!chapterNames.isEmpty()) {
            jdbc.query("SELECT cts.id, cts.chapter_id, cts.slide_id, cts.slide_order FROM chapter_to_slides cts "
                            + "WHERE cts.chapter_id IN (:ch) AND cts.status <> 'DELETED'",
                    new MapSqlParameterSource("ch", chapterNames.keySet()), rs -> {
                        String slide = rs.getString(3);
                        if (slideRow.containsKey(slide)) doubled.add(slide);
                        slideRow.put(slide, rs.getString(1));
                        slideChapter.put(slide, rs.getString(2));
                        slideOrder.put(slide, (Integer) rs.getObject(4));
                    });
        }
        if (!doubled.isEmpty()) {
            throw new VacademyException("Some slides are in more than one chapter of this course; restructure it from "
                    + "the dashboard: " + String.join(", ", doubled));
        }

        requireNotShared(batches, subjectNames, moduleNames, chapterNames);
        return new Current(depth, batches, subjectNames, moduleNames, chapterNames, chapterDrip, slideRow,
                slideChapter, slideOrder);
    }

    private static void requireSameAcrossBatches(List<String> batches, Map<String, Set<String>> perBatch, String what) {
        Set<String> first = perBatch.getOrDefault(batches.get(0), Set.of());
        for (String batch : batches) {
            if (!perBatch.getOrDefault(batch, Set.of()).equals(first)) {
                throw new VacademyException("The batches of this course have different " + what
                        + "; restructure each batch from the dashboard");
            }
        }
    }

    /** Containers also used by ANOTHER course must not be regrouped from here. */
    private void requireNotShared(List<String> batches, Map<String, String> subjects, Map<String, String> modules,
                                  Map<String, String> chapters) {
        List<String> shared = new ArrayList<>();
        if (!subjects.isEmpty()) {
            jdbc.queryForList("SELECT DISTINCT ss.subject_id FROM subject_session ss JOIN package_session ps ON ps.id = ss.session_id "
                            + "WHERE ss.subject_id IN (:s) AND ss.session_id NOT IN (:b) AND ps.status <> 'DELETED'",
                    new MapSqlParameterSource().addValue("s", subjects.keySet()).addValue("b", batches), String.class)
                    .forEach(id -> shared.add("subject '" + subjects.get(id) + "'"));
        }
        if (!modules.isEmpty()) {
            jdbc.queryForList("SELECT DISTINCT smm.module_id FROM subject_module_mapping smm JOIN subject s ON s.id = smm.subject_id "
                            + "WHERE smm.module_id IN (:m) AND smm.subject_id NOT IN (:s) AND COALESCE(s.status, 'ACTIVE') <> 'DELETED'",
                    new MapSqlParameterSource().addValue("m", modules.keySet()).addValue("s", subjects.keySet()), String.class)
                    .forEach(id -> shared.add("module '" + modules.get(id) + "'"));
        }
        if (!chapters.isEmpty()) {
            MapSqlParameterSource p = new MapSqlParameterSource().addValue("ch", chapters.keySet())
                    .addValue("m", modules.keySet()).addValue("b", batches);
            jdbc.queryForList("SELECT DISTINCT mcm.chapter_id FROM module_chapter_mapping mcm JOIN modules m ON m.id = mcm.module_id "
                            + "WHERE mcm.chapter_id IN (:ch) AND mcm.module_id NOT IN (:m) AND COALESCE(m.status, 'ACTIVE') <> 'DELETED' "
                            + "UNION SELECT DISTINCT cpsm.chapter_id FROM chapter_package_session_mapping cpsm "
                            + "JOIN package_session ps ON ps.id = cpsm.package_session_id "
                            + "WHERE cpsm.chapter_id IN (:ch) AND cpsm.package_session_id NOT IN (:b) "
                            + "AND cpsm.status <> 'DELETED' AND ps.status <> 'DELETED'", p, String.class)
                    .forEach(id -> shared.add("chapter '" + chapters.get(id) + "'"));
        }
        if (!shared.isEmpty()) {
            throw new VacademyException("This content is shared with another course, so regrouping it here would change "
                    + "that course too: " + String.join(", ", shared));
        }
    }

    private void validateTarget(CourseRestructureRequestDTO req, int depth, Current cur) {
        List<SubjectNode> subjects = Optional.ofNullable(req.getSubjects()).orElse(List.of());
        if (subjects.isEmpty()) {
            throw new VacademyException("The target tree has no subjects");
        }
        if (depth <= 4) hiddenLevel(subjects, "subject", SubjectNode::getName);
        Set<String> seenS = new HashSet<>(), seenM = new HashSet<>(), seenC = new HashSet<>(), seenSlides = new HashSet<>();
        for (SubjectNode s : subjects) {
            if (depth == 5) visibleName(s.getName(), "subject");
            known(s.getId(), cur.subjectNames(), seenS, "subject");
            List<ModuleNode> modules = Optional.ofNullable(s.getModules()).orElse(List.of());
            if (depth <= 3) hiddenLevel(modules, "module", ModuleNode::getName);
            for (ModuleNode m : modules) {
                if (depth >= 4) visibleName(m.getName(), "module");
                known(m.getId(), cur.moduleNames(), seenM, "module");
                List<ChapterNode> chapters = Optional.ofNullable(m.getChapters()).orElse(List.of());
                if (depth == 2) hiddenLevel(chapters, "chapter", ChapterNode::getName);
                for (ChapterNode c : chapters) {
                    if (depth >= 3) visibleName(c.getName(), "chapter");
                    known(c.getId(), cur.chapterNames(), seenC, "chapter");
                    for (String slide : Optional.ofNullable(c.getSlideIds()).orElse(List.of())) {
                        if (!cur.slideRow().containsKey(slide)) {
                            throw new VacademyException("Slide " + slide + " is not in this course");
                        }
                        if (!seenSlides.add(slide)) {
                            throw new VacademyException("Slide " + slide + " is listed twice");
                        }
                    }
                }
            }
        }
        Set<String> missing = new HashSet<>(cur.slideRow().keySet());
        missing.removeAll(seenSlides);
        if (!missing.isEmpty()) {
            throw new VacademyException(missing.size() + " slide(s) of the course are missing from the target tree — "
                    + "every slide must be placed exactly once: " + String.join(", ", missing));
        }
    }

    private static <T> void hiddenLevel(List<T> nodes, String level, java.util.function.Function<T, String> name) {
        if (nodes.size() != 1 || !DEFAULT.equalsIgnoreCase(String.valueOf(name.apply(nodes.get(0))).trim())) {
            throw new VacademyException("At this depth the " + level + " level is hidden: it must be exactly one "
                    + level + " named DEFAULT");
        }
    }

    private static void visibleName(String name, String level) {
        if (!StringUtils.hasText(name) || name.trim().length() > MAX_NAME) {
            throw new VacademyException("Every " + level + " needs a name (1-" + MAX_NAME + " characters)");
        }
        if (DEFAULT.equalsIgnoreCase(name.trim())) {
            throw new VacademyException("'DEFAULT' is reserved for hidden levels; give the " + level + " a real name");
        }
    }

    private static void known(String id, Map<String, String> current, Set<String> seen, String level) {
        if (!StringUtils.hasText(id)) return;
        if (!current.containsKey(id)) {
            throw new VacademyException("The " + level + " " + id + " is not part of this course");
        }
        if (!seen.add(id)) {
            throw new VacademyException("The " + level + " " + id + " is used twice");
        }
    }

    // ── apply ─────────────────────────────────────────────────────────────

    private void apply(CourseRestructureRequestDTO req, Current cur, String userId, CourseRestructureResponseDTO out,
                       Map<String, String> targetChapterOfSlide, List<String[]> recompute) {
        Set<String> keptS = new HashSet<>(), keptM = new HashSet<>(), keptC = new HashSet<>();
        int chapterOrder = 0;
        int subjectOrder = 0;
        for (SubjectNode s : req.getSubjects()) {
            String sid = upsertSubject(s, cur, userId, ++subjectOrder, out);
            keptS.add(sid);
            int moduleOrder = 0;
            for (ModuleNode m : Optional.ofNullable(s.getModules()).orElse(List.of())) {
                String mid = upsertModule(m, sid, cur, userId, ++moduleOrder, out);
                keptM.add(mid);
                for (ChapterNode c : Optional.ofNullable(m.getChapters()).orElse(List.of())) {
                    String cid = upsertChapter(c, mid, cur, userId, ++chapterOrder, out);
                    keptC.add(cid);
                    recompute.add(new String[]{cid, mid, sid});
                    int slideOrder = 0;
                    for (String slide : Optional.ofNullable(c.getSlideIds()).orElse(List.of())) {
                        slideOrder++;
                        targetChapterOfSlide.put(slide, cid);
                        boolean moved = !cid.equals(cur.slideChapter().get(slide));
                        if (moved || !Objects.equals(cur.slideOrder().get(slide), slideOrder)) {
                            jdbc.update("UPDATE chapter_to_slides SET chapter_id = :c, slide_order = :o WHERE id = :id",
                                    new MapSqlParameterSource().addValue("c", cid).addValue("o", slideOrder)
                                            .addValue("id", cur.slideRow().get(slide)));
                        }
                        if (moved) {
                            out.setSlidesMoved(out.getSlidesMoved() + 1);
                            // Re-index under both chapters; queued after commit, so a dry run queues nothing.
                            if (contentIndexMarker != null) {
                                contentIndexMarker.mark(slide, cid, "COURSE_RESTRUCTURED");
                                contentIndexMarker.mark(slide, cur.slideChapter().get(slide), "COURSE_RESTRUCTURED");
                            }
                        }
                    }
                }
            }
        }
        out.setTree(req.getSubjects());

        List<String> goneC = cur.chapterNames().keySet().stream().filter(id -> !keptC.contains(id)).toList();
        if (!goneC.isEmpty()) {
            jdbc.update("UPDATE chapter_package_session_mapping SET status = 'DELETED' "
                            + "WHERE chapter_id IN (:ids) AND package_session_id IN (:b)",
                    new MapSqlParameterSource().addValue("ids", goneC).addValue("b", cur.batchIds()));
            jdbc.update("UPDATE chapter SET status = 'DELETED' WHERE id IN (:ids)", new MapSqlParameterSource("ids", goneC));
            goneC.forEach(id -> out.getRemoved().add(new Ref("chapter", id, cur.chapterNames().get(id), null)));
        }
        List<String> goneM = cur.moduleNames().keySet().stream().filter(id -> !keptM.contains(id)).toList();
        if (!goneM.isEmpty()) {
            jdbc.update("UPDATE modules SET status = 'DELETED' WHERE id IN (:ids)", new MapSqlParameterSource("ids", goneM));
            goneM.forEach(id -> out.getRemoved().add(new Ref("module", id, cur.moduleNames().get(id), null)));
        }
        List<String> goneS = cur.subjectNames().keySet().stream().filter(id -> !keptS.contains(id)).toList();
        if (!goneS.isEmpty()) {
            jdbc.update("UPDATE subject SET status = 'DELETED' WHERE id IN (:ids)", new MapSqlParameterSource("ids", goneS));
            goneS.forEach(id -> out.getRemoved().add(new Ref("subject", id, cur.subjectNames().get(id), null)));
        }
    }

    private String upsertSubject(SubjectNode s, Current cur, String userId, int order, CourseRestructureResponseDTO out) {
        String name = s.getName().trim();
        String id = s.getId();
        if (StringUtils.hasText(id)) {
            rename("subject", "UPDATE subject SET subject_name = :n WHERE id = :id", id, name,
                    cur.subjectNames().get(id), out);
            jdbc.update("UPDATE subject_session SET subject_order = :o WHERE subject_id = :id AND session_id IN (:b)",
                    new MapSqlParameterSource().addValue("o", order).addValue("id", id).addValue("b", cur.batchIds()));
        } else {
            id = UUID.randomUUID().toString();
            jdbc.update("INSERT INTO subject (id, subject_name, status, created_by_user_id) VALUES (:id, :n, :st, :u)",
                    new MapSqlParameterSource().addValue("id", id).addValue("n", name).addValue("st", ACTIVE)
                            .addValue("u", userId));
            for (String batch : cur.batchIds()) {
                jdbc.update("INSERT INTO subject_session (id, subject_id, session_id, subject_order) VALUES (:x, :id, :b, :o)",
                        new MapSqlParameterSource().addValue("x", UUID.randomUUID().toString()).addValue("id", id)
                                .addValue("b", batch).addValue("o", order));
            }
            out.getCreated().add(new Ref("subject", id, name, null));
            s.setId(id);
        }
        return id;
    }

    private String upsertModule(ModuleNode m, String subjectId, Current cur, String userId, int order,
                                CourseRestructureResponseDTO out) {
        String name = m.getName().trim();
        String id = m.getId();
        if (StringUtils.hasText(id)) {
            rename("module", "UPDATE modules SET module_name = :n WHERE id = :id", id, name, cur.moduleNames().get(id), out);
            // A module sits under exactly one subject of this course (checked in load): re-point that link.
            jdbc.update("UPDATE subject_module_mapping SET subject_id = :s, module_order = :o "
                            + "WHERE module_id = :id AND subject_id IN (:cur)",
                    new MapSqlParameterSource().addValue("s", subjectId).addValue("o", order).addValue("id", id)
                            .addValue("cur", cur.subjectNames().keySet()));
        } else {
            id = UUID.randomUUID().toString();
            jdbc.update("INSERT INTO modules (id, module_name, status, created_by_user_id) VALUES (:id, :n, :st, :u)",
                    new MapSqlParameterSource().addValue("id", id).addValue("n", name).addValue("st", ACTIVE)
                            .addValue("u", userId));
            jdbc.update("INSERT INTO subject_module_mapping (id, subject_id, module_id, module_order) VALUES (:x, :s, :id, :o)",
                    new MapSqlParameterSource().addValue("x", UUID.randomUUID().toString()).addValue("s", subjectId)
                            .addValue("id", id).addValue("o", order));
            out.getCreated().add(new Ref("module", id, name, null));
            m.setId(id);
        }
        return id;
    }

    private String upsertChapter(ChapterNode c, String moduleId, Current cur, String userId, int order,
                                 CourseRestructureResponseDTO out) {
        String name = c.getName().trim();
        String id = c.getId();
        if (StringUtils.hasText(id)) {
            rename("chapter", "UPDATE chapter SET chapter_name = :n WHERE id = :id", id, name,
                    cur.chapterNames().get(id), out);
            jdbc.update("UPDATE module_chapter_mapping SET module_id = :m WHERE chapter_id = :id AND module_id IN (:cur)",
                    new MapSqlParameterSource().addValue("m", moduleId).addValue("id", id)
                            .addValue("cur", cur.moduleNames().keySet()));
            jdbc.update("UPDATE chapter_package_session_mapping SET chapter_order = :o "
                            + "WHERE chapter_id = :id AND package_session_id IN (:b) AND status <> 'DELETED'",
                    new MapSqlParameterSource().addValue("o", order).addValue("id", id).addValue("b", cur.batchIds()));
        } else {
            id = UUID.randomUUID().toString();
            jdbc.update("INSERT INTO chapter (id, chapter_name, status, created_by_user_id) VALUES (:id, :n, :st, :u)",
                    new MapSqlParameterSource().addValue("id", id).addValue("n", name).addValue("st", ACTIVE)
                            .addValue("u", userId));
            jdbc.update("INSERT INTO module_chapter_mapping (id, chapter_id, module_id) VALUES (:x, :id, :m)",
                    new MapSqlParameterSource().addValue("x", UUID.randomUUID().toString()).addValue("id", id)
                            .addValue("m", moduleId));
            for (String batch : cur.batchIds()) {
                jdbc.update("INSERT INTO chapter_package_session_mapping (id, chapter_id, package_session_id, status, chapter_order) "
                                + "VALUES (:x, :id, :b, :st, :o)",
                        new MapSqlParameterSource().addValue("x", UUID.randomUUID().toString()).addValue("id", id)
                                .addValue("b", batch).addValue("st", ACTIVE).addValue("o", order));
            }
            out.getCreated().add(new Ref("chapter", id, name, null));
            c.setId(id);
        }
        return id;
    }

    private void rename(String level, String sql, String id, String name, String previous, CourseRestructureResponseDTO out) {
        if (!name.equals(previous)) {
            jdbc.update(sql, new MapSqlParameterSource().addValue("n", name).addValue("id", id));
            out.getRenamed().add(new Ref(level, id, name, previous));
        }
    }

    private int countLearners(List<String> batches) {
        Integer n = jdbc.queryForObject("SELECT COUNT(DISTINCT user_id) FROM student_session_institute_group_mapping "
                        + "WHERE package_session_id IN (:b) AND status IN ('ACTIVE', 'INACTIVE')",
                new MapSqlParameterSource("b", batches), Integer.class);
        return n == null ? 0 : n;
    }

    // ── drip rules ────────────────────────────────────────────────────────

    /**
     * Removed chapter → the chapter now holding most of its slides. Prerequisite references to a removed
     * chapter follow it there (or are dropped when it had no slides); the removed chapter's own rule moves
     * there when that chapter has none of its own, otherwise it is dropped. Everything is reported.
     */
    private void remapDrip(String courseId, Current cur, CourseRestructureResponseDTO out,
                           Map<String, String> targetChapterOfSlide) {
        Map<String, String> map = new LinkedHashMap<>();
        for (Ref removed : out.getRemoved()) {
            if (!"chapter".equals(removed.getLevel())) continue;
            Map<String, Long> receivers = cur.slideChapter().entrySet().stream()
                    .filter(e -> removed.getId().equals(e.getValue()))
                    .collect(Collectors.groupingBy(e -> targetChapterOfSlide.get(e.getKey()), LinkedHashMap::new,
                            Collectors.counting()));
            receivers.entrySet().stream().max(Map.Entry.comparingByValue())
                    .ifPresent(e -> map.put(removed.getId(), e.getKey()));
        }
        out.setChapterIdMap(map);
        Set<String> removedChapters = out.getRemoved().stream().filter(r -> "chapter".equals(r.getLevel()))
                .map(Ref::getId).collect(Collectors.toSet());
        if (removedChapters.isEmpty()) return;

        // 1) A removed chapter's own rule.
        Map<String, String> drip = new HashMap<>(cur.chapterDrip());
        for (String gone : removedChapters) {
            String rule = drip.get(gone);
            if (!StringUtils.hasText(rule)) continue;
            String name = cur.chapterNames().get(gone);
            String receiver = map.get(gone);
            if (receiver != null && !StringUtils.hasText(drip.get(receiver))) {
                drip.put(receiver, rule);
                jdbc.update("UPDATE chapter SET drip_condition_json = :j WHERE id = :id",
                        new MapSqlParameterSource().addValue("j", rule).addValue("id", receiver));
                out.getDripChanges().add("The release rule of chapter '" + name + "' now applies to chapter '"
                        + chapterLabel(receiver, cur, out) + "', which holds its slides.");
            } else {
                out.getDripChanges().add("The release rule of chapter '" + name + "' was dropped"
                        + (receiver != null ? " (chapter '" + chapterLabel(receiver, cur, out) + "' has its own rule)"
                        : " (it had no slides)") + ".");
            }
        }

        // 2) Prerequisite references to removed chapters, wherever they are in this course.
        rewriteJson("SELECT id, drip_condition_json FROM package WHERE id = :c AND drip_condition_json IS NOT NULL",
                new MapSqlParameterSource("c", courseId), "UPDATE package SET drip_condition_json = :j WHERE id = :id",
                null, map, removedChapters, cur, out, "the course");
        List<String> chapters = out.getTree().stream()
                .flatMap(s -> Optional.ofNullable(s.getModules()).orElse(List.of()).stream())
                .flatMap(m -> Optional.ofNullable(m.getChapters()).orElse(List.of()).stream())
                .map(ChapterNode::getId).toList();
        if (!chapters.isEmpty()) {
            rewriteJson("SELECT id, drip_condition_json FROM chapter WHERE id IN (:ids) AND drip_condition_json IS NOT NULL",
                    new MapSqlParameterSource("ids", chapters), "UPDATE chapter SET drip_condition_json = :j WHERE id = :id",
                    "chapter", map, removedChapters, cur, out, null);
        }
        if (!cur.slideRow().isEmpty()) {
            rewriteJson("SELECT id, drip_condition_json FROM slide WHERE id IN (:ids) AND drip_condition_json IS NOT NULL",
                    new MapSqlParameterSource("ids", cur.slideRow().keySet()),
                    "UPDATE slide SET drip_condition_json = :j WHERE id = :id", "slide", map, removedChapters, cur, out, null);
        }
    }

    private void rewriteJson(String select, MapSqlParameterSource params, String update, String ownerLevel,
                             Map<String, String> map, Set<String> removed, Current cur, CourseRestructureResponseDTO out,
                             String fixedLabel) {
        jdbc.query(select, params, rs -> {
            String owner = rs.getString(1);
            String json = rs.getString(2);
            if (!StringUtils.hasText(json)) return;
            String label = fixedLabel != null ? fixedLabel
                    : ("chapter".equals(ownerLevel) ? "chapter '" + chapterLabel(owner, cur, out) + "'" : "a slide");
            try {
                JsonNode root = objectMapper.readTree(json);
                boolean changed = false;
                List<JsonNode> conditions = new ArrayList<>();
                if (root.isArray()) root.forEach(conditions::add);
                else conditions.add(root);
                for (JsonNode condition : conditions) {
                    changed |= remapCondition(condition, map, removed, "chapter".equals(ownerLevel) ? owner : null,
                            cur, out, label);
                }
                if (changed) {
                    jdbc.update(update, new MapSqlParameterSource().addValue("j", objectMapper.writeValueAsString(root))
                            .addValue("id", owner));
                }
            } catch (Exception e) {
                out.getWarnings().add("Could not read the release rule of " + label + "; it was left as is.");
            }
        });
    }

    private boolean remapCondition(JsonNode condition, Map<String, String> map, Set<String> removed, String selfChapter,
                                   Current cur, CourseRestructureResponseDTO out, String label) {
        JsonNode rules = condition == null ? null : condition.get("rules");
        if (rules == null || !rules.isArray()) return false;
        boolean changed = false;
        for (JsonNode rule : rules) {
            if (rule.get("type") == null || !"prerequisite".equalsIgnoreCase(rule.get("type").asText())) continue;
            JsonNode params = rule.get("params");
            if (!(params instanceof ObjectNode obj) || !(obj.get("required_chapters") instanceof ArrayNode ids)) continue;
            ArrayNode next = objectMapper.createArrayNode();
            Set<String> added = new LinkedHashSet<>();
            boolean touched = false;
            for (JsonNode n : ids) {
                String id = n.asText();
                if (!removed.contains(id)) {
                    if (added.add(id)) next.add(id);
                    continue;
                }
                touched = true;
                String name = cur.chapterNames().get(id);
                String to = map.get(id);
                if (to == null) {
                    out.getDripChanges().add("In " + label + ": the prerequisite on chapter '" + name
                            + "' was dropped (that chapter had no slides).");
                } else if (to.equals(selfChapter)) {
                    out.getDripChanges().add("In " + label + ": the prerequisite on chapter '" + name
                            + "' was dropped — its slides are now in this same chapter.");
                } else if (added.add(to)) {
                    next.add(to);
                    out.getDripChanges().add("In " + label + ": the prerequisite on chapter '" + name
                            + "' now points to chapter '" + chapterLabel(to, cur, out) + "'.");
                }
            }
            if (touched) {
                obj.set("required_chapters", next);
                changed = true;
            }
        }
        return changed;
    }

    private static String chapterLabel(String id, Current cur, CourseRestructureResponseDTO out) {
        for (Ref r : out.getCreated()) if (r.getId().equals(id)) return r.getName();
        for (Ref r : out.getRenamed()) if (r.getId().equals(id)) return r.getName();
        return cur.chapterNames().getOrDefault(id, id);
    }

    // ── after commit ──────────────────────────────────────────────────────

    /** Learner percentages for every chapter (and, through it, module / subject / course), once committed. */
    private void scheduleRecompute(List<String> batches, List<String[]> chapters) {
        Runnable job = () -> {
            for (String batch : batches) {
                for (String[] c : chapters) {
                    try {
                        learnerTrackingAsyncService.updateLearnerOperationsForBatch("CHAPTER", null, null, c[0], c[1],
                                c[2], batch);
                    } catch (Exception e) {
                        log.warn("Progress recompute after restructure failed for chapter {} batch {}: {}",
                                c[0], batch, e.getMessage());
                    }
                }
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    job.run();
                }
            });
        } else {
            job.run();
        }
    }
}
