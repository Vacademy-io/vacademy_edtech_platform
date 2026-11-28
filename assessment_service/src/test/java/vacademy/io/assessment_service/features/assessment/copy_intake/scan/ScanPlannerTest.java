package vacademy.io.assessment_service.features.assessment.copy_intake.scan;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto.ScanAnalysis;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto.ScanStationDtos.LoadDecisions;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto.ScanStationDtos.SessionDecisions;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.service.ScanPlanner;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.service.ScanPlanner.Copy;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.service.ScanPlanner.Flag;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.service.ScanPlanner.LoadFacts;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.service.ScanPlanner.PagePick;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.service.ScanPlanner.Plan;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static vacademy.io.assessment_service.features.assessment.copy_intake.scan.ScanFixtures.done;
import static vacademy.io.assessment_service.features.assessment.copy_intake.scan.ScanFixtures.fixture;
import static vacademy.io.assessment_service.features.assessment.copy_intake.scan.ScanFixtures.load;
import static vacademy.io.assessment_service.features.assessment.copy_intake.scan.ScanFixtures.status;

/**
 * The planner on analyse-load answers written to contract C1. Every rule that
 * decides which pages end up in whose PDF is pinned here.
 */
class ScanPlannerTest {

    private final ScanPlanner planner = new ScanPlanner();

    private Plan plan(List<LoadFacts> loads) {
        return planner.plan(loads, null, Map.of());
    }

    private Plan plan(List<LoadFacts> loads, SessionDecisions s, Map<Integer, LoadDecisions> d) {
        return planner.plan(loads, s, d);
    }

    private static List<String> keys(Plan p) {
        return p.copies().stream().map(Copy::copyKey).toList();
    }

    private static List<String> refs(List<PagePick> pages) {
        return pages.stream().map(PagePick::ref).toList();
    }

    private static List<String> codes(List<Flag> flags) {
        return flags.stream().map(Flag::code).toList();
    }

    private static Map<Integer, LoadDecisions> one(int loadNo, LoadDecisions d) {
        Map<Integer, LoadDecisions> m = new HashMap<>();
        m.put(loadNo, d);
        return m;
    }

    // ---------------------------------------------------------------- copy starts

    @Test
    void labelsSplitCopies() {
        Plan p = plan(List.of(done(1, load(4).labels(0, 2).result())));

        assertThat(keys(p)).containsExactly("L1-S0", "L1-S2");
        assertThat(refs(p.copies().get(0).pages())).containsExactly("p1.0", "p2.0", "p1.1", "p2.1");
        assertThat(p.copies().get(1).sheets()).extracting(ScanPlanner.SheetRef::sheetNo).containsExactly(2, 3);
        assertThat(p.copies().get(0).label()).isEqualTo("Load 1 copy 1");
        assertThat(p.copies().get(1).buildFileName()).isEqualTo("scan_l1_c2.pdf");
    }

    @Test
    void oneSidedCopiesAreFrontsOnlyAndReady() {
        Plan p = plan(List.of(done(1, load(5).labels(0, 2, 3).evidence(true, false).oneSided().result())));

        assertThat(keys(p)).containsExactly("L1-S0", "L1-S2", "L1-S3");
        assertThat(refs(p.copies().get(0).pages())).containsExactly("p1.0", "p1.1");
        assertThat(refs(p.copies().get(2).pages())).containsExactly("p1.3", "p1.4");
        assertThat(p.copies()).allSatisfy(c -> assertThat(c.leftOut()).isEmpty());
        assertThat(p.verdict()).isEqualTo(ScanPlanner.VERDICT_READY);
    }

    @Test
    void labelWithNoValueStillSplitsAndIsFlagged() {
        Plan p = plan(List.of(done(1, load(4).labels(0).label(2, null)
                .flag("LABEL_NO_VALUE", "REVIEW", 2).result())));

        assertThat(keys(p)).containsExactly("L1-S0", "L1-S2");
        assertThat(codes(p.copyAt(1, 2).flags())).containsExactly("LABEL_NO_VALUE");
        assertThat(p.copyAt(1, 2).needsReview()).isTrue();
        assertThat(p.verdict()).isEqualTo(ScanPlanner.VERDICT_NEEDS_REVIEW);
    }

    @Test
    void questionTextNeverStartsACopy() {
        // Even a confused answer that also claims label_present: only a PRINTED_FIELD label splits.
        Plan p = plan(List.of(done(1, load(3).labels(0).labelKind(1, "QUESTION_TEXT", true)
                .labelKind(2, "QUESTION_TEXT", false).result())));

        assertThat(keys(p)).containsExactly("L1-S0");
        assertThat(p.copies().get(0).sheets()).hasSize(3);
    }

