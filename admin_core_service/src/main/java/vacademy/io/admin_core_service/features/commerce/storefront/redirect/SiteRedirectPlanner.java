package vacademy.io.admin_core_service.features.commerce.storefront.redirect;

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
import java.util.concurrent.ThreadLocalRandom;
import java.util.regex.Pattern;

/**
 * What a redirect file would do to {@code site_redirect}: rows to create, rows to update (with
 * their old values), rows already as the file says, and every problem, per row. Validate and
 * commit both run this, so a commit writes exactly what the validation showed.
 *
 * <p>Errors (the file cannot be committed while it has one): a path the resolver cannot store
 * (a control character anywhere in it, the query included), a target off the site (also once
 * percent-decoded: {@code /%2F%2Fhost}, a backslash, a {@code .} or {@code ..} segment), a 410
 * with a target or a 301 without one, a target that is the address of another EXACT row (in the
 * file or already stored: a second hop), a stored row that would lead to a new address, PREFIX
 * rows that send visitors round in a circle, two rows for one address, the home page, and more
 * rows (or more PREFIX rows) than an institute may hold.
 *
 * <p>Skipped with a warning (the rest of the file still goes in): a row whose target leads back
 * to its own address ({@code /cart/} to {@code /cart}: the new shop already answers there), and
 * the home page with a query ({@code /?p=123}, an old WordPress link), which the shop never looks
 * up.
 *
 * <p>Warnings (shown, not blocking): a {@code /p/<slug>} or {@code /c/<slug>} target that names no
 * ACTIVE product or collection, or spells its address in another Unicode form (the target is then
 * written as the shop stores it), a target a PREFIX row would catch again, a new PREFIX row that
 * catches stored targets, a PREFIX address that does not end at a segment ({@code /hi} also
 * catches {@code /history}), a dropped {@code #fragment}, and an address the shop edge never asks
 * about (a file such as {@code .jpg}, one of the shop's own routes, more than six segments).
 */
public final class SiteRedirectPlanner {

    public static final String EXACT = "EXACT";
    public static final String PREFIX = "PREFIX";
    /** Most rows one institute may hold. */
    public static final int MAX_ROWS_PER_INSTITUTE = 50_000;
    /**
     * Most PREFIX rows one institute may hold. The public resolver reads every PREFIX row of the
     * institute on a miss, so they are pattern rows, not one per address. A shop leaving an old
     * site needs a few catch-alls plus one paging row per old category, so 500 leaves room.
     */
    public static final int MAX_PREFIX_ROWS_PER_INSTITUTE = 500;
    /**
     * First segments the shop edge never looks up for an old address: the shop's own routes
     * (the storefront's reserved segments, {@code routes.ts}).
     */
    static final Set<String> SHOP_ROUTE_SEGMENTS = Set.of("p", "c", "q", "shop", "search", "cart", "checkout",
            "order", "track-order", "account");
    /** The edge looks up addresses of at most this many segments. */
    static final int MAX_LOOKED_UP_SEGMENTS = 6;

    /**
     * Longest one plan may run. A file of the largest size plans in about a second; past this the
     * plan stops with {@link PlanTooSlowException}, so a request never holds a connection (and, in
     * a commit, the institute's redirect lock) for long.
     */
    static final long MAX_PLAN_MILLIS = 15_000;
    /**
     * Most steps the PREFIX circle check may take in one plan. Each PREFIX row's next step is
     * worked out once and kept, so a file within the limits takes at most about 250,000 steps
     * (500 PREFIX rows, each followed round at most 501 steps); this is only a guard.
     */
    static final int MAX_PREFIX_WALK_STEPS = 1_000_000;

    private static final Pattern FILE_SEGMENT = Pattern.compile("\\.[a-z0-9]{2,12}$", Pattern.CASE_INSENSITIVE);

    /** A plan stopped because it ran past {@link #MAX_PLAN_MILLIS}. */
    public static final class PlanTooSlowException extends RuntimeException {

        PlanTooSlowException(long millis) {
            super("the redirect plan was stopped after " + millis + " ms");
        }
    }

