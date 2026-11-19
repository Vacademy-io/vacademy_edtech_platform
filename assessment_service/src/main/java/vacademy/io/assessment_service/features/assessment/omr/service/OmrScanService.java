package vacademy.io.assessment_service.features.assessment.omr.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import org.springframework.web.reactive.function.client.WebClient;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.InstituteFileOwnership;
import vacademy.io.assessment_service.features.assessment.dto.offline_entry.*;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.enums.ReleaseResultStatusEnum;
import vacademy.io.assessment_service.features.assessment.manager.AdminOfflineDataEntryManager;
import vacademy.io.assessment_service.features.assessment.omr.client.AiServiceOmrClient;
import vacademy.io.assessment_service.features.assessment.omr.client.AiServiceOmrClient.PageResult;
import vacademy.io.assessment_service.features.assessment.omr.dto.OmrDtos;
import vacademy.io.assessment_service.features.assessment.omr.dto.OmrSetJson;
import vacademy.io.assessment_service.features.assessment.omr.entity.OmrScanBatch;
import vacademy.io.assessment_service.features.assessment.omr.entity.OmrScanItem;
import vacademy.io.assessment_service.features.assessment.omr.layout.OmrSheetLayout;
import vacademy.io.assessment_service.features.assessment.omr.repository.OmrScanBatchRepository;
import vacademy.io.assessment_service.features.assessment.omr.repository.OmrScanItemRepository;
import vacademy.io.assessment_service.features.assessment.omr.service.OmrRollService.Participant;
import vacademy.io.assessment_service.features.assessment.omr.service.OmrRollService.RollIndex;
import vacademy.io.assessment_service.features.assessment.omr.service.OmrSetService.LoadedSet;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentUserRegistrationRepository;
import vacademy.io.assessment_service.features.assessment.service.StudentAttemptService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.*;