    @Test
    void the1118ScanGivesThreeCopiesWithTwoBlankBacksLeftOut() {
        Plan p = plan(List.of(done(1, fixture("c1_1118_layout.json"))));

        assertThat(keys(p)).containsExactly("L1-S0", "L1-S2", "L1-S5");
        assertThat(p.copies()).extracting(Copy::nameText).containsExactly("Aarav Sharma", "Priya Verma", "Rohan Gupta");
        assertThat(refs(p.copyAt(1, 0).pages())).containsExactly("p2.0", "p1.5", "p2.1", "p1.4");
        assertThat(refs(p.copyAt(1, 2).pages())).containsExactly("p2.2", "p1.3", "p2.3", "p2.4");
        assertThat(refs(p.copyAt(1, 2).leftOut())).containsExactly("p1.2", "p1.1");
        assertThat(refs(p.copyAt(1, 5).pages())).containsExactly("p2.5", "p1.0");
        assertThat(p.copyAt(1, 2).pages()).extracting(PagePick::side).containsExactly("FRONT", "BACK", "FRONT", "FRONT");
        assertThat(p.totals().copies()).isEqualTo(3);
        assertThat(p.totals().pages()).isEqualTo(10);
        assertThat(p.totals().blankLeftOut()).isEqualTo(2);
        assertThat(p.totals().sheets()).isEqualTo(6);
        // the clerk is asked to glance at the two pages being left out
        assertThat(p.loadFlag(1, ScanPlanner.BLANKS_TO_CONFIRM)).isNotNull();
    }

    // ------------------------------------------------------------------ direction

    @Test
    void loadOneDecidesForwardWhenOnlyItsFirstFrontIsLabelled() {
        Plan p = plan(List.of(done(1, load(4).labels(0, 2).evidence(true, false).result())));

        assertThat(p.direction()).isEqualTo(ScanPlanner.FORWARD);
        assertThat(p.directionSource()).isEqualTo(ScanPlanner.SOURCE_LOAD1);
        assertThat(p.sessionFlags()).isEmpty();
    }

    @Test
    void loadOneDecidesReversedWhenOnlyItsLastFrontIsLabelled() {
        Plan p = plan(List.of(done(1, load(4).labels(1, 3).evidence(false, true).result())));

        assertThat(p.direction()).isEqualTo(ScanPlanner.REVERSED);
        assertThat(p.directionSource()).isEqualTo(ScanPlanner.SOURCE_LOAD1);
        // fronts read 3,2,1,0: copies start on 3 and 1
        assertThat(keys(p)).containsExactly("L1-S3", "L1-S1");
        assertThat(p.copyAt(1, 3).sheets()).extracting(ScanPlanner.SheetRef::sheetNo).containsExactly(3, 2);
        assertThat(p.verdict()).isEqualTo(ScanPlanner.VERDICT_READY);
    }

    @Test
    void ambiguousDirectionWithMultiSheetCopiesDefaultsForwardAndAsks() {
        Plan p = plan(List.of(done(1, load(4).labels(0, 3).evidence(true, true).result())));

        assertThat(p.direction()).isEqualTo(ScanPlanner.FORWARD);
        assertThat(p.directionSource()).isEqualTo(ScanPlanner.SOURCE_DEFAULT);
        assertThat(codes(p.sessionFlags())).containsExactly(ScanPlanner.FRONT_ORDER_UNCERTAIN);
        assertThat(p.verdict()).isEqualTo(ScanPlanner.VERDICT_NEEDS_REVIEW);
    }

    @Test
    void ambiguousDirectionWithSingleSheetCopiesDoesNotAsk() {
        Plan p = plan(List.of(done(1, load(3).labels(0, 1, 2).result())));

        assertThat(p.directionSource()).isEqualTo(ScanPlanner.SOURCE_DEFAULT);
        assertThat(p.sessionFlags()).isEmpty();
        assertThat(p.verdict()).isEqualTo(ScanPlanner.VERDICT_READY);
    }

    @Test
    void aggregateDecidesWhenLoadsAgreeByTwo() {
        ScanAnalysis.Result l1 = load(2).labels(0, 1).result();               // both ends labelled: undecided
        ScanAnalysis.Result l2 = load(3).labels(2).evidence(false, true).result();
        ScanAnalysis.Result l3 = load(3).labels(2).evidence(false, true).result();
        Plan p = plan(List.of(done(1, l1), done(2, l2), done(3, l3)));

        assertThat(p.direction()).isEqualTo(ScanPlanner.REVERSED);
        assertThat(p.directionSource()).isEqualTo(ScanPlanner.SOURCE_AGGREGATE);
    }

    @Test
    void clerkDirectionWinsAndChangingItInvalidatesCopyAccepts() {
        ScanAnalysis.Result r = load(2).labels(0, 1).flag("PAIR_NOT_ROW_MAX", "REVIEW", 1).result();
        Plan forward = plan(List.of(done(1, r)));
        LoadDecisions d = new LoadDecisions();
        d.getAccepted().put("1", forward.copyAt(1, 1).fingerprint());
        assertThat(plan(List.of(done(1, r)), null, one(1, d)).copyAt(1, 1).decision())
                .isEqualTo(ScanPlanner.DECISION_ACCEPTED);

        Plan reversed = plan(List.of(done(1, r)), new SessionDecisions(ScanPlanner.REVERSED), one(1, d));

        assertThat(reversed.directionSource()).isEqualTo(ScanPlanner.SOURCE_CLERK);
        assertThat(reversed.direction()).isEqualTo(ScanPlanner.REVERSED);
        assertThat(reversed.copyAt(1, 1).decision()).isEqualTo(ScanPlanner.DECISION_NONE);
        assertThat(reversed.copyAt(1, 1).needsReview()).isTrue();
    }

