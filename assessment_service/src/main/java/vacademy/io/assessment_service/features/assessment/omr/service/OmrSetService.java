package vacademy.io.assessment_service.features.assessment.omr.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentSetMapping;
import vacademy.io.assessment_service.features.assessment.enums.AssessmentSetStatusEnum;
import vacademy.io.assessment_service.features.assessment.omr.dto.OmrConfig;
import vacademy.io.assessment_service.features.assessment.omr.dto.OmrDtos;
import vacademy.io.assessment_service.features.assessment.omr.dto.OmrSetJson;
import vacademy.io.assessment_service.features.assessment.omr.layout.OmrSheetLayout;
import vacademy.io.assessment_service.features.assessment.omr.layout.OmrSheetPdfRenderer;
import vacademy.io.assessment_service.features.assessment.omr.repository.OmrScanBatchRepository;
import vacademy.io.assessment_service.features.assessment.omr.service.OmrPaperLoader.PaperQuestion;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentSetMappingRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.*;

/**
 * OMR settings and paper sets of an assessment.
 *
 * <p>A set is generated once and saved (assessment_set_mapping.json, see
 * {@link OmrSetJson}); everything after that - the question paper and answer key the
 * dashboard renders, the OMR sheet PDF, the reading and grading of every scan - works
 * from the saved set and never re-derives it from the live assessment. Set A keeps the
 * authored order; the other sets shuffle questions and/or options with a seed that is
 * stored on the set, so a set is reproducible and explainable.
 *
 * <p>Once the first scan of the assessment is uploaded the sets are locked: changing
 * them then would change what an already printed and filled sheet means.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class OmrSetService {

    public static final String SUPPORTED_TYPE = "MCQS";

    private final AssessmentRepository assessmentRepository;
    private final AssessmentSetMappingRepository setRepository;
    private final OmrScanBatchRepository scanBatchRepository;
    private final OmrPaperLoader paperLoader;
    private final OmrRollService rollService;
    private final ObjectMapper objectMapper;

    // ----------------------------------------------------------------- config

    public OmrConfig config(Assessment assessment) {
        if (!StringUtils.hasText(assessment.getOmrConfig())) {
            return OmrConfig.builder().setCount(1).shuffleQuestions(true).shuffleOptions(false).build();
        }
        try {
            return objectMapper.readValue(assessment.getOmrConfig(), OmrConfig.class);
        } catch (Exception e) {
            log.warn("[omr] unreadable omr_config on assessment {}: {}", assessment.getId(), e.getMessage());
            return OmrConfig.builder().setCount(1).shuffleQuestions(true).shuffleOptions(false).build();
        }
    }

    public boolean isLocked(Assessment assessment) {
        return config(assessment).getLockedAt() != null || scanBatchRepository.existsByAssessmentId(assessment.getId());
    }

    @Transactional
    public OmrDtos.OverviewDto saveConfig(String assessmentId, OmrDtos.ConfigRequest request) {
        Assessment assessment = requireAssessment(assessmentId);
        requireUnlocked(assessment);
        if (request == null) throw new VacademyException("Invalid Request");
        OmrConfig cfg = config(assessment);
        if (request.getSetCount() != null) {
            if (request.getSetCount() < 1 || request.getSetCount() > OmrSheetLayout.MAX_SETS) {
                throw new VacademyException("Choose 1 to " + OmrSheetLayout.MAX_SETS + " sets");
            }
            cfg.setSetCount(request.getSetCount());
        }
        if (request.getShuffleQuestions() != null) cfg.setShuffleQuestions(request.getShuffleQuestions());
        if (request.getShuffleOptions() != null) cfg.setShuffleOptions(request.getShuffleOptions());
        writeConfig(assessment, cfg);
        return overview(assessmentId);
    }

    // --------------------------------------------------------------- overview

    @Transactional(readOnly = true)
    public OmrDtos.OverviewDto overview(String assessmentId) {
        Assessment assessment = requireAssessment(assessmentId);
        List<PaperQuestion> paper = paperLoader.load(assessmentId);
        List<OmrDtos.SetDto> sets = new ArrayList<>();
        for (LoadedSet s : loadSets(assessmentId)) {
            sets.add(OmrDtos.SetDto.builder()
                    .id(s.row().getId()).setCode(s.json().getSetCode())
                    .questionCount(s.json().getItems() == null ? 0 : s.json().getItems().size())
                    .density(s.json().getDensity()).rollDigits(s.json().getRollDigits())
                    .createdAt(s.row().getCreatedAt()).build());
        }
        return OmrDtos.OverviewDto.builder()
                .omrMode(Boolean.TRUE.equals(assessment.getOmrMode()))
                .config(config(assessment))
                .locked(isLocked(assessment))
                .questionCount(paper.size())
                .paperIssues(paperIssues(paper))
                .sets(sets)
                .build();
    }

    /** Why this paper cannot be printed as an OMR sheet; empty when it can. */
    public static List<String> paperIssues(List<PaperQuestion> paper) {
        List<String> issues = new ArrayList<>();
        if (paper.isEmpty()) {
            issues.add("The assessment has no questions yet");
            return issues;
        }
        if (paper.size() > OmrSheetLayout.MAX_QUESTIONS) {
            issues.add("An OMR sheet holds at most " + OmrSheetLayout.MAX_QUESTIONS + " questions; this paper has " + paper.size());
        }
        List<Integer> wrongType = new ArrayList<>(), wrongOptions = new ArrayList<>(), noKey = new ArrayList<>();
        for (int i = 0; i < paper.size(); i++) {
            PaperQuestion q = paper.get(i);
            int no = i + 1;
            if (!SUPPORTED_TYPE.equals(q.questionType())) {
                wrongType.add(no);
                continue;
            }
            int n = q.optionIds().size();
            if (n < OmrSheetLayout.MIN_OPTIONS || n > OmrSheetLayout.MAX_OPTIONS) wrongOptions.add(no);
            if (q.correctOptionIds().size() != 1 || !q.optionIds().contains(q.correctOptionIds().get(0))) noKey.add(no);
        }
        if (!wrongType.isEmpty()) {
            issues.add("Only single-correct MCQ questions can go on an OMR sheet; change or remove question(s) " + list(wrongType));
        }
        if (!wrongOptions.isEmpty()) {
            issues.add("Every question needs " + OmrSheetLayout.MIN_OPTIONS + " to " + OmrSheetLayout.MAX_OPTIONS
                    + " options; check question(s) " + list(wrongOptions));
        }
        if (!noKey.isEmpty()) {
            issues.add("Mark exactly one correct option on question(s) " + list(noKey));
        }
        return issues;
    }

    private static String list(List<Integer> nos) {
        if (nos.size() <= 15) return nos.toString().replaceAll("[\\[\\]]", "");
        return nos.subList(0, 15).toString().replaceAll("[\\[\\]]", "") + " and " + (nos.size() - 15) + " more";
    }

    // --------------------------------------------------------------- generate

    /**
     * (Re)generate the OMR sets from the assessment as it is now. Refused when the
     * paper cannot go on a sheet, when a roll number cannot be bubbled (the sheet's
     * roll grid width depends on them), or once a scan exists.
     */
    @Transactional
    public OmrDtos.OverviewDto generateSets(String assessmentId, String instituteId) {
        Assessment assessment = requireAssessment(assessmentId);
        if (!Boolean.TRUE.equals(assessment.getOmrMode())) {
            throw new VacademyException("Turn on OMR mode for this assessment first");
        }
        requireUnlocked(assessment);
        List<PaperQuestion> paper = paperLoader.load(assessmentId);
        List<String> issues = paperIssues(paper);
        if (!issues.isEmpty()) throw new VacademyException(String.join(". ", issues));

        OmrRollService.RollIndex roll = rollService.build(assessmentId, instituteId);
        if (!roll.ok()) {
            throw new VacademyException(roll.participants().isEmpty()
                    ? "Add participants to the assessment before generating OMR sheets"
                    : roll.issues().size() + " participant(s) have an enrollment number that cannot be bubbled; fix them first");
        }

        OmrConfig cfg = config(assessment);
        int setCount = cfg.setCountOrDefault();
        String density = paper.size() <= OmrSheetLayout.LARGE_MAX_QUESTIONS ? OmrSheetLayout.LARGE : OmrSheetLayout.DENSE;

        // Retire the earlier OMR sets (rows other features keep in this table are left alone).
        for (LoadedSet old : loadSets(assessmentId)) {
            old.row().setStatus(AssessmentSetStatusEnum.DELETED.name());
            setRepository.save(old.row());
        }

        long generation = System.currentTimeMillis();
        for (int s = 0; s < setCount; s++) {
            String code = String.valueOf((char) ('A' + s));
            long seed = Objects.hash(assessmentId, code, generation);
            OmrSetJson json = OmrSetJson.builder()
                    .kind(OmrSetJson.KIND).v(OmrSetJson.VERSION)
                    .setCode(code).seed(seed).density(density)
                    .rollDigits(roll.rollDigits()).layoutVersion(OmrSheetLayout.LAYOUT_VERSION)
                    .items(order(paper, s == 0 ? null : new Random(seed),
                            Boolean.TRUE.equals(cfg.getShuffleQuestions()),
                            Boolean.TRUE.equals(cfg.getShuffleOptions())))
                    .build();
            setRepository.save(AssessmentSetMapping.builder()
                    .assessment(assessment).setName("OMR Set " + code)
                    .status(AssessmentSetStatusEnum.ACTIVE.name())
                    .json(write(json)).build());
        }

        cfg.setRollDigits(roll.rollDigits());
        cfg.setDensity(density);
        cfg.setLayoutVersion(OmrSheetLayout.LAYOUT_VERSION);
        writeConfig(assessment, cfg);
        return overview(assessmentId);
    }

    /**
     * Printed order of one set. {@code random} null = the authored order (set A).
     * Shuffling keeps each section's questions together and keeps the sections in
     * their order, so section-wise instructions on the paper still apply.
     */
    static List<OmrSetJson.Item> order(List<PaperQuestion> paper, Random random, boolean shuffleQuestions,
                                       boolean shuffleOptions) {
        Map<String, List<PaperQuestion>> bySection = new LinkedHashMap<>();
        for (PaperQuestion q : paper) bySection.computeIfAbsent(q.sectionId(), k -> new ArrayList<>()).add(q);
        List<OmrSetJson.Item> items = new ArrayList<>();
        int no = 1;
        for (List<PaperQuestion> section : bySection.values()) {
            List<PaperQuestion> qs = new ArrayList<>(section);
            if (random != null && shuffleQuestions) Collections.shuffle(qs, random);
            for (PaperQuestion q : qs) {
                List<String> options = new ArrayList<>(q.optionIds());
                if (random != null && shuffleOptions) Collections.shuffle(options, random);
                items.add(OmrSetJson.Item.builder().no(no++).questionId(q.questionId())
                        .sectionId(q.sectionId()).optionIds(options).build());
            }
        }
        return items;
    }

    // ------------------------------------------------------------------ reads

    public record LoadedSet(AssessmentSetMapping row, OmrSetJson json) {
    }

    /** The assessment's live OMR sets, A first. */
    public List<LoadedSet> loadSets(String assessmentId) {
        List<LoadedSet> out = new ArrayList<>();
        for (AssessmentSetMapping row : setRepository.findByAssessmentIdAndStatusNotIn(assessmentId,
                List.of(AssessmentSetStatusEnum.DELETED.name()))) {
            OmrSetJson json = parse(row.getJson());
            if (json != null) out.add(new LoadedSet(row, json));
        }
        out.sort(Comparator.comparing(s -> s.json().getSetCode()));
        return out;
    }

    public LoadedSet requireSet(String assessmentId, String setId) {
        AssessmentSetMapping row = setRepository.findById(setId)
                .orElseThrow(() -> new VacademyException("Set not found"));
        if (row.getAssessment() == null || !assessmentId.equals(row.getAssessment().getId())) {
            throw new VacademyException("Set not found on this assessment");
        }
        OmrSetJson json = parse(row.getJson());
        if (json == null) throw new VacademyException("This set is not an OMR set");
        if (AssessmentSetStatusEnum.DELETED.name().equals(row.getStatus())) {
            throw new VacademyException("This set was replaced; download the current sets");
        }
        return new LoadedSet(row, json);
    }

    /** One set's paper and answer key, for the dashboard's export. */
    @Transactional(readOnly = true)
    public OmrDtos.PaperDto paper(String assessmentId, String setId) {
        LoadedSet set = requireSet(assessmentId, setId);
        Map<String, String> correctById = new HashMap<>();
        for (PaperQuestion q : paperLoader.load(assessmentId)) {
            if (!q.correctOptionIds().isEmpty()) correctById.put(q.questionId(), q.correctOptionIds().get(0));
        }
        List<OmrDtos.PaperItemDto> items = new ArrayList<>();
        for (OmrSetJson.Item item : set.json().getItems()) {
            int idx = item.getOptionIds().indexOf(correctById.get(item.getQuestionId()));
            items.add(OmrDtos.PaperItemDto.builder()
                    .no(item.getNo()).questionId(item.getQuestionId()).sectionId(item.getSectionId())
                    .optionIds(item.getOptionIds())
                    .correctLetter(idx >= 0 && idx < 5 ? String.valueOf((char) ('A' + idx)) : null)
                    .build());
        }
        return OmrDtos.PaperDto.builder().setId(set.row().getId()).setCode(set.json().getSetCode())
                .rollDigits(set.json().getRollDigits()).items(items).build();
    }

    /** The geometry of a set's sheet; the scan of that sheet is read with the same one. */
    public OmrSheetLayout layoutFor(String assessmentId, LoadedSet set) {
        if (set.json().getLayoutVersion() == null || set.json().getLayoutVersion() != OmrSheetLayout.LAYOUT_VERSION) {
            throw new VacademyException(HttpStatus.CONFLICT,
                    "This set was printed with an older sheet layout; regenerate the sets and print new sheets");
        }
        List<String> codes = loadSets(assessmentId).stream().map(s -> s.json().getSetCode()).toList();
        List<Integer> optionCounts = set.json().getItems().stream().map(i -> i.getOptionIds().size()).toList();
        return OmrSheetLayout.builder()
                .rollDigits(set.json().getRollDigits())
                .setCodes(codes.isEmpty() ? List.of(set.json().getSetCode()) : codes)
                .printedSetCode(set.json().getSetCode())
                .optionCounts(optionCounts)
                .build();
    }

    /**
     * The printable OMR sheet of a set. Re-checks the roll numbers, because the sheet's
     * grid width was fixed when the sets were generated: a learner added since then with
     * a longer number could not bubble it.
     */
    @Transactional(readOnly = true)
    public byte[] sheetPdf(String assessmentId, String instituteId, String setId) {
        Assessment assessment = requireAssessment(assessmentId);
        LoadedSet set = requireSet(assessmentId, setId);
        OmrRollService.RollIndex roll = rollService.build(assessmentId, instituteId);
        if (!roll.ok()) {
            throw new VacademyException(roll.issues().size()
                    + " participant(s) have an enrollment number that cannot be bubbled; fix them before printing");
        }
        if (roll.rollDigits() > set.json().getRollDigits()) {
            throw new VacademyException("A participant's enrollment number is longer than this sheet's "
                    + set.json().getRollDigits() + "-digit roll grid; regenerate the sets");
        }
        OmrSheetLayout layout = layoutFor(assessmentId, set);
        return OmrSheetPdfRenderer.render(layout, new OmrSheetPdfRenderer.SheetText(assessment.getName(),
                "OMR Answer Sheet  |  " + set.json().getItems().size() + " questions"));
    }

    // ------------------------------------------------------------------- lock

    /** Called when the first scan is uploaded. */
    @Transactional
    public void lock(String assessmentId) {
        Assessment assessment = requireAssessment(assessmentId);
        OmrConfig cfg = config(assessment);
        if (cfg.getLockedAt() == null) {
            cfg.setLockedAt(new Date());
            writeConfig(assessment, cfg);
        }
    }

    // ---------------------------------------------------------------- helpers

    private Assessment requireAssessment(String assessmentId) {
        return assessmentRepository.findById(assessmentId)
                .orElseThrow(() -> new VacademyException("Assessment not found"));
    }

    private void requireUnlocked(Assessment assessment) {
        if (isLocked(assessment)) {
            throw new VacademyException(HttpStatus.CONFLICT,
                    "Filled sheets were already uploaded for this assessment, so its sets can no longer change");
        }
    }

    private void writeConfig(Assessment assessment, OmrConfig cfg) {
        String json = write(cfg);
        assessmentRepository.updateOmrConfig(assessment.getId(), json);
        assessment.setOmrConfig(json);
    }

    private OmrSetJson parse(String json) {
        if (!StringUtils.hasText(json) || !json.contains(OmrSetJson.KIND)) return null;
        try {
            OmrSetJson s = objectMapper.readValue(json, OmrSetJson.class);
            return OmrSetJson.KIND.equals(s.getKind()) && s.getItems() != null ? s : null;
        } catch (Exception e) {
            return null;
        }
    }

    private String write(Object o) {
        try {
            return objectMapper.writeValueAsString(o);
        } catch (Exception e) {
            throw new VacademyException("Could not save the OMR settings: " + e.getMessage());
        }
    }
}