    /** The time and the PREFIX steps one plan may still use. */
    static final class Budget {

        private final long millis;
        private final long deadline;
        private final int maxWalkSteps;
        private int walkSteps;
        private boolean walkLimitReached;

        Budget(long millis, int maxWalkSteps) {
            this.millis = millis;
            this.deadline = System.nanoTime() + millis * 1_000_000L;
            this.maxWalkSteps = maxWalkSteps;
        }

        static Budget standard() {
            return new Budget(MAX_PLAN_MILLIS, MAX_PREFIX_WALK_STEPS);
        }

        /** Stops the plan once its time is up. */
        void tick() {
            if (System.nanoTime() - deadline > 0) {
                throw new PlanTooSlowException(millis);
            }
        }

        /** One more step of the PREFIX walk; false (and remembered) once the steps are used up. */
        boolean walk() {
            if (walkSteps >= maxWalkSteps) {
                walkLimitReached = true;
                return false;
            }
            walkSteps++;
            tick();
            return true;
        }

        boolean walkLimitReached() {
            return walkLimitReached;
        }

        int maxWalkSteps() {
            return maxWalkSteps;
        }
    }

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

    /** {@code ignored}: rows read but skipped with a warning (a self-redirect, the home page with a query). */
    public record Plan(List<Change> creates, List<Change> updates, int unchanged, int ignored, List<Issue> issues,
                       int errorCount, int warningCount, String fingerprint) {

        public boolean hasErrors() {
            return errorCount > 0;
        }
    }