    // ------------------------------------------------------- loads and first sheet

    @Test
    void laterLoadStartingWithoutALabelContinuesThePreviousCopy() {
        Plan p = plan(List.of(done(1, fixture("c1_1118_layout.json")), done(2, fixture("c1_continues_copy.json"))));

        assertThat(keys(p)).containsExactly("L1-S0", "L1-S2", "L1-S5", "L2-S1");
        Copy rohan = p.copyAt(1, 5);
        assertThat(rohan.sheets()).extracting(s -> s.loadNo() + ":" + s.sheetNo()).containsExactly("1:5", "2:0");
        assertThat(refs(rohan.pages())).containsExactly("p2.5", "p1.0", "p1.0", "p2.0");
        assertThat(rohan.pages()).extracting(PagePick::loadNo).containsExactly(1, 1, 2, 2);
        assertThat(rohan.pages()).extracting(PagePick::rotation).containsExactly(0, 0, 180, 180);
        assertThat(codes(rohan.flags())).containsExactly(ScanPlanner.LOAD_STARTS_MID_COPY);
        assertThat(codes(p.copyAt(2, 1).flags())).containsExactly("PAIR_NOT_ROW_MAX");
    }

    @Test
    void firstSheetWithoutLabelBlocksUntilSplitOrExcludedThenAsksForTheDirection() {
        ScanAnalysis.Result r = load(3).labels(1).evidence(true, false).result();
        Plan p = plan(List.of(done(1, r)));
        assertThat(codes(p.copyAt(1, 0).flags())).containsExactly(ScanPlanner.FIRST_SHEET_NO_LABEL);
        assertThat(p.copyAt(1, 0).flags().get(0).severity()).isEqualTo(ScanPlanner.BLOCK);
        assertThat(p.verdict()).isEqualTo(ScanPlanner.VERDICT_BLOCKED);

        LoadDecisions split = new LoadDecisions();
        split.getStartOverrides().put("0", true);
        Plan fixed = plan(List.of(done(1, r)), null, one(1, split));
        assertThat(fixed.copyAt(1, 0).flags()).isEmpty();
        // an unlabelled first sheet is the main sign the fronts went the other way: still ask
        assertThat(codes(fixed.sessionFlags())).containsExactly(ScanPlanner.FRONT_ORDER_UNCERTAIN);
        assertThat(fixed.verdict()).isEqualTo(ScanPlanner.VERDICT_NEEDS_REVIEW);
        assertThat(plan(List.of(done(1, r)), new SessionDecisions(ScanPlanner.FORWARD), one(1, split)).verdict())
                .isEqualTo(ScanPlanner.VERDICT_READY);

        LoadDecisions exclude = new LoadDecisions();
        exclude.getExcluded().add(0);
        Plan excluded = plan(List.of(done(1, r)), null, one(1, exclude));
        assertThat(excluded.copyAt(1, 0).decision()).isEqualTo(ScanPlanner.DECISION_EXCLUDED);
        assertThat(codes(excluded.sessionFlags())).containsExactly(ScanPlanner.FRONT_ORDER_UNCERTAIN);
        assertThat(excluded.verdict()).isEqualTo(ScanPlanner.VERDICT_NEEDS_REVIEW);
        assertThat(excluded.totals().excluded()).isEqualTo(1);
        assertThat(excluded.buildList()).extracting(Copy::copyKey).containsExactly("L1-S1");
        Plan confirmed = plan(List.of(done(1, r)), new SessionDecisions(ScanPlanner.FORWARD), one(1, exclude));
        assertThat(confirmed.sessionFlags()).isEmpty();
        assertThat(confirmed.verdict()).isEqualTo(ScanPlanner.VERDICT_READY);
    }

    @Test
    void excludingTheUnlabelledFirstCopyUnderAnAggregateGuessStillAsksForTheDirection() {
        // load 1 says nothing (both ends unlabelled); loads 2 and 3 vote FORWARD by two
        ScanAnalysis.Result l1 = load(3).labels(1).evidence(false, false).result();
        ScanAnalysis.Result l2 = load(2).labels(0).evidence(true, false).result();
        ScanAnalysis.Result l3 = load(2).labels(0).evidence(true, false).result();
        List<LoadFacts> loads = List.of(done(1, l1), done(2, l2), done(3, l3));
        Plan p = plan(loads);
        assertThat(p.directionSource()).isEqualTo(ScanPlanner.SOURCE_AGGREGATE);
        assertThat(p.sessionFlags()).isEmpty();
        assertThat(p.verdict()).isEqualTo(ScanPlanner.VERDICT_BLOCKED);       // FIRST_SHEET_NO_LABEL

        LoadDecisions exclude = new LoadDecisions();
        exclude.getExcluded().add(0);
        Plan excluded = plan(loads, null, one(1, exclude));
        assertThat(codes(excluded.sessionFlags())).containsExactly(ScanPlanner.FRONT_ORDER_UNCERTAIN);
        assertThat(excluded.verdict()).isEqualTo(ScanPlanner.VERDICT_NEEDS_REVIEW);
    }

