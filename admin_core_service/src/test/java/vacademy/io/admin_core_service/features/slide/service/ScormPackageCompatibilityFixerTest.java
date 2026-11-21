package vacademy.io.admin_core_service.features.slide.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ScormPackageCompatibilityFixerTest {

    private final ScormPackageCompatibilityFixer fixer = new ScormPackageCompatibilityFixer();

    private static final String DROPPED_VALUE_PACKAGE = """
            <html><body><script>
            let API=null;
            function LMSCall(name,arg){try{return API?API[name](arg):'';}catch(e){return '';}}
            LMSCall('LMSInitialize','');
            LMSCall('LMSSetValue','cmi.core.lesson_status','incomplete');
            LMSCall('LMSSetValue','cmi.core.score.raw',String(pct));
            </script></body></html>
            """;

    private static final String SECTION_TRACKING_PACKAGE = """
            <html><head><title>t</title></head><body><main><section></section><section></section></main><script>
            var SCORM={set:function(){},commit:function(){}};
            function saveState(st){var s=JSON.stringify(st);SCORM.set('cmi.suspend_data',s);SCORM.commit();}
            function persist(){var lite={seen:ST.seen};SCORM.set('cmi.suspend_data',JSON.stringify(lite));SCORM.commit();}
            var secs=document.querySelectorAll('main section');var ST={seen:[]};ST.seen.push(0);
            function markComplete(){SCORM.set('cmi.completion_status','completed');SCORM.commit()}
            </script></body></html>
            """;

    private static final String SCREEN_TEMPLATE_APP_JS = """
            (function(){
            function $(s){return document.querySelector(s)}
            var visited={},count=document.querySelectorAll(".screen").length;
            function show(id){visited[id]=1;$("#progress").textContent=Math.round(Object.keys(visited).length/count*100)+"%";SCORM.bookmark(id);}
            window.addEventListener("beforeunload",function(){SCORM.commit();SCORM.finish()});
            SCORM.init();var loc=SCORM.get("cmi.core.lesson_location");show(loc&&$("#"+loc)?loc:"welcome");
            })();
            """;

    @Test
    void screenTemplateReportsVisitedScreensAsProgress() {
        Set<String> fixes = new LinkedHashSet<>();
        String out = fixer.addScreenProgress(SCREEN_TEMPLATE_APP_JS, fixes);
        assertEquals(Set.of(ScormPackageCompatibilityFixer.FIX_SCREEN_PROGRESS), fixes);
        // Inserted once, after init and before the resume lookup, so the restored list is in place for the first show().
        int init = out.indexOf("SCORM.init();");
        int marker = out.indexOf("/*vacademy-screen-progress*/");
        int resume = out.indexOf("var loc=SCORM.get(\"cmi.core.lesson_location\")");
        assertTrue(init >= 0 && init < marker && marker < resume);
        assertEquals(1, out.split("vacademy-screen-progress", -1).length - 1);
        assertTrue(out.contains("SCORM.set('cmi.progress_measure',(Math.min(n,count)/(count+1)).toFixed(2))"));
        // The rest of the package is unchanged.
        assertEquals(SCREEN_TEMPLATE_APP_JS, out.replaceFirst("/\\*vacademy-screen-progress\\*/\\(function\\(\\)\\{.*?\\}\\)\\(\\);", ""));
    }

    @Test
    void screenTemplateFixWorksOnMinifiedSingleLineFilesAndIsIdempotent() {
        String minified = SCREEN_TEMPLATE_APP_JS.replace("\n", "");
        String once = fixer.addScreenProgress(minified, new LinkedHashSet<>());
        assertTrue(once.contains("/*vacademy-screen-progress*/"));
        assertEquals(once, fixer.addScreenProgress(once, new LinkedHashSet<>()));
    }

    @Test
    void screenTemplateAlreadyReportingProgressIsLeftAlone() {
        String reporting = SCREEN_TEMPLATE_APP_JS.replace("SCORM.bookmark(id);",
                "SCORM.bookmark(id);SCORM.set('cmi.progress_measure','0.5');");
        Set<String> fixes = new LinkedHashSet<>();
        assertEquals(reporting, fixer.addScreenProgress(reporting, fixes));
        assertTrue(fixes.isEmpty());
    }

    @Test
    void forwardsTheValueDroppedByASetValueHelper() {
        Set<String> fixes = new LinkedHashSet<>();
        String out = fixer.fixDroppedSetValue(DROPPED_VALUE_PACKAGE, fixes);
        assertTrue(out.contains("function LMSCall(name,arg,__vacademyValue){try{return API?API[name](arg,__vacademyValue)"));
        assertEquals(Set.of(ScormPackageCompatibilityFixer.FIX_SET_VALUE_ARGUMENT), fixes);
    }

    @Test
    void leavesASingleArgumentHelperAloneWhenNoValueIsPassed() {
        String pkg = "function call(n,a){try{return API?API[n](a):''}catch(e){}} call('LMSInitialize','');";
        Set<String> fixes = new LinkedHashSet<>();
        assertEquals(pkg, fixer.fixDroppedSetValue(pkg, fixes));
        assertTrue(fixes.isEmpty());
    }

    @Test
    void reportsSectionsSeenAsProgressOnEveryStateSave() {
        Set<String> fixes = new LinkedHashSet<>();
        String out = fixer.addSectionProgress(SECTION_TRACKING_PACKAGE, fixes);
        assertEquals(2, out.split("__vacademySectionProgress\\(\\);SCORM\\.commit\\(\\)", -1).length - 1);
        assertTrue(out.indexOf("<script>function __vacademySectionProgress") < out.indexOf("</head>"));
        assertTrue(out.contains("SCORM.set('cmi.progress_measure'"));
        assertEquals(Set.of(ScormPackageCompatibilityFixer.FIX_SECTION_PROGRESS), fixes);
    }

    @Test
    void progressCallIsGuardedSoTheOriginalSaveAlwaysRuns() {
        String out = fixer.addSectionProgress(SECTION_TRACKING_PACKAGE, new LinkedHashSet<>());
        assertTrue(out.contains(
                "typeof __vacademySectionProgress==='function'&&__vacademySectionProgress();SCORM.commit()"));
    }

    @Test
    void doesNotTouchPackagesThatAlreadyReportProgress() {
        String pkg = SECTION_TRACKING_PACKAGE.replace("<title>t</title>",
                "<title>t</title><script>SCORM.set('cmi.progress_measure','0.5')</script>");
        Set<String> fixes = new LinkedHashSet<>();
        assertEquals(pkg, fixer.addSectionProgress(pkg, fixes));
        assertTrue(fixes.isEmpty());
    }

    @Test
    void fixIsIdempotentAcrossReUploads() {
        Set<String> fixes = new LinkedHashSet<>();
        String once = fixer.addSectionProgress(SECTION_TRACKING_PACKAGE, fixes);
        assertEquals(once, fixer.addSectionProgress(once, new LinkedHashSet<>()));
    }

    @Test
    void warnsWhenAPackageNeverReportsCompletion(@TempDir Path dir) throws IOException {
        Files.writeString(dir.resolve("index.html"), "<html><script>API.LMSInitialize('')</script></html>");
        assertEquals(List.of(ScormPackageCompatibilityFixer.WARN_NO_COMPLETION_STATUS),
                fixer.apply(dir.toFile()).warnings());

        Files.writeString(dir.resolve("lms.js"), "SetValue('cmi.completion_status','completed')");
        assertEquals(List.of(ScormPackageCompatibilityFixer.WARN_COMPLETION_ONLY),
                fixer.apply(dir.toFile()).warnings());

        Files.writeString(dir.resolve("lms.js"), "cmi.completion_status cmi.progress_measure");
        assertTrue(fixer.apply(dir.toFile()).warnings().isEmpty());
    }

    @Test
    void doesNotWarnWhenAFileWasTooLargeToScan(@TempDir Path dir) throws IOException {
        Files.writeString(dir.resolve("index.html"), "<html></html>");
        Files.write(dir.resolve("big.js"), new byte[5 * 1024 * 1024 + 1]);
        assertTrue(fixer.apply(dir.toFile()).warnings().isEmpty());
    }

    @Test
    void neverInsertsTheProgressScriptIntoJavaScriptFiles(@TempDir Path dir) throws IOException {
        String js = SECTION_TRACKING_PACKAGE.replace("<html><head><title>t</title></head>", "var tpl='<script>';");
        Path file = dir.resolve("app.js");
        Files.writeString(file, js, StandardCharsets.UTF_8);
        ScormPackageCompatibilityFixer.Report report = fixer.apply(dir.toFile());
        assertEquals(js, Files.readString(file));
        assertTrue(report.fixes().isEmpty());
    }

    @Test
    void leavesWorkingPackagesUntouched(@TempDir Path dir) throws IOException {
        String working = """
                <html><head></head><body><script>
                var api=window.parent.API_1484_11;api.Initialize('');
                function save(){api.SetValue('cmi.progress_measure','0.5');api.SetValue('cmi.completion_status','incomplete');api.Commit('')}
                </script></body></html>
                """;
        Path file = dir.resolve("index.html");
        Files.writeString(file, working, StandardCharsets.UTF_8);
        ScormPackageCompatibilityFixer.Report report = fixer.apply(dir.toFile());
        assertEquals(working, Files.readString(file));
        assertTrue(report.fixes().isEmpty());
        assertTrue(report.warnings().isEmpty());
    }

    @Test
    void appliesFixesInPlaceAcrossThePackage(@TempDir Path dir) throws IOException {
        Path launch = dir.resolve("index.html");
        Files.writeString(launch, SECTION_TRACKING_PACKAGE, StandardCharsets.UTF_8);
        Path js = Files.createDirectories(dir.resolve("js")).resolve("lms.js");
        Files.writeString(js, DROPPED_VALUE_PACKAGE, StandardCharsets.UTF_8);
        Path binary = dir.resolve("broken.js");
        byte[] invalidUtf8 = {(byte) 0xC3, (byte) 0x28, 'L', 'M', 'S'};
        Files.write(binary, invalidUtf8);

        ScormPackageCompatibilityFixer.Report report = fixer.apply(dir.toFile());

        assertTrue(report.fixes().contains(ScormPackageCompatibilityFixer.FIX_SECTION_PROGRESS));
        assertTrue(report.fixes().contains(ScormPackageCompatibilityFixer.FIX_SET_VALUE_ARGUMENT));
        assertTrue(report.warnings().isEmpty());
        assertTrue(Files.readString(launch).contains("__vacademySectionProgress();SCORM.commit()"));
        assertTrue(Files.readString(js).contains("__vacademyValue"));
        assertFalse(Files.readString(launch).contains("__vacademyValue"));
        assertTrue(java.util.Arrays.equals(invalidUtf8, Files.readAllBytes(binary)));
    }
}