    /**
     * A row that passed its own checks, before the checks across rows. {@code pathOnly} is the
     * address's path without the query and without the trailing slash a PREFIX address may keep.
     * {@code skip}: read, warned about, not written.
     */
    private record Valid(int row, String matchType, String fromPath, String pathOnly, String toPath, int statusCode,
                         boolean skip) {

        String key() {
            return matchType + " " + fromPath;
        }

        Valid withTarget(String target) {
            return new Valid(row, matchType, fromPath, pathOnly, target, statusCode, skip);
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
        return plan(rows, existing, activeProducts, activeCollections, Budget.standard());
    }

    static Plan plan(List<SiteRedirectCsv.Row> rows, Collection<Existing> existing,
                     Set<String> activeProducts, Set<String> activeCollections, Budget budget) {
        List<Issue> issues = new ArrayList<>();
        List<Valid> valid = new ArrayList<>();
        Map<String, Integer> firstRowOfKey = new HashMap<>();
        int ignored = 0;
        budget.tick();

        for (SiteRedirectCsv.Row row : rows) {
            budget.tick();
            Valid checked = check(row, issues);
            if (checked == null) {
                continue;
            }
            if (checked.skip()) {
                ignored++;
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
        // Every PREFIX row once the file is in, by address: the file's replace the stored ones.
        Map<String, Existing> prefixRows = new HashMap<>();
        int storedPrefixes = 0;
        for (Existing e : existing) {
            if (PREFIX.equals(e.matchType())) {
                prefixRows.put(e.fromPath(), e);
                storedPrefixes++;
            }
        }
        for (Valid v : valid) {
            if (EXACT.equals(v.matchType())) {
                exactSource.put(v.fromPath(), "row " + v.row());
            } else {
                prefixRows.put(v.fromPath(), new Existing(null, PREFIX, v.fromPath(), v.toPath(), v.statusCode()));
            }
        }
        PrefixIndex prefixes = new PrefixIndex(prefixRows.keySet());
        // Past the cap the file is refused anyway; the loop walk is skipped so it stays cheap.
        PrefixWalker walker = prefixRows.size() <= MAX_PREFIX_ROWS_PER_INSTITUTE
                ? new PrefixWalker(prefixRows, prefixes, exactSource.keySet(), budget) : null;
        Map<String, List<String>> productsByNfc = byNfc(activeProducts);
        Map<String, List<String>> collectionsByNfc = byNfc(activeCollections);
        // Stored 301 rows the file does not replace, by the address they lead to.
        Map<String, String> storedLeadingTo = new HashMap<>();
        for (Existing e : existing) {
            budget.tick();
            if (e.statusCode() == 301 && e.toPath() != null && !firstRowOfKey.containsKey(e.matchType() + " " + e.fromPath())) {
                for (String target : targetKeys(e.toPath())) {
                    storedLeadingTo.putIfAbsent(target, e.fromPath());
                }
            }
        }

        List<Change> creates = new ArrayList<>();
        List<Change> updates = new ArrayList<>();
        int unchanged = 0;
        for (Valid checked : valid) {
            budget.tick();
            Valid v = checked;
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
                if (!blocked && walker != null) {
                    String loop = walker.loop(v.matchType(), v.fromPath(), v.toPath());
                    if (loop != null) {
                        issues.add(error(v.row(), "PREFIX_LOOP", "the target " + v.toPath() + " is caught by PREFIX"
                                + " rows that lead back round (through " + loop + "); visitors would be"
                                + " redirected in a circle"));
                        blocked = true;
                    }
                }
                if (!blocked) {
                    String prefix = catchingPrefix(prefixes, v);
                    if (prefix != null) {
                        issues.add(warning(v.row(), "TARGET_CAUGHT_BY_PREFIX", "the target " + v.toPath()
                                + " starts with the PREFIX address " + prefix + ", which redirects it again"
                                + " unless it is a page of the site"));
                    }
                    v = targetCheck(v, activeProducts, productsByNfc, activeCollections, collectionsByNfc, issues);
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
        if (walker != null && budget.walkLimitReached()) {
            issues.add(error(0, "PREFIX_CHECK_TOO_LONG", "the PREFIX rows lead into each other so often that the"
                    + " check for circles took more than " + budget.maxWalkSteps() + " steps; use fewer PREFIX rows"
                    + " whose targets other PREFIX rows catch"));
        }
        if (existing.size() + creates.size() > MAX_ROWS_PER_INSTITUTE) {
            issues.add(error(0, "TOO_MANY_REDIRECTS", "the shop would hold " + (existing.size() + creates.size())
                    + " redirects; at most " + MAX_ROWS_PER_INSTITUTE + " are allowed"));
        }
        int prefixTotal = storedPrefixes + (int) creates.stream().filter(c -> PREFIX.equals(c.matchType())).count();
        if (prefixTotal > MAX_PREFIX_ROWS_PER_INSTITUTE) {
            issues.add(error(0, "TOO_MANY_PREFIX_REDIRECTS", "the shop would hold " + prefixTotal
                    + " PREFIX redirects; at most " + MAX_PREFIX_ROWS_PER_INSTITUTE + " are allowed. PREFIX rows are"
                    + " for patterns; give single addresses EXACT rows"));
        } else {
            newPrefixWarnings(creates, existing, firstRowOfKey, prefixes, issues, budget);
        }

        issues.sort(Comparator.comparing((Issue i) -> !i.error()).thenComparingInt(Issue::row));
        int errors = (int) issues.stream().filter(Issue::error).count();
        return new Plan(List.copyOf(creates), List.copyOf(updates), unchanged, ignored, List.copyOf(issues), errors,
                issues.size() - errors, fingerprint(creates, updates, unchanged));
    }

    /**
     * A new PREFIX row that catches the targets of stored rows (which the file does not replace):
     * those visitors would be redirected a second time.
     */
    private static void newPrefixWarnings(List<Change> creates, Collection<Existing> existing,
                                          Map<String, Integer> fileKeys, PrefixIndex prefixes, List<Issue> issues,
                                          Budget budget) {
        Map<String, Change> created = new HashMap<>();
        for (Change c : creates) {
            if (PREFIX.equals(c.matchType())) {
                created.put(c.fromPath(), c);
            }
        }
        if (created.isEmpty()) {
            return;
        }
        Map<String, Integer> caught = new HashMap<>();
        Map<String, Existing> example = new HashMap<>();
        for (Existing e : existing) {
            budget.tick();
            if (e.statusCode() != 301 || e.toPath() == null || fileKeys.containsKey(e.matchType() + " " + e.fromPath())) {
                continue;
            }
            List<String> keys = targetKeys(e.toPath());
            if (keys.isEmpty()) {
                continue;
            }
            String self = PREFIX.equals(e.matchType()) ? e.fromPath() : null;
            String prefix = prefixes.longestCatching(keys.get(0), self);
            if (prefix != null && created.containsKey(prefix)) {
                caught.merge(prefix, 1, Integer::sum);
                example.putIfAbsent(prefix, e);
            }
        }
        for (Map.Entry<String, Integer> entry : caught.entrySet()) {
            Existing e = example.get(entry.getKey());
            int n = entry.getValue();
            issues.add(warning(created.get(entry.getKey()).row(), "PREFIX_CATCHES_TARGETS", n + " stored redirect"
                    + (n == 1 ? " leads" : "s lead") + " to addresses this PREFIX row catches (for example "
                    + e.fromPath() + " to " + e.toPath() + "); those visitors would be redirected again unless the"
                    + " address is a page of the site"));
        }
    }

    /**
     * The checks of one row on its own; null when it has an error (added to {@code issues}). A row
     * that is read but not written comes back with {@code skip} and one warning that says why.
     */
    private static Valid check(SiteRedirectCsv.Row row, List<Issue> issues) {
        int at = row.row();
        int before = issues.size();
        List<Issue> notes = new ArrayList<>();
        Issue skip = null;

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
        } else if (hasControl(fromRaw)) {
            issues.add(error(at, "INVALID_FROM_PATH", "from_path holds a control character (a tab, a line break or"
                    + " similar), in the path or the query; remove it"));
        } else {
            String reduced = SiteRedirectPaths.pathOfOldAddress(fromRaw);
            from = SiteRedirectResolver.normalise(reduced);
            if (from == null) {
                issues.add(error(at, "INVALID_FROM_PATH", "from_path must be a path that starts with / (or a full"
                        + " http(s) address of the old site), at most " + SiteRedirectResolver.MAX_PATH_LENGTH
                        + " characters"));
            } else {
                pathOnly = SiteRedirectPaths.pathPart(from);
                if ("/".equals(pathOnly) && from.length() > 1) {
                    skip = warning(at, "NEVER_LOOKED_UP", "the shop never looks up its home page with a query (such"
                            + " as /?p=123, an old WordPress link), so this row is skipped");
                } else if ("/".equals(pathOnly)) {
                    issues.add(error(at, "HOME_PAGE", "the home page (/) cannot be redirected"));
                } else {
                    boolean hasQuery = from.indexOf('?') >= 0;
                    if (PREFIX.equals(match) && !hasQuery && reduced.indexOf('?') < 0 && reduced.endsWith("/")) {
                        // "/product/" stops at the segment: it catches /product/x and /product, not /products.
                        from = from + "/";
                        if (from.length() > SiteRedirectResolver.MAX_PATH_LENGTH) {
                            issues.add(error(at, "INVALID_FROM_PATH", "from_path is longer than "
                                    + SiteRedirectResolver.MAX_PATH_LENGTH + " characters"));
                        }
                    } else if (PREFIX.equals(match) && !hasQuery) {
                        notes.add(warning(at, "PREFIX_NOT_AT_SEGMENT", "the PREFIX address " + from + " also catches"
                                + " every address that only starts with it (such as " + from + "-old or " + from
                                + "s); end it with / to catch " + from + " and the addresses under it only"));
                    }
                    if (SiteRedirectPaths.hasFragment(fromRaw)) {
                        notes.add(warning(at, "FRAGMENT_DROPPED", "the #part of from_path was dropped: a browser"
                                + " never sends it"));
                    }
                    String last = pathOnly.substring(pathOnly.lastIndexOf('/') + 1);
                    String unused = neverLookedUp(pathOnly);
                    if (EXACT.equals(match) && FILE_SEGMENT.matcher(last).find()) {
                        notes.add(warning(at, "FILE_ADDRESS", "the shop never looks up an address that ends in a"
                                + " file name (" + last + "), so this row is never used"));
                    } else if (unused != null) {
                        notes.add(warning(at, "NEVER_LOOKED_UP", "the shop never looks up this address (" + unused
                                + "), so this row is never used"));
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
                String problem = SiteRedirectPaths.targetProblem(to);
                if ("OFF_SITE_TARGET".equals(problem)) {
                    issues.add(error(at, "OFF_SITE_TARGET", "to_path must stay on this site: read with its %"
                            + " escapes decoded it must not start with // or /\\, hold a backslash, or have a . or .."
                            + " segment"));
                    to = null;
                } else if (problem != null) {
                    issues.add(error(at, "INVALID_TO_PATH", "to_path holds an encoded control character (such as"
                            + " %00, %09 or %0A)"));
                    to = null;
                } else if (to.length() > SiteRedirectResolver.MAX_PATH_LENGTH) {
                    issues.add(error(at, "TO_PATH_TOO_LONG", "to_path is longer than "
                            + SiteRedirectResolver.MAX_PATH_LENGTH + " characters once encoded"));
                    to = null;
                } else if (pathOnly != null
                        && pathOnly.equals(SiteRedirectResolver.normalise(SiteRedirectPaths.pathPart(to)))) {
                    if (skip == null) {
                        skip = warning(at, "SELF_REDIRECT", "to_path leads back to from_path, so the row could never"
                                + " be used (the shop already answers at this address); it is skipped");
                    }
                } else if (pathOnly != null
                        && !SiteRedirectResolver.safe(new SiteRedirectResolver.Redirect(301, to), pathOnly)) {
                    issues.add(error(at, "INVALID_TO_PATH", "to_path is not a path the shop would follow"));
                    to = null;
                }
            }
        }
        boolean failed = issues.subList(before, issues.size()).stream().anyMatch(Issue::error);
        if (failed) {
            return null;
        }
        if (skip != null) {
            issues.add(skip);
            return new Valid(at, match, from, pathOnly, to, status, true);
        }
        issues.addAll(notes);
        return new Valid(at, match, from, pathOnly, to, status, false);
    }

    /** Why the edge never asks about this address (lower-case path, no query), or null. */
    private static String neverLookedUp(String pathOnly) {
        List<String> segments = new ArrayList<>();
        for (String segment : pathOnly.split("/")) {
            if (!segment.isEmpty()) {
                segments.add(segment);
            }
        }
        if (segments.isEmpty()) {
            return null;
        }
        if (segments.size() > MAX_LOOKED_UP_SEGMENTS) {
            return "it has more than " + MAX_LOOKED_UP_SEGMENTS + " segments";
        }
        String first = segments.get(0);
        if (SHOP_ROUTE_SEGMENTS.contains(first)) {
            return "/" + first + " is one of the shop's own routes";
        }
        if (first.startsWith(".")) {
            return "a folder that starts with a dot is never a page";
        }
        return null;
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
    private static String catchingPrefix(PrefixIndex prefixes, Valid v) {
        List<String> keys = targetKeys(v.toPath());
        if (keys.isEmpty() || prefixes.isEmpty()) {
            return null;
        }
        return prefixes.longestCatching(keys.get(0), PREFIX.equals(v.matchType()) ? v.fromPath() : null);
    }

    /**
     * The PREFIX addresses of one plan, ready to find the longest one an address starts with in
     * time linear in the address: the address's leading parts are hashed once (a polynomial hash
     * with a random base, modulo 2^61 - 1) and only the PREFIX addresses of the same length and
     * hash are compared with {@code startsWith}. No leading part is copied out of the address.
     */
    static final class PrefixIndex {

        private static final long MOD = (1L << 61) - 1;

        private final Set<String> prefixes;
        private final long base;
        /** Every length a PREFIX address has, longest first. */
        private final int[] lengths;
        private final int longest;
        private final Map<Long, List<String>> byLengthAndHash = new HashMap<>();

        PrefixIndex(Set<String> prefixes) {
            this.prefixes = prefixes;
            this.base = ThreadLocalRandom.current().nextLong(1L << 16, MOD - 1);
            Set<Integer> seen = new HashSet<>();
            int max = 0;
            for (String prefix : prefixes) {
                long hash = 0;
                for (int i = 0; i < prefix.length(); i++) {
                    hash = next(hash, prefix.charAt(i));
                }
                byLengthAndHash.computeIfAbsent(key(prefix.length(), hash), k -> new ArrayList<>(1)).add(prefix);
                seen.add(prefix.length());
                max = Math.max(max, prefix.length());
            }
            this.lengths = seen.stream().mapToInt(Integer::intValue).sorted().toArray();
            for (int i = 0, j = lengths.length - 1; i < j; i++, j--) {
                int swap = lengths[i];
                lengths[i] = lengths[j];
                lengths[j] = swap;
            }
            this.longest = max;
        }

        boolean isEmpty() {
            return prefixes.isEmpty();
        }

        /**
         * The longest PREFIX address that catches the normalised address {@code full} the way the
         * resolver does: {@code full} starts with it, or it ends in {@code /} and is the address's
         * path plus that slash ({@code /product/} catches {@code /product}). {@code except} is
         * never picked.
         */
        String longestCatching(String full, String except) {
            if (prefixes.isEmpty()) {
                return null;
            }
            String pathOnly = SiteRedirectPaths.pathPart(full);
            String bare = pathOnly.length() > 1 ? pathOnly + "/" : null;
            int hashed = Math.min(full.length(), longest);
            long[] hash = new long[hashed + 1];
            for (int i = 0; i < hashed; i++) {
                hash[i + 1] = next(hash[i], full.charAt(i));
            }
            for (int length : lengths) {
                if (bare != null && length == bare.length() && !bare.equals(except) && prefixes.contains(bare)) {
                    return bare;
                }
                if (length <= hashed) {
                    List<String> same = byLengthAndHash.get(key(length, hash[length]));
                    if (same != null) {
                        for (String prefix : same) {
                            if (prefix.length() == length && !prefix.equals(except) && full.startsWith(prefix)) {
                                return prefix;
                            }
                        }
                    }
                }
            }
            return null;
        }

        private long next(long hash, char c) {
            return reduce(multiply(hash, base) + c + 1);
        }

        /** {@code a * b} modulo 2^61 - 1, for {@code a} and {@code b} below it. */
        private static long multiply(long a, long b) {
            long high = Math.multiplyHigh(a, b);
            long low = a * b;
            return reduce((low & MOD) + (low >>> 61) + (high << 3));
        }

        private static long reduce(long value) {
            long r = (value & MOD) + (value >>> 61);
            return r >= MOD ? r - MOD : r;
        }

        private static Long key(int length, long hash) {
            return hash * 1031 + length;
        }
    }

    /**
     * Follows a visitor through the PREFIX rows, as the resolver answers each step (an EXACT row
     * answers first, the longest PREFIX next, and a target equal to the address asked is never
     * handed out). The next step from each PREFIX row is the same for every row of the plan, so it
     * is worked out once and kept, and so is where a visitor arriving at a PREFIX row comes round
     * again; a row's check then costs one lookup of its own target, plus (for a PREFIX row) a walk
     * along the kept steps. Every step counts against the plan's {@link Budget}.
     */
    static final class PrefixWalker {

        /** The kept answer "the walk ends here"; no PREFIX address is empty. */
        private static final String END = "";

        private final Map<String, Existing> prefixRows;
        private final PrefixIndex index;
        private final Set<String> exactAddresses;
        private final Budget budget;
        /** PREFIX address to the PREFIX address the visitor is sent on to, or {@link #END}. */
        private final Map<String, String> nextOf = new HashMap<>();
        /** PREFIX address to the PREFIX address a visitor arriving there meets twice first, or {@link #END}. */
        private final Map<String, String> roundAt = new HashMap<>();

        PrefixWalker(Map<String, Existing> prefixRows, PrefixIndex index, Set<String> exactAddresses, Budget budget) {
            this.prefixRows = prefixRows;
            this.index = index;
            this.exactAddresses = exactAddresses;
            this.budget = budget;
        }

        /**
         * The PREFIX address at which a visitor sent to {@code toPath} by the row
         * ({@code matchType}, {@code fromPath}) comes round again, or null when the walk ends (or
         * the plan's steps are used up: the plan then reports that).
         */
        String loop(String matchType, String fromPath, String toPath) {
            if (!budget.walk()) {
                return null;
            }
            String at = step(toPath, false);
            if (at == null) {
                return null;
            }
            if (!PREFIX.equals(matchType)) {
                return roundFrom(at);
            }
            // The row's own address counts as met: the first address met twice, walking the kept steps.
            Set<String> seen = new HashSet<>();
            seen.add(fromPath);
            while (at != null) {
                if (!seen.add(at)) {
                    return at;
                }
                if (!budget.walk()) {
                    return null;
                }
                at = nextOf(at);
            }
            return null;
        }

        /**
         * The PREFIX row a visitor asking for {@code target} is sent on by, or null when the walk
         * ends there. {@code afterFirstHop}: an EXACT row for the address answers first (the row's
         * own target being an EXACT address is a chain, reported on its own).
         */
        private String step(String target, boolean afterFirstHop) {
            List<String> keys = targetKeys(target);
            if (keys.isEmpty()) {
                return null;
            }
            if (afterFirstHop) {
                for (String key : keys) {
                    if (exactAddresses.contains(key)) {
                        return null;
                    }
                }
            }
            String full = keys.get(0);
            String prefix = index.longestCatching(full, null);
            if (prefix == null) {
                return null;
            }
            Existing next = prefixRows.get(prefix);
            if (next.statusCode() != 301 || next.toPath() == null) {
                return null;
            }
            String nextPath = SiteRedirectResolver.normalise(SiteRedirectPaths.pathPart(next.toPath()));
            if (nextPath == null || nextPath.equals(SiteRedirectPaths.pathPart(full))) {
                return null;
            }
            return prefix;
        }

        private String nextOf(String prefix) {
            String known = nextOf.get(prefix);
            if (known == null) {
                String next = step(prefixRows.get(prefix).toPath(), true);
                known = next == null ? END : next;
                nextOf.put(prefix, known);
            }
            return END.equals(known) ? null : known;
        }

        /**
         * The first PREFIX address a visitor arriving at {@code start} meets twice: the first
         * address of the circle its walk runs into, or null when the walk ends.
         */
        private String roundFrom(String start) {
            List<String> path = new ArrayList<>();
            Map<String, Integer> onPath = new HashMap<>();
            String at = start;
            String result;
            while (true) {
                if (at == null) {
                    result = END;
                    break;
                }
                String known = roundAt.get(at);
                if (known != null) {
                    result = known;
                    break;
                }
                Integer index = onPath.get(at);
                if (index != null) {
                    // A circle: each of its addresses is met twice first by a visitor arriving there.
                    for (String member : path.subList(index, path.size())) {
                        roundAt.put(member, member);
                    }
                    path = path.subList(0, index);
                    result = at;
                    break;
                }
                if (!budget.walk()) {
                    return null;
                }
                onPath.put(at, path.size());
                path.add(at);
                at = nextOf(at);
            }
            for (String member : path) {
                roundAt.put(member, result);
            }
            String answer = roundAt.get(start);
            return answer == null || END.equals(answer) ? null : answer;
        }
    }

    /**
     * A {@code /p/<slug>} or {@code /c/<slug>} target against the shop's ACTIVE slugs, compared as
     * stored (no Unicode normal form: the product route matches the slug exactly). When the target
     * spells a stored slug in another Unicode form (a Devanagari nukta letter typed as one code
     * point or as two), it is written the way the shop stores the slug, so the redirect lands; a
     * warning says so. Otherwise a missing slug is a warning.
     */
    private static Valid targetCheck(Valid v, Set<String> products, Map<String, List<String>> productsByNfc,
                                     Set<String> collections, Map<String, List<String>> collectionsByNfc,
                                     List<Issue> issues) {
        String path = SiteRedirectPaths.pathPart(v.toPath());
        String[] segments = path.split("/");
        // "/p/<slug>" splits into "", "p", "<slug>".
        if (segments.length != 3) {
            return v;
        }
        boolean product = "p".equals(segments[1]);
        if (!product && !"c".equals(segments[1])) {
            return v;
        }
        String slug = SiteRedirectPaths.decodePath(segments[2]);
        if ((product ? products : collections).contains(slug)) {
            return v;
        }
        String what = product ? "product" : "collection";
        List<String> same = (product ? productsByNfc : collectionsByNfc)
                .getOrDefault(Normalizer.normalize(slug, Normalizer.Form.NFC), List.of());
        if (same.size() == 1) {
            String stored = same.get(0);
            String target = "/" + segments[1] + "/" + SiteRedirectPaths.ascii(stored) + v.toPath().substring(path.length());
            if (target.length() <= SiteRedirectResolver.MAX_PATH_LENGTH) {
                issues.add(warning(v.row(), "TARGET_SPELLING_FIXED", "the target spells the " + what + "'s address in"
                        + " another Unicode form; it is written as /" + segments[1] + "/" + stored
                        + ", the way the shop stores it, so the redirect lands"));
                return v.withTarget(target);
            }
        }
        issues.add(warning(v.row(), product ? "TARGET_PRODUCT_NOT_ACTIVE" : "TARGET_COLLECTION_NOT_ACTIVE",
                "no ACTIVE " + what + " has the address /" + segments[1] + "/" + slug + " yet"));
        return v;
    }

    /**
     * What would be wrong with the table {@code after} (every row once an undo is applied) for the
     * rows the undo puts back ({@code restoredIds}): a target that has become another row's EXACT
     * address since (a second hop), or a target that now leads into a circle of PREFIX rows. Empty
     * when the undo leaves the table as consistent as a commit would.
     */
    static List<String> restoreProblems(Collection<Existing> after, Set<String> restoredIds) {
        return restoreProblems(after, restoredIds, Budget.standard());
    }

    static List<String> restoreProblems(Collection<Existing> after, Set<String> restoredIds, Budget budget) {
        budget.tick();
        Set<String> exact = new HashSet<>();
        Map<String, Existing> prefixRows = new HashMap<>();
        for (Existing e : after) {
            if (EXACT.equals(e.matchType())) {
                exact.add(e.fromPath());
            } else {
                prefixRows.put(e.fromPath(), e);
            }
        }
        List<String> problems = new ArrayList<>();
        PrefixWalker walker = new PrefixWalker(prefixRows, new PrefixIndex(prefixRows.keySet()), exact, budget);
        for (Existing e : after) {
            budget.tick();
            if (!restoredIds.contains(e.id()) || e.statusCode() != 301 || e.toPath() == null) {
                continue;
            }
            for (String target : targetKeys(e.toPath())) {
                if (exact.contains(target) && !target.equals(e.fromPath())) {
                    problems.add("send " + e.fromPath() + " to " + e.toPath() + ", which another row now redirects");
                    break;
                }
            }
            String loop = walker.loop(e.matchType(), e.fromPath(), e.toPath());
            if (loop != null) {
                problems.add("send " + e.fromPath() + " round a circle of PREFIX rows (through " + loop + ")");
            }
        }
        if (budget.walkLimitReached()) {
            problems.add("need more than " + budget.maxWalkSteps() + " steps to check its PREFIX rows for circles");
        }
        return problems;
    }

    private static Map<String, List<String>> byNfc(Set<String> slugs) {
        Map<String, List<String>> out = new HashMap<>();
        for (String slug : slugs) {
            if (slug != null) {
                out.computeIfAbsent(Normalizer.normalize(slug, Normalizer.Form.NFC), k -> new ArrayList<>()).add(slug);
            }
        }
        return out;
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