    // -------------------------------------------------------------- removed loads

    @Test
    void aRemovedLoadOneNeverLendsItsDirectionToTheNextLoad() {
        // load 2 really fed FORWARD, starting mid-copy and ending on a labelled front
        ScanAnalysis.Result l2 = load(4).labels(1, 3).evidence(false, true).result();
        Plan asLoad1 = plan(List.of(done(1, l2)));
        assertThat(asLoad1.directionSource()).isEqualTo(ScanPlanner.SOURCE_LOAD1);   // it would say REVERSED

        Plan p = planner.plan(List.of(done(2, l2)), Set.of(1), null, Map.of());

        assertThat(p.directionSource()).isNotEqualTo(ScanPlanner.SOURCE_LOAD1);
        assertThat(p.direction()).isEqualTo(ScanPlanner.FORWARD);
        assertThat(codes(p.sessionFlags())).containsExactly(ScanPlanner.FRONT_ORDER_UNCERTAIN);
        Copy first = p.copyAt(2, 0);
        assertThat(codes(first.flags())).containsExactly(ScanPlanner.FIRST_SHEET_NO_LABEL);
        assertThat(first.flags().get(0).detail()).contains("removed");
        assertThat(p.verdict()).isEqualTo(ScanPlanner.VERDICT_BLOCKED);
    }

    @Test
    void aRemovedMiddleLoadBreaksTheChainAndAsksForTheDirection() {
        ScanAnalysis.Result l1 = load(3).labels(0, 2).evidence(true, false).result();
        ScanAnalysis.Result l3 = load(2).labels(1).result();
        SessionDecisions clerk = new SessionDecisions(ScanPlanner.FORWARD);

        Plan joined = plan(List.of(done(1, l1), done(3, l3)));
        assertThat(joined.directionSource()).isEqualTo(ScanPlanner.SOURCE_LOAD1);
        assertThat(joined.sessionFlags()).isEmpty();
        assertThat(joined.copyAt(1, 2).sheets()).hasSize(2);                // continues across loads 1 -> 3

        Plan p = planner.plan(List.of(done(1, l1), done(3, l3)), Set.of(2), clerk, Map.of());
        assertThat(keys(p)).containsExactly("L1-S0", "L1-S2", "L3-S0", "L3-S1");
        assertThat(p.copyAt(1, 2).sheets()).hasSize(1);
        Copy orphan = p.copyAt(3, 0);
        assertThat(codes(orphan.flags())).containsExactly(ScanPlanner.LOAD_STARTS_MID_COPY);
        assertThat(orphan.flags().get(0).detail()).contains("removed");
        assertThat(p.sessionFlags()).isEmpty();                             // the clerk already chose

        Plan guessed = planner.plan(List.of(done(1, l1), done(3, l3)), Set.of(2), null, Map.of());
        assertThat(guessed.directionSource()).isEqualTo(ScanPlanner.SOURCE_LOAD1);
        assertThat(codes(guessed.sessionFlags())).containsExactly(ScanPlanner.FRONT_ORDER_UNCERTAIN);

        // removing the last load leaves nothing in the middle
        Plan tail = planner.plan(List.of(done(1, l1)), Set.of(2), null, Map.of());
        assertThat(tail.sessionFlags()).isEmpty();
    }

    @Test
    void aNewReviewReasonOnAnAcceptedCopyNeedsANewLook() {
        ScanAnalysis.Result r = load(2).labels(0, 1).flag("PAIR_NOT_ROW_MAX", "REVIEW", 1).result();
        LoadDecisions d = new LoadDecisions();
        d.getAccepted().put("1", plan(List.of(done(1, r))).copyAt(1, 1).fingerprint());
        assertThat(plan(List.of(done(1, r)), null, one(1, d)).verdict()).isEqualTo(ScanPlanner.VERDICT_READY);

        // same sheets and pages, one more reason to look
        ScanAnalysis.Result r2 = load(2).labels(0, 1).flag("PAIR_NOT_ROW_MAX", "REVIEW", 1)
                .flag("DPI_LOW", "REVIEW", 1).result();
        Plan after = plan(List.of(done(1, r2)), null, one(1, d));
        assertThat(after.copyAt(1, 1).pages()).isEqualTo(plan(List.of(done(1, r)), null, one(1, d)).copyAt(1, 1).pages());
        assertThat(after.copyAt(1, 1).decision()).isEqualTo(ScanPlanner.DECISION_NONE);
        assertThat(after.copyAt(1, 1).needsReview()).isTrue();
        assertThat(after.verdict()).isEqualTo(ScanPlanner.VERDICT_NEEDS_REVIEW);
    }

    // ---------------------------------------------------------------------- blanks

