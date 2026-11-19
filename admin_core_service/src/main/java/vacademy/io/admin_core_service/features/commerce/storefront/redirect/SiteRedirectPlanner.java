package vacademy.io.admin_core_service.features.commerce.storefront.redirect;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * What a redirect file would do to {@code site_redirect}: rows to create, rows to update (with
 * their old values), rows already as the file says, and every problem, per row. Validate and
 * commit both run this, so a commit writes exactly what the validation showed.
 *
 * <p>Errors (the file cannot be committed while it has one): a path the resolver cannot store, a
 * target off the site, a 410 with a target or a 301 without one, a target equal to its own
 * address, a target that is the address of another EXACT row (in the file or already stored: a
 * second hop), a stored row that would lead to a new address, two rows for one address, the home
 * page, and more rows than an institute may hold.
 *
 * <p>Warnings (shown, not blocking): a {@code /p/<slug>} or {@code /c/<slug>} target that names no
 * ACTIVE product or collection, a target a PREFIX row would catch again, a dropped
 * {@code #fragment}, and an address the shop edge never asks about (a file such as {@code .jpg}).
 */
public final class SiteRedirectPlanner {

    public static final String EXACT = "EXACT";
    public static final String PREFIX = "PREFIX";
    /** Most rows one institute may hold. */
    public static final int MAX_ROWS_PER_INSTITUTE = 50_000;

    private static final Pattern FILE_SEGMENT = Pattern.compile("\\.[a-z0-9]{2,12}$", Pattern.CASE_INSENSITIVE);

    /** A stored row. */
    public record Existing(String id, String matchType, String fromPath, String toPath, int statusCode) {
    }

    /** A problem of one row ({@code row} 0 for the whole file). */
    public record Issue(int row, String code, String message, boolean error) {
    }

    /**
     * One write: {@code id} null for a create; for an update, the stored row's id and its old
     * target and status.
     */
    public record Change(int row, String id, String matchType, String fromPath, String toPath, int statusCode,
                         String oldToPath, Integer oldStatusCode) {
    }

    public record Plan(List<Change> creates, List<Change> updates, int unchanged, List<Issue> issues,
                       int errorCount, int warningCount, String fingerprint) {

        public boolean hasErrors() {
            return errorCount > 0;
        }
    }

    /** A row that passed its own checks, before the checks across rows. */
    private record Valid(int row, String matchType, String fromPath, String pathOnly, String toPath, int statusCode) {

        String key() {
            return matchType + " " + fromPath;
        }
    }

    private SiteRedirectPlanner() {
    }

    /**
     * @param rows               the file's data rows
     * @param existing           every stored row of the institute
     * @param activeProducts     slugs of the institute's ACTIVE products
     * @param activeCollections  slugs of the institute's ACTIVE collections
     */
    public static Plan plan(List<SiteRedirectCsv.Row> rows, Collection<Existing> existing,
                            Set<String> activeProducts, Set<String> activeCollections) {
        List<Issue> issues = new ArrayList<>();
        List<Valid> valid = new ArrayList<>();
        Map<String, Integer> firstRowOfKey = new HashMap<>();

        for (SiteRedirectCsv.Row row : rows) {
            Valid checked = check(row, issues);
            if (checked == null) {
                continue;
            }
            Integer first = firstRowOfKey.putIfAbsent(checked.key(), row.row());
            if (first != null) {
                issues.add(error(row.row(), "DUPLICATE_FROM_PATH", "the address " + checked.fromPath()
                        + " (" + checked.matchType() + ") is already on row " + first));
                continue;
            }
            valid.add(checked);
        }

        Map<String, Existing> stored = new HashMap<>();
        for (Existing e : existing) {
            stored.put(e.matchType() + " " + e.fromPath(), e);
        }
        // Every EXACT address once the file is in: the stored ones and the file's.
        Map<String, String> exactSource = new HashMap<>();
        for (Existing e : existing) {
            if (EXACT.equals(e.matchType())) {
                exactSource.put(e.fromPath(), "a stored redirect");
            }
        }
        Set<String> prefixes = new HashSet<>();
        for (Existing e : existing) {
            if (PREFIX.equals(e.matchType())) {
                prefixes.add(e.fromPath());
            }
        }
        for (Valid v : valid) {
            if (EXACT.equals(v.matchType())) {
                exactSource.put(v.fromPath(), "row " + v.row());
            } else {
                prefixes.add(v.fromPath());
            }
        }
        // Stored 301 rows the file does not replace, by the address they lead to.
        Map<String, String> storedLeadingTo = new HashMap<>();
        for (Existing e : existing) {
            if (e.statusCode() == 301 && e.toPath() != null && !firstRowOfKey.containsKey(e.matchType() + " " + e.fromPath())) {
                for (String target : targetKeys(e.toPath())) {
                    storedLeadingTo.putIfAbsent(target, e.fromPath());
                }
            }
        }

        List<Change> creates = new ArrayList<>();
        List<Change> updates = new ArrayList<>();
        int unchanged = 0;
        for (Valid v : valid) {
            boolean blocked = false;
            if (v.statusCode() == 301) {
                for (String target : targetKeys(v.toPath())) {
                    String source = exactSource.get(target);
                    if (source != null && !target.equals(v.fromPath())) {
                        issues.add(error(v.row(), "REDIRECT_CHAIN", "the target " + v.toPath()
                                + " is itself redirected (" + source + "); point this row at the final address"));
                        blocked = true;
                        break;
                    }
                }
                if (!blocked) {
                    String prefix = catchingPrefix(prefixes, v);
                    if (prefix != null) {
                        issues.add(warning(v.row(), "TARGET_CAUGHT_BY_PREFIX", "the target " + v.toPath()
                                + " starts with the PREFIX address " + prefix + ", which redirects it again"
                                + " unless it is a page of the site"));
                    }
                    targetWarning(v, activeProducts, activeCollections, issues);
                }
            }
            if (EXACT.equals(v.matchType())) {
                String leader = storedLeadingTo.get(v.fromPath());
                if (leader != null) {
                    issues.add(error(v.row(), "REDIRECT_CHAIN", "the stored redirect from " + leader
                            + " leads to this address; change that row in the same file or leave this one out"));
                    blocked = true;
                }
            }
            if (blocked) {
                continue;
            }
            Existing old = stored.get(v.key());
            if (old == null) {
                creates.add(new Change(v.row(), null, v.matchType(), v.fromPath(), v.toPath(), v.statusCode(),
                        null, null));
            } else if (old.statusCode() == v.statusCode() && Objects.equals(old.toPath(), v.toPath())) {
                unchanged++;
            } else {
                updates.add(new Change(v.row(), old.id(), v.matchType(), v.fromPath(), v.toPath(), v.statusCode(),
                        old.toPath(), old.statusCode()));
            }
        }
        if (existing.size() + creates.size() > MAX_ROWS_PER_INSTITUTE) {
            issues.add(error(0, "TOO_MANY_REDIRECTS", "the shop would hold " + (existing.size() + creates.size())
                    + " redirects; at most " + MAX_ROWS_PER_INSTITUTE + " are allowed"));
        }

        issues.sort(Comparator.comparing((Issue i) -> !i.error()).thenComparingInt(Issue::row));
        int errors = (int) issues.stream().filter(Issue::error).count();
        return new Plan(List.copyOf(creates), List.copyOf(updates), unchanged, List.copyOf(issues), errors,
                issues.size() - errors, fingerprint(creates, updates, unchanged));
    }

    /** The checks of one row on its own; null when it has an error (added to {@code issues}). */
    private static Valid check(SiteRedirectCsv.Row row, List<Issue> issues) {
        int at = row.row();
        int before = issues.size();

        String match = row.matchType() == null || row.matchType().isBlank() ? EXACT
                : row.matchType().trim().toUpperCase(Locale.ROOT);
        if (!EXACT.equals(match) && !PREFIX.equals(match)) {
            issues.add(error(at, "INVALID_MATCH_TYPE", "match_type must be EXACT or PREFIX"));
        }

        String fromRaw = row.fromPath() == null ? "" : row.fromPath().trim();
        String from = null;
        String pathOnly = null;
        if (fromRaw.isEmpty()) {
            issues.add(error(at, "FROM_PATH_REQUIRED", "from_path is empty"));
        } else {
            String reduced = SiteRedirectPaths.pathOfOldAddress(fromRaw);
            from = SiteRedirectResolver.normalise(reduced);
            if (from == null) {
                issues.add(error(at, "INVALID_FROM_PATH", "from_path must be a path that starts with / (or a full"
                        + " http(s) address of the old site), at most " + SiteRedirectResolver.MAX_PATH_LENGTH
                        + " characters"));
            } else {
                pathOnly = SiteRedirectPaths.pathPart(from);
                if ("/".equals(pathOnly)) {
                    issues.add(error(at, "HOME_PAGE", "the home page (/) cannot be redirected"));
                } else {
                    if (SiteRedirectPaths.hasFragment(fromRaw)) {
                        issues.add(warning(at, "FRAGMENT_DROPPED", "the #part of from_path was dropped: a browser"
                                + " never sends it"));
                    }
                    String last = pathOnly.substring(pathOnly.lastIndexOf('/') + 1);
                    if (EXACT.equals(match) && FILE_SEGMENT.matcher(last).find()) {
                        issues.add(warning(at, "FILE_ADDRESS", "the shop never looks up an address that ends in a"
                                + " file name (" + last + "), so this row is never used"));
                    }
                }
            }
        }

        String statusRaw = row.statusCode() == null ? "" : row.statusCode().trim();
        int status = 0;
        if (statusRaw.isEmpty() || "301".equals(statusRaw)) {
            status = 301;
        } else if ("410".equals(statusRaw)) {
            status = 410;
        } else {
            issues.add(error(at, "INVALID_STATUS_CODE", "status_code must be 301 (moved) or 410 (gone)"));
        }

        String toRaw = row.toPath() == null ? "" : row.toPath().trim();
        String to = null;
        if (status == 410 && !toRaw.isEmpty()) {
            issues.add(error(at, "GONE_WITH_TARGET", "a 410 row has no to_path; leave it empty"));
        } else if (status == 301) {
            if (toRaw.isEmpty()) {
                issues.add(error(at, "TO_PATH_REQUIRED", "a 301 row needs a to_path"));
            } else if (SiteRedirectPaths.leavesSite(toRaw) || toRaw.indexOf('\\') >= 0) {
                issues.add(error(at, "OFF_SITE_TARGET", "to_path must be a path on this site that starts with a"
                        + " single /, not a full or protocol-relative address"));
            } else if (!toRaw.startsWith("/") || hasControl(toRaw)) {
                issues.add(error(at, "INVALID_TO_PATH", "to_path must start with / and hold no line breaks"));
            } else {
                to = SiteRedirectPaths.ascii(toRaw);
                if (to.length() > SiteRedirectResolver.MAX_PATH_LENGTH) {
                    issues.add(error(at, "TO_PATH_TOO_LONG", "to_path is longer than "
                            + SiteRedirectResolver.MAX_PATH_LENGTH + " characters once encoded"));
                    to = null;
                } else if (pathOnly != null
                        && pathOnly.equals(SiteRedirectResolver.normalise(SiteRedirectPaths.pathPart(to)))) {
                    issues.add(error(at, "SELF_REDIRECT", "to_path leads back to from_path"));
                    to = null;
                } else if (pathOnly != null
                        && !SiteRedirectResolver.safe(new SiteRedirectResolver.Redirect(301, to), pathOnly)) {
                    issues.add(error(at, "INVALID_TO_PATH", "to_path is not a path the shop would follow"));
                    to = null;
                }
            }
        }
        boolean failed = issues.subList(before, issues.size()).stream().anyMatch(Issue::error);
        return failed ? null : new Valid(at, match, from, pathOnly, to, status);
    }

    /**
     * The addresses a visitor sent to {@code toPath} would ask the resolver for, in its order:
     * the target with its query, then without (the fragment never reaches the server).
     */
    private static List<String> targetKeys(String toPath) {
        int hash = toPath.indexOf('#');
        String target = hash < 0 ? toPath : toPath.substring(0, hash);
        String full = SiteRedirectResolver.normalise(target);
        String path = SiteRedirectResolver.normalise(SiteRedirectPaths.pathPart(target));
        List<String> out = new ArrayList<>(2);
        if (full != null) {
            out.add(full);
        }
        if (path != null && !path.equals(full)) {
            out.add(path);
        }
        return out;
    }

    /** The longest PREFIX address (other than the row's own) the target starts with, as the resolver picks it. */
    private static String catchingPrefix(Set<String> prefixes, Valid v) {
        List<String> keys = targetKeys(v.toPath());
        if (keys.isEmpty() || prefixes.isEmpty()) {
            return null;
        }
        String target = keys.get(0);
        for (int end = target.length(); end > 0; end--) {
            String prefix = target.substring(0, end);
            boolean self = PREFIX.equals(v.matchType()) && prefix.equals(v.fromPath());
            if (!self && prefixes.contains(prefix)) {
                return prefix;
            }
        }
        return null;
    }

    private static void targetWarning(Valid v, Set<String> products, Set<String> collections, List<Issue> issues) {
        String path = SiteRedirectPaths.pathPart(v.toPath());
        String[] segments = path.split("/");
        // "/p/<slug>" splits into "", "p", "<slug>".
        if (segments.length != 3) {
            return;
        }
        String slug = decode(segments[2]);
        if ("p".equals(segments[1]) && !products.contains(slug)) {
            issues.add(warning(v.row(), "TARGET_PRODUCT_NOT_ACTIVE", "no ACTIVE product has the address "
                    + "/p/" + slug + " yet"));
        } else if ("c".equals(segments[1]) && !collections.contains(slug)) {
            issues.add(warning(v.row(), "TARGET_COLLECTION_NOT_ACTIVE", "no ACTIVE collection has the address "
                    + "/c/" + slug + " yet"));
        }
    }

    private static String decode(String segment) {
        try {
            return Normalizer.normalize(URLDecoder.decode(segment.replace("+", "%2B"), StandardCharsets.UTF_8),
                    Normalizer.Form.NFC);
        } catch (IllegalArgumentException e) {
            return segment;
        }
    }

    private static boolean hasControl(String value) {
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c < 0x20 || c == 0x7F) {
                return true;
            }
        }
        return false;
    }

    /**
     * A digest of the writes the plan would make, old values included: equal for equal plans
     * against an equal table, whatever the order of the file.
     */
    static String fingerprint(List<Change> creates, List<Change> updates, int unchanged) {
        List<String> lines = new ArrayList<>(creates.size() + updates.size() + 1);
        for (Change c : creates) {
            lines.add("C\u0000" + c.matchType() + "\u0000" + c.fromPath() + "\u0000" + c.toPath() + "\u0000"
                    + c.statusCode());
        }
        for (Change u : updates) {
            lines.add("U\u0000" + u.id() + "\u0000" + u.matchType() + "\u0000" + u.fromPath() + "\u0000" + u.toPath()
                    + "\u0000" + u.statusCode() + "\u0000" + u.oldToPath() + "\u0000" + u.oldStatusCode());
        }
        lines.sort(null);
        lines.add("N\u0000" + unchanged);
        return sha256(String.join("\n", lines));
    }

    static String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static Issue error(int row, String code, String message) {
        return new Issue(row, code, message, true);
    }

    private static Issue warning(int row, String code, String message) {
        return new Issue(row, code, message, false);
    }
}
