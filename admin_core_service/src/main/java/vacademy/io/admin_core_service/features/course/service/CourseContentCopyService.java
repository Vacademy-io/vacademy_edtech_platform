package vacademy.io.admin_core_service.features.course.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.chapter.entity.Chapter;
import vacademy.io.admin_core_service.features.chapter.entity.ChapterPackageSessionMapping;
import vacademy.io.admin_core_service.features.chapter.entity.ChapterToSlides;
import vacademy.io.admin_core_service.features.chapter.repository.ChapterPackageSessionMappingRepository;
import vacademy.io.admin_core_service.features.chapter.repository.ChapterRepository;
import vacademy.io.admin_core_service.features.chapter.repository.ChapterToSlidesRepository;
import vacademy.io.admin_core_service.features.course.dto.CopyContentLineageResponse;
import vacademy.io.admin_core_service.features.course.dto.CopyCourseContentResponse;
import vacademy.io.admin_core_service.features.course_knowledge.service.ContentIndexMarker;
import vacademy.io.admin_core_service.features.course_knowledge.service.ContentIndexQueueWriter;
import vacademy.io.admin_core_service.features.module.entity.ModuleChapterMapping;
import vacademy.io.admin_core_service.features.module.entity.SubjectModuleMapping;
import vacademy.io.admin_core_service.features.module.repository.ModuleChapterMappingRepository;
import vacademy.io.admin_core_service.features.module.repository.ModuleRepository;
import vacademy.io.admin_core_service.features.module.repository.SubjectModuleMappingRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import vacademy.io.admin_core_service.features.slide.service.AssessmentSlideBatchRegistrationService;
import vacademy.io.admin_core_service.features.slide.service.SlideService;
import vacademy.io.admin_core_service.features.subject.entity.SubjectPackageSession;
import vacademy.io.admin_core_service.features.subject.repository.SubjectPackageSessionRepository;
import vacademy.io.admin_core_service.features.subject.repository.SubjectRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.institute.entity.module.Module;
import vacademy.io.common.institute.entity.session.PackageSession;
import vacademy.io.common.institute.entity.student.Subject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * Wizard-time content copy: deep-clones the entire content tree
 * (Subject → Module → Chapter → Slide + slide source rows) of one source
 * package_session into one or more target package_sessions.
 *
 * Self-contained — does not touch CourseApprovalService or its private clone
 * methods. Reuses {@link SlideService#copySlideSourceForSlide(Slide)} for the
 * slide-source deep copy (DocumentSlide / VideoSlide / QuizSlide / ...).
 *
 * After cloning, runs {@link DripConditionRemapper} to rewrite prerequisite-rule
 * id references in `drip_condition_json` so they point at the new ids inside
 * the cloned subtree.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class CourseContentCopyService {

    private final PackageSessionRepository packageSessionRepository;
    private final SubjectRepository subjectRepository;
    private final ModuleRepository moduleRepository;
    private final ChapterRepository chapterRepository;
    private final SlideRepository slideRepository;
    private final SubjectPackageSessionRepository subjectPackageSessionRepository;
    private final SubjectModuleMappingRepository subjectModuleMappingRepository;
    private final ModuleChapterMappingRepository moduleChapterMappingRepository;
    private final ChapterPackageSessionMappingRepository chapterPackageSessionMappingRepository;
    private final ChapterToSlidesRepository chapterToSlidesRepository;
    private final SlideService slideService;
    private final DripConditionRemapper dripConditionRemapper;
    private final AssessmentSlideBatchRegistrationService assessmentSlideBatchRegistrationService;
    private final ContentIndexMarker contentIndexMarker;

    /**
     * Mode dispatcher.
     *  - VALUE      => deep clone (new ids for every Subject/Module/Chapter/Slide
     *                  + slide source rows). Drip-condition prerequisite ids are
     *                  remapped to the new ids; out-of-scope refs are dropped
     *                  with surfaced warnings.
     *  - REFERENCE  => share rows. Only mapping rows are inserted
     *                  (subject_session, chapter_package_session_mapping). Edits
     *                  in either course are visible in both because they point
     *                  at the same Subject/Chapter/Slide rows. Drip rules carry
     *                  the source ids unchanged — that is correct for shared
     *                  content.
     */
    @Transactional
    public CopyCourseContentResponse copy(String sourcePackageSessionId,
                                          List<String> targetPackageSessionIds,
                                          String mode,
                                          String userId) {
        if (sourcePackageSessionId == null || sourcePackageSessionId.isBlank()) {
            throw new VacademyException("sourcePackageSessionId is required");
        }
        if (targetPackageSessionIds == null || targetPackageSessionIds.isEmpty()) {
            throw new VacademyException("targetPackageSessionIds must contain at least one id");
        }

        PackageSession sourcePs = packageSessionRepository.findById(sourcePackageSessionId)
                .orElseThrow(() -> new VacademyException("Source batch not found: " + sourcePackageSessionId));

        // Drop any duplicate target ids and the source itself if accidentally included.
        List<String> dedupedTargetIds = new ArrayList<>(new java.util.LinkedHashSet<>(targetPackageSessionIds));
        dedupedTargetIds.removeIf(id -> id == null || id.isBlank() || id.equals(sourcePackageSessionId));
        if (dedupedTargetIds.isEmpty()) {
            throw new VacademyException("No valid target batches after deduping with source");
        }

        List<PackageSession> targetPss = packageSessionRepository.findAllById(dedupedTargetIds);
        if (targetPss.size() != dedupedTargetIds.size()) {
            log.warn("Some target package_sessions were not found. Requested {}, loaded {}",
                    dedupedTargetIds.size(), targetPss.size());
        }
        if (targetPss.isEmpty()) {
            throw new VacademyException("No valid target batches found");
        }

        // Depth equality check across source vs every target.
        Integer sourceDepth = depthOf(sourcePs);
        for (PackageSession tgt : targetPss) {
            Integer tgtDepth = depthOf(tgt);
            if (!Objects.equals(sourceDepth, tgtDepth)) {
                throw new VacademyException(
                        "Source and target courses have different structure depth (source="
                                + sourceDepth + ", target=" + tgtDepth + "). "
                                + "Copy at the wizard level is only allowed between same-depth courses.");
            }
        }

        CopyCourseContentResponse response = CopyCourseContentResponse.builder()
                .warnings(new ArrayList<>())
                .build();

        boolean reference = isReferenceMode(mode);
        String auditMode = reference ? "REFERENCE" : "VALUE";
        for (PackageSession tgtPs : targetPss) {
            // Wipe out the wizard-seeded empty DEFAULT subject/module/chapter
            // chain BEFORE importing, so the imported content doesn't appear
            // alongside an empty placeholder (which manifests in the UI as
            // duplicate "Add Chapter" / "Add Module" buttons under each tree).
            cleanupEmptyDefaultStructure(tgtPs);

            if (reference) {
                referenceInto(sourcePs, tgtPs, response);
            } else {
                cloneInto(sourcePs, tgtPs, userId, response);
            }
            // Audit trail: stamp the target batch with the copy mode and source.
            // Last-write-wins if the same target is copied into more than once.
            tgtPs.setContentCopiedBy(auditMode);
            tgtPs.setContentCopiedFromPackageSessionId(sourcePs.getId());
            packageSessionRepository.save(tgtPs);
        }
        return response;
    }

    /**
     * Remove the wizard-seeded "DEFAULT" subject/module/chapter chain from a
     * target batch when it carries zero slides — i.e. it's still the placeholder
     * created by `add-course-form.handleStep2Submit`'s default-seeding branch
     * and the user hasn't added any real content under it yet.
     *
     * Scope is strictly per-target: only the SubjectPackageSession mapping for
     * this `tgtPs` is removed, plus the `chapter_package_session_mapping` rows
     * under it for this `tgtPs`. Subject / Module / Chapter rows themselves stay
     * intact so any other batch sharing them is unaffected.
     *
     * If the user has added even one slide under the DEFAULT chain, cleanup is
     * skipped — we never delete user-touched content.
     */
    private void cleanupEmptyDefaultStructure(PackageSession tgtPs) {
        List<Subject> subjects = subjectPackageSessionRepository
                .findDistinctSubjectsByPackageSessionId(tgtPs.getId());

        for (Subject subj : subjects) {
            String name = subj.getSubjectName();
            if (name == null || !"DEFAULT".equalsIgnoreCase(name.trim())) continue;

            if (subjectHasAnyActiveSlidesInBatch(subj.getId(), tgtPs.getId())) {
                // User added slides under DEFAULT. Don't touch.
                continue;
            }

            // Soft-delete chapter mappings for this target only (not the chapter rows).
            List<Module> modules = subjectModuleMappingRepository
                    .findModulesBySubjectIdAndPackageSessionId(subj.getId(), tgtPs.getId());
            for (Module mod : modules) {
                List<Chapter> chapters = moduleChapterMappingRepository
                        .findChaptersByModuleIdAndStatusNotDeleted(mod.getId(), tgtPs.getId());
                for (Chapter ch : chapters) {
                    Optional<ChapterPackageSessionMapping> mapping = chapterPackageSessionMappingRepository
                            .findByChapterIdAndPackageSessionIdAndStatusNotDeleted(
                                    ch.getId(), tgtPs.getId());
                    mapping.ifPresent(m -> {
                        m.setStatus("DELETED");
                        chapterPackageSessionMappingRepository.save(m);
                    });
                }
            }

            // Drop the SubjectPackageSession row for this target. The Subject
            // row itself stays in case it's referenced elsewhere (defensive).
            subjectPackageSessionRepository
                    .findBySubjectIdAndPackageSessionId(subj.getId(), tgtPs.getId())
                    .ifPresent(subjectPackageSessionRepository::delete);
        }
    }

    private boolean subjectHasAnyActiveSlidesInBatch(String subjectId, String packageSessionId) {
        List<Module> modules = subjectModuleMappingRepository
                .findModulesBySubjectIdAndPackageSessionId(subjectId, packageSessionId);
        for (Module mod : modules) {
            List<Chapter> chapters = moduleChapterMappingRepository
                    .findChaptersByModuleIdAndStatusNotDeleted(mod.getId(), packageSessionId);
            for (Chapter ch : chapters) {
                List<ChapterToSlides> links = chapterToSlidesRepository.findByChapterId(ch.getId());
                for (ChapterToSlides link : links) {
                    if (link.getStatus() == null || !"DELETED".equalsIgnoreCase(link.getStatus())) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    /**
     * Backward-compatible entry point — same semantics as
     * {@link #copy(String, List, String, String)} with mode = VALUE.
     */
    @Transactional
    public CopyCourseContentResponse copyByValue(String sourcePackageSessionId,
                                                 List<String> targetPackageSessionIds,
                                                 String userId) {
        return copy(sourcePackageSessionId, targetPackageSessionIds, "VALUE", userId);
    }

    /**
     * Build the content-copy lineage for a batch:
     *  - upstream: which batch (if any) seeded this one, and via which mode;
     *  - downstream: every batch that was later seeded from this one, with
     *    the mode each child used.
     *
     * Returns an empty (all-null/empty) response when the batch is unknown,
     * so the UI can render a neutral state without a 404.
     *
     * Fast path: when the batch has neither been seeded from another nor used
     * as a source by any child, both signals are checked cheaply (one column
     * read + one indexed EXISTS probe) and the method returns immediately. The
     * expensive joined fetches only run when there's actually something to
     * surface.
     */
    @Transactional(readOnly = true)
    public CopyContentLineageResponse getLineage(String packageSessionId) {
        if (packageSessionId == null || packageSessionId.isBlank()) {
            throw new VacademyException("packageSessionId is required");
        }

        CopyContentLineageResponse response = CopyContentLineageResponse.builder()
                .packageSessionId(packageSessionId)
                .copiedTo(new ArrayList<>())
                .build();

        Optional<PackageSession> selfOpt = packageSessionRepository.findById(packageSessionId);
        if (selfOpt.isEmpty()) {
            return response;
        }
        PackageSession self = selfOpt.get();
        response.setCopiedBy(self.getContentCopiedBy());

        String sourceId = self.getContentCopiedFromPackageSessionId();
        boolean hasUpstream = sourceId != null && !sourceId.isBlank();
        boolean hasDownstream =
                packageSessionRepository.existsByContentCopiedFromPackageSessionId(packageSessionId);

        // Fast path: vanilla batch with no copy history in either direction.
        // Skip the joined fetches entirely — most batches in any institute fall
        // into this bucket, and the UI badge will render nothing anyway.
        if (!hasUpstream && !hasDownstream) {
            return response;
        }

        // Upstream: the batch this one was seeded from (if any). Source rows
        // may have been deleted later — we recorded the id but not as a FK, so
        // a missing source is expected and tolerated. Joined fetch avoids the
        // three lazy-init queries on package / session / level.
        if (hasUpstream) {
            packageSessionRepository.findByIdWithRelations(sourceId).ifPresent(source ->
                    response.setCopiedFrom(toBatchRef(source, self.getContentCopiedBy()))
            );
        }

        // Downstream: indexed lookup that also joins package/session/level in
        // one round-trip, so building N BatchRefs no longer fans out to 3N
        // lazy SELECTs.
        if (hasDownstream) {
            List<PackageSession> children =
                    packageSessionRepository.findChildrenForLineage(packageSessionId);
            List<CopyContentLineageResponse.BatchRef> childRefs = new ArrayList<>(children.size());
            for (PackageSession child : children) {
                // Skip soft-deleted batches so the audit view does not surface them.
                if (child.getStatus() != null && "DELETED".equalsIgnoreCase(child.getStatus())) {
                    continue;
                }
                childRefs.add(toBatchRef(child, child.getContentCopiedBy()));
            }
            response.setCopiedTo(childRefs);
        }
        return response;
    }

    private CopyContentLineageResponse.BatchRef toBatchRef(PackageSession ps, String copiedBy) {
        PackageEntity pkg = ps.getPackageEntity();
        return CopyContentLineageResponse.BatchRef.builder()
                .packageSessionId(ps.getId())
                .courseId(pkg == null ? null : pkg.getId())
                .courseName(pkg == null ? null : pkg.getPackageName())
                .sessionName(ps.getSession() == null ? null : ps.getSession().getSessionName())
                .levelName(ps.getLevel() == null ? null : ps.getLevel().getLevelName())
                .copiedBy(copiedBy)
                .build();
    }

    private boolean isReferenceMode(String mode) {
        if (mode == null) return false;
        return "REFERENCE".equalsIgnoreCase(mode.trim());
    }

    private Integer depthOf(PackageSession ps) {
        PackageEntity pkg = ps.getPackageEntity();
        if (pkg == null) {
            throw new VacademyException("Package not bound on package_session " + ps.getId());
        }
        return pkg.getCourseDepth();
    }

    /** Clone the full subtree of `sourcePs` into `tgtPs`. */
    private void cloneInto(PackageSession sourcePs,
                           PackageSession tgtPs,
                           String userId,
                           CopyCourseContentResponse response) {
        Map<String, String> chapterIdMap = new HashMap<>();
        Map<String, String> slideIdMap = new HashMap<>();

        List<Subject> sourceSubjects = subjectPackageSessionRepository
                .findDistinctSubjectsByPackageSessionId(sourcePs.getId());

        // Courses that hide the subject level (course_depth < 5: depths 2, 3, 4)
        // must carry EXACTLY ONE subject (the wizard "DEFAULT"). If we minted a
        // fresh subject per source subject here, a target that already has
        // content (so cleanupEmptyDefaultStructure left its DEFAULT in place)
        // would end up with two subjects. On the outline that surfaces as
        // duplicate "Add Module"/"Add Chapter" buttons, and it breaks drag
        // because each subject is its own dnd-kit Sortable context (children
        // can't be dragged across subjects, and a lone one has nothing to
        // reorder against). So for these depths we clone every source module
        // into the target's single subject instead of creating another one.
        if (isSingleSubjectStructure(tgtPs)) {
            cloneIntoSingleSubject(sourcePs, tgtPs, sourceSubjects, userId,
                    chapterIdMap, slideIdMap, response);
        } else {
            Integer baseSubjectOrder = subjectPackageSessionRepository
                    .findMaxSubjectOrderByPackageSessionId(tgtPs.getId());
            int subjectOrder = baseSubjectOrder == null ? 0 : baseSubjectOrder + 1;

            for (Subject sourceSubject : sourceSubjects) {
                // 1. New subject row (lineage via parent_id)
                Subject newSubject = subjectRepository.save(cloneSubjectEntity(sourceSubject, userId));
                response.incrementSubjects();

                // 2. Subject -> target package_session mapping
                subjectPackageSessionRepository.save(
                        new SubjectPackageSession(newSubject, tgtPs, subjectOrder++));

                // 3. Modules under this subject in the source batch
                List<Module> sourceModules = subjectModuleMappingRepository
                        .findModulesBySubjectIdAndPackageSessionId(sourceSubject.getId(), sourcePs.getId());

                int moduleOrder = 0;
                for (Module sourceModule : sourceModules) {
                    cloneModuleInto(sourceModule, sourcePs, tgtPs, newSubject, moduleOrder++,
                            userId, chapterIdMap, slideIdMap, response);
                }
            }
        }

        // After the full subtree is in place, rewrite drip-condition prerequisite ids.
        List<String> remapWarnings = dripConditionRemapper.remap(chapterIdMap, slideIdMap);
        response.addWarnings(remapWarnings);
    }

    /**
     * Depth-4 (subject level hidden) variant of {@link #cloneInto}: clone every
     * source module into the target's single subject rather than creating a new
     * subject per source subject.
     *
     * Destination subject resolution:
     *  - reuse the target's existing subject if one is mapped (the DEFAULT that
     *    {@code cleanupEmptyDefaultStructure} left in place because it already
     *    holds user content);
     *  - otherwise create exactly one subject (cloned from the first source
     *    subject) and map it to the target.
     *
     * New modules are appended after any the destination subject already has, so
     * imported content lands below the user's existing modules.
     */
    private void cloneIntoSingleSubject(PackageSession sourcePs,
                                        PackageSession tgtPs,
                                        List<Subject> sourceSubjects,
                                        String userId,
                                        Map<String, String> chapterIdMap,
                                        Map<String, String> slideIdMap,
                                        CopyCourseContentResponse response) {
        Subject destSubject = subjectPackageSessionRepository
                .findDistinctSubjectsByPackageSessionId(tgtPs.getId())
                .stream().findFirst().orElse(null);

        if (destSubject == null) {
            if (sourceSubjects.isEmpty()) {
                return; // nothing to copy
            }
            // No subject mapped on the target (empty DEFAULT was cleaned up, or a
            // fresh batch): create exactly one and reuse it for every module.
            destSubject = subjectRepository.save(cloneSubjectEntity(sourceSubjects.get(0), userId));
            Integer baseSubjectOrder = subjectPackageSessionRepository
                    .findMaxSubjectOrderByPackageSessionId(tgtPs.getId());
            int subjectOrder = baseSubjectOrder == null ? 0 : baseSubjectOrder + 1;
            subjectPackageSessionRepository.save(
                    new SubjectPackageSession(destSubject, tgtPs, subjectOrder));
            response.incrementSubjects();
        }

        // Append after the destination subject's existing modules.
        Integer maxModuleOrder = subjectModuleMappingRepository
                .findMaxModuleOrderBySubjectId(destSubject.getId());
        int moduleOrder = maxModuleOrder == null ? 0 : maxModuleOrder + 1;

        for (Subject sourceSubject : sourceSubjects) {
            List<Module> sourceModules = subjectModuleMappingRepository
                    .findModulesBySubjectIdAndPackageSessionId(sourceSubject.getId(), sourcePs.getId());
            for (Module sourceModule : sourceModules) {
                cloneModuleInto(sourceModule, sourcePs, tgtPs, destSubject, moduleOrder++,
                        userId, chapterIdMap, slideIdMap, response);
            }
        }
    }

    /**
     * Clone a single source module (with its chapters, slides and slide source
     * rows) under {@code destSubject} in {@code tgtPs}. Shared by the normal
     * multi-subject path and the depth-4 single-subject path.
     */
    private void cloneModuleInto(Module sourceModule,
                                 PackageSession sourcePs,
                                 PackageSession tgtPs,
                                 Subject destSubject,
                                 int moduleOrder,
                                 String userId,
                                 Map<String, String> chapterIdMap,
                                 Map<String, String> slideIdMap,
                                 CopyCourseContentResponse response) {
        Module newModule = moduleRepository.save(cloneModuleEntity(sourceModule, userId));
        response.incrementModules();

        subjectModuleMappingRepository.save(
                new SubjectModuleMapping(destSubject, newModule, moduleOrder));

        // Chapters under this module in the source batch
        List<Chapter> sourceChapters = moduleChapterMappingRepository
                .findChaptersByModuleIdAndStatusNotDeleted(sourceModule.getId(), sourcePs.getId());

        for (Chapter sourceChapter : sourceChapters) {
            Chapter newChapter = chapterRepository.save(cloneChapterEntity(sourceChapter, userId));
            response.incrementChapters();
            chapterIdMap.put(sourceChapter.getId(), newChapter.getId());

            moduleChapterMappingRepository.save(
                    new ModuleChapterMapping(newChapter, newModule));

            // Chapter -> target package_session mapping (preserve order if known)
            Optional<ChapterPackageSessionMapping> srcMapping = chapterPackageSessionMappingRepository
                    .findByChapterIdAndPackageSessionIdAndStatusNotDeleted(
                            sourceChapter.getId(), sourcePs.getId());
            Integer chapterOrder = srcMapping.map(ChapterPackageSessionMapping::getChapterOrder).orElse(null);
            if (chapterOrder == null) {
                Integer max = chapterPackageSessionMappingRepository
                        .findMaxChapterOrderByPackageSessionId(tgtPs.getId());
                chapterOrder = (max == null) ? 1 : max + 1;
            }
            chapterPackageSessionMappingRepository.save(
                    new ChapterPackageSessionMapping(newChapter, tgtPs, chapterOrder));

            // Slides + slide source content
            cloneSlidesOfChapter(sourceChapter, newChapter, userId, slideIdMap, response);

            // The cloned slides keep the same assessmentId; register that
            // assessment to the target batch so it shows for those learners.
            assessmentSlideBatchRegistrationService
                    .registerChapterAssessmentsToBatches(newChapter.getId(), List.of(tgtPs.getId()));
        }
    }

    /**
     * True when the target's course structure hides the subject level — course
     * depth < 5 (depths 2, 3 and 4) — meaning it must carry exactly one subject.
     * (Depth 5 shows the subject level and legitimately has many subjects.)
     */
    private boolean isSingleSubjectStructure(PackageSession tgtPs) {
        Integer depth = depthOf(tgtPs);
        return depth != null && depth < 5;
    }

    /**
     * REFERENCE mode: insert mapping rows so the target package_session points
     * at the SAME Subject/Chapter/Slide rows the source does. No new content
     * rows are written. Module rows ride along via subject_module_mapping
     * (which is keyed only on subject + module — once the subject is shared,
     * its modules are visible automatically). Slides ride along via
     * chapter_to_slides (keyed on chapter_id) — once the chapter is shared,
     * its slides are visible automatically.
     *
     * Idempotent: if a mapping already exists (e.g. because the user runs the
     * copy a second time), it is skipped rather than duplicated.
     *
     * Deliberately not marked for course knowledge re-indexing: sharing rows
     * changes only who can reach a lesson, never its content, and access is
     * resolved at query time.
     */
    private void referenceInto(PackageSession sourcePs,
                               PackageSession tgtPs,
                               CopyCourseContentResponse response) {
        List<Subject> sourceSubjects = subjectPackageSessionRepository
                .findDistinctSubjectsByPackageSessionId(sourcePs.getId());

        Integer baseSubjectOrder = subjectPackageSessionRepository
                .findMaxSubjectOrderByPackageSessionId(tgtPs.getId());
        int subjectOrder = baseSubjectOrder == null ? 0 : baseSubjectOrder + 1;

        for (Subject sourceSubject : sourceSubjects) {
            // 1. subject_session row (target_ps -> existing subject id)
            boolean subjectAlreadyMapped = subjectPackageSessionRepository
                    .findBySubjectIdAndPackageSessionId(sourceSubject.getId(), tgtPs.getId())
                    .isPresent();
            if (!subjectAlreadyMapped) {
                subjectPackageSessionRepository.save(
                        new SubjectPackageSession(sourceSubject, tgtPs, subjectOrder++));
            }
            response.incrementSubjects();

            // 2. Modules visible through this subject in the source batch.
            //    No new rows needed (subject_module_mapping is shared globally
            //    once the subject is shared) — we only count for UX feedback.
            List<Module> sourceModules = subjectModuleMappingRepository
                    .findModulesBySubjectIdAndPackageSessionId(sourceSubject.getId(), sourcePs.getId());

            for (Module sourceModule : sourceModules) {
                response.incrementModules();

                // 3. Chapters visible under this module in the source batch.
                List<Chapter> sourceChapters = moduleChapterMappingRepository
                        .findChaptersByModuleIdAndStatusNotDeleted(sourceModule.getId(), sourcePs.getId());

                for (Chapter sourceChapter : sourceChapters) {
                    boolean chapterAlreadyMapped = chapterPackageSessionMappingRepository
                            .findByChapterIdAndPackageSessionIdAndStatusNotDeleted(
                                    sourceChapter.getId(), tgtPs.getId())
                            .isPresent();
                    if (!chapterAlreadyMapped) {
                        Optional<ChapterPackageSessionMapping> srcMapping = chapterPackageSessionMappingRepository
                                .findByChapterIdAndPackageSessionIdAndStatusNotDeleted(
                                        sourceChapter.getId(), sourcePs.getId());
                        Integer chapterOrder = srcMapping
                                .map(ChapterPackageSessionMapping::getChapterOrder).orElse(null);
                        if (chapterOrder == null) {
                            Integer max = chapterPackageSessionMappingRepository
                                    .findMaxChapterOrderByPackageSessionId(tgtPs.getId());
                            chapterOrder = (max == null) ? 1 : max + 1;
                        }
                        chapterPackageSessionMappingRepository.save(
                                new ChapterPackageSessionMapping(sourceChapter, tgtPs, chapterOrder));
                    }
                    response.incrementChapters();

                    // Slides ride along via chapter_to_slides — count for UX.
                    int slideCount = chapterToSlidesRepository
                            .findByChapterId(sourceChapter.getId())
                            .size();
                    response.incrementSlides(slideCount);

                    // The shared chapter (and its assessment slides) is now also
                    // visible to tgtPs — register its assessments to that batch.
                    assessmentSlideBatchRegistrationService
                            .registerChapterAssessmentsToBatches(sourceChapter.getId(), List.of(tgtPs.getId()));
                }
            }
        }
    }

    private void cloneSlidesOfChapter(Chapter sourceChapter,
                                      Chapter newChapter,
                                      String userId,
                                      Map<String, String> slideIdMap,
                                      CopyCourseContentResponse response) {
        List<ChapterToSlides> sourceLinks = chapterToSlidesRepository.findByChapterId(sourceChapter.getId());
        if (sourceLinks == null || sourceLinks.isEmpty()) return;

        // Sort into the rendered order (slide_order, then slide.created_at DESC) and
        // stamp a fresh sequential slide_order below, so the clone preserves the
        // source's visible order. Clones share one batch-insert created_at, so without
        // a unique slide_order a slide_order=0 chapter would copy in arbitrary order.
        sourceLinks = new ArrayList<>(sourceLinks);
        sourceLinks.sort(SlideService.renderOrderComparator());

        // First persist the new Slide rows (so they're managed) without source ids.
        List<Slide> newSlides = new ArrayList<>(sourceLinks.size());
        for (ChapterToSlides link : sourceLinks) {
            Slide oldSlide = link.getSlide();
            if (oldSlide == null) continue;
            newSlides.add(cloneSlideShell(oldSlide, userId));
        }
        List<Slide> persistedSlides = slideRepository.saveAll(newSlides);

        // Now deep-clone the source row (DocumentSlide / VideoSlide / Quiz / ...) per slide.
        List<ChapterToSlides> newLinks = new ArrayList<>(sourceLinks.size());
        for (int i = 0; i < sourceLinks.size(); i++) {
            ChapterToSlides oldLink = sourceLinks.get(i);
            Slide oldSlide = oldLink.getSlide();
            Slide newSlide = persistedSlides.get(i);
            if (oldSlide == null || newSlide == null) continue;

            String newSourceId = slideService.copySlideSourceForSlide(oldSlide);
            newSlide.setSourceId(newSourceId);

            slideIdMap.put(oldSlide.getId(), newSlide.getId());
            // slide_order = position in the sorted (rendered) order so the clone is
            // deterministic and preserves the source's visible slide order.
            newLinks.add(new ChapterToSlides(newChapter, newSlide,
                    i, oldLink.getStatus()));
        }
        slideRepository.saveAll(persistedSlides);
        chapterToSlidesRepository.saveAll(newLinks);
        response.incrementSlides(newLinks.size());
        contentIndexMarker.markAll(newLinks.stream()
                .map(l -> new ContentIndexQueueWriter.Mark(l.getSlide().getId(), newChapter.getId()))
                .toList(), "COURSE_CONTENT_COPIED");
    }

    // ---- entity cloning helpers (private; keep all field copies in one place) ----

    private Subject cloneSubjectEntity(Subject src, String userId) {
        Subject c = new Subject();
        c.setSubjectName(src.getSubjectName());
        c.setSubjectCode(src.getSubjectCode());
        c.setCredit(src.getCredit());
        c.setStatus(src.getStatus());
        c.setThumbnailId(src.getThumbnailId());
        c.setParentId(src.getId());
        c.setCreatedByUserId(userId);
        return c;
    }

    private Module cloneModuleEntity(Module src, String userId) {
        Module c = new Module();
        c.setModuleName(src.getModuleName());
        c.setStatus(src.getStatus());
        c.setDescription(src.getDescription());
        c.setThumbnailId(src.getThumbnailId());
        c.setParentId(src.getId());
        c.setCreatedByUserId(userId);
        return c;
    }

    private Chapter cloneChapterEntity(Chapter src, String userId) {
        Chapter c = new Chapter();
        c.setChapterName(src.getChapterName());
        c.setStatus(src.getStatus());
        c.setFileId(src.getFileId());
        c.setDescription(src.getDescription());
        c.setParentId(src.getId());
        c.setCreatedByUserId(userId);
        // drip_condition_json copied verbatim; remap pass rewrites prerequisite ids afterward.
        c.setDripConditionJson(src.getDripConditionJson());
        return c;
    }

    private Slide cloneSlideShell(Slide src, String userId) {
        Slide c = new Slide();
        c.setId(UUID.randomUUID().toString());
        c.setTitle(src.getTitle());
        c.setStatus(src.getStatus());
        c.setImageFileId(src.getImageFileId());
        c.setSourceType(src.getSourceType());
        c.setDescription(src.getDescription());
        c.setParentId(src.getId());
        c.setCreatedByUserId(userId);
        c.setDripConditionJson(src.getDripConditionJson());
        // sourceId is set after slideService.copySlideSourceForSlide(...).
        return c;
    }
}