    @Test
    void blankBackLeftOutUnsureKeptAndClerkOverridesWin() {
        ScanAnalysis.Result r = load(3).labels(0, 1, 2).back(0, ScanAnalysis.BLANK).back(1, ScanAnalysis.UNSURE)
                .back(2, ScanAnalysis.BLANK).result();
        Plan p = plan(List.of(done(1, r)));
        assertThat(refs(p.copyAt(1, 0).leftOut())).containsExactly("p2.0");
        assertThat(refs(p.copyAt(1, 1).pages())).containsExactly("p1.1", "p2.1");
        assertThat(p.loads().get(1).blankEffective()).containsEntry("p2.0", "BLANK").containsEntry("p2.1", "UNSURE");

        LoadDecisions d = new LoadDecisions();
        d.getPageOverrides().put("p2.0", ScanPlanner.KEEP);
        d.getPageOverrides().put("p2.1", ScanPlanner.DROP);
        d.getPageOverrides().put("p1.2", ScanPlanner.DROP);     // a front: the API refuses this for a labelled one, not the planner
        Plan o = plan(List.of(done(1, r)), null, one(1, d));
        assertThat(refs(o.copyAt(1, 0).pages())).containsExactly("p1.0", "p2.0");
        assertThat(refs(o.copyAt(1, 1).leftOut())).containsExactly("p2.1");
        assertThat(refs(o.copyAt(1, 2).leftOut())).containsExactly("p1.2", "p2.2");
        assertThat(o.loads().get(1).blankEffective()).containsEntry("p2.0", "WRITTEN").containsEntry("p2.1", "BLANK");
    }

    @Test
    void untrustedBlankRuleKeepsEveryPage() {
        ScanAnalysis.Result r = load(2).labels(0, 1).back(0, ScanAnalysis.BLANK).back(1, ScanAnalysis.BLANK)
                .suspect().flag("BLANK_RULE_SUSPECT", "INFO", null).result();
        Plan p = plan(List.of(done(1, r)));

        assertThat(p.totals().blankLeftOut()).isZero();
        assertThat(p.totals().pages()).isEqualTo(4);
        assertThat(p.loadFlag(1, ScanPlanner.BLANKS_TO_CONFIRM)).isNull();
        assertThat(p.verdict()).isEqualTo(ScanPlanner.VERDICT_READY);   // INFO never blocks
    }

    @Test
    void blanksToConfirmAcceptStopsCountingWhenTheLeftOutSetChanges() {
        ScanAnalysis.Result r = load(3).labels(0, 1, 2).back(0, ScanAnalysis.BLANK).back(2, ScanAnalysis.BLANK).result();
        Plan p = plan(List.of(done(1, r)));
        Flag blanks = p.loadFlag(1, ScanPlanner.BLANKS_TO_CONFIRM);
        assertThat(blanks.severity()).isEqualTo(ScanPlanner.REVIEW);
        assertThat(p.verdict()).isEqualTo(ScanPlanner.VERDICT_NEEDS_REVIEW);

        LoadDecisions d = new LoadDecisions();
        d.getAcceptedFlags().put(ScanPlanner.BLANKS_TO_CONFIRM, blanks.fingerprint());
        Plan accepted = plan(List.of(done(1, r)), null, one(1, d));
        assertThat(accepted.loadFlag(1, ScanPlanner.BLANKS_TO_CONFIRM).accepted()).isTrue();
        assertThat(accepted.verdict()).isEqualTo(ScanPlanner.VERDICT_READY);

        // a rescan-free change: one more back reads blank now -> the clerk must look again
        ScanAnalysis.Result r2 = load(3).labels(0, 1, 2).back(0, ScanAnalysis.BLANK).back(1, ScanAnalysis.BLANK)
                .back(2, ScanAnalysis.BLANK).result();
        Plan changed = plan(List.of(done(1, r2)), null, one(1, d));
        assertThat(changed.loadFlag(1, ScanPlanner.BLANKS_TO_CONFIRM).accepted()).isFalse();
        assertThat(changed.verdict()).isEqualTo(ScanPlanner.VERDICT_NEEDS_REVIEW);

        // keeping one of the accepted blanks also changes the set
        d.getPageOverrides().put("p2.0", ScanPlanner.KEEP);
        Plan kept = plan(List.of(done(1, r)), null, one(1, d));
        assertThat(kept.loadFlag(1, ScanPlanner.BLANKS_TO_CONFIRM).accepted()).isFalse();
    }

