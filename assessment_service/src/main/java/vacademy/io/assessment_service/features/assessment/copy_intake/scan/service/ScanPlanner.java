package vacademy.io.assessment_service.features.assessment.copy_intake.scan.service;

import vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto.ScanAnalysis;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto.ScanStationDtos.LoadDecisions;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto.ScanStationDtos.SessionDecisions;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * Turns what ai_service read from each load, plus the clerk's decisions, into
 * copies (one per student), flags and a verdict. Pure: no Spring, no IO. It runs
 * on every read of a session and its output is never stored, so a decision or a
 * replaced load shows its effect at once and nothing can go stale.
 *
 * <p>The rules, in order:
 * <ol>
 *   <li>Fronts direction, once per session: the clerk's choice; else load 1 (only
 *       while load 1 itself is live: it is the physical first pile) when exactly
 *       one of its first/last fronts carries a label (the physical first sheet of
 *       a pile always does); else the loads in aggregate when one direction leaves
 *       at least {@code aggregateMargin} fewer loads starting without a label;
 *       else FORWARD. Unless the clerk chose, the clerk is asked
 *       (FRONT_ORDER_UNCERTAIN) when any copy has more than one sheet and the
 *       guess is weak: no evidence at all, a removed load before a live one, or
 *       the session's unlabelled first sheet was excluded or split away (that
 *       sheet is the strongest sign the guess is wrong).</li>
 *   <li>A copy starts on a sheet the clerk split at, or on a front with a printed
 *       name label. The session's first sheet must start one (FIRST_SHEET_NO_LABEL);
 *       a later load whose first sheet has no label continues the copy before
 *       (LOAD_STARTS_MID_COPY). A removed load between two live ones breaks the
 *       chain: the later load never continues a copy across it.</li>
 *   <li>Each sheet gives its front, then its back unless the back is BLANK after
 *       the clerk's keep/drop and the load's blank-rule trust. Only backs are left
 *       out by the rule; a front leaves only when the clerk drops it.</li>
 *   <li>Flags from ai_service plus the planner's own; BLOCK flags can never be
 *       accepted, REVIEW flags are accepted per copy or per load against a
 *       fingerprint of what the clerk saw (pages and the copy's REVIEW reasons),
 *       so an accept stops counting when that changes.</li>
 *   <li>Verdict: BLOCKED &gt; ANALYSING &gt; NEEDS_REVIEW &gt; READY (EMPTY with no loads).</li>
 * </ol>
 */
public final class ScanPlanner {

    public static final String FORWARD = "FORWARD";
    public static final String REVERSED = "REVERSED";

    public static final String SOURCE_CLERK = "CLERK";
    public static final String SOURCE_LOAD1 = "LOAD1";
    public static final String SOURCE_AGGREGATE = "AGGREGATE";
    public static final String SOURCE_DEFAULT = "DEFAULT";

    public static final String VERDICT_EMPTY = "EMPTY";
    public static final String VERDICT_ANALYSING = "ANALYSING";
    public static final String VERDICT_READY = "READY";
    public static final String VERDICT_NEEDS_REVIEW = "NEEDS_REVIEW";
    public static final String VERDICT_BLOCKED = "BLOCKED";

    public static final String BLOCK = "BLOCK";
    public static final String REVIEW = "REVIEW";
    public static final String INFO = "INFO";

    public static final String DECISION_NONE = "NONE";
    public static final String DECISION_ACCEPTED = "ACCEPTED";
    public static final String DECISION_EXCLUDED = "EXCLUDED";

    public static final String FRONT = "FRONT";
    public static final String BACK = "BACK";

    public static final String KEEP = "KEEP";
    public static final String DROP = "DROP";

    // load statuses as stored on ai_scan_load
    public static final String LOAD_PENDING = "PENDING";
    public static final String LOAD_ANALYSING = "ANALYSING";
    public static final String LOAD_DONE = "DONE";
    public static final String LOAD_FAILED = "FAILED";

    // planner-made codes
    public static final String ANALYSIS_FAILED = "ANALYSIS_FAILED";
    public static final String FIRST_SHEET_NO_LABEL = "FIRST_SHEET_NO_LABEL";
    public static final String TOO_MANY_COPIES = "TOO_MANY_COPIES";
    public static final String FRONT_ORDER_UNCERTAIN = "FRONT_ORDER_UNCERTAIN";
    public static final String LOAD_STARTS_MID_COPY = "LOAD_STARTS_MID_COPY";
    public static final String SAME_NAME = "SAME_NAME";
    public static final String COPY_UNUSUALLY_LONG = "COPY_UNUSUALLY_LONG";
    public static final String TOO_MANY_PAGES = "TOO_MANY_PAGES";
    public static final String BLANKS_TO_CONFIRM = "BLANKS_TO_CONFIRM";
    public static final String MTIME_DISAGREES = "MTIME_DISAGREES";
    /** Verdict reason only: nothing left to build. */
    public static final String NO_COPIES = "NO_COPIES";

    /** Severity of every known code; ai_service's own severity is used only for codes not listed. */
    static final Map<String, String> SEVERITY = Map.ofEntries(
            Map.entry("COUNT_MISMATCH", BLOCK), Map.entry("FILE_UNREADABLE", BLOCK),
            Map.entry("NO_NAME_BOX_FOUND", BLOCK), Map.entry("LOAD_TOO_LARGE", BLOCK),
            Map.entry("PAIR_SHIFT_DETECTED", BLOCK), Map.entry("BACK_HAS_LABEL", BLOCK),
            Map.entry(ANALYSIS_FAILED, BLOCK), Map.entry(FIRST_SHEET_NO_LABEL, BLOCK),
            Map.entry(TOO_MANY_COPIES, BLOCK),
            Map.entry("LABEL_NO_VALUE", REVIEW), Map.entry("LABEL_UNUSUAL", REVIEW),
            Map.entry("PAIR_NOT_ROW_MAX", REVIEW), Map.entry("ORDER_UNCERTAIN", REVIEW),
            Map.entry("FRONT_BLANK", REVIEW), Map.entry("DPI_LOW", REVIEW),
            Map.entry(FRONT_ORDER_UNCERTAIN, REVIEW), Map.entry(LOAD_STARTS_MID_COPY, REVIEW),
            Map.entry(SAME_NAME, REVIEW), Map.entry(COPY_UNUSUALLY_LONG, REVIEW),
            Map.entry(TOO_MANY_PAGES, REVIEW), Map.entry(BLANKS_TO_CONFIRM, REVIEW),
            Map.entry(MTIME_DISAGREES, REVIEW),
            Map.entry("BLANK_RULE_SUSPECT", INFO), Map.entry("DPI_ASSUMED", INFO), Map.entry("UNSURE_KEPT", INFO));

    /**
     * Flags about the whole load even when ai_service names a sheet: a shifted
     * pairing or a sheet turned over in the pile makes every pair after it
     * suspect, so leaving one copy out cannot fix it; the load is rescanned.
     */
    static final Set<String> LOAD_WIDE = Set.of("COUNT_MISMATCH", "LOAD_TOO_LARGE", "NO_NAME_BOX_FOUND",
            "PAIR_SHIFT_DETECTED", "BACK_HAS_LABEL", "ORDER_UNCERTAIN", "BLANK_RULE_SUSPECT");

    /** Tunables in one place. */
    public record Thresholds(int maxCopies, int maxPagesPerCopy, int longCopyMinSheets,
                             double longCopyMedianFactor, double sameNameSimilarity, int aggregateMargin) {
        public static Thresholds defaults() {
            return new Thresholds(500, 40, 3, 2.0, 0.9, 2);
        }
    }

    /** One live (not removed) load, as stored. */
    public record LoadFacts(int loadNo, String status, ScanAnalysis.Result result, List<String> clientWarnings,
                            String errorMessage) {
    }

    public record Flag(String code, String severity, Integer loadNo, Integer sheetNo, String copyKey,
                       String detail, boolean accepted, String fingerprint) {
        Flag withAccepted(boolean a) {
            return new Flag(code, severity, loadNo, sheetNo, copyKey, detail, a, fingerprint);
        }

        Flag withCopyKey(String key) {
            return new Flag(code, severity, loadNo, sheetNo, key, detail, accepted, fingerprint);
        }

        boolean isOpen(String sev) {
            return sev.equals(severity) && (BLOCK.equals(sev) || !accepted);
        }
    }

    public record SheetRef(int loadNo, int sheetNo) {
    }

    public record PagePick(int loadNo, String ref, String fileId, Integer pageIndex, String kind, int rotation,
                           String side, Integer dpi) {
    }

    public record Copy(String copyKey, int loadNo, int firstSheetNo, List<SheetRef> sheets, List<PagePick> pages,
                       List<PagePick> leftOut, String nameText, List<Flag> flags, String decision,
                       boolean needsReview, String fingerprint, String label, String buildFileName) {
        public boolean excluded() {
            return DECISION_EXCLUDED.equals(decision);
        }
    }

    /** Load-level flags (sheet flags live on the copies) and every page's effective blank class. */
    public record LoadPlan(int loadNo, List<Flag> flags, Map<String, String> blankEffective) {
    }

    public record Totals(int loads, int sheets, int pages, int copies, int blankLeftOut, int excluded) {
    }

    public record Plan(String direction, String directionSource, List<Flag> sessionFlags,
                       Map<Integer, LoadPlan> loads, List<Copy> copies, String verdict, List<Flag> verdictReasons,
                       Totals totals, List<Copy> buildList, String fingerprint) {

        public Copy copyAt(int loadNo, int firstSheetNo) {
            for (Copy c : copies) {
                if (c.loadNo() == loadNo && c.firstSheetNo() == firstSheetNo) return c;
            }
            return null;
        }

        /** The first flag of the load with this code (a load can carry several with one code). */
        public Flag loadFlag(int loadNo, String code) {
            List<Flag> all = loadFlags(loadNo, code);
            return all.isEmpty() ? null : all.get(0);
        }

        /** Every flag of the load with this code, in plan order; the clerk tells them apart by fingerprint. */
        public List<Flag> loadFlags(int loadNo, String code) {
            LoadPlan lp = loads.get(loadNo);
            if (lp == null || code == null) return List.of();
            List<Flag> out = new ArrayList<>();
            for (Flag f : lp.flags()) {
                if (code.equals(f.code())) out.add(f);
            }
            return out;
        }

        public Flag sessionFlag(String code) {
            for (Flag f : sessionFlags) {
                if (code.equals(f.code())) return f;
            }
            return null;
        }
    }

    private final Thresholds t;

    public ScanPlanner() {
        this(Thresholds.defaults());
    }

    public ScanPlanner(Thresholds thresholds) {
        this.t = thresholds;
    }

    // ------------------------------------------------------------------ plan

    public Plan plan(List<LoadFacts> liveLoadsInOrder, SessionDecisions session,
                     Map<Integer, LoadDecisions> loadDecisions) {
        return plan(liveLoadsInOrder, Set.of(), session, loadDecisions);
    }

    /**
     * @param removedLoadNos the load numbers the clerk removed. Load numbers are
     *                       never reused, so they mark holes in the physical pile.
     */
    public Plan plan(List<LoadFacts> liveLoadsInOrder, Set<Integer> removedLoadNos, SessionDecisions session,
                     Map<Integer, LoadDecisions> loadDecisions) {
        Set<Integer> removed = removedLoadNos == null ? Set.of() : removedLoadNos;
        List<LoadFacts> loads = new ArrayList<>(liveLoadsInOrder == null ? List.of() : liveLoadsInOrder);
        loads.sort(Comparator.comparingInt(LoadFacts::loadNo));
        Map<Integer, LoadDecisions> decisions = new HashMap<>();
        for (LoadFacts l : loads) {
            LoadDecisions d = loadDecisions == null ? null : loadDecisions.get(l.loadNo());
            decisions.put(l.loadNo(), d == null ? new LoadDecisions() : d.normalized());
        }
        if (loads.isEmpty()) {
            return new Plan(FORWARD, SOURCE_DEFAULT, List.of(), Map.of(), List.of(), VERDICT_EMPTY, List.of(),
                    new Totals(0, 0, 0, 0, 0, 0), List.of(), sha256(""));
        }

        String[] dir = direction(loads, session);
        String direction = dir[0];
        String source = dir[1];

        // ---- group sheets into copies, in physical order
        List<CopyDraft> drafts = new ArrayList<>();
        Map<Integer, Map<String, String>> effective = new LinkedHashMap<>();
        Map<Integer, List<Flag>> loadFlags = new LinkedHashMap<>();
        Map<Integer, Set<String>> autoLeftOut = new HashMap<>();
        Map<String, CopyDraft> copyOfSheet = new HashMap<>();
        int sheetsTotal = 0;
        CopyDraft current = null;
        boolean gapBefore = false;      // an earlier load is not (usefully) read yet
        int prevLoadNo = 0;
        CopyDraft firstDraft = null;    // the copy holding the session's first sheet
        boolean firstSheetUnlabelled = false;

        for (LoadFacts load : loads) {
            LoadDecisions d = decisions.get(load.loadNo());
            final int after = prevLoadNo;
            boolean removedBefore = removed.stream().anyMatch(n -> n > after && n < load.loadNo());
            if (removedBefore && after > 0) {
                // The pile between them was taken out: nothing continues across the hole.
                current = null;
                gapBefore = true;
            }
            prevLoadNo = load.loadNo();
            List<Flag> lf = new ArrayList<>();
            loadFlags.put(load.loadNo(), lf);
            Map<String, String> eff = new LinkedHashMap<>();
            effective.put(load.loadNo(), eff);

            if (LOAD_FAILED.equals(load.status())) {
                lf.add(flag(ANALYSIS_FAILED, null, load.loadNo(), null,
                        load.errorMessage() == null ? "This load could not be read; rescan it" : load.errorMessage()));
            }
            if (load.clientWarnings() != null && load.clientWarnings().contains(MTIME_DISAGREES)) {
                lf.add(flag(MTIME_DISAGREES, null, load.loadNo(), null,
                        "The scan numbers and the file times disagree about the page order"));
            }
            ScanAnalysis.Result r = load.result();
            List<ScanAnalysis.Sheet> sheets = LOAD_DONE.equals(load.status()) && r != null && r.getSheets() != null
                    ? new ArrayList<>(r.getSheets()) : new ArrayList<>();
            if (!LOAD_DONE.equals(load.status()) || r == null) {
                current = null;
                gapBefore = true;
                continue;
            }
            ScanAnalysis.Layout layout = r.getLayout();
            boolean suspect = layout != null && Boolean.TRUE.equals(layout.getBlankRuleSuspect());
            Map<String, ScanAnalysis.Page> pages = new HashMap<>();
            if (r.getPages() != null) {
                for (ScanAnalysis.Page p : r.getPages()) {
                    if (p != null && p.getRef() != null) {
                        pages.put(p.getRef(), p);
                        eff.put(p.getRef(), effectiveClass(p, d, suspect));
                    }
                }
            }
            if (sheets.isEmpty()) {
                current = null;
                gapBefore = true;
            }
            sheets.removeIf(s -> s == null || s.getSheetNo() == null);
            sheets.sort(Comparator.comparingInt(ScanAnalysis.Sheet::getSheetNo));
            if (REVERSED.equals(direction)) java.util.Collections.reverse(sheets);
            sheetsTotal += sheets.size();
            int frontRot = rotation(layout == null ? null : layout.getFrontsRotation());
            int backRot = rotation(layout == null ? null : layout.getBacksRotation());

            boolean firstInLoad = true;
            for (ScanAnalysis.Sheet s : sheets) {
                int no = s.getSheetNo();
                Boolean override = d.getStartOverrides().get(String.valueOf(no));
                boolean start = override != null ? override : isLabelled(s);
                if (current == null) {
                    current = new CopyDraft(load.loadNo(), no, s.getNameText());
                    if (drafts.isEmpty() && !gapBefore) {
                        firstDraft = current;
                        firstSheetUnlabelled = !isLabelled(s);
                    }
                    drafts.add(current);
                    if (!start) {
                        current.flags.add(gapBefore
                                ? flag(LOAD_STARTS_MID_COPY, null, load.loadNo(), no, removedBefore
                                ? "This load starts without a name label, and the load before it was removed"
                                : "This load starts without a name label, and the load before it is not read yet")
                                : flag(FIRST_SHEET_NO_LABEL, null, load.loadNo(), no, removedBefore
                                ? "The first sheet of the session has no name label (an earlier load was removed)"
                                : "The first sheet of the session has no name label"));
                    }
                } else if (start) {
                    current = new CopyDraft(load.loadNo(), no, s.getNameText());
                    drafts.add(current);
                } else if (firstInLoad) {
                    current.flags.add(flag(LOAD_STARTS_MID_COPY, null, load.loadNo(), no,
                            "This load starts without a name label, so it continues the last copy of the load before"));
                }
                firstInLoad = false;
                current.sheets.add(new SheetRef(load.loadNo(), no));
                copyOfSheet.put(load.loadNo() + ":" + no, current);
                addPages(current, load.loadNo(), s, pages, eff, d, frontRot, backRot, autoLeftOut);
            }
            if (!sheets.isEmpty()) gapBefore = false;

            // ai flags: sheet flags go to the copy holding the sheet, the rest stay on the load
            if (r.getFlags() != null) {
                for (ScanAnalysis.Flag f : r.getFlags()) {
                    if (f == null || f.getCode() == null) continue;
                    Flag pf = flag(f.getCode(), f.getSeverity(), load.loadNo(), f.getSheetNo(), f.getDetail());
                    CopyDraft owner = f.getSheetNo() == null || LOAD_WIDE.contains(f.getCode()) ? null
                            : copyOfSheet.get(load.loadNo() + ":" + f.getSheetNo());
                    if (owner != null) owner.flags.add(pf);
                    else lf.add(pf);
                }
            }
        }

        // ---- exclusions, labels, file names
        Map<Integer, Integer> perLoad = new HashMap<>();
        for (CopyDraft c : drafts) {
            c.excluded = decisions.get(c.loadNo).getExcluded().contains(c.firstSheetNo);
            if (!c.excluded) {
                int n = perLoad.merge(c.loadNo, 1, Integer::sum);
                c.label = "Load " + c.loadNo + " copy " + n;
                c.fileName = "scan_l" + c.loadNo + "_c" + n + ".pdf";
            }
        }
        List<CopyDraft> live = drafts.stream().filter(c -> !c.excluded).toList();

        // ---- planner copy flags
        double median = median(live.stream().map(c -> c.sheets.size()).toList());
        double longLimit = Math.max(t.longCopyMinSheets(), t.longCopyMedianFactor() * median);
        for (CopyDraft c : live) {
            if (c.pages.size() > t.maxPagesPerCopy()) {
                c.flags.add(flag(TOO_MANY_PAGES, null, c.loadNo, c.firstSheetNo,
                        c.pages.size() + " pages; more than " + t.maxPagesPerCopy() + " in one copy"));
            }
            if (c.sheets.size() > longLimit) {
                c.flags.add(flag(COPY_UNUSUALLY_LONG, null, c.loadNo, c.firstSheetNo,
                        c.sheets.size() + " sheets; most copies here have " + fmt(median)
                                + ", so a name label may have been missed"));
            }
        }
        sameNames(live);

        // ---- fingerprints, accepts, decisions
        List<Copy> copies = new ArrayList<>();
        for (CopyDraft c : drafts) {
            String fp = copyFingerprint(direction, c);
            String acceptedFp = decisions.get(c.loadNo).getAccepted().get(String.valueOf(c.firstSheetNo));
            boolean accepted = !c.excluded && fp.equals(acceptedFp);
            String key = copyKey(c.loadNo, c.firstSheetNo);
            List<Flag> flags = new ArrayList<>();
            boolean needsReview = false;
            for (Flag f : c.flags) {
                Flag g = f.withCopyKey(key).withAccepted(REVIEW.equals(f.severity()) && accepted);
                flags.add(g);
                if (!c.excluded && g.isOpen(REVIEW)) needsReview = true;
            }
            copies.add(new Copy(key, c.loadNo, c.firstSheetNo, List.copyOf(c.sheets), List.copyOf(c.pages),
                    List.copyOf(c.leftOut), c.nameText, List.copyOf(flags),
                    c.excluded ? DECISION_EXCLUDED : accepted ? DECISION_ACCEPTED : DECISION_NONE,
                    needsReview, fp, c.label, c.fileName));
        }

        // ---- load flags that need the grouping: blanks to confirm, accepts
        Map<Integer, LoadPlan> loadPlans = new LinkedHashMap<>();
        Set<String> excludedSheets = new HashSet<>();
        for (CopyDraft c : drafts) {
            if (c.excluded) c.sheets.forEach(s -> excludedSheets.add(s.loadNo() + ":" + s.sheetNo()));
        }
        for (LoadFacts load : loads) {
            LoadDecisions d = decisions.get(load.loadNo());
            List<Flag> lf = loadFlags.get(load.loadNo());
            Set<String> blanks = new TreeSet<>();
            for (String refKey : autoLeftOut.getOrDefault(load.loadNo(), Set.of())) {
                String[] parts = refKey.split("\\|", 2);
                if (!excludedSheets.contains(load.loadNo() + ":" + parts[0])) blanks.add(parts[1]);
            }
            if (!blanks.isEmpty()) {
                Flag b = flag(BLANKS_TO_CONFIRM, null, load.loadNo(), null,
                        blanks.size() + (blanks.size() == 1 ? " blank page is" : " blank pages are")
                                + " being left out; check them");
                lf.add(new Flag(b.code(), b.severity(), b.loadNo(), null, null, b.detail(), false,
                        sha256(String.join(",", blanks))));
            }
            List<Flag> out = new ArrayList<>();
            for (Flag f : lf) {
                String fp = f.fingerprint() != null ? f.fingerprint() : loadFlagFingerprint(f);
                boolean acc = REVIEW.equals(f.severity()) && loadFlagAccepted(d.getAcceptedFlags(), f.code(), fp);
                out.add(new Flag(f.code(), f.severity(), f.loadNo(), f.sheetNo(), null, f.detail(), acc, fp));
            }
            loadPlans.put(load.loadNo(), new LoadPlan(load.loadNo(), List.copyOf(out),
                    Map.copyOf(effective.getOrDefault(load.loadNo(), Map.of()))));
        }

        // ---- session flags
        List<Copy> buildList = copies.stream().filter(c -> !c.excluded()).toList();
        List<Flag> sessionFlags = new ArrayList<>();
        String uncertain = uncertainDirection(source, loads, removed, firstDraft, firstSheetUnlabelled);
        if (uncertain != null && buildList.stream().anyMatch(c -> c.sheets().size() >= 2)) {
            sessionFlags.add(flag(FRONT_ORDER_UNCERTAIN, null, null, null, uncertain));
        }
        if (buildList.size() > t.maxCopies()) {
            sessionFlags.add(flag(TOO_MANY_COPIES, null, null, null,
                    buildList.size() + " copies; at most " + t.maxCopies() + " in one session"));
        }

        // ---- verdict
        boolean analysing = loads.stream().anyMatch(l ->
                LOAD_PENDING.equals(l.status()) || LOAD_ANALYSING.equals(l.status()));
        List<Flag> blocks = new ArrayList<>();
        List<Flag> reviews = new ArrayList<>();
        collect(sessionFlags, blocks, reviews);
        loadPlans.values().forEach(lp -> collect(lp.flags(), blocks, reviews));
        buildList.forEach(c -> collect(c.flags(), blocks, reviews));

        String verdict;
        List<Flag> reasons;
        if (!blocks.isEmpty()) {
            verdict = VERDICT_BLOCKED;
            reasons = blocks;
        } else if (analysing) {
            verdict = VERDICT_ANALYSING;
            reasons = new ArrayList<>();
            for (LoadFacts l : loads) {
                if (LOAD_PENDING.equals(l.status()) || LOAD_ANALYSING.equals(l.status())) {
                    reasons.add(new Flag(VERDICT_ANALYSING, INFO, l.loadNo(), null, null, null, false, null));
                }
            }
        } else if (buildList.isEmpty()) {
            verdict = VERDICT_BLOCKED;
            reasons = List.of(new Flag(NO_COPIES, BLOCK, null, null, null, "No copies to build", false, null));
        } else if (!reviews.isEmpty()) {
            verdict = VERDICT_NEEDS_REVIEW;
            reasons = reviews;
        } else {
            verdict = VERDICT_READY;
            reasons = List.of();
        }

        int pages = 0;
        int blankLeftOut = 0;
        StringBuilder fp = new StringBuilder();
        for (Copy c : buildList) {
            pages += c.pages().size();
            blankLeftOut += c.leftOut().size();
            fp.append(c.copyKey()).append('=');
            for (PagePick p : c.pages()) {
                fp.append('L').append(p.loadNo()).append('/').append(p.ref()).append(':').append(p.rotation()).append(',');
            }
            fp.append(';');
        }
        Totals totals = new Totals(loads.size(), sheetsTotal, pages, buildList.size(), blankLeftOut,
                copies.size() - buildList.size());
        return new Plan(direction, source, List.copyOf(sessionFlags), loadPlans, List.copyOf(copies), verdict,
                List.copyOf(reasons), totals, buildList, sha256(fp.toString()));
    }

    public static String copyKey(int loadNo, int sheetNo) {
        return "L" + loadNo + "-S" + sheetNo;
    }

    // -------------------------------------------------------------- direction

    private String[] direction(List<LoadFacts> loads, SessionDecisions session) {
        String clerk = session == null ? null : session.getFrontsDirection();
        if (FORWARD.equals(clerk) || REVERSED.equals(clerk)) {
            return new String[] { clerk, SOURCE_CLERK };
        }
        // Only load 1 is the physical first pile; after it is removed, the lowest
        // live load usually starts in the middle of a copy and proves nothing.
        boolean[] first = loads.get(0).loadNo() == 1 ? evidence(loads.get(0)) : null;
        if (first != null && first[0] != first[1]) {
            return new String[] { first[0] ? FORWARD : REVERSED, SOURCE_LOAD1 };
        }
        int missForward = 0;
        int missReversed = 0;
        for (LoadFacts l : loads) {
            boolean[] e = evidence(l);
            if (e == null) continue;
            if (!e[0]) missForward++;
            if (!e[1]) missReversed++;
        }
        if (Math.abs(missForward - missReversed) >= t.aggregateMargin()) {
            return new String[] { missForward < missReversed ? FORWARD : REVERSED, SOURCE_AGGREGATE };
        }
        return new String[] { FORWARD, SOURCE_DEFAULT };
    }

    /**
     * Why the direction needs the clerk, or null. Never once the clerk chose it.
     * The session's first sheet carries a label when the direction is right, so
     * an unlabelled first sheet that the clerk excluded or split away (which
     * clears FIRST_SHEET_NO_LABEL) still has to be answered with the direction.
     */
    private static String uncertainDirection(String source, List<LoadFacts> loads, Set<Integer> removed,
                                             CopyDraft firstDraft, boolean firstSheetUnlabelled) {
        if (SOURCE_CLERK.equals(source)) return null;
        if (SOURCE_DEFAULT.equals(source)) {
            return "Could not tell which way the fronts were fed; check the first copy and pick the order";
        }
        int lastLive = loads.get(loads.size() - 1).loadNo();
        if (removed.stream().anyMatch(n -> n < lastLive)) {
            return "A load was removed from the middle of the pile, so the order of the fronts is a guess;"
                    + " check the first copy and pick the order";
        }
        if (firstDraft != null && firstSheetUnlabelled) {
            boolean stillBlocked = !firstDraft.excluded
                    && firstDraft.flags.stream().anyMatch(f -> FIRST_SHEET_NO_LABEL.equals(f.code()));
            if (!stillBlocked) {
                return "The session's first sheet has no name label, which usually means the fronts were fed"
                        + " the other way; check the first copy and pick the order";
            }
        }
        return null;
    }

    /** {first front labelled, last front labelled} in fronts scan order, or null when the load is not read. */
    private static boolean[] evidence(LoadFacts l) {
        ScanAnalysis.Result r = l.result();
        if (!LOAD_DONE.equals(l.status()) || r == null || r.getSheets() == null || r.getSheets().isEmpty()) {
            return null;
        }
        ScanAnalysis.Sheet lo = null;
        ScanAnalysis.Sheet hi = null;
        for (ScanAnalysis.Sheet s : r.getSheets()) {
            if (s == null || s.getSheetNo() == null) continue;
            if (lo == null || s.getSheetNo() < lo.getSheetNo()) lo = s;
            if (hi == null || s.getSheetNo() > hi.getSheetNo()) hi = s;
        }
        if (lo == null) return null;
        ScanAnalysis.Evidence e = r.getEvidence();
        boolean first = e != null && e.getFirstFrontLabel() != null ? e.getFirstFrontLabel() : isLabelled(lo);
        boolean last = e != null && e.getLastFrontLabel() != null ? e.getLastFrontLabel() : isLabelled(hi);
        return new boolean[] { first, last };
    }

    static boolean isLabelled(ScanAnalysis.Sheet s) {
        return Boolean.TRUE.equals(s.getLabelPresent()) && ScanAnalysis.LABEL_PRINTED_FIELD.equals(s.getLabelKind());
    }

    // ------------------------------------------------------------------ pages

    private static void addPages(CopyDraft c, int loadNo, ScanAnalysis.Sheet s, Map<String, ScanAnalysis.Page> pages,
                                 Map<String, String> eff, LoadDecisions d, int frontRot, int backRot,
                                 Map<Integer, Set<String>> autoLeftOut) {
        if (s.getFront() != null) {
            PagePick front = pick(loadNo, s.getFront(), pages.get(s.getFront()), frontRot, FRONT);
            // Only a clerk's DROP takes a front out; the blank rule never does.
            if (DROP.equals(d.getPageOverrides().get(s.getFront()))) c.leftOut.add(front);
            else c.pages.add(front);
        }
        if (s.getBack() != null) {
            PagePick back = pick(loadNo, s.getBack(), pages.get(s.getBack()), backRot, BACK);
            String cls = eff.getOrDefault(s.getBack(), fallbackClass(s.getBackBlankClass(), d.getPageOverrides().get(s.getBack())));
            if (ScanAnalysis.BLANK.equals(cls)) {
                c.leftOut.add(back);
                if (!d.getPageOverrides().containsKey(s.getBack())) {
                    autoLeftOut.computeIfAbsent(loadNo, k -> new HashSet<>()).add(s.getSheetNo() + "|" + s.getBack());
                }
            } else {
                c.pages.add(back);
            }
        }
    }

    private static String fallbackClass(String aiClass, String override) {
        if (KEEP.equals(override)) return ScanAnalysis.WRITTEN;
        if (DROP.equals(override)) return ScanAnalysis.BLANK;
        return aiClass == null ? ScanAnalysis.WRITTEN : aiClass;
    }

    /** The clerk's keep/drop, else WRITTEN when the load's blank rule is not trusted, else ai_service's class. */
    static String effectiveClass(ScanAnalysis.Page p, LoadDecisions d, boolean blankRuleSuspect) {
        String override = d.getPageOverrides().get(p.getRef());
        if (KEEP.equals(override)) return ScanAnalysis.WRITTEN;
        if (DROP.equals(override)) return ScanAnalysis.BLANK;
        if (blankRuleSuspect) return ScanAnalysis.WRITTEN;
        String cls = p.getBlankClass();
        return ScanAnalysis.BLANK.equals(cls) || ScanAnalysis.UNSURE.equals(cls) ? cls : ScanAnalysis.WRITTEN;
    }

    private static PagePick pick(int loadNo, String ref, ScanAnalysis.Page p, int rotation, String side) {
        return new PagePick(loadNo, ref, p == null ? null : p.getFileId(), p == null ? null : p.getPageIndex(),
                p == null ? null : p.getKind(), rotation, side, p == null ? null : p.getDpi());
    }

    private static int rotation(Integer r) {
        if (r == null) return 0;
        int v = ((r % 360) + 360) % 360;
        return v == 90 || v == 180 || v == 270 ? v : 0;
    }

    // ------------------------------------------------------------------ flags

    private static Flag flag(String code, String aiSeverity, Integer loadNo, Integer sheetNo, String detail) {
        String sev = SEVERITY.get(code);
        if (sev == null) {
            sev = BLOCK.equals(aiSeverity) || REVIEW.equals(aiSeverity) || INFO.equals(aiSeverity) ? aiSeverity : REVIEW;
        }
        return new Flag(code, sev, loadNo, sheetNo, null, detail, false, null);
    }

    private static void collect(List<Flag> flags, List<Flag> blocks, List<Flag> reviews) {
        for (Flag f : flags) {
            if (f.isOpen(BLOCK)) blocks.add(f);
            else if (f.isOpen(REVIEW)) reviews.add(f);
        }
    }

    /** Any two copies whose names read alike: one of them probably lost its label and merged with another. */
    private void sameNames(List<CopyDraft> live) {
        List<String> norm = live.stream().map(c -> normalizeName(c.nameText)).toList();
        for (int i = 0; i < live.size(); i++) {
            for (int j = i + 1; j < live.size(); j++) {
                String a = norm.get(i);
                String b = norm.get(j);
                if (a.isEmpty() || b.isEmpty() || similarity(a, b) < t.sameNameSimilarity()) continue;
                markSameName(live.get(i), live.get(j));
                markSameName(live.get(j), live.get(i));
            }
        }
    }

    private static void markSameName(CopyDraft c, CopyDraft other) {
        if (c.flags.stream().anyMatch(f -> SAME_NAME.equals(f.code()))) return;
        c.flags.add(flag(SAME_NAME, null, c.loadNo, c.firstSheetNo,
                "Same name as copy " + copyKey(other.loadNo, other.firstSheetNo)));
    }

    /** Lower case, accents and punctuation dropped, tokens sorted. */
    static String normalizeName(String name) {
        if (name == null) return "";
        String s = Normalizer.normalize(name, Normalizer.Form.NFD).replaceAll("\\p{M}", "")
                .toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]+", " ").trim();
        if (s.isEmpty()) return "";
        String[] tokens = s.split(" ");
        Arrays.sort(tokens);
        return String.join(" ", tokens);
    }

    /** 1 - edit distance / longer length. */
    static double similarity(String a, String b) {
        if (a.equals(b)) return 1.0;
        int max = Math.max(a.length(), b.length());
        if (max == 0) return 1.0;
        int[] prev = new int[b.length() + 1];
        int[] cur = new int[b.length() + 1];
        for (int j = 0; j <= b.length(); j++) prev[j] = j;
        for (int i = 1; i <= a.length(); i++) {
            cur[0] = i;
            for (int j = 1; j <= b.length(); j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                cur[j] = Math.min(Math.min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost);
            }
            int[] tmp = prev;
            prev = cur;
            cur = tmp;
        }
        return 1.0 - (double) prev[b.length()] / max;
    }

    private static double median(List<Integer> values) {
        if (values.isEmpty()) return 0;
        List<Integer> v = new ArrayList<>(values);
        v.sort(Integer::compareTo);
        int n = v.size();
        return n % 2 == 1 ? v.get(n / 2) : (v.get(n / 2 - 1) + v.get(n / 2)) / 2.0;
    }

    private static String fmt(double d) {
        return d == Math.floor(d) ? String.valueOf((int) d) : String.valueOf(d);
    }

    // ----------------------------------------------------------- fingerprints

    /**
     * What the clerk saw of a copy: the fronts direction, its sheets, its pages and
     * rotations, what was left out, and the REVIEW reasons it was shown (code and
     * sheet), so a new reason on an accepted copy needs a new look.
     */
    private static String copyFingerprint(String direction, CopyDraft c) {
        StringBuilder sb = new StringBuilder(direction).append('|');
        for (SheetRef s : c.sheets) sb.append(s.loadNo()).append(':').append(s.sheetNo()).append(',');
        sb.append('|');
        for (PagePick p : c.pages) sb.append(p.loadNo()).append('/').append(p.ref()).append(':').append(p.rotation()).append(',');
        sb.append('|');
        for (PagePick p : c.leftOut) sb.append(p.loadNo()).append('/').append(p.ref()).append(',');
        sb.append('|');
        TreeSet<String> reasons = new TreeSet<>();
        for (Flag f : c.flags) {
            if (REVIEW.equals(f.severity())) reasons.add(f.code() + "@" + (f.sheetNo() == null ? "" : f.sheetNo()));
        }
        sb.append(String.join(",", reasons));
        return sha256(sb.toString());
    }

    /**
     * What the clerk saw of a load flag: its code, detail and sheet. Two flags of
     * one code on one load differ here (unless they say exactly the same thing),
     * so each is accepted on its own.
     */
    private static String loadFlagFingerprint(Flag f) {
        String base = f.code() + "|" + nz(f.detail());
        return sha256(f.sheetNo() == null ? base : base + "|@" + f.sheetNo());
    }

    /**
     * Accepted load flags are stored fingerprint -&gt; code, so two flags with one
     * code are accepted one by one. A code -&gt; fingerprint entry (the first
     * format, which held one accept per code) is still honoured; the two kinds of
     * key cannot collide (a fingerprint is 64 hex digits, a code is upper case).
     */
    static boolean loadFlagAccepted(Map<String, String> accepted, String code, String fingerprint) {
        if (accepted == null || fingerprint == null) return false;
        return code.equals(accepted.get(fingerprint)) || fingerprint.equals(accepted.get(code));
    }

    public static String sha256(String s) {
        try {
            byte[] h = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(64);
            for (byte b : h) hex.append(String.format("%02x", b));
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    /** A copy while it is being grouped. */
    private static final class CopyDraft {
        final int loadNo;
        final int firstSheetNo;
        final String nameText;
        final List<SheetRef> sheets = new ArrayList<>();
        final List<PagePick> pages = new ArrayList<>();
        final List<PagePick> leftOut = new ArrayList<>();
        final List<Flag> flags = new ArrayList<>();
        boolean excluded;
        String label;
        String fileName;

        CopyDraft(int loadNo, int firstSheetNo, String nameText) {
            this.loadNo = loadNo;
            this.firstSheetNo = firstSheetNo;
            this.nameText = nameText;
        }
    }
}