/**
 * Filled OMR sheets: from a pile of scans to graded, held attempts.
 *
 * <p>Same shape as the bulk copy intake (CopyIntakeService): start creates the batch
 * and one FILE row per upload and returns at once; {@link OmrScanRunner} does the rest
 * off the request thread. Every row carries its own state, every claim is an atomic
 * status change, and the batch keeps no counters - so two pods, or a sweep landing on
 * a running pass, share the work instead of doing it twice, and a redeploy mid-batch
 * resumes from the database.
 *
 * <p>The pipeline per upload: count its pages (FILE: PENDING -> COUNTING -> SPLIT, one
 * PENDING SHEET row per page), read the sheets in chunks with OMRChecker (SHEET:
 * PENDING -> READING), then place each sheet: match the bubbled roll number to a
 * participant and grade it, or park it as NEEDS_REVIEW with the reason. Placing runs
 * under an advisory lock per assessment, so two sheets bubbled with the same roll
 * number can never both become attempts.
 *
 * <p>Grading is the offline entry's: the bubbles are mapped to option ids through the
 * set's saved order and fed to {@link AdminOfflineDataEntryManager#applyResponses}, so
 * marks, negative marking and question_wise_marks are exactly those of any other
 * attempt. A question with two bubbles filled is sent as not attempted (0, no negative)
 * and flagged. Results stay held until the admin releases them (StudentAttemptService
 * never auto-releases an OMR-mode assessment).
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class OmrScanService {

    public static final int MAX_FILES_PER_BATCH = 300;
    public static final int MAX_PAGES_PER_FILE = 400;
    /** Pages per ai_service call (its own cap is 25). */
    static final int READ_CHUNK = 20;

    private static final List<String> IMAGE_EXTENSIONS = List.of(".jpg", ".jpeg", ".png");

    private final OmrScanBatchRepository batchRepository;
    private final OmrScanItemRepository itemRepository;
    private final AssessmentRepository assessmentRepository;
    private final AssessmentUserRegistrationRepository registrationRepository;
    private final OmrSetService setService;
    private final OmrRollService rollService;
    private final AiServiceOmrClient omrClient;
    private final AdminOfflineDataEntryManager offlineDataEntryManager;
    private final StudentAttemptService studentAttemptService;
    private final InstituteFileOwnership fileOwnership;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate tx;

    @PersistenceContext
    private EntityManager em;

    @Value("${media.service.baseurl}")
    private String mediaServiceUrl;

    @Value("${assessment.omr.stale-minutes:15}")
    private long staleMinutes;

    // ------------------------------------------------------------------ start

    @Transactional
    public OmrScanBatch start(CustomUserDetails user, String assessmentId, String instituteId,
                              OmrDtos.StartScanRequest request) {
        if (request == null || !StringUtils.hasText(request.getSetId())) {
            throw new VacademyException("Choose the set these sheets were printed for");
        }
        if (request.getFiles() == null || request.getFiles().isEmpty()) {
            throw new VacademyException("Upload at least one file");
        }
        if (request.getFiles().size() > MAX_FILES_PER_BATCH) {
            throw new VacademyException("At most " + MAX_FILES_PER_BATCH + " files per upload; split it");
        }
        Assessment assessment = assessmentRepository.findById(assessmentId)
                .orElseThrow(() -> new VacademyException("Assessment not found"));
        if (!Boolean.TRUE.equals(assessment.getOmrMode())) {
            throw new VacademyException("OMR mode is off for this assessment");
        }
        LoadedSet set = setService.requireSet(assessmentId, request.getSetId());
        setService.layoutFor(assessmentId, set);   // refuses a set printed with an older layout

        Set<String> seen = new HashSet<>();
        List<OmrDtos.UploadedFile> usable = new ArrayList<>();
        for (OmrDtos.UploadedFile f : request.getFiles()) {
            if (f != null && StringUtils.hasText(f.getFileId()) && seen.add(f.getFileId())) usable.add(f);
        }
        if (usable.isEmpty()) throw new VacademyException("No usable files in the upload");
        // Only the institute's own uploads (as copy intake, G12): each sheet becomes an
        // attempt on one of this exam's learners.
        List<String> foreign = fileOwnership.notOwnedBy(instituteId,
                usable.stream().map(OmrDtos.UploadedFile::getFileId).toList());
        if (!foreign.isEmpty()) {
            throw new VacademyException(foreign.size() == 1
                    ? "One of the files was not uploaded for this institute; upload it again from this page"
                    : foreign.size() + " of the files were not uploaded for this institute; upload them again from this page");
        }

        setService.lock(assessmentId);
        OmrScanBatch batch = batchRepository.save(OmrScanBatch.builder()
                .assessmentId(assessmentId).instituteId(instituteId).setId(set.row().getId())
                .status(OmrScanBatch.RUNNING).totalFiles(usable.size())
                .createdBy(user.getUserId()).createdByName(user.getFullName())
                .build());
        List<OmrScanItem> items = new ArrayList<>();
        for (OmrDtos.UploadedFile f : usable) {
            items.add(OmrScanItem.builder().batchId(batch.getId()).fileId(f.getFileId())
                    .fileName(f.getFileName()).status(OmrScanItem.PENDING).build());
        }
        itemRepository.saveAll(items);
        return batch;
    }

    // ----------------------------------------------------------------- counting

    public List<OmrScanItem> pendingFiles(String batchId) {
        return itemRepository.findByBatchIdAndStatus(batchId, OmrScanItem.PENDING).stream()
                .filter(i -> !i.isSheet()).toList();
    }

    public List<OmrScanItem> pendingSheets(String batchId) {
        return itemRepository.findByBatchIdAndStatus(batchId, OmrScanItem.PENDING).stream()
                .filter(OmrScanItem::isSheet).toList();
    }

    /** Count one uploaded file's pages and split it into one PENDING sheet per page. */
    public void split(String fileItemId) {
        if (itemRepository.transition(fileItemId, OmrScanItem.PENDING, OmrScanItem.COUNTING) == 0) return;
        OmrScanItem file = itemRepository.findById(fileItemId).orElse(null);
        if (file == null) return;
        String url = fileUrl(file.getFileId());
        if (url == null) {
            failFile(fileItemId, "media service returned no URL for the uploaded file");
            return;
        }
        int pages;
        try {
            pages = omrClient.countPages(url, kind(file.getFileName()));
        } catch (AiServiceOmrClient.OmrBusyException e) {
            itemRepository.transition(fileItemId, OmrScanItem.COUNTING, OmrScanItem.PENDING);
            throw e;
        } catch (Exception e) {
            failFile(fileItemId, "could not open the file: " + e.getMessage());
            return;
        }
        if (pages < 1) {
            failFile(fileItemId, "the file has no pages");
            return;
        }
        if (pages > MAX_PAGES_PER_FILE) {
            failFile(fileItemId, "the file has " + pages + " pages; split it into files of at most " + MAX_PAGES_PER_FILE);
            return;
        }
        tx.executeWithoutResult(status -> {
            OmrScanItem f = itemRepository.findById(fileItemId).orElseThrow();
            if (!OmrScanItem.COUNTING.equals(f.getStatus())) return;
            List<OmrScanItem> sheets = new ArrayList<>();
            for (int p = 1; p <= pages; p++) {
                sheets.add(OmrScanItem.builder().batchId(f.getBatchId()).parentItemId(f.getId())
                        .fileId(f.getFileId()).fileName(f.getFileName()).pageNo(p)
                        .status(OmrScanItem.PENDING).build());
            }
            itemRepository.saveAll(sheets);
            f.setStatus(OmrScanItem.SPLIT);
            itemRepository.save(f);
        });
    }

    // ------------------------------------------------------------------ reading

    /** Everything a pass needs to read and place the sheets of one batch, loaded once. */
    public record PassContext(OmrScanBatch batch, LoadedSet set, OmrSheetLayout layout, Map<String, Object> template,
                              RollIndex roll) {
    }

    public PassContext context(OmrScanBatch batch) {
        LoadedSet set = setService.requireSet(batch.getAssessmentId(), batch.getSetId());
        OmrSheetLayout layout = setService.layoutFor(batch.getAssessmentId(), set);
        RollIndex roll = rollService.build(batch.getAssessmentId(), batch.getInstituteId());
        return new PassContext(batch, set, layout, layout.toTemplate(), roll);
    }

    /**
     * Read up to {@link #READ_CHUNK} pending sheets of one file and place each. Sheets
     * another pass already claimed are skipped.
     */
    public void readChunk(PassContext ctx, List<OmrScanItem> chunk) {
        List<OmrScanItem> claimed = new ArrayList<>();
        for (OmrScanItem s : chunk) {
            if (itemRepository.transition(s.getId(), OmrScanItem.PENDING, OmrScanItem.READING) == 1) claimed.add(s);
        }
        if (claimed.isEmpty()) return;
        String fileId = claimed.get(0).getFileId();
        String url = fileUrl(fileId);
        if (url == null) {
            claimed.forEach(s -> failSheet(s.getId(), OmrScanItem.R_READ_ERROR, "media service returned no URL for the file"));
            return;
        }
        AiServiceOmrClient.ReadResponse response;
        try {
            response = omrClient.read(url, kind(claimed.get(0).getFileName()),
                    claimed.stream().map(OmrScanItem::getPageNo).toList(),
                    ctx.template(), OmrSheetLayout.markerSpec(), ctx.layout().readerLayout(),
                    "omr-" + ctx.batch().getId().substring(0, 8));
        } catch (AiServiceOmrClient.OmrBusyException e) {
            claimed.forEach(s -> itemRepository.transition(s.getId(), OmrScanItem.READING, OmrScanItem.PENDING));
            throw e;
        } catch (Exception e) {
            log.warn("[omr] read failed for batch {} file {}: {}", ctx.batch().getId(), fileId, e.getMessage());
            claimed.forEach(s -> failSheet(s.getId(), OmrScanItem.R_READ_ERROR, "could not read the page: " + e.getMessage()));
            return;
        }
        Map<Integer, PageResult> byPage = new HashMap<>();
        for (PageResult p : response.pages() == null ? List.<PageResult>of() : response.pages()) {
            if (p.pageNo() != null) byPage.put(p.pageNo(), p);
        }
        for (OmrScanItem s : claimed) {
            PageResult page = byPage.get(s.getPageNo());
            if (page == null) {
                failSheet(s.getId(), OmrScanItem.R_READ_ERROR, "the reader returned nothing for this page");
                continue;
            }
            try {
                tx.executeWithoutResult(status -> place(ctx, s.getId(), page));
            } catch (Exception e) {
                log.error("[omr] sheet {} could not be placed: {}", s.getId(), e.getMessage(), e);
                failSheet(s.getId(), OmrScanItem.R_READ_ERROR, "could not create the attempt: " + rootMessage(e));
            }
        }
    }

    /** Store what was read, then match and grade the sheet - or park it with the reason. One transaction. */
    private void place(PassContext ctx, String sheetId, PageResult page) {
        lockAssessment(ctx.batch().getAssessmentId());
        OmrScanItem sheet = itemRepository.findById(sheetId).orElse(null);
        if (sheet == null || !OmrScanItem.READING.equals(sheet.getStatus())) return;

        sheet.setSheetImageFileId(page.sheetFileId());
        sheet.setMarkedImageFileId(page.markedFileId());
        sheet.setNameCropFileId(page.nameCropFileId());
        if (!"READ".equals(page.status())) {
            sheet.setStatus(OmrScanItem.FAILED);
            sheet.setReasonCode("NO_MARKERS".equals(page.status()) ? OmrScanItem.R_NO_MARKERS : OmrScanItem.R_READ_ERROR);
            sheet.setReason("NO_MARKERS".equals(page.status())
                    ? "The four black corner squares could not be found. Rescan the whole sheet, flat and uncropped."
                    : "The page could not be read" + (page.error() != null ? ": " + page.error() : ""));
            itemRepository.save(sheet);
            return;
        }

        Map<String, String> values = page.values() == null ? Map.of() : page.values();
        Set<String> low = new HashSet<>(page.lowConfidence() == null ? List.of() : page.lowConfidence());
        OmrSetJson set = ctx.set().json();

        // Roll number
        int digits = set.getRollDigits();
        List<String> rollColumns = new ArrayList<>();
        boolean rollLow = false;
        for (int c = 0; c < digits; c++) {
            String label = OmrSheetLayout.rollLabel(c);
            rollColumns.add(values.getOrDefault(label, ""));
            rollLow |= low.contains(label);
        }
        sheet.setReadRoll(OmrRollService.display(rollColumns));
        sheet.setRollLowConfidence(rollLow);

        // Set code
        String readSet = ctx.layout().hasSetGrid() ? values.getOrDefault(OmrSheetLayout.SET_LABEL, "") : set.getSetCode();
        sheet.setReadSet(readSet);

        // Answers + flags, by printed question number
        Map<String, String> answers = new LinkedHashMap<>();
        Map<String, String> flags = new LinkedHashMap<>();
        for (OmrSetJson.Item item : set.getItems()) {
            String label = OmrSheetLayout.questionLabel(item.getNo());
            String v = values.getOrDefault(label, "");
            answers.put(String.valueOf(item.getNo()), v);
            if (v.length() > 1) flags.put(String.valueOf(item.getNo()), "MULTI");
            else if (low.contains(label)) flags.put(String.valueOf(item.getNo()), "LOW_CONFIDENCE");
        }
        sheet.setAnswersJson(json(answers));
        sheet.setFlagsJson(flags.isEmpty() ? null : json(flags));

        // Who is it?
        OmrRollService.ReadRoll roll = OmrRollService.normalizeRead(rollColumns, digits);
        Participant participant = roll.key() == null ? null : ctx.roll().byRoll().get(roll.key());
        if (roll.problem() != null) {
            park(sheet, roll.problem(), OmrScanItem.R_ROLL_BLANK.equals(roll.problem())
                    ? "The roll number is blank or has a blank digit"
                    : "A roll number digit has more than one bubble filled");
            return;
        }
        if (participant == null) {
            park(sheet, OmrScanItem.R_ROLL_UNMATCHED, "No participant has roll number " + roll.key());
            return;
        }
        sheet.setMatchedUserId(participant.userId());
        sheet.setMatchedName(participant.name());
        if (rollLow) {
            park(sheet, OmrScanItem.R_ROLL_LOW_CONFIDENCE, "A roll number bubble is faint or smudged; confirm it is "
                    + (participant.name() != null ? participant.name() : roll.key()));
            return;
        }
        if (ctx.layout().hasSetGrid()) {
            if (readSet.isEmpty()) {
                park(sheet, OmrScanItem.R_SET_BLANK, "The set bubble is blank");
                return;
            }
            if (!readSet.equals(set.getSetCode())) {
                park(sheet, OmrScanItem.R_SET_MISMATCH, "Set " + readSet + " is bubbled but this upload is for set "
                        + set.getSetCode());
                return;
            }
        }
        if (itemRepository.countGradedOnLearner(ctx.batch().getAssessmentId(), participant.userId(), sheet.getId()) > 0) {
            park(sheet, OmrScanItem.R_DUPLICATE_IN_BATCH, (participant.name() != null ? participant.name() : "This learner")
                    + " already has a graded OMR sheet on this assessment");
            return;
        }
        if (hasAttempt(ctx.batch().getAssessmentId(), participant.userId())) {
            park(sheet, OmrScanItem.R_ALREADY_HAS_ATTEMPT, (participant.name() != null ? participant.name() : "This learner")
                    + " already has an attempt on this assessment");
            return;
        }
        grade(ctx, sheet, participant, null);
    }

    /** Create the learner's attempt from the sheet and mark it GRADED. Runs inside a transaction. */
    private void grade(PassContext ctx, OmrScanItem sheet, Participant p, CustomUserDetails resolver) {
        String assessmentId = ctx.batch().getAssessmentId();
        OfflineAttemptCreateRequest create = null;
        String registrationId = p.registrationId();
        if (!StringUtils.hasText(registrationId)) {
            Optional<AssessmentUserRegistration> existing = registrationRepository.findTopByUserIdAndAssessmentId(p.userId(), assessmentId);
            if (existing.isPresent()) {
                registrationId = existing.get().getId();
            } else {
                create = OfflineAttemptCreateRequest.builder().userId(p.userId()).fullName(p.name()).email(p.email())
                        .batchId(p.batchId()).build();
            }
        }
        OfflineAttemptCreateResponse created = offlineDataEntryManager
                .createOfflineAttempt(resolver, assessmentId, registrationId, ctx.batch().getInstituteId(), create)
                .getBody();
        if (created == null || created.getAttemptId() == null) throw new VacademyException("attempt was not created");

        StudentAttempt attempt = studentAttemptService.getStudentAttemptById(created.getAttemptId())
                .orElseThrow(() -> new VacademyException("attempt vanished after creation"));
        attempt.setAssessmentSetMapping(ctx.set().row());
        Assessment assessment = attempt.getRegistration().getAssessment();
        offlineDataEntryManager.applyResponses(attempt, assessment,
                responses(ctx.set().json(), readMap(sheet.getAnswersJson()), readMap(sheet.getFixesJson())));
        if (StringUtils.hasText(sheet.getSheetImageFileId())) {
            offlineDataEntryManager.attachOfflineFiles(resolver, assessmentId, attempt.getId(), ctx.batch().getInstituteId(),
                    OfflineAttachmentsRequest.builder().studentFileId(sheet.getSheetImageFileId()).build());
        }

        sheet.setMatchedUserId(p.userId());
        sheet.setMatchedName(p.name());
        sheet.setRegistrationId(created.getRegistrationId());
        sheet.setAttemptId(created.getAttemptId());
        sheet.setStatus(OmrScanItem.GRADED);
        sheet.setReasonCode(null);
        sheet.setReason(null);
        itemRepository.save(sheet);
    }

    /**
     * The responses of one sheet in offline-entry form. A blank question and a question
     * with several bubbles both go in with no option: not attempted, no negative marks.
     * An admin's fix of a flagged question replaces what was read.
     */
    static OfflineResponseSubmitRequest responses(OmrSetJson set, Map<String, String> answers, Map<String, String> fixes) {
        Map<String, List<OfflineQuestionResponse>> bySection = new LinkedHashMap<>();
        for (OmrSetJson.Item item : set.getItems()) {
            String key = String.valueOf(item.getNo());
            String v = fixes.containsKey(key) ? fixes.get(key) : answers.getOrDefault(key, "");
            List<String> optionIds = new ArrayList<>();
            if (v != null && v.length() == 1) {
                int idx = v.charAt(0) - 'A';
                if (idx >= 0 && idx < item.getOptionIds().size()) optionIds.add(item.getOptionIds().get(idx));
            }
            bySection.computeIfAbsent(item.getSectionId(), k -> new ArrayList<>()).add(OfflineQuestionResponse.builder()
                    .questionId(item.getQuestionId()).type(OmrSetService.SUPPORTED_TYPE).optionIds(optionIds).build());
        }
        List<OfflineSectionResponse> sections = new ArrayList<>();
        bySection.forEach((sectionId, qs) -> sections.add(OfflineSectionResponse.builder()
                .sectionId(sectionId).questions(qs).build()));
        return OfflineResponseSubmitRequest.builder().sections(sections).build();
    }

    // -------------------------------------------------------------- admin acts

    /** The admin assigned a parked sheet to a learner (or confirmed the suggested one). */
    @Transactional
    public OmrScanItem resolve(CustomUserDetails user, String sheetId, OmrDtos.ResolveRequest request) {
        OmrScanItem sheet = requireSheet(sheetId);
        if (!OmrScanItem.NEEDS_REVIEW.equals(sheet.getStatus())) {
            throw new VacademyException("This sheet is not waiting for a decision (" + sheet.getStatus() + ")");
        }
        if (request == null || !StringUtils.hasText(request.getUserId())) throw new VacademyException("Pick a learner");
        OmrScanBatch batch = batchRepository.findById(sheet.getBatchId()).orElseThrow(() -> new VacademyException("Upload not found"));
        lockAssessment(batch.getAssessmentId());
        PassContext ctx = context(batch);
        Participant p = ctx.roll().byUserId(request.getUserId())
                .orElseThrow(() -> new VacademyException("That learner is not a participant of this assessment"));
        if (itemRepository.countGradedOnLearner(batch.getAssessmentId(), p.userId(), sheet.getId()) > 0) {
            throw new VacademyException((p.name() != null ? p.name() : "This learner")
                    + " already has a graded OMR sheet; skip one of the two sheets");
        }
        // An earlier non-OMR attempt (e.g. the learner opened the test online) parks a
        // sheet as ALREADY_HAS_ATTEMPT; the admin assigning it is the confirmation, and
        // the sheet becomes that learner's next attempt.
        sheet.setResolvedBy(user.getUserId());
        grade(ctx, sheet, p, user);
        reopen(batch);
        return sheet;
    }

    @Transactional
    public OmrScanItem skip(CustomUserDetails user, String itemId) {
        OmrScanItem item = itemRepository.findById(itemId).orElseThrow(() -> new VacademyException("Sheet not found"));
        if (!OmrScanItem.NEEDS_REVIEW.equals(item.getStatus()) && !OmrScanItem.FAILED.equals(item.getStatus())) {
            throw new VacademyException("Only a sheet waiting for review or a failed one can be skipped");
        }
        item.setStatus(OmrScanItem.SKIPPED);
        item.setResolvedBy(user.getUserId());
        return itemRepository.save(item);
    }

    /** Read a failed file or sheet again (after a transient error). */
    @Transactional
    public OmrScanItem retry(CustomUserDetails user, String itemId) {
        OmrScanItem item = itemRepository.findById(itemId).orElseThrow(() -> new VacademyException("Sheet not found"));
        if (!OmrScanItem.FAILED.equals(item.getStatus())) throw new VacademyException("Only a failed sheet can be retried");
        item.setStatus(OmrScanItem.PENDING);
        item.setReasonCode(null);
        item.setReason(null);
        item.setResolvedBy(user.getUserId());
        itemRepository.save(item);
        batchRepository.findById(item.getBatchId()).ifPresent(b -> {
            b.setStatus(OmrScanBatch.RUNNING);
            b.setCompletedAt(null);
            batchRepository.save(b);
        });
        return item;
    }

    /**
     * Set the intended option of flagged questions on a graded sheet and re-grade it.
     * Only questions the reader flagged can be changed: the review is read-only for
     * everything it was sure about.
     */
    @Transactional
    public OmrScanItem fixAnswers(CustomUserDetails user, String sheetId, OmrDtos.FixAnswersRequest request) {
        OmrScanItem sheet = requireSheet(sheetId);
        if (!OmrScanItem.GRADED.equals(sheet.getStatus()) || !StringUtils.hasText(sheet.getAttemptId())) {
            throw new VacademyException("Answers can be corrected only on a graded sheet");
        }
        if (request == null || request.getAnswers() == null || request.getAnswers().isEmpty()) {
            throw new VacademyException("Nothing to correct");
        }
        OmrScanBatch batch = batchRepository.findById(sheet.getBatchId()).orElseThrow(() -> new VacademyException("Upload not found"));
        LoadedSet set = setService.requireSet(batch.getAssessmentId(), batch.getSetId());
        Map<String, String> flags = readMap(sheet.getFlagsJson());
        Map<String, Integer> optionCount = new HashMap<>();
        set.json().getItems().forEach(i -> optionCount.put(String.valueOf(i.getNo()), i.getOptionIds().size()));

        Map<String, String> fixes = new LinkedHashMap<>(readMap(sheet.getFixesJson()));
        for (Map.Entry<String, String> e : request.getAnswers().entrySet()) {
            String no = e.getKey();
            if (!flags.containsKey(no)) {
                throw new VacademyException("Question " + no + " was read with confidence and cannot be changed here");
            }
            String letter = e.getValue() == null ? "" : e.getValue().trim().toUpperCase(Locale.ROOT);
            if (!letter.isEmpty() && (letter.length() != 1 || letter.charAt(0) - 'A' < 0
                    || letter.charAt(0) - 'A' >= optionCount.getOrDefault(no, 0))) {
                throw new VacademyException("Question " + no + " has no option " + letter);
            }
            fixes.put(no, letter);
        }

        StudentAttempt attempt = studentAttemptService.getStudentAttemptById(sheet.getAttemptId())
                .orElseThrow(() -> new VacademyException("Attempt not found"));
        if (ReleaseResultStatusEnum.RELEASED.name().equalsIgnoreCase(attempt.getReportReleaseStatus())) {
            throw new VacademyException("This learner's result is already released; it can no longer change here");
        }
        offlineDataEntryManager.applyResponses(attempt, attempt.getRegistration().getAssessment(),
                responses(set.json(), readMap(sheet.getAnswersJson()), fixes));
        // applyResponses rebuilt attempt_data from the answers; put the sheet back on it.
        if (StringUtils.hasText(sheet.getSheetImageFileId())) {
            offlineDataEntryManager.attachOfflineFiles(user, batch.getAssessmentId(), attempt.getId(), batch.getInstituteId(),
                    OfflineAttachmentsRequest.builder().studentFileId(sheet.getSheetImageFileId()).build());
        }
        sheet.setFixesJson(json(fixes));
        sheet.setResolvedBy(user.getUserId());
        return itemRepository.save(sheet);
    }

    // ---------------------------------------------------------------- settling

    /** Put sheets / files whose worker died back in the queue. */
    public void recoverStale(String batchId) {
        Date before = new Date(System.currentTimeMillis() - staleMinutes * 60_000);
        for (String status : List.of(OmrScanItem.READING, OmrScanItem.COUNTING)) {
            for (OmrScanItem i : itemRepository.findByBatchIdAndStatusAndUpdatedAtBefore(batchId, status, before)) {
                itemRepository.transition(i.getId(), status, OmrScanItem.PENDING);
            }
        }
    }

    /** Close the batch once nothing is left to read: NEEDS_REVIEW when a sheet waits for the admin. */
    @Transactional
    public void finalizeIfDone(String batchId) {
        OmrScanBatch batch = batchRepository.findById(batchId).orElse(null);
        if (batch == null) return;
        if (itemRepository.countByBatchIdAndStatusIn(batchId, OmrScanItem.ACTIVE) > 0) return;
        boolean waiting = itemRepository.countByBatchIdAndStatusIn(batchId, List.of(OmrScanItem.NEEDS_REVIEW)) > 0;
        String next = waiting ? OmrScanBatch.NEEDS_REVIEW : OmrScanBatch.COMPLETED;
        if (!next.equals(batch.getStatus())) {
            batch.setStatus(next);
            if (!waiting) batch.setCompletedAt(new Date());
            batchRepository.save(batch);
        }
    }

    public void noteBatchError(String batchId, String message) {
        batchRepository.findById(batchId).ifPresent(b -> {
            b.setErrorMessage(message);
            batchRepository.save(b);
        });
    }

    private void reopen(OmrScanBatch batch) {
        // A decision may settle the batch; finalizeIfDone (called by the controller) decides.
        if (OmrScanBatch.COMPLETED.equals(batch.getStatus())) {
            batch.setStatus(OmrScanBatch.NEEDS_REVIEW);
            batchRepository.save(batch);
        }
    }

    // -------------------------------------------------------------------- reads

    public Optional<OmrScanBatch> getBatch(String batchId) {
        return batchRepository.findById(batchId);
    }

    public Optional<OmrScanItem> getItem(String itemId) {
        return itemRepository.findById(itemId);
    }

    public List<OmrScanBatch> listBatches(String assessmentId, String instituteId) {
        return batchRepository.findByAssessmentIdAndInstituteIdOrderByCreatedAtDesc(assessmentId, instituteId);
    }

    @Transactional(readOnly = true)
    public OmrDtos.BatchDto toDto(OmrScanBatch batch, boolean withSheets) {
        List<OmrScanItem> items = itemRepository.findByBatchIdOrderByCreatedAtAscPageNoAsc(batch.getId());
        OmrDtos.Counts counts = new OmrDtos.Counts();
        List<OmrScanItem> sheets = new ArrayList<>();
        for (OmrScanItem i : items) {
            if (!i.isSheet()) {
                counts.setFiles(counts.getFiles() + 1);
                // A file not split yet is still being opened; a failed one shows as a failed row.
                if (OmrScanItem.ACTIVE.contains(i.getStatus())) counts.setReading(counts.getReading() + 1);
                if (OmrScanItem.FAILED.equals(i.getStatus())) {
                    counts.setFailed(counts.getFailed() + 1);
                    sheets.add(i);
                }
                if (OmrScanItem.SKIPPED.equals(i.getStatus())) counts.setSkipped(counts.getSkipped() + 1);
                continue;
            }
            sheets.add(i);
            counts.setSheets(counts.getSheets() + 1);
            switch (i.getStatus()) {
                case OmrScanItem.PENDING, OmrScanItem.READING -> counts.setReading(counts.getReading() + 1);
                case OmrScanItem.GRADED -> {
                    counts.setGraded(counts.getGraded() + 1);
                    if (StringUtils.hasText(i.getFlagsJson())) counts.setFlagged(counts.getFlagged() + 1);
                }
                case OmrScanItem.NEEDS_REVIEW -> counts.setNeedsReview(counts.getNeedsReview() + 1);
                case OmrScanItem.FAILED -> counts.setFailed(counts.getFailed() + 1);
                case OmrScanItem.SKIPPED -> counts.setSkipped(counts.getSkipped() + 1);
                default -> {
                }
            }
        }
        String setCode = null;
        try {
            setCode = setService.requireSet(batch.getAssessmentId(), batch.getSetId()).json().getSetCode();
        } catch (Exception ignored) {
            // a set replaced after the upload (cannot happen once locked, but never fail a read on it)
        }
        OmrDtos.BatchDto.BatchDtoBuilder dto = OmrDtos.BatchDto.builder()
                .id(batch.getId()).setId(batch.getSetId()).setCode(setCode).status(batch.getStatus())
                .totalFiles(batch.getTotalFiles()).counts(counts).createdByName(batch.getCreatedByName())
                .errorMessage(batch.getErrorMessage()).createdAt(batch.getCreatedAt()).completedAt(batch.getCompletedAt());
        if (withSheets) {
            Map<String, Double> marks = new HashMap<>();
            List<String> attemptIds = sheets.stream().map(OmrScanItem::getAttemptId).filter(StringUtils::hasText).toList();
            if (!attemptIds.isEmpty()) {
                for (StudentAttempt a : studentAttemptService.getStudentAttemptsByIds(attemptIds)) {
                    marks.put(a.getId(), a.getTotalMarks());
                }
            }
            dto.sheets(sheets.stream().map(i -> toDto(i, marks.get(i.getAttemptId()))).toList());
        }
        return dto.build();
    }

    public OmrDtos.SheetDto toDto(OmrScanItem i, Double marks) {
        return OmrDtos.SheetDto.builder()
                .id(i.getId()).fileName(i.getFileName()).pageNo(i.getPageNo()).status(i.getStatus())
                .reasonCode(i.getReasonCode()).reason(i.getReason())
                .sheetFileId(i.getSheetImageFileId()).markedFileId(i.getMarkedImageFileId())
                .nameCropFileId(i.getNameCropFileId())
                .readRoll(i.getReadRoll()).readSet(i.getReadSet()).rollLowConfidence(i.getRollLowConfidence())
                .answers(readMap(i.getAnswersJson())).flags(readMap(i.getFlagsJson())).fixes(readMap(i.getFixesJson()))
                .matchedUserId(i.getMatchedUserId()).matchedName(i.getMatchedName()).attemptId(i.getAttemptId())
                .marks(marks)
                .build();
    }

    /** Participants for the "assign learner" picker, with whether they already have a graded sheet. */
    @Transactional(readOnly = true)
    public List<OmrDtos.ParticipantDto> participants(String assessmentId, String instituteId) {
        RollIndex roll = rollService.build(assessmentId, instituteId);
        Set<String> withSheet = new HashSet<>();
        for (OmrScanBatch b : batchRepository.findByAssessmentIdAndInstituteIdOrderByCreatedAtDesc(assessmentId, instituteId)) {
            for (OmrScanItem i : itemRepository.findByBatchIdAndStatus(b.getId(), OmrScanItem.GRADED)) {
                if (i.getMatchedUserId() != null) withSheet.add(i.getMatchedUserId());
            }
        }
        return roll.participants().stream().map(p -> OmrDtos.ParticipantDto.builder()
                        .userId(p.userId()).name(p.name()).enrollmentNumber(p.enrollmentNumber())
                        .hasOmrSheet(withSheet.contains(p.userId())).build())
                .sorted(Comparator.comparing(d -> d.getName() == null ? "" : d.getName().toLowerCase(Locale.ROOT)))
                .toList();
    }

    // ------------------------------------------------------------------ helpers

    private OmrScanItem requireSheet(String sheetId) {
        OmrScanItem sheet = itemRepository.findById(sheetId).orElseThrow(() -> new VacademyException("Sheet not found"));
        if (!sheet.isSheet()) throw new VacademyException("Not a sheet");
        return sheet;
    }

    private boolean hasAttempt(String assessmentId, String userId) {
        return registrationRepository.findTopByUserIdAndAssessmentId(userId, assessmentId)
                .map(r -> r.getStudentAttempts() != null && !r.getStudentAttempts().isEmpty())
                .orElse(false);
    }

    /**
     * Serialise placing on one assessment (transaction-scoped Postgres advisory lock):
     * the duplicate checks above read before they write, and two sheets bubbled with
     * the same roll number may be placed by two threads or pods at the same moment.
     */
    private void lockAssessment(String assessmentId) {
        em.createNativeQuery("SELECT pg_advisory_xact_lock(hashtext(:k))")
                .setParameter("k", "omr:" + assessmentId).getSingleResult();
    }

    private void park(OmrScanItem sheet, String code, String reason) {
        sheet.setStatus(OmrScanItem.NEEDS_REVIEW);
        sheet.setReasonCode(code);
        sheet.setReason(reason);
        itemRepository.save(sheet);
    }

    private void failFile(String itemId, String reason) {
        itemRepository.findById(itemId).ifPresent(i -> {
            i.setStatus(OmrScanItem.FAILED);
            i.setReasonCode(OmrScanItem.R_READ_ERROR);
            i.setReason(reason);
            itemRepository.save(i);
        });
    }

    private void failSheet(String itemId, String code, String reason) {
        itemRepository.findById(itemId).ifPresent(i -> {
            i.setStatus(OmrScanItem.FAILED);
            i.setReasonCode(code);
            i.setReason(reason);
            itemRepository.save(i);
        });
    }

    static String kind(String fileName) {
        String n = fileName == null ? "" : fileName.toLowerCase(Locale.ROOT);
        return IMAGE_EXTENSIONS.stream().anyMatch(n::endsWith) ? "image" : "pdf";
    }

    private String fileUrl(String fileId) {
        try {
            String url = WebClient.builder()
                    .baseUrl(mediaServiceUrl)
                    .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                    .build()
                    .get()
                    .uri(b -> b.path("/media-service/public/get-public-url").queryParam("fileId", fileId).build())
                    .retrieve()
                    .bodyToMono(String.class)
                    .block();
            return StringUtils.hasText(url) ? url.replace("\"", "") : null;
        } catch (Exception e) {
            log.error("[omr] media-service failed for fileId={}: {}", fileId, e.getMessage());
            return null;
        }
    }

    private Map<String, String> readMap(String json) {
        if (!StringUtils.hasText(json)) return new LinkedHashMap<>();
        try {
            return objectMapper.readValue(json, new TypeReference<LinkedHashMap<String, String>>() {
            });
        } catch (Exception e) {
            return new LinkedHashMap<>();
        }
    }

    private String json(Object o) {
        try {
            return objectMapper.writeValueAsString(o);
        } catch (Exception e) {
            throw new VacademyException("Could not save the sheet: " + e.getMessage());
        }
    }

    private static String rootMessage(Throwable e) {
        Throwable t = e;
        while (t.getCause() != null && t.getCause() != t) t = t.getCause();
        return t.getMessage() != null ? t.getMessage() : t.getClass().getSimpleName();
    }
}