    @Test
    void twoLoadFlagsWithOneCodeAreAcceptedOneByOne() {
        // ORDER_UNCERTAIN is load-wide: on two sheets it is two flags of one code on the load
        ScanAnalysis.Result r = load(3).labels(0, 1, 2).flag("ORDER_UNCERTAIN", "REVIEW", 1)
                .flag("ORDER_UNCERTAIN", "REVIEW", 2).result();
        Plan p = plan(List.of(done(1, r)));
        List<Flag> two = p.loadFlags(1, "ORDER_UNCERTAIN");
        assertThat(two).hasSize(2);
        assertThat(two.get(0).fingerprint()).isNotEqualTo(two.get(1).fingerprint());
        assertThat(p.verdict()).isEqualTo(ScanPlanner.VERDICT_NEEDS_REVIEW);

        // the second alone (stored fingerprint -> code)
        LoadDecisions d = new LoadDecisions();
        d.getAcceptedFlags().put(two.get(1).fingerprint(), "ORDER_UNCERTAIN");
        Plan second = plan(List.of(done(1, r)), null, one(1, d));
        assertThat(second.loadFlags(1, "ORDER_UNCERTAIN")).extracting(Flag::accepted).containsExactly(false, true);
        assertThat(second.verdict()).isEqualTo(ScanPlanner.VERDICT_NEEDS_REVIEW);

        // then the first too: nothing left to review
        d.getAcceptedFlags().put(two.get(0).fingerprint(), "ORDER_UNCERTAIN");
        Plan both = plan(List.of(done(1, r)), null, one(1, d));
        assertThat(both.loadFlags(1, "ORDER_UNCERTAIN")).extracting(Flag::accepted).containsExactly(true, true);
        assertThat(both.verdict()).isEqualTo(ScanPlanner.VERDICT_READY);
    }

    @Test
    void aLoadFlagAcceptKeyedByCodeIsStillRead() {
        // the first decision format: code -> fingerprint; it accepts exactly that one flag
        ScanAnalysis.Result r = load(3).labels(0, 1, 2).flag("ORDER_UNCERTAIN", "REVIEW", 1)
                .flag("ORDER_UNCERTAIN", "REVIEW", 2).result();
        Plan p = plan(List.of(done(1, r)));
        List<Flag> two = p.loadFlags(1, "ORDER_UNCERTAIN");
        LoadDecisions d = new LoadDecisions();
        d.getAcceptedFlags().put("ORDER_UNCERTAIN", two.get(0).fingerprint());
        Plan after = plan(List.of(done(1, r)), null, one(1, d));
        assertThat(after.loadFlags(1, "ORDER_UNCERTAIN")).extracting(Flag::accepted).containsExactly(true, false);
    }

    // ----------------------------------------------------------------- BLOCK flags

    @Test
    void pairShiftAndBackLabelBlockAndCannotBeAcceptedOrExcludedAway() {
        for (String code : List.of("PAIR_SHIFT_DETECTED", "BACK_HAS_LABEL")) {
            ScanAnalysis.Result r = load(3).labels(0, 1, 2).flag(code, "BLOCK", 1).result();
            Plan p = plan(List.of(done(1, r)));
            Flag f = p.loadFlag(1, code);
            assertThat(f).as(code).isNotNull();
            assertThat(f.severity()).isEqualTo(ScanPlanner.BLOCK);
            assertThat(p.verdict()).isEqualTo(ScanPlanner.VERDICT_BLOCKED);

            LoadDecisions d = new LoadDecisions();
            d.getAcceptedFlags().put(code, f.fingerprint());
            d.getAccepted().put("1", p.copyAt(1, 1).fingerprint());
            d.getExcluded().add(1);
            Plan after = plan(List.of(done(1, r)), null, one(1, d));
            assertThat(after.loadFlag(1, code).accepted()).as(code).isFalse();
            assertThat(after.verdict()).as(code).isEqualTo(ScanPlanner.VERDICT_BLOCKED);
        }
    }

    @Test
    void aiSeverityCannotDowngradeABlockCode() {
        Plan p = plan(List.of(done(1, load(2).labels(0, 1).flag("BACK_HAS_LABEL", "INFO", null).result())));
        assertThat(p.verdict()).isEqualTo(ScanPlanner.VERDICT_BLOCKED);
    }

    @Test
    void countMismatchFixtureBlocks() {
        Plan p = plan(List.of(done(1, load(2).labels(0, 1).result()), done(2, fixture("c1_count_mismatch.json"))));
        assertThat(p.verdict()).isEqualTo(ScanPlanner.VERDICT_BLOCKED);
        assertThat(p.verdictReasons()).extracting(Flag::code).containsExactly("COUNT_MISMATCH");
        assertThat(p.verdictReasons().get(0).loadNo()).isEqualTo(2);
    }

    // ------------------------------------------------------------- copy accepts

