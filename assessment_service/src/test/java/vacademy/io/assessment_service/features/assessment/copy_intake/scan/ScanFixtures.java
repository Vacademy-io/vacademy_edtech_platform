package vacademy.io.assessment_service.features.assessment.copy_intake.scan;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto.ScanAnalysis;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.service.ScanPlanner;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/** analyse-load answers (contract C1) for the scan tests: from JSON fixtures, or built sheet by sheet. */
final class ScanFixtures {

    static final ObjectMapper MAPPER = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private ScanFixtures() {
    }

    static String json(String name) {
        try (InputStream in = ScanFixtures.class.getResourceAsStream("/scan/" + name)) {
            if (in == null) throw new IllegalStateException("missing fixture " + name);
            return new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
    }

    static ScanAnalysis.Result fixture(String name) {
        try {
            return MAPPER.readValue(json(name), ScanAnalysis.Result.class);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static String write(Object o) {
        try {
            return MAPPER.writeValueAsString(o);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static ScanPlanner.LoadFacts done(int loadNo, ScanAnalysis.Result r) {
        return new ScanPlanner.LoadFacts(loadNo, ScanPlanner.LOAD_DONE, r, null, null);
    }

    static ScanPlanner.LoadFacts status(int loadNo, String status) {
        return new ScanPlanner.LoadFacts(loadNo, status, null, null, status.equals("FAILED") ? "boom" : null);
    }

    /** A load of n sheets: fronts are pass 1, backs pass 2 in the same order, every page written, no labels. */
    static Load load(int n) {
        return new Load(n);
    }

    static final class Load {
        final ScanAnalysis.Result r;

        Load(int n) {
            List<ScanAnalysis.Page> pages = new ArrayList<>();
            List<ScanAnalysis.Sheet> sheets = new ArrayList<>();
            for (int pass = 1; pass <= 2; pass++) {
                for (int i = 0; i < n; i++) {
                    pages.add(ScanAnalysis.Page.builder().ref("p" + pass + "." + i).passNo(pass)
                            .fileId("file-" + pass + "-" + i).pageIndex(0).kind("IMAGE").dpi(300).dpiSource("JFIF")
                            .widthPx(2480).heightPx(3508).inkPer10k(40.0).blankClass(ScanAnalysis.WRITTEN).build());
                }
            }
            for (int i = 0; i < n; i++) {
                sheets.add(ScanAnalysis.Sheet.builder().sheetNo(i).front("p1." + i).back("p2." + i).pairScore(0.6)
                        .pairRunnerUp(0.2).pairIsRowMax(true).labelKind("NONE").labelPresent(false)
                        .nameReadable(false).labelTemplateSim(0.1).backLabelLike(false)
                        .frontBlankClass(ScanAnalysis.WRITTEN).backBlankClass(ScanAnalysis.WRITTEN).build());
            }
            r = ScanAnalysis.Result.builder().analyserVersion("scan-1").status("OK")
                    .layout(ScanAnalysis.Layout.builder().frontsPass(1).frontsRotation(0).backsOrder("SAME")
                            .backsRotation(0).orderMargin(0.3).blankRuleSuspect(false).build())
                    .pages(pages).sheets(sheets).flags(new ArrayList<>()).build();
        }

        Load label(int i, String name) {
            ScanAnalysis.Sheet s = r.getSheets().get(i);
            s.setLabelKind(ScanAnalysis.LABEL_PRINTED_FIELD);
            s.setLabelPresent(true);
            s.setNameText(name);
            s.setNameReadable(name != null);
            return this;
        }

        /** Labelled fronts with no name read (so no two of them can look alike). */
        Load labels(int... sheets) {
            for (int i : sheets) label(i, null);
            return this;
        }

        Load labelKind(int i, String kind, boolean present) {
            ScanAnalysis.Sheet s = r.getSheets().get(i);
            s.setLabelKind(kind);
            s.setLabelPresent(present);
            return this;
        }

        Load back(int i, String blankClass) {
            ScanAnalysis.Sheet s = r.getSheets().get(i);
            s.setBackBlankClass(blankClass);
            page(s.getBack()).setBlankClass(blankClass);
            return this;
        }

        Load flag(String code, String severity, Integer sheetNo) {
            r.getFlags().add(ScanAnalysis.Flag.builder().code(code).severity(severity).sheetNo(sheetNo)
                    .detail(code.toLowerCase()).build());
            return this;
        }

        Load evidence(boolean first, boolean last) {
            r.setEvidence(ScanAnalysis.Evidence.builder().firstFrontLabel(first).lastFrontLabel(last).build());
            return this;
        }

        /** One-sided copies: drop the backs, as the analyser returns them (no pass 2, no pairing). */
        Load oneSided() {
            r.getPages().removeIf(p -> p.getPassNo() == 2);
            for (ScanAnalysis.Sheet sh : r.getSheets()) {
                sh.setBack(null);
                sh.setPairScore(null);
                sh.setPairRunnerUp(null);
                sh.setBackBlankClass(null);
            }
            r.getLayout().setBacksOrder(null);
            r.getLayout().setBacksRotation(null);
            r.getLayout().setOrderMargin(null);
            return this;
        }

        Load suspect() {
            r.getLayout().setBlankRuleSuspect(true);
            return this;
        }

        Load rotations(int fronts, int backs) {
            r.getLayout().setFrontsRotation(fronts);
            r.getLayout().setBacksRotation(backs);
            return this;
        }

        ScanAnalysis.Page page(String ref) {
            return r.getPages().stream().filter(p -> p.getRef().equals(ref)).findFirst().orElseThrow();
        }

        ScanAnalysis.Result result() {
            return r;
        }
    }
}
