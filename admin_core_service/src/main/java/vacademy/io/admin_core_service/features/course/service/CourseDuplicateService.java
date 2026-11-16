package vacademy.io.admin_core_service.features.course.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.commerce.common.CommerceLegacyGuard;
import vacademy.io.admin_core_service.features.course.dto.AddCourseDTO;
import vacademy.io.admin_core_service.features.course.dto.CopyCourseContentResponse;
import vacademy.io.admin_core_service.features.course.dto.SubgroupDTO;
import vacademy.io.admin_core_service.features.course.dto.duplicate.DuplicateCourseResponse;
import vacademy.io.admin_core_service.features.group.dto.AddGroupDTO;
import vacademy.io.admin_core_service.features.level.dto.AddLevelWithSessionDTO;
import vacademy.io.admin_core_service.features.packages.enums.PackageSessionStatusEnum;
import vacademy.io.admin_core_service.features.packages.enums.PackageStatusEnum;
import vacademy.io.admin_core_service.features.packages.repository.PackageInstituteRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.packages.service.PackagePageContentService;
import vacademy.io.admin_core_service.features.session.dto.AddNewSessionDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * One-click "Duplicate course".
 *
 * <p>Does in one transaction what an admin used to do by hand: create a course with the same
 * depth, then Course Structure &rarr; Import Content &rarr; "Make a separate copy" for every batch.
 *
 * <ol>
 *   <li>Creates the new course through {@link CourseService#addCourse} (the create-course path),
 *       so it gets exactly what a freshly created course gets: ACTIVE status, the institute link,
 *       the INVITED batch, a default enrol invite and invitation form per batch, and the
 *       COURSE_CREATED workflow trigger. Course details (description, media, tags, depth, about /
 *       why-learn / who-should-learn, course settings, course page content) are copied from the
 *       source.</li>
 *   <li>Recreates the source batches (same level + session, batch name, sub-batches, status and
 *       start date).</li>
 *   <li>Deep-copies each source batch's content into its new twin with
 *       {@link CourseContentCopyService#copy} in VALUE mode (a separate copy, new ids).</li>
 * </ol>
 *
 * <p>Never copied: learners and enrolments, payment options, invite links, issued certificates,
 * teacher assignments, seat inventory, and catalogue publishing (the copy starts unpublished).
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class CourseDuplicateService {

    static final String COPY_SUFFIX = " (Copy)";
    /**
     * package_name is 255 wide, and on a name clash the create path appends " (2)" .. " (50)".
     * Capping below the column leaves room for that suffix so a long clashing name still saves.
     */
    static final int MAX_NAME_LENGTH = 245;

    /** Batch statuses that are recreated on the copy. INVITED and DELETED rows are not batches to copy. */
    static final Set<String> COPIED_BATCH_STATUSES = Set.of(
            PackageSessionStatusEnum.ACTIVE.name(),
            PackageSessionStatusEnum.HIDDEN.name(),
            PackageSessionStatusEnum.DRAFT.name());

    private final PackageRepository packageRepository;
    private final PackageSessionRepository packageSessionRepository;
    private final PackageInstituteRepository packageInstituteRepository;
    private final PackagePageContentService packagePageContentService;
    private final CourseService courseService;
    private final CourseContentCopyService courseContentCopyService;
    private final CommerceLegacyGuard commerceLegacyGuard;

    @Transactional
    public DuplicateCourseResponse duplicate(String instituteId, String courseId, String requestedName,
                                             CustomUserDetails user) {
        if (!StringUtils.hasText(courseId)) {
            throw new VacademyException("courseId is required");
        }
        refuseTeacherOnly(user);
        PackageEntity source = packageRepository.findById(courseId)
                .orElseThrow(() -> new VacademyException("Course not found"));
        if (PackageStatusEnum.DELETED.name().equalsIgnoreCase(source.getStatus())
                || !packageInstituteRepository.existsLink(courseId, instituteId)) {
            throw new VacademyException("Course not found in this institute");
        }
        commerceLegacyGuard.refuseProduct(source, "duplicate");

        String userId = user == null ? null : user.getUserId();

        // Source batches, parents before their sub-batches, in a stable order.
        List<PackageSession> sourceBatches = packageSessionRepository.findByPackageEntityId(courseId).stream()
                .filter(ps -> ps.getStatus() != null && COPIED_BATCH_STATUSES.contains(ps.getStatus().toUpperCase()))
                .filter(ps -> ps.getLevel() != null && ps.getSession() != null)
                .sorted(Comparator.comparing((PackageSession ps) -> ps.getCreatedAt() == null ? 0L : ps.getCreatedAt().getTime())
                        .thenComparing(PackageSession::getId, Comparator.nullsLast(Comparator.naturalOrder())))
                .toList();

        AddCourseDTO dto = buildAddCourseDto(source, resolveName(requestedName, source.getPackageName()),
                packagePageContentService.getContentJson(courseId), userId);
        dto.setSessions(buildSessions(sourceBatches));
        dto.setContainLevels(!dto.getSessions().isEmpty());

        String newCourseId = courseService.addCourse(dto, user, instituteId);
        PackageEntity created = packageRepository.findById(newCourseId)
                .orElseThrow(() -> new VacademyException("Duplicated course was not saved"));
        // Course-wide drip rules live on the package row and are not part of the create payload.
        if (StringUtils.hasText(source.getDripConditionJson())) {
            created.setDripConditionJson(source.getDripConditionJson());
            packageRepository.save(created);
        }

        DuplicateCourseResponse response = DuplicateCourseResponse.builder()
                .courseId(newCourseId)
                .courseName(created.getPackageName())
                .warnings(new ArrayList<>())
                .build();

        List<PackageSession> newBatches = packageSessionRepository.findByPackageEntityId(newCourseId).stream()
                .filter(ps -> !PackageSessionStatusEnum.INVITED.name().equalsIgnoreCase(ps.getStatus()))
                .filter(ps -> ps.getLevel() != null && ps.getSession() != null)
                .toList();
        Map<PackageSession, PackageSession> pairs = pairBatches(sourceBatches, newBatches, response.getWarnings());

        boolean first = true;
        for (Map.Entry<PackageSession, PackageSession> pair : pairs.entrySet()) {
            PackageSession src = pair.getKey();
            PackageSession tgt = pair.getValue();
            tgt.setStatus(src.getStatus().toUpperCase());
            tgt.setStartTime(src.getStartTime());
            packageSessionRepository.save(tgt);

            CopyCourseContentResponse copied = courseContentCopyService.copy(
                    src.getId(), List.of(tgt.getId()), "VALUE", userId);
            response.setBatchesCopied(response.getBatchesCopied() + 1);
            if (copied != null) {
                response.setCopiedSubjects(response.getCopiedSubjects() + copied.getCopiedSubjects());
                response.setCopiedModules(response.getCopiedModules() + copied.getCopiedModules());
                response.setCopiedChapters(response.getCopiedChapters() + copied.getCopiedChapters());
                response.setCopiedSlides(response.getCopiedSlides() + copied.getCopiedSlides());
                if (copied.getWarnings() != null) {
                    response.getWarnings().addAll(copied.getWarnings());
                }
            }
            if (first) {
                response.setSessionId(tgt.getSession().getId());
                response.setLevelId(tgt.getLevel().getId());
                first = false;
            }
        }
        if (first && !newBatches.isEmpty()) {
            // Source had no batches: the create path made the default one. Open the course on it.
            response.setSessionId(newBatches.get(0).getSession().getId());
            response.setLevelId(newBatches.get(0).getLevel().getId());
        }

        log.info("Duplicated course {} into {} ({} batches, {} slides) by {}", courseId, newCourseId,
                response.getBatchesCopied(), response.getCopiedSlides(), userId);
        return response;
    }

    /**
     * A TEACHER without ADMIN may not duplicate: the copy is created ACTIVE, which would skip the
     * teacher course-approval flow (teachers use "Copy to edit", which makes a DRAFT). Same rule as
     * the dashboard, which hides the Duplicate button for a teacher who is not also an admin.
     */
    static void refuseTeacherOnly(CustomUserDetails user) {
        if (user == null || user.getAuthorities() == null) {
            return;
        }
        Set<String> names = new HashSet<>();
        for (GrantedAuthority authority : user.getAuthorities()) {
            if (authority != null && authority.getAuthority() != null) {
                names.add(authority.getAuthority().trim().toUpperCase());
            }
        }
        if (names.contains("TEACHER") && !names.contains("ADMIN")) {
            throw new ForbiddenException("Access denied: only institute admins can duplicate a course");
        }
    }

    /** "&lt;requested&gt;" when given, else "&lt;source&gt; (Copy)"; trimmed and capped below the column size. */
    static String resolveName(String requestedName, String sourceName) {
        String name = StringUtils.hasText(requestedName)
                ? requestedName.trim()
                : (StringUtils.hasText(sourceName) ? sourceName.trim() : "Course") + COPY_SUFFIX;
        return name.length() > MAX_NAME_LENGTH ? name.substring(0, MAX_NAME_LENGTH) : name;
    }

    /** The create-course payload for the copy: the source's course details, never its people or money. */
    static AddCourseDTO buildAddCourseDto(PackageEntity source, String name, String coursePageJson, String userId) {
        AddCourseDTO dto = new AddCourseDTO();
        dto.setNewCourse(true);
        // Never merge into an existing course that happens to carry this name.
        dto.setForceNewCourse(true);
        dto.setCourseName(name);
        dto.setThumbnailFileId(source.getThumbnailFileId());
        dto.setCoursePreviewImageMediaId(source.getCoursePreviewImageMediaId());
        dto.setCourseBannerMediaId(source.getCourseBannerMediaId());
        dto.setCourseMediaId(source.getCourseMediaId());
        dto.setWhyLearnHtml(source.getWhyLearn());
        dto.setWhoShouldLearnHtml(source.getWhoShouldLearn());
        dto.setAboutTheCourseHtml(source.getAboutTheCourse());
        dto.setCourseHtmlDescription(source.getCourseHtmlDescription());
        dto.setCourseDepth(source.getCourseDepth());
        dto.setCourseSetting(source.getCourseSetting());
        dto.setCoursePageJson(StringUtils.hasText(coursePageJson) ? coursePageJson : null);
        if (StringUtils.hasText(source.getTags())) {
            dto.setTags(Arrays.stream(source.getTags().split(","))
                    .map(String::trim)
                    .filter(StringUtils::hasText)
                    .collect(Collectors.toList()));
        }
        // A copy is a new course: unpublished from the catalogue, fresh status, version 1, no lineage
        // to the teacher-approval flow (original_course_id is that flow's "editable copy" marker).
        dto.setIsCoursePublishedToCatalaouge(false);
        dto.setStatus(null);
        dto.setVersionNumber(null);
        dto.setOriginalCourseId(null);
        dto.setCreatedByUserId(userId);
        dto.setAddFacultyToCourse(null);
        dto.setContainsSubgroup(false);
        dto.setSubgroups(null);
        return dto;
    }

    /**
     * One session entry per source session, each with one level entry per top-level source batch.
     * A source batch's sub-batches ride along as that level's subgroups (named children).
     */
    static List<AddNewSessionDTO> buildSessions(List<PackageSession> sourceBatches) {
        Map<String, List<PackageSession>> childrenByParent = new HashMap<>();
        for (PackageSession ps : sourceBatches) {
            if (StringUtils.hasText(ps.getParentId())) {
                childrenByParent.computeIfAbsent(ps.getParentId(), k -> new ArrayList<>()).add(ps);
            }
        }
        Set<String> sourceIds = sourceBatches.stream().map(PackageSession::getId).collect(Collectors.toSet());

        Map<String, AddNewSessionDTO> bySession = new LinkedHashMap<>();
        for (PackageSession ps : sourceBatches) {
            if (StringUtils.hasText(ps.getParentId()) && sourceIds.contains(ps.getParentId())) {
                continue; // created as a subgroup of its parent below
            }
            AddNewSessionDTO sessionDto = bySession.computeIfAbsent(ps.getSession().getId(), id -> {
                AddNewSessionDTO s = new AddNewSessionDTO();
                s.setId(id);
                s.setNewSession(false);
                s.setStartDate(ps.getSession().getStartDate());
                s.setLevels(new ArrayList<>());
                return s;
            });

            AddLevelWithSessionDTO level = new AddLevelWithSessionDTO();
            level.setId(ps.getLevel().getId());
            level.setNewLevel(false);
            level.setNewPackageSession(true);
            if (StringUtils.hasText(ps.getName())) {
                level.setBatchName(ps.getName());
            }
            if (ps.getGroup() != null && StringUtils.hasText(ps.getGroup().getId())) {
                AddGroupDTO group = new AddGroupDTO();
                group.setId(ps.getGroup().getId());
                group.setNewGroup(false);
                level.setGroup(group);
            }
            List<SubgroupDTO> subgroups = new ArrayList<>();
            for (PackageSession child : childrenByParent.getOrDefault(ps.getId(), List.of())) {
                if (!StringUtils.hasText(child.getName())) {
                    continue; // the create path cannot make an unnamed sub-batch; reported by pairBatches
                }
                SubgroupDTO sub = new SubgroupDTO();
                sub.setName(child.getName());
                subgroups.add(sub);
            }
            if (!subgroups.isEmpty()) {
                level.setSubgroups(subgroups);
            }
            sessionDto.getLevels().add(level);
        }
        return new ArrayList<>(bySession.values());
    }

    /**
     * Pair every source batch with the new batch the create path made for it, matched on
     * session + level + batch name (+ the parent's key for a sub-batch). Duplicate keys pair in
     * creation order. A source batch with no twin is reported as a warning and its content skipped.
     */
    static Map<PackageSession, PackageSession> pairBatches(List<PackageSession> sourceBatches,
                                                           List<PackageSession> newBatches,
                                                           List<String> warnings) {
        Map<String, Deque<PackageSession>> available = new HashMap<>();
        Map<String, PackageSession> newById = newBatches.stream()
                .collect(Collectors.toMap(PackageSession::getId, ps -> ps, (a, b) -> a));
        for (PackageSession ps : newBatches) {
            available.computeIfAbsent(keyOf(ps, newById), k -> new ArrayDeque<>()).add(ps);
        }

        Map<String, PackageSession> sourceById = sourceBatches.stream()
                .collect(Collectors.toMap(PackageSession::getId, ps -> ps, (a, b) -> a));
        Map<PackageSession, PackageSession> pairs = new LinkedHashMap<>();
        for (PackageSession src : sourceBatches) {
            Deque<PackageSession> candidates = available.get(keyOf(src, sourceById));
            PackageSession tgt = candidates == null ? null : candidates.pollFirst();
            if (tgt == null) {
                warnings.add("Batch '" + label(src) + "' could not be recreated, so its content was not copied.");
                continue;
            }
            pairs.put(src, tgt);
        }
        return pairs;
    }

    private static String keyOf(PackageSession ps, Map<String, PackageSession> sameCourseById) {
        String own = ps.getSession().getId() + "|" + ps.getLevel().getId() + "|" + normalisedName(ps);
        PackageSession parent = StringUtils.hasText(ps.getParentId()) ? sameCourseById.get(ps.getParentId()) : null;
        if (parent == null) {
            return own;
        }
        return parent.getSession().getId() + "|" + parent.getLevel().getId() + "|" + normalisedName(parent)
                + "#" + own;
    }

    private static String normalisedName(PackageSession ps) {
        return ps.getName() == null ? "" : ps.getName().trim();
    }

    private static String label(PackageSession ps) {
        String level = ps.getLevel() == null ? "" : ps.getLevel().getLevelName();
        String session = ps.getSession() == null ? "" : ps.getSession().getSessionName();
        String name = StringUtils.hasText(ps.getName()) ? ps.getName() + " - " : "";
        return name + level + " / " + session;
    }
}