    @Test
    void pairNotRowMaxIsAcceptedPerCopyAndTheAcceptIsLostWhenTheCopyChanges() {
        ScanAnalysis.Result r = load(4).labels(0, 2, 3).evidence(true, false)
                .flag("PAIR_NOT_ROW_MAX", "REVIEW", 2).result();
        Plan p = plan(List.of(done(1, r)));
        assertThat(p.verdict()).isEqualTo(ScanPlanner.VERDICT_NEEDS_REVIEW);

        LoadDecisions d = new LoadDecisions();
        d.getAccepted().put("2", p.copyAt(1, 2).fingerprint());
        Plan accepted = plan(List.of(done(1, r)), null, one(1, d));
        assertThat(accepted.copyAt(1, 2).decision()).isEqualTo(ScanPlanner.DECISION_ACCEPTED);
        assertThat(accepted.copyAt(1, 2).needsReview()).isFalse();
        assertThat(accepted.verdict()).isEqualTo(ScanPlanner.VERDICT_READY);

        // MERGE_WITH_PREVIOUS on the copy after it: copy L1-S2 now holds sheets 2 and 3
        d.getStartOverrides().put("3", false);
        Plan merged = plan(List.of(done(1, r)), null, one(1, d));
        assertThat(merged.copyAt(1, 2).sheets()).hasSize(2);
        assertThat(merged.copyAt(1, 2).decision()).isEqualTo(ScanPlanner.DECISION_NONE);
        assertThat(merged.verdict()).isEqualTo(ScanPlanner.VERDICT_NEEDS_REVIEW);
    }

    // ------------------------------------------------------------ planner flags

    @Test
    void sameNameIsFlaggedOnNonAdjacentCopiesOnly() {
        ScanAnalysis.Result r = load(3).label(0, "Aarav Sharma").label(1, "Priya Verma").label(2, "sharma, AARAV").result();
        Plan p = plan(List.of(done(1, r)));

        assertThat(codes(p.copyAt(1, 0).flags())).containsExactly(ScanPlanner.SAME_NAME);
        assertThat(codes(p.copyAt(1, 2).flags())).containsExactly(ScanPlanner.SAME_NAME);
        assertThat(p.copyAt(1, 1).flags()).isEmpty();
        assertThat(p.copyAt(1, 0).flags().get(0).detail()).contains("L1-S2").doesNotContain("Aarav");
    }

    @Test
    void sameNameAlsoAcrossLoadsAndNotForUnreadNames() {
        Plan p = plan(List.of(done(1, load(2).label(0, "Kabir Singh").label(1, null).result()),
                done(2, load(2).label(0, "Kabir Sing").label(1, null).result())));
        assertThat(codes(p.copyAt(1, 0).flags())).contains(ScanPlanner.SAME_NAME);
        assertThat(codes(p.copyAt(2, 0).flags())).contains(ScanPlanner.SAME_NAME);
        assertThat(codes(p.copyAt(1, 1).flags())).doesNotContain(ScanPlanner.SAME_NAME);
    }

    @Test
    void copyUnusuallyLongAgainstTheSessionMedian() {
        // copies of 1,1,1,1 and 4 sheets: median 1, limit max(3, 2) = 3
        Plan p = plan(List.of(done(1, load(8).labels(0, 1, 2, 3, 4).result())));
        assertThat(codes(p.copyAt(1, 4).flags())).containsExactly(ScanPlanner.COPY_UNUSUALLY_LONG);
        assertThat(p.copyAt(1, 0).flags()).isEmpty();

        // three sheets is never unusual
        Plan q = plan(List.of(done(1, load(6).labels(0, 1, 2, 3).result())));
        assertThat(codes(q.copyAt(1, 3).flags())).doesNotContain(ScanPlanner.COPY_UNUSUALLY_LONG);
    }

    @Test
    void tooManyPagesInOneCopy() {
        Plan p = plan(List.of(done(1, load(21).labels(0).result())));
        assertThat(p.copyAt(1, 0).pages()).hasSize(42);
        assertThat(codes(p.copyAt(1, 0).flags())).contains(ScanPlanner.TOO_MANY_PAGES);
    }

    @Test
    void moreThan500CopiesBlocks() {
        int[] all = new int[501];
        for (int i = 0; i < all.length; i++) all[i] = i;
        Plan p = plan(List.of(done(1, load(501).labels(all).result())));
        assertThat(p.totals().copies()).isEqualTo(501);
        assertThat(codes(p.sessionFlags())).contains(ScanPlanner.TOO_MANY_COPIES);
        assertThat(p.verdict()).isEqualTo(ScanPlanner.VERDICT_BLOCKED);

        int[] five = new int[500];
        for (int i = 0; i < five.length; i++) five[i] = i;
        assertThat(plan(List.of(done(1, load(500).labels(five).result()))).verdict())
                .isEqualTo(ScanPlanner.VERDICT_READY);
    }

    @Test
    void mtimeWarningFromTheBrowserIsALoadReview() {
        LoadFacts l = new LoadFacts(1, ScanPlanner.LOAD_DONE, load(1).labels(0).result(),
                List.of(ScanPlanner.MTIME_DISAGREES), null);
        Plan p = plan(List.of(l));
        Flag f = p.loadFlag(1, ScanPlanner.MTIME_DISAGREES);
        assertThat(f.severity()).isEqualTo(ScanPlanner.REVIEW);
        LoadDecisions d = new LoadDecisions();
        d.getAcceptedFlags().put(f.code(), f.fingerprint());
        assertThat(plan(List.of(l), null, one(1, d)).verdict()).isEqualTo(ScanPlanner.VERDICT_READY);
    }

    // ------------------------------------------------------------------- verdict

