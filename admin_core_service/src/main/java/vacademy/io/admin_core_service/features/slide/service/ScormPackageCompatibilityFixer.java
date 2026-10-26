package vacademy.io.admin_core_service.features.slide.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Repairs known authoring mistakes in an unzipped SCORM package before it is
 * uploaded, and reports packages that will never move a learner's progress.
 *
 * Progress on our side comes only from what the package sends through the
 * SCORM API (see ScormTrackingService#computeScormCompletionPercentage). Two
 * patterns seen in hand-built packages leave learners stuck at 0%:
 *
 * 1. A SCORM 1.2 helper like {@code function call(name, arg) { return API[name](arg) }}
 *    that the package then calls with a value: {@code call('LMSSetValue', key, value)}.
 *    The value is dropped, so every status and score is stored empty.
 *
 * 2. A single-page package that tracks visited sections in its own state
 *    ({@code ST.seen}) and only reports completion once every section, the quiz
 *    and a Finish button are done. It never sends cmi.progress_measure, so
 *    partial progress shows as 0%. We report sections seen as progress.
 *
 * Fixing at upload means a re-upload of the same zip, or a new package from the
 * same tool, is repaired without anyone having to remember it.
 */
@Component
@Slf4j
public class ScormPackageCompatibilityFixer {

    public static final String FIX_SET_VALUE_ARGUMENT = "SET_VALUE_ARGUMENT";
    public static final String FIX_SECTION_PROGRESS = "SECTION_PROGRESS";
    public static final String WARN_NO_COMPLETION_STATUS = "NO_COMPLETION_STATUS";
    public static final String WARN_COMPLETION_ONLY = "COMPLETION_ONLY";

    private static final long MAX_SCANNED_FILE_BYTES = 5L * 1024 * 1024;

    // function NAME(a, b) { try { return API ? API[a](b) ...   (one argument forwarded)
    private static final Pattern DROPPED_VALUE_HELPER = Pattern.compile(
            "function\\s+(\\w+)\\s*\\(\\s*(\\w+)\\s*,\\s*(\\w+)\\s*\\)\\s*\\{\\s*try\\s*\\{\\s*return\\s+(\\w+)\\s*\\?\\s*\\4\\s*\\[\\s*\\2\\s*\\]\\s*\\(\\s*\\3\\s*\\)");

    private static final Pattern SET_VALUE_CALL = Pattern.compile(
            "\\b(\\w+)\\(\\s*['\"]LMSSetValue['\"]\\s*,[^,)]+,");

    // SCORM.set('cmi.suspend_data', x); SCORM.commit()   (state save of the section-tracking template)
    private static final Pattern STATE_SAVE_COMMIT = Pattern.compile(
            "(SCORM\\.set\\(\\s*['\"]cmi\\.suspend_data['\"]\\s*,[^;]*\\)\\s*;\\s*)(SCORM\\.commit\\(\\s*\\))");

    private static final String PROGRESS_FUNCTION = "__vacademySectionProgress";

    // Sections seen + quiz checked over sections + 1; 1 once the package marks itself done.
    private static final String PROGRESS_SCRIPT = "<script>function " + PROGRESS_FUNCTION + "(){try{"
            + "var st=window.ST;if(!st||!st.seen||typeof SCORM==='undefined')return;"
            + "var n=document.querySelectorAll('main section').length;if(!n)return;"
            + "var seen=0;for(var i=0;i<st.seen.length;i++){if(st.seen[i]>=0&&st.seen[i]<n)seen++}"
            + "var p=st.done?1:(Math.min(seen,n)+(st.quiz?1:0))/(n+1);"
            + "SCORM.set('cmi.progress_measure',p.toFixed(2))}catch(e){}}</script>";

    public record Report(List<String> fixes, List<String> warnings) {
    }

    /**
     * Never fails the upload: on any unexpected error the package goes up as it
     * is (minus any file already repaired) with no warnings.
     */
    public Report apply(File packageDir) {
        Set<String> fixes = new LinkedHashSet<>();
        boolean reportsStatus = false;
        boolean reportsProgress = false;
        try {
            boolean scannedEverything = true;
            for (File file : textFiles(packageDir)) {
                String original = file.length() <= MAX_SCANNED_FILE_BYTES ? readUtf8(file) : null;
                if (original == null) {
                    // Unread code may be where completion is reported; don't warn on a guess.
                    scannedEverything = false;
                    continue;
                }
                Set<String> fileFixes = new LinkedHashSet<>();
                String content = fixDroppedSetValue(original, fileFixes);
                if (isHtml(file)) {
                    content = addSectionProgress(content, fileFixes);
                }
                if (!content.equals(original)) {
                    // Temp file + rename, so a failed write never leaves a half-written file to upload.
                    Path tmp = file.toPath().resolveSibling(file.getName() + ".vacademy-fix.tmp");
                    try {
                        Files.writeString(tmp, content, StandardCharsets.UTF_8);
                        Files.move(tmp, file.toPath(), StandardCopyOption.REPLACE_EXISTING,
                                StandardCopyOption.ATOMIC_MOVE);
                        fixes.addAll(fileFixes);
                        log.info("[SCORM] Applied compatibility fix to {}", file.getName());
                    } catch (IOException e) {
                        log.warn("[SCORM] Could not write compatibility fix to {}", file.getName(), e);
                        content = original;
                        try {
                            Files.deleteIfExists(tmp);
                        } catch (IOException ignored) {
                            // Leftover only matters if it uploads; nothing more we can do here.
                        }
                    }
                }
                reportsStatus |= reportsStatus(content);
                reportsProgress |= reportsProgress(content);
            }
            List<String> warnings = scannedEverything ? warnings(reportsStatus, reportsProgress) : List.of();
            return new Report(new ArrayList<>(fixes), warnings);
        } catch (RuntimeException | StackOverflowError e) {
            log.warn("[SCORM] Compatibility check aborted; uploading package as is", e);
            return new Report(new ArrayList<>(fixes), List.of());
        }
    }

    String fixDroppedSetValue(String content, Set<String> fixes) {
        if (!content.contains("LMSSetValue")) {
            return content;
        }
        // Helpers the package really calls with a value: NAME('LMSSetValue', key, value)
        Set<String> calledWithValue = new LinkedHashSet<>();
        Matcher calls = SET_VALUE_CALL.matcher(content);
        while (calls.find()) {
            calledWithValue.add(calls.group(1));
        }
        if (calledWithValue.isEmpty()) {
            return content;
        }
        Matcher m = DROPPED_VALUE_HELPER.matcher(content);
        StringBuilder out = new StringBuilder();
        boolean changed = false;
        while (m.find()) {
            String helper = m.group(1);
            if (!calledWithValue.contains(helper)) {
                continue;
            }
            String api = m.group(4);
            String replacement = "function " + helper + "(" + m.group(2) + "," + m.group(3) + ",__vacademyValue){try{return "
                    + api + "?" + api + "[" + m.group(2) + "](" + m.group(3) + ",__vacademyValue)";
            m.appendReplacement(out, Matcher.quoteReplacement(replacement));
            changed = true;
        }
        if (!changed) {
            return content;
        }
        m.appendTail(out);
        fixes.add(FIX_SET_VALUE_ARGUMENT);
        return out.toString();
    }

    String addSectionProgress(String content, Set<String> fixes) {
        if (content.contains("progress_measure") || content.contains(PROGRESS_FUNCTION)
                || !content.contains("ST.seen") || !content.contains("main section")) {
            return content;
        }
        Matcher m = STATE_SAVE_COMMIT.matcher(content);
        if (!m.find()) {
            return content;
        }
        // Guarded: if the injected definition never loads, the package's own save must still run.
        String withCalls = m.replaceAll("$1typeof " + PROGRESS_FUNCTION + "==='function'&&" + PROGRESS_FUNCTION + "();$2");
        int head = indexOfIgnoreCase(withCalls, "</head>");
        int at = head >= 0 ? head : indexOfIgnoreCase(withCalls, "<script");
        if (at < 0) {
            return content;
        }
        fixes.add(FIX_SECTION_PROGRESS);
        return withCalls.substring(0, at) + PROGRESS_SCRIPT + withCalls.substring(at);
    }

    static boolean reportsStatus(String text) {
        return text.contains("completion_status") || text.contains("lesson_status");
    }

    static boolean reportsProgress(String text) {
        return text.contains("progress_measure") || text.contains("score.raw") || text.contains("score.scaled");
    }

    static List<String> warnings(boolean reportsStatus, boolean reportsProgress) {
        List<String> warnings = new ArrayList<>();
        if (!reportsStatus) {
            warnings.add(WARN_NO_COMPLETION_STATUS);
        } else if (!reportsProgress) {
            warnings.add(WARN_COMPLETION_ONLY);
        }
        return warnings;
    }

    // The progress fix inserts a <script> tag, so it only belongs in HTML.
    private static boolean isHtml(File file) {
        String name = file.getName().toLowerCase(Locale.ROOT);
        return name.endsWith(".html") || name.endsWith(".htm");
    }

    private List<File> textFiles(File dir) {
        List<File> out = new ArrayList<>();
        File[] files = dir.listFiles();
        if (files == null) {
            return out;
        }
        for (File f : files) {
            if (f.isDirectory()) {
                out.addAll(textFiles(f));
                continue;
            }
            String name = f.getName().toLowerCase(Locale.ROOT);
            if (name.endsWith(".html") || name.endsWith(".htm") || name.endsWith(".js")) {
                out.add(f);
            }
        }
        return out;
    }

    // Files that are not valid UTF-8 are left untouched rather than re-encoded.
    private String readUtf8(File file) {
        try {
            byte[] bytes = Files.readAllBytes(file.toPath());
            return StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes))
                    .toString();
        } catch (CharacterCodingException e) {
            return null;
        } catch (IOException e) {
            log.warn("[SCORM] Could not read {} for compatibility check", file.getName(), e);
            return null;
        }
    }

    private static int indexOfIgnoreCase(String s, String needle) {
        Matcher m = Pattern.compile(Pattern.quote(needle), Pattern.CASE_INSENSITIVE).matcher(s);
        return m.find() ? m.start() : -1;
    }
}