    @Test
    void verdictPrecedence() {
        ScanAnalysis.Result clean = load(2).labels(0, 1).result();
        ScanAnalysis.Result review = load(2).labels(0, 1).flag("DPI_LOW", "REVIEW", null).result();
        ScanAnalysis.Result block = load(2).labels(0, 1).flag("LOAD_TOO_LARGE", "BLOCK", null).result();

        assertThat(plan(List.of()).verdict()).isEqualTo(ScanPlanner.VERDICT_EMPTY);
        assertThat(plan(List.of(done(1, clean))).verdict()).isEqualTo(ScanPlanner.VERDICT_READY);
        assertThat(plan(List.of(done(1, review))).verdict()).isEqualTo(ScanPlanner.VERDICT_NEEDS_REVIEW);
        assertThat(plan(List.of(done(1, review), status(2, "PENDING"))).verdict())
                .isEqualTo(ScanPlanner.VERDICT_ANALYSING);
        assertThat(plan(List.of(done(1, block), status(2, "ANALYSING"))).verdict())
                .isEqualTo(ScanPlanner.VERDICT_BLOCKED);
        Plan failed = plan(List.of(done(1, clean), status(2, "FAILED")));
        assertThat(failed.verdict()).isEqualTo(ScanPlanner.VERDICT_BLOCKED);
        assertThat(failed.verdictReasons()).extracting(Flag::code).containsExactly(ScanPlanner.ANALYSIS_FAILED);
        assertThat(plan(List.of(status(1, "PENDING"))).verdict()).isEqualTo(ScanPlanner.VERDICT_ANALYSING);

        LoadDecisions all = new LoadDecisions();
        all.getExcluded().addAll(List.of(0, 1));
        Plan none = plan(List.of(done(1, clean)), null, one(1, all));
        assertThat(none.verdict()).isEqualTo(ScanPlanner.VERDICT_BLOCKED);
        assertThat(none.verdictReasons()).extracting(Flag::code).containsExactly(ScanPlanner.NO_COPIES);
    }

    @Test
    void pendingLoadInTheMiddleDoesNotBlockTheNextLoadsFirstSheet() {
        Plan p = plan(List.of(done(1, load(2).labels(0).result()), status(2, "PENDING"),
                done(3, load(2).labels(1).result())));
        assertThat(p.verdict()).isEqualTo(ScanPlanner.VERDICT_ANALYSING);
        assertThat(codes(p.copyAt(3, 0).flags())).containsExactly(ScanPlanner.LOAD_STARTS_MID_COPY);
    }

    // -------------------------------------------------------- keys + fingerprints

    @Test
    void copyKeysOfALoadStayWhenAnotherLoadChanges() {
        ScanAnalysis.Result l2 = load(3).labels(0, 2).result();
        Plan before = plan(List.of(done(1, load(2).labels(0).result()), done(2, l2)));
        Plan after = plan(List.of(done(1, load(5).labels(0, 3).result()), done(2, l2)));

        assertThat(before.copies().stream().filter(c -> c.loadNo() == 2).map(Copy::copyKey))
                .containsExactly("L2-S0", "L2-S2");
        assertThat(after.copies().stream().filter(c -> c.loadNo() == 2).map(Copy::copyKey))
                .containsExactly("L2-S0", "L2-S2");
        assertThat(after.copyAt(2, 2).fingerprint()).isEqualTo(before.copyAt(2, 2).fingerprint());
    }

    @Test
    void planFingerprintChangesWithARotationOrAPage() {
        Plan base = plan(List.of(done(1, load(2).labels(0, 1).back(1, ScanAnalysis.BLANK).result())));
        Plan same = plan(List.of(done(1, load(2).labels(0, 1).back(1, ScanAnalysis.BLANK).result())));
        Plan rotated = plan(List.of(done(1, load(2).labels(0, 1).back(1, ScanAnalysis.BLANK).rotations(0, 180).result())));
        LoadDecisions keep = new LoadDecisions();
        keep.getPageOverrides().put("p2.1", ScanPlanner.KEEP);
        Plan kept = plan(List.of(done(1, load(2).labels(0, 1).back(1, ScanAnalysis.BLANK).result())), null, one(1, keep));

        assertThat(same.fingerprint()).isEqualTo(base.fingerprint());
        assertThat(rotated.fingerprint()).isNotEqualTo(base.fingerprint());
        assertThat(kept.fingerprint()).isNotEqualTo(base.fingerprint());
        assertThat(rotated.copyAt(1, 0).pages()).extracting(PagePick::rotation).containsExactly(0, 180);
    }

    @Test
    void contractFieldNamesParse() {
        ScanAnalysis.Result r = fixture("c1_1118_layout.json");
        assertThat(r.getPages().get(1).getInkPer10k()).isEqualTo(0.116);
        assertThat(r.getPages().get(0).getDpiSource()).isEqualTo("JFIF");
        assertThat(r.getLayout().getBacksOrder()).isEqualTo("REVERSED");
        assertThat(r.getSheets().get(0).getPairRunnerUp()).isEqualTo(0.21);
        assertThat(r.getEvidence().getFirstFrontLabel()).isTrue();
    }
}
