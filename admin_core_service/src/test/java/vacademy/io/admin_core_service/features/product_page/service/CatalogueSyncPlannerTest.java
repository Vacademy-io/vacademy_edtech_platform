package vacademy.io.admin_core_service.features.product_page.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The catalogue sync's decisions: what a store page gains, loses and skips
 * when it is filled from the catalogue. Pure logic, no database.
 */
class CatalogueSyncPlannerTest {

    private static final long DAY = 24L * 60 * 60 * 1000;

    /** A sellable catalogue session: ACTIVE DEFAULT invite, ONE_TIME option, INR plan priced 4999. */
    private static CatalogueSyncPlanner.Pick pick(String session) {
        return new CatalogueSyncPlanner.Pick(session, "Course " + session, "Hindi",
                "psli-" + session, "inv-" + session, "ACTIVE", "DEFAULT", null, null, "RAZORPAY", "INR",
                "po-" + session, "ONE_TIME", "plan-" + session, 4999.0, "INR");
    }

    /** A sellable catalogue session on `vendor`, its invite and plan both in `currency`, at `price`. */
    private static CatalogueSyncPlanner.Pick sold(String session, String vendor, String currency, double price) {
        return with(with(with(with(pick(session), "vendor", vendor), "inviteCurrency", currency),
                "planCurrency", currency), "price", price);
    }

    private static CatalogueSyncPlanner.Pick with(CatalogueSyncPlanner.Pick p, String field, Object value) {
        return new CatalogueSyncPlanner.Pick(p.packageSessionId(), p.packageName(), p.levelName(),
                field.equals("psli") ? (String) value : p.psliId(),
                field.equals("invite") ? (String) value : p.inviteId(),
                field.equals("inviteStatus") ? (String) value : p.inviteStatus(),
                field.equals("inviteTag") ? (String) value : p.inviteTag(),
                field.equals("start") ? (Date) value : p.inviteStartDate(),
                field.equals("end") ? (Date) value : p.inviteEndDate(),
                field.equals("vendor") ? (String) value : p.inviteVendor(),
                field.equals("inviteCurrency") ? (String) value : p.inviteCurrency(),
                field.equals("option") ? (String) value : p.paymentOptionId(),
                field.equals("optionType") ? (String) value : p.paymentOptionType(),
                field.equals("plan") ? (String) value : p.paymentPlanId(),
                field.equals("price") ? (Double) value : p.planPrice(),
                field.equals("planCurrency") ? (String) value : p.planCurrency());
    }

    /** A healthy existing mapping on the catalogue's own bridge row and plan (priced 4999) for its session. */
    private static CatalogueSyncPlanner.Row row(String mappingId, int order, String session) {
        return new CatalogueSyncPlanner.Row(mappingId, order, session, "Course " + session, "Hindi",
                "psli-" + session, "ACTIVE", "inv-" + session, "ACTIVE", null, null, "RAZORPAY", "INR",
                true, "ACTIVE", "ONE_TIME", "plan-" + session, true, "ACTIVE", 4999.0, "INR");
    }

    /** A healthy existing mapping on `vendor`, its invite and plan both in `currency`, at `price`. */
    private static CatalogueSyncPlanner.Row rowSold(String mappingId, int order, String session, String vendor,
                                                    String currency, double price) {
        return rowWith(rowWith(rowWith(rowWith(row(mappingId, order, session), "vendor", vendor),
                "inviteCurrency", currency), "planCurrency", currency), "price", price);
    }

    private static CatalogueSyncPlanner.Row rowWith(CatalogueSyncPlanner.Row r, String field, Object value) {
        return new CatalogueSyncPlanner.Row(r.mappingId(), r.displayOrder(), r.packageSessionId(), r.packageName(),
                r.levelName(),
                field.equals("bridge") ? (String) value : r.bridgeId(),
                field.equals("bridgeStatus") ? (String) value : r.bridgeStatus(),
                r.inviteId(),
                field.equals("inviteStatus") ? (String) value : r.inviteStatus(),
                field.equals("start") ? (Date) value : r.inviteStartDate(),
                field.equals("end") ? (Date) value : r.inviteEndDate(),
                field.equals("vendor") ? (String) value : r.inviteVendor(),
                field.equals("inviteCurrency") ? (String) value : r.inviteCurrency(),
                field.equals("optionFound") ? (Boolean) value : r.paymentOptionFound(),
                field.equals("optionStatus") ? (String) value : r.paymentOptionStatus(),
                r.paymentOptionType(),
                field.equals("plan") ? (String) value : r.planId(),
                field.equals("planFound") ? (Boolean) value : r.planFound(),
                field.equals("planStatus") ? (String) value : r.planStatus(),
                field.equals("price") ? (Double) value : r.planPrice(),
                field.equals("planCurrency") ? (String) value : r.planCurrency());
    }

    private static List<String> addedSessions(CatalogueSyncPlanner.Plan plan) {
        return plan.adds().stream().map(a -> a.pick().packageSessionId()).toList();
    }

    private static List<String> deactivatedIds(CatalogueSyncPlanner.Plan plan) {
        return plan.deactivations().stream().map(d -> d.row().mappingId() + ":" + d.reason()).toList();
    }

    private static List<String> skippedReasons(CatalogueSyncPlanner.Plan plan) {
        return plan.skipped().stream().map(s -> s.pick().packageSessionId() + ":" + s.reason()).toList();
    }

    private static boolean warns(CatalogueSyncPlanner.Plan plan, String fragment) {
        return plan.warnings().stream().anyMatch(w -> w.contains(fragment));
    }

    @Test
    @DisplayName("an empty page gets every catalogue session, in catalogue order, from display order 0")
    void fillsAnEmptyPage() {
        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(List.of(),
                List.of(pick("a"), pick("b"), pick("c")), true);

        assertEquals(List.of("a", "b", "c"), addedSessions(plan));
        assertEquals(List.of(0, 1, 2), plan.adds().stream().map(CatalogueSyncPlanner.Add::displayOrder).toList());
        assertEquals("psli-b", plan.adds().get(1).pick().psliId());
        assertEquals("plan-b", plan.adds().get(1).pick().paymentPlanId());
        assertTrue(plan.deactivations().isEmpty());
        assertTrue(plan.warnings().isEmpty(), plan.warnings().toString());
    }

    @Test
    @DisplayName("sessions already sold are left alone; new ones append after the highest display order")
    void appendsOnlyWhatIsMissing() {
        List<CatalogueSyncPlanner.Row> rows = List.of(row("m1", 0, "a"), row("m2", 7, "b"));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows,
                List.of(pick("a"), pick("b"), pick("c"), pick("d")), true);

        assertEquals(List.of("c", "d"), addedSessions(plan));
        assertEquals(List.of(8, 9), plan.adds().stream().map(CatalogueSyncPlanner.Add::displayOrder).toList());
        assertTrue(plan.deactivations().isEmpty());
    }

    @Test
    @DisplayName("a session is matched by package session, so one sold on another bridge or plan is not added twice")
    void dedupesByPackageSession() {
        CatalogueSyncPlanner.Row onOtherInvite = rowWith(rowWith(row("m1", 0, "a"), "bridge", "psli-other"),
                "plan", "plan-other");

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(List.of(onOtherInvite),
                List.of(pick("a"), pick("a")), true);

        assertTrue(plan.adds().isEmpty());
        assertTrue(plan.deactivations().isEmpty());
        assertTrue(warns(plan, "different enrollment link or plan"), plan.warnings().toString());
    }

    @Test
    @DisplayName("what a store page cannot sell is skipped with a reason")
    void skipsWhatCannotBeSold() {
        Date tomorrow = new Date(System.currentTimeMillis() + 2 * DAY);
        Date lastWeek = new Date(System.currentTimeMillis() - 7 * DAY);
        List<CatalogueSyncPlanner.Pick> picks = List.of(
                with(pick("nobridge"), "psli", null),
                with(pick("dangling"), "invite", null),
                with(pick("closed"), "inviteStatus", "INACTIVE"),
                with(pick("future"), "start", tomorrow),
                with(pick("over"), "end", lastWeek),
                with(pick("nooption"), "option", null),
                with(pick("cpo"), "optionType", "CPO"),
                with(pick("noplan"), "plan", null),
                pick("ok"));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(List.of(), picks, true);

        assertEquals(List.of("ok"), addedSessions(plan));
        assertEquals(List.of(
                "nobridge:" + CatalogueSyncPlanner.NO_ACTIVE_INVITE,
                "dangling:" + CatalogueSyncPlanner.INVITE_INACTIVE,
                "closed:" + CatalogueSyncPlanner.INVITE_INACTIVE,
                "future:" + CatalogueSyncPlanner.INVITE_NOT_STARTED,
                "over:" + CatalogueSyncPlanner.INVITE_EXPIRED,
                "nooption:" + CatalogueSyncPlanner.PAYMENT_OPTION_INACTIVE,
                "cpo:" + CatalogueSyncPlanner.CPO_NOT_SUPPORTED,
                "noplan:" + CatalogueSyncPlanner.NO_ACTIVE_PLAN), skippedReasons(plan));
    }

    @Test
    @DisplayName("an invite with no status set sells, as it does at enrollment")
    void unsetInviteStatusIsOpen() {
        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(List.of(),
                List.of(with(pick("a"), "inviteStatus", null)), true);

        assertEquals(List.of("a"), addedSessions(plan));
    }

    @Test
    @DisplayName("deactivateMissing switches off mappings whose session left the catalogue")
    void deactivatesWhatLeft() {
        List<CatalogueSyncPlanner.Row> rows = List.of(row("m1", 0, "a"), row("m2", 1, "gone"));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows, List.of(pick("a"), pick("b")), true);

        assertEquals(List.of("m2:" + CatalogueSyncPlanner.LEFT_CATALOGUE), deactivatedIds(plan));
        assertEquals(List.of("b"), addedSessions(plan));
        assertEquals(2, plan.adds().get(0).displayOrder());
    }

    @Test
    @DisplayName("without deactivateMissing nothing is switched off, and the admin is told what is left over")
    void keepsEverythingWhenAsked() {
        List<CatalogueSyncPlanner.Row> rows = List.of(row("m1", 0, "a"), row("m2", 1, "gone"),
                rowWith(row("m3", 2, "c"), "bridgeStatus", "INACTIVE"));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows, List.of(pick("a"), pick("c")), false);

        assertTrue(plan.deactivations().isEmpty());
        assertTrue(plan.adds().isEmpty());
        assertTrue(warns(plan, "not in the catalogue: Course gone (Hindi)"), plan.warnings().toString());
        assertTrue(warns(plan, "inactive or closed enrollment link, payment option or plan: Course c (Hindi)"),
                plan.warnings().toString());
    }

    @Test
    @DisplayName("a mapping that can no longer be sold is replaced by the catalogue's current row")
    void replacesStaleMappings() {
        List<CatalogueSyncPlanner.Row> rows = List.of(
                rowWith(row("m1", 0, "a"), "bridgeStatus", "DELETED"),
                rowWith(row("m2", 1, "b"), "inviteStatus", "INACTIVE"),
                rowWith(row("m3", 2, "c"), "optionStatus", "INACTIVE"),
                rowWith(row("m4", 3, "d"), "planFound", false),
                rowWith(row("m5", 4, "e"), "planStatus", "DELETED"),
                rowWith(row("m6", 5, "f"), "optionFound", false),
                rowWith(row("m7", 6, "g"), "planStatus", null));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows,
                List.of(pick("a"), pick("b"), pick("c"), pick("d"), pick("e"), pick("f"), pick("g")), true);

        assertEquals(List.of(
                "m1:" + CatalogueSyncPlanner.BRIDGE_INACTIVE,
                "m2:" + CatalogueSyncPlanner.INVITE_INACTIVE,
                "m3:" + CatalogueSyncPlanner.PAYMENT_OPTION_INACTIVE,
                "m4:" + CatalogueSyncPlanner.PLAN_MISSING,
                "m5:" + CatalogueSyncPlanner.PLAN_INACTIVE,
                "m6:" + CatalogueSyncPlanner.PAYMENT_OPTION_INACTIVE), deactivatedIds(plan));
        // A status that was never set is not "inactive": m7 stays.
        assertEquals(List.of("a", "b", "c", "d", "e", "f"), addedSessions(plan));
        assertEquals(7, plan.adds().get(0).displayOrder());
    }

    @Test
    @DisplayName("a mapping whose invite window has closed, or not opened, is switched off like the Courses page closes it")
    void closedInvitesAreStale() {
        Date lastWeek = new Date(System.currentTimeMillis() - 7 * DAY);
        Date nextWeek = new Date(System.currentTimeMillis() + 7 * DAY);
        List<CatalogueSyncPlanner.Row> rows = List.of(
                row("m1", 0, "a"),
                rowWith(row("m2", 1, "over"), "end", lastWeek),
                rowWith(row("m3", 2, "later"), "start", nextWeek),
                rowWith(row("m4", 3, "moved"), "end", lastWeek));
        // "over" and "later" are on the same closed invites in the catalogue;
        // the catalogue now sells "moved" through another, open invite.
        List<CatalogueSyncPlanner.Pick> picks = List.of(pick("a"),
                with(pick("over"), "end", lastWeek),
                with(pick("later"), "start", nextWeek),
                with(with(pick("moved"), "psli", "psli-moved-2"), "invite", "inv-moved-2"));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows, picks, true);

        assertEquals(List.of(
                "m2:" + CatalogueSyncPlanner.INVITE_EXPIRED,
                "m3:" + CatalogueSyncPlanner.INVITE_NOT_STARTED,
                "m4:" + CatalogueSyncPlanner.INVITE_EXPIRED), deactivatedIds(plan));
        assertEquals(List.of(
                "over:" + CatalogueSyncPlanner.INVITE_EXPIRED,
                "later:" + CatalogueSyncPlanner.INVITE_NOT_STARTED), skippedReasons(plan));
        assertEquals(List.of("moved"), addedSessions(plan));
        assertEquals("psli-moved-2", plan.adds().get(0).pick().psliId());
    }

    @Test
    @DisplayName("an invite is open through the whole of its end day, and an unset window never closes it")
    void inviteWindowEdges() {
        Date today = new Date(System.currentTimeMillis() - 60_000);
        Date yesterday = new Date(System.currentTimeMillis() - DAY);
        CatalogueSyncPlanner.Row endsToday = rowWith(row("m1", 0, "a"), "end", today);
        CatalogueSyncPlanner.Row startedYesterday = rowWith(row("m2", 1, "b"), "start", yesterday);

        assertNull(CatalogueSyncPlanner.staleReason(endsToday));
        assertNull(CatalogueSyncPlanner.staleReason(startedYesterday));
        assertNull(CatalogueSyncPlanner.staleReason(row("m3", 2, "c")));
        // The status part stays lenient for existing rows: only an explicit non-ACTIVE status counts.
        assertNull(CatalogueSyncPlanner.staleReason(rowWith(row("m4", 3, "d"), "inviteStatus", " active ")));
        assertEquals(CatalogueSyncPlanner.INVITE_INACTIVE,
                CatalogueSyncPlanner.staleReason(rowWith(row("m5", 4, "e"), "inviteStatus", "INACTIVE")));
    }

    @Test
    @DisplayName("without deactivateMissing a closed invite is reported, not switched off")
    void closedInvitesAreReportedWhenKept() {
        Date lastWeek = new Date(System.currentTimeMillis() - 7 * DAY);
        List<CatalogueSyncPlanner.Row> rows = List.of(row("m1", 0, "a"), rowWith(row("m2", 1, "b"), "end", lastWeek));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows,
                List.of(pick("a"), with(pick("b"), "end", lastWeek)), false);

        assertTrue(plan.deactivations().isEmpty());
        assertTrue(warns(plan, "inactive or closed enrollment link, payment option or plan: Course b (Hindi)"),
                plan.warnings().toString());
    }

    @Test
    @DisplayName("an invite with no gateway (the institute default) counts as a gateway of its own beside a named one")
    void defaultGatewayCountsWhenMixed() {
        List<CatalogueSyncPlanner.Row> rows = List.of(row("m1", 0, "a"), rowWith(row("m2", 1, "b"), "vendor", " "));

        CatalogueSyncPlanner.Plan mixed = CatalogueSyncPlanner.plan(rows, List.of(pick("a"), pick("b")), true);
        assertTrue(warns(mixed, "more than one payment gateway (RAZORPAY, " + CatalogueSyncPlanner.DEFAULT_GATEWAY_LABEL
                + ")"), mixed.warnings().toString());
        // ...and a course on the institute default is not added beside a named gateway either.
        CatalogueSyncPlanner.Plan adding = CatalogueSyncPlanner.plan(List.of(row("m1", 0, "a")),
                List.of(pick("a"), with(pick("b"), "vendor", " ")), true);
        assertEquals(List.of("b:" + CatalogueSyncPlanner.VENDOR_MISMATCH), skippedReasons(adding));

        // Every invite on the institute default: one gateway, nothing to warn about, and it is added.
        CatalogueSyncPlanner.Plan allDefault = CatalogueSyncPlanner.plan(
                List.of(rowWith(row("m1", 0, "a"), "vendor", null)),
                List.of(pick("a"), with(pick("b"), "vendor", null)), true);
        assertEquals(List.of("b"), addedSessions(allDefault));
        assertTrue(allDefault.warnings().stream().noneMatch(w -> w.contains("payment gateway")),
                allDefault.warnings().toString());
    }

    @Test
    @DisplayName("a stale mapping whose catalogue row cannot be sold either is switched off and the session skipped")
    void staleAndUnsellable() {
        List<CatalogueSyncPlanner.Row> rows = List.of(row("m1", 0, "a"),
                rowWith(row("m2", 1, "b"), "inviteStatus", "INACTIVE"));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows,
                List.of(pick("a"), with(pick("b"), "inviteStatus", "INACTIVE")), true);

        assertEquals(List.of("m2:" + CatalogueSyncPlanner.INVITE_INACTIVE), deactivatedIds(plan));
        assertEquals(List.of("b:" + CatalogueSyncPlanner.INVITE_INACTIVE), skippedReasons(plan));
    }

    @Test
    @DisplayName("a sync never empties a page: an empty catalogue deactivates nothing")
    void emptyCatalogueDeactivatesNothing() {
        List<CatalogueSyncPlanner.Row> rows = List.of(row("m1", 0, "a"), row("m2", 1, "b"));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows, List.of(), true);

        assertTrue(plan.deactivations().isEmpty());
        assertTrue(plan.adds().isEmpty());
        assertTrue(warns(plan, "no published courses"), plan.warnings().toString());
    }

    @Test
    @DisplayName("a sync never empties a page: when every row would go and nothing can be added, all stay")
    void neverLeavesThePageEmpty() {
        List<CatalogueSyncPlanner.Row> rows = List.of(row("m1", 0, "gone1"), row("m2", 1, "gone2"));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows,
                List.of(with(pick("x"), "optionType", "CPO")), true);

        assertTrue(plan.deactivations().isEmpty());
        assertEquals(List.of("x:" + CatalogueSyncPlanner.CPO_NOT_SUPPORTED), skippedReasons(plan));
        assertTrue(warns(plan, "rather than leave the page empty"), plan.warnings().toString());
    }

    @Test
    @DisplayName("every row may go when the catalogue replaces them")
    void allRowsMayBeReplaced() {
        List<CatalogueSyncPlanner.Row> rows = List.of(row("m1", 0, "gone"));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows, List.of(pick("new")), true);

        assertEquals(List.of("m1:" + CatalogueSyncPlanner.LEFT_CATALOGUE), deactivatedIds(plan));
        assertEquals(List.of("new"), addedSessions(plan));
        assertEquals(1, plan.adds().get(0).displayOrder());
    }

    @Test
    @DisplayName("mixed gateways and currencies already on the page are warned about, and left as they are")
    void warnsOnMixedVendorsAndCurrencies() {
        List<CatalogueSyncPlanner.Row> rows = List.of(row("m1", 0, "a"),
                rowWith(rowWith(rowWith(row("m2", 1, "b"), "vendor", "cashfree"), "inviteCurrency", "USD"),
                        "planCurrency", "USD"));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows, List.of(pick("a"), pick("b")), true);

        assertTrue(plan.deactivations().isEmpty());
        assertTrue(plan.adds().isEmpty());
        assertTrue(warns(plan, "more than one payment gateway (CASHFREE, RAZORPAY)"), plan.warnings().toString());
        assertTrue(warns(plan, "more than one currency (INR, USD). Checkout refuses a cart that mixes them"),
                plan.warnings().toString());
    }

    @Test
    @DisplayName("a row charged in its invite's currency but priced in another plan currency is reported on its own")
    void warnsOnARowWhoseInviteAndPlanCurrenciesDiffer() {
        List<CatalogueSyncPlanner.Row> rows = List.of(row("m1", 0, "a"),
                rowWith(row("m2", 1, "b"), "planCurrency", "USD"));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows, List.of(pick("a"), pick("b")), true);

        // Checkout charges both in INR (each invite's currency), so the cart is not mixed...
        assertTrue(plan.warnings().stream().noneMatch(w -> w.contains("more than one currency")),
                plan.warnings().toString());
        // ...but the USD plan's number is charged in rupees.
        assertTrue(warns(plan, "1 course is charged in the currency the enrollment link names, not the one the plan "
                + "names: Course b (Hindi)"), plan.warnings().toString());
    }

    @Test
    @DisplayName("switched-off rows do not count towards the mixed-gateway warning")
    void deactivatedRowsDoNotWarn() {
        List<CatalogueSyncPlanner.Row> rows = List.of(row("m1", 0, "a"),
                rowWith(row("m2", 1, "gone"), "vendor", "STRIPE"));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows, List.of(pick("a")), true);

        assertEquals(List.of("m2:" + CatalogueSyncPlanner.LEFT_CATALOGUE), deactivatedIds(plan));
        assertTrue(plan.warnings().isEmpty(), plan.warnings().toString());
    }

    @Test
    @DisplayName("duplicates and recurring options are reported; a non-default invite is skipped, not added")
    void reportsOddities() {
        List<CatalogueSyncPlanner.Row> rows = List.of(row("m1", 0, "a"),
                rowWith(row("m2", 1, "a"), "plan", "plan-combo"));
        List<CatalogueSyncPlanner.Pick> picks = List.of(pick("a"),
                with(pick("b"), "inviteTag", null),
                with(pick("c"), "optionType", "SUBSCRIPTION"));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows, picks, true);

        assertEquals(List.of("c"), addedSessions(plan));
        assertEquals(List.of("b:" + CatalogueSyncPlanner.NON_DEFAULT_INVITE), skippedReasons(plan));
        assertTrue(warns(plan, "1 course is on this page more than once"), plan.warnings().toString());
        assertTrue(warns(plan, "subscription or donation payment option"), plan.warnings().toString());
        assertTrue(plan.warnings().stream().noneMatch(w -> w.contains("not the course's default")),
                plan.warnings().toString());
        // Two rows for one session (plan tiles) are a choice, not price drift.
        assertTrue(plan.warnings().stream().noneMatch(w -> w.contains("different enrollment link")),
                plan.warnings().toString());
    }

    @Test
    @DisplayName("warnings list a handful of names, then a count")
    void longListsAreShortened() {
        List<CatalogueSyncPlanner.Pick> picks = new ArrayList<>();
        for (int i = 0; i < 8; i++) picks.add(with(pick("s" + i), "optionType", "DONATION"));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(List.of(), picks, true);

        assertTrue(warns(plan, "8 courses were added on a subscription or donation"), plan.warnings().toString());
        assertTrue(warns(plan, "Course s4 (Hindi) and 3 more"), plan.warnings().toString());
    }

    /* ── which enrollment link a course is added on ──────────────────── */

    @Test
    @DisplayName("a session the catalogue can only offer through a non-default link is skipped, never added")
    void nonDefaultInviteIsSkipped() {
        Date lastWeek = new Date(System.currentTimeMillis() - 7 * DAY);
        List<CatalogueSyncPlanner.Pick> picks = List.of(
                with(pick("scholarship"), "inviteTag", "SCHOLARSHIP"),
                with(pick("untagged"), "inviteTag", null),
                // Not the default link AND closed: the link is the problem, so that is what is reported.
                with(with(pick("oldpromo"), "inviteTag", "PROMO"), "end", lastWeek),
                // The default link itself has closed: extend it.
                with(pick("closeddefault"), "end", lastWeek),
                with(pick("padded"), "inviteTag", " default "),
                pick("ok"));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(List.of(), picks, true);

        assertEquals(List.of("padded", "ok"), addedSessions(plan));
        assertEquals(List.of(
                "scholarship:" + CatalogueSyncPlanner.NON_DEFAULT_INVITE,
                "untagged:" + CatalogueSyncPlanner.NON_DEFAULT_INVITE,
                "oldpromo:" + CatalogueSyncPlanner.NON_DEFAULT_INVITE,
                "closeddefault:" + CatalogueSyncPlanner.INVITE_EXPIRED), skippedReasons(plan));
    }

    @Test
    @DisplayName("an existing row on a non-default link is kept as it is: the rule only decides what is added")
    void existingNonDefaultRowsAreKept() {
        // The catalogue now offers "a" only through a scholarship link; the page's own row stays.
        List<CatalogueSyncPlanner.Row> rows = List.of(row("m1", 0, "a"));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows,
                List.of(with(pick("a"), "inviteTag", "SCHOLARSHIP")), true);

        assertTrue(plan.deactivations().isEmpty());
        assertTrue(plan.adds().isEmpty());
        assertTrue(plan.skipped().isEmpty(), "a session the page already sells is not a candidate");
    }

    /* ── one gateway and one currency per page ───────────────────────── */

    @Test
    @DisplayName("a course on another gateway than the page is skipped vendor_mismatch")
    void vendorMismatchIsSkipped() {
        List<CatalogueSyncPlanner.Row> rows = List.of(row("m1", 0, "a"));
        List<CatalogueSyncPlanner.Pick> picks = List.of(pick("a"),
                with(pick("stripe"), "vendor", "STRIPE"),
                with(pick("lower"), "vendor", " razorpay "),
                pick("same"));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows, picks, true);

        // Gateways compare without case or padding.
        assertEquals(List.of("lower", "same"), addedSessions(plan));
        assertEquals(List.of("stripe:" + CatalogueSyncPlanner.VENDOR_MISMATCH), skippedReasons(plan));
        assertTrue(plan.warnings().stream().noneMatch(w -> w.contains("payment gateway")), plan.warnings().toString());
    }

    @Test
    @DisplayName("a course in another currency than the page is skipped currency_mismatch, its invite's currency first")
    void currencyMismatchIsSkipped() {
        List<CatalogueSyncPlanner.Row> rows = List.of(row("m1", 0, "a"));
        List<CatalogueSyncPlanner.Pick> picks = List.of(pick("a"),
                with(with(pick("usd"), "inviteCurrency", "USD"), "planCurrency", "USD"),
                // No currency on the invite: the plan's is the one checkout charges.
                with(with(pick("planusd"), "inviteCurrency", null), "planCurrency", "USD"),
                // Invite and plan disagree: its plan's price would be charged in its invite's currency.
                with(pick("split"), "planCurrency", "USD"),
                // Gateway and currency both differ: the currency is what blocks it.
                with(with(with(pick("both"), "vendor", "STRIPE"), "inviteCurrency", "USD"), "planCurrency", "USD"),
                // Nothing names a currency: nothing to disagree with.
                with(with(pick("unknown"), "inviteCurrency", null), "planCurrency", " "),
                with(with(pick("lower"), "inviteCurrency", "inr"), "planCurrency", null));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows, picks, true);

        assertEquals(List.of("unknown", "lower"), addedSessions(plan));
        assertEquals(List.of(
                "usd:" + CatalogueSyncPlanner.CURRENCY_MISMATCH,
                "planusd:" + CatalogueSyncPlanner.CURRENCY_MISMATCH,
                "split:" + CatalogueSyncPlanner.CURRENCY_MISMATCH,
                "both:" + CatalogueSyncPlanner.CURRENCY_MISMATCH), skippedReasons(plan));
        assertTrue(plan.warnings().stream().noneMatch(w -> w.contains("currency")), plan.warnings().toString());
    }

    @Test
    @DisplayName("the page's first row in display order sets its gateway and currency; existing rows are never changed")
    void firstRowSetsTheTerms() {
        List<CatalogueSyncPlanner.Row> rows = List.of(
                rowWith(rowWith(rowWith(row("m1", 0, "a"), "vendor", "STRIPE"), "inviteCurrency", "USD"),
                        "planCurrency", "USD"),
                row("m2", 1, "b"));
        List<CatalogueSyncPlanner.Pick> picks = List.of(pick("a"), pick("b"),
                with(with(with(pick("stripeusd"), "vendor", "STRIPE"), "inviteCurrency", "USD"), "planCurrency", "USD"),
                with(pick("stripeinr"), "vendor", "STRIPE"),
                with(with(pick("razorpayusd"), "inviteCurrency", "USD"), "planCurrency", "USD"),
                pick("razorpayinr"));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows, picks, true);

        assertEquals(List.of("stripeusd"), addedSessions(plan));
        assertEquals(List.of(
                "stripeinr:" + CatalogueSyncPlanner.CURRENCY_MISMATCH,
                "razorpayusd:" + CatalogueSyncPlanner.VENDOR_MISMATCH,
                "razorpayinr:" + CatalogueSyncPlanner.CURRENCY_MISMATCH), skippedReasons(plan));
        // The mixed rows already there stay, and are reported.
        assertTrue(plan.deactivations().isEmpty());
        assertTrue(warns(plan, "more than one payment gateway (RAZORPAY, STRIPE)"), plan.warnings().toString());
        assertTrue(warns(plan, "more than one currency (INR, USD)"), plan.warnings().toString());
    }

    @Test
    @DisplayName("when the first row is switched off, the next remaining row sets the terms")
    void termsComeFromTheRowsThatStay() {
        List<CatalogueSyncPlanner.Row> rows = List.of(
                rowWith(rowWith(rowWith(row("m1", 0, "gone"), "vendor", "STRIPE"), "inviteCurrency", "USD"),
                        "planCurrency", "USD"),
                row("m2", 1, "a"));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows, List.of(pick("a"), pick("b")), true);

        assertEquals(List.of("m1:" + CatalogueSyncPlanner.LEFT_CATALOGUE), deactivatedIds(plan));
        assertEquals(List.of("b"), addedSessions(plan));
        assertTrue(plan.skipped().isEmpty(), plan.skipped().toString());
    }

    @Test
    @DisplayName("an empty page takes its gateway and currency from the first course that can be added")
    void emptyPageTakesTheFirstAddableCourse() {
        List<CatalogueSyncPlanner.Pick> picks = List.of(
                // Cannot be sold at all, so it does not decide anything.
                with(with(with(pick("cpo"), "optionType", "CPO"), "vendor", "STRIPE"), "planCurrency", "EUR"),
                // Its invite and plan disagree, so it cannot decide the page's currency either.
                with(with(pick("split"), "vendor", "CASHFREE"), "planCurrency", "USD"),
                with(with(with(pick("first"), "vendor", "CASHFREE"), "inviteCurrency", "USD"), "planCurrency", "USD"),
                pick("razorpay"),
                with(with(with(pick("again"), "vendor", "cashfree"), "inviteCurrency", "USD"), "planCurrency", null));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(List.of(), picks, true);

        assertEquals(List.of("first", "again"), addedSessions(plan));
        assertEquals(List.of(
                "cpo:" + CatalogueSyncPlanner.CPO_NOT_SUPPORTED,
                "split:" + CatalogueSyncPlanner.CURRENCY_MISMATCH,
                "razorpay:" + CatalogueSyncPlanner.CURRENCY_MISMATCH), skippedReasons(plan));
        assertEquals(new CatalogueSyncPlanner.Terms("CASHFREE", "USD", true),
                CatalogueSyncPlanner.pageTerms(List.of(), picks));
    }

    @Test
    @DisplayName("rows naming no currency leave the page's currency to the first addable course that names one")
    void currencyFromCoursesWhenRowsNameNone() {
        List<CatalogueSyncPlanner.Row> rows = List.of(
                rowWith(rowWith(row("m1", 0, "a"), "inviteCurrency", null), "planCurrency", null));
        List<CatalogueSyncPlanner.Pick> picks = List.of(pick("a"),
                with(with(pick("none"), "inviteCurrency", null), "planCurrency", null),
                with(with(pick("usd"), "inviteCurrency", "USD"), "planCurrency", "USD"),
                pick("inr"));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows, picks, true);

        assertEquals(List.of("none", "usd"), addedSessions(plan));
        assertEquals(List.of("inr:" + CatalogueSyncPlanner.CURRENCY_MISMATCH), skippedReasons(plan));
    }

    @Test
    @DisplayName("a course on another gateway never decides the page's currency")
    void otherGatewayDoesNotDecideTheCurrency() {
        List<CatalogueSyncPlanner.Row> rows = List.of(
                rowWith(rowWith(row("m1", 0, "a"), "inviteCurrency", null), "planCurrency", null));
        List<CatalogueSyncPlanner.Pick> picks = List.of(pick("a"),
                with(with(with(pick("stripeusd"), "vendor", "STRIPE"), "inviteCurrency", "USD"), "planCurrency", "USD"),
                pick("inr"));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows, picks, true);

        // The page is on RAZORPAY: the STRIPE course is skipped, and the RAZORPAY one sets the currency.
        assertEquals(List.of("inr"), addedSessions(plan));
        assertEquals(List.of("stripeusd:" + CatalogueSyncPlanner.CURRENCY_MISMATCH), skippedReasons(plan));
        assertEquals(new CatalogueSyncPlanner.Terms("RAZORPAY", "INR", true),
                CatalogueSyncPlanner.pageTerms(rows, picks.subList(1, 3)));
    }

    /* ── free courses: charged nothing, so their gateway and currency decide nothing ── */

    private static List<Integer> addedOrders(CatalogueSyncPlanner.Plan plan) {
        return plan.adds().stream().map(CatalogueSyncPlanner.Add::displayOrder).toList();
    }

    @Test
    @DisplayName("an empty page whose first catalogue course is free and labelled INR still adds the paid AUD courses, paid ones first")
    void freeFirstCourseDoesNotSetAnEmptyPagesCurrency() {
        // Free plans are created in INR by the server, so a free course's label says nothing.
        List<CatalogueSyncPlanner.Pick> picks = List.of(
                sold("a-intro", "EWAY", "INR", 0),
                sold("physics", "EWAY", "AUD", 499),
                sold("chemistry", "EWAY", "AUD", 399));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(List.of(), picks, true);

        // The paid courses are numbered first, so the page's first row (whose
        // currency by-code shows) is an AUD course, not the free INR one.
        assertEquals(List.of("physics", "chemistry", "a-intro"), addedSessions(plan));
        assertEquals(List.of(0, 1, 2), addedOrders(plan));
        assertTrue(plan.skipped().isEmpty(), plan.skipped().toString());
        assertEquals(new CatalogueSyncPlanner.Terms("EWAY", "AUD", true),
                CatalogueSyncPlanner.pageTerms(List.of(), picks));
        assertTrue(plan.warnings().isEmpty(), plan.warnings().toString());
    }

    @Test
    @DisplayName("an empty page whose first catalogue course is free on a stale gateway still adds every paid course on the real one")
    void freeFirstCourseOnAStaleGatewayDoesNotSetTheGateway() {
        // A free course whose default invite fell back to STRIPE before Razorpay
        // was set up sorts first; the paid courses are on RAZORPAY.
        List<CatalogueSyncPlanner.Pick> picks = List.of(
                sold("ps-intro", "STRIPE", "INR", 0),
                sold("ps-bio", "RAZORPAY", "INR", 999),
                sold("ps-chem", "RAZORPAY", "INR", 1999));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(List.of(), picks, true);

        assertEquals(List.of("ps-bio", "ps-chem", "ps-intro"), addedSessions(plan));
        assertEquals(List.of(0, 1, 2), addedOrders(plan));
        assertTrue(plan.skipped().isEmpty(), plan.skipped().toString());
        assertEquals(new CatalogueSyncPlanner.Terms("RAZORPAY", "INR", true),
                CatalogueSyncPlanner.pageTerms(List.of(), picks));
        // The free course is never charged, so as far as checkout goes the page is on one gateway.
        assertTrue(plan.warnings().isEmpty(), plan.warnings().toString());
    }

    @Test
    @DisplayName("free courses join a priced page whatever their gateway or currency labels")
    void freeCoursesJoinAPricedPage() {
        List<CatalogueSyncPlanner.Row> rows = List.of(rowSold("m1", 0, "a", "EWAY", "AUD", 499));
        List<CatalogueSyncPlanner.Pick> picks = List.of(sold("a", "EWAY", "AUD", 499),
                sold("freeinr", "EWAY", "INR", 0),
                // Invite and plan disagree, but nothing is charged in either.
                with(sold("freesplit", "EWAY", "INR", 0), "planCurrency", "GBP"),
                with(sold("noprice", "EWAY", "INR", 0), "price", null),
                // Checkout takes the gateway from the cart's first priced course, never from a free one.
                sold("freestripe", "STRIPE", "INR", 0),
                sold("paidinr", "EWAY", "INR", 999),
                sold("paidaud", "EWAY", "AUD", 399));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows, picks, true);

        assertEquals(List.of("paidaud", "freeinr", "freesplit", "noprice", "freestripe"), addedSessions(plan));
        assertEquals(List.of(1, 2, 3, 4, 5), addedOrders(plan));
        assertEquals(List.of("paidinr:" + CatalogueSyncPlanner.CURRENCY_MISMATCH), skippedReasons(plan));
        assertTrue(plan.warnings().stream().noneMatch(w -> w.contains("currency")), plan.warnings().toString());
        assertTrue(plan.warnings().stream().noneMatch(w -> w.contains("payment gateway")), plan.warnings().toString());
    }

    @Test
    @DisplayName("a free row first on the page sets neither its gateway nor its currency, and is not warned about")
    void freeRowDoesNotSetThePageTerms() {
        List<CatalogueSyncPlanner.Row> rows = List.of(
                rowWith(rowSold("m1", 0, "a", "STRIPE", "INR", 0), "planCurrency", "GBP"),
                rowSold("m2", 1, "b", "EWAY", "AUD", 499));
        List<CatalogueSyncPlanner.Pick> picks = List.of(
                with(sold("a", "STRIPE", "INR", 0), "planCurrency", "GBP"),
                sold("b", "EWAY", "AUD", 499),
                sold("paidaud", "EWAY", "AUD", 399),
                sold("paidinr", "EWAY", "INR", 399),
                sold("stripe", "STRIPE", "AUD", 399));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows, picks, true);

        assertEquals(List.of("paidaud"), addedSessions(plan));
        assertEquals(List.of(
                "paidinr:" + CatalogueSyncPlanner.CURRENCY_MISMATCH,
                "stripe:" + CatalogueSyncPlanner.VENDOR_MISMATCH), skippedReasons(plan));
        assertEquals(new CatalogueSyncPlanner.Terms("EWAY", "AUD", true),
                CatalogueSyncPlanner.pageTerms(rows, picks.subList(2, 5)));
        // Checkout charges the free row nothing, so the page is not mixed, and its labels are not a price.
        assertTrue(plan.warnings().stream().noneMatch(w -> w.contains("currency")), plan.warnings().toString());
        assertTrue(plan.warnings().stream().noneMatch(w -> w.contains("payment gateway")), plan.warnings().toString());
        // The row itself stays exactly as it is.
        assertTrue(plan.deactivations().isEmpty());
    }

    @Test
    @DisplayName("on a page that sells something priced a free course is never skipped for its gateway or currency; a priced one still is")
    void termsReasonIgnoresFreeCourses() {
        CatalogueSyncPlanner.Terms page = new CatalogueSyncPlanner.Terms("RAZORPAY", "INR", true);

        assertNull(CatalogueSyncPlanner.termsReason(sold("free", "STRIPE", "USD", 0), page));
        assertNull(CatalogueSyncPlanner.termsReason(with(sold("free", "STRIPE", "USD", 0), "planCurrency", "GBP"),
                page));
        assertNull(CatalogueSyncPlanner.termsReason(with(sold("noplan", "STRIPE", "USD", 0), "price", null), page));
        // The priced course that decides names no gateway (the institute default).
        assertNull(CatalogueSyncPlanner.termsReason(sold("free", "STRIPE", "USD", 0),
                new CatalogueSyncPlanner.Terms(null, null, true)));
        assertEquals(CatalogueSyncPlanner.VENDOR_MISMATCH,
                CatalogueSyncPlanner.termsReason(sold("paid", "STRIPE", "INR", 1), page));
        assertEquals(CatalogueSyncPlanner.CURRENCY_MISMATCH,
                CatalogueSyncPlanner.termsReason(sold("paid", "RAZORPAY", "USD", 1), page));
        assertNull(CatalogueSyncPlanner.termsReason(sold("paid", "razorpay", "inr", 1), page));
    }

    @Test
    @DisplayName("on a page where nothing is priced a free course must share the page's gateway, whatever its currency label")
    void termsReasonOnAPageWhereNothingIsPriced() {
        // A cart there is charged (the basket price) through its first course's gateway.
        CatalogueSyncPlanner.Terms page = new CatalogueSyncPlanner.Terms("RAZORPAY", null, false);

        assertEquals(CatalogueSyncPlanner.VENDOR_MISMATCH,
                CatalogueSyncPlanner.termsReason(sold("free", "STRIPE", "INR", 0), page));
        assertEquals(CatalogueSyncPlanner.VENDOR_MISMATCH,
                CatalogueSyncPlanner.termsReason(with(sold("free", "RAZORPAY", "INR", 0), "vendor", null), page));
        assertNull(CatalogueSyncPlanner.termsReason(sold("free", " razorpay ", "INR", 0), page));
        // A free course's currency is only a label: it is not checked, as before.
        assertNull(CatalogueSyncPlanner.termsReason(with(sold("free", "RAZORPAY", "USD", 0), "planCurrency", "GBP"),
                page));
        // The first course names no gateway (the institute default): so must every other.
        CatalogueSyncPlanner.Terms onDefault = new CatalogueSyncPlanner.Terms(null, null, false);
        assertNull(CatalogueSyncPlanner.termsReason(with(sold("free", "STRIPE", "INR", 0), "vendor", " "), onDefault));
        assertEquals(CatalogueSyncPlanner.VENDOR_MISMATCH,
                CatalogueSyncPlanner.termsReason(sold("free", "STRIPE", "INR", 0), onDefault));
    }

    @Test
    @DisplayName("courses added after a page's rows are numbered paid ones first, each in catalogue order")
    void paidAdditionsAreNumberedFirst() {
        List<CatalogueSyncPlanner.Row> rows = List.of(row("m1", 0, "a"), row("m2", 3, "b"));
        List<CatalogueSyncPlanner.Pick> picks = List.of(pick("a"), pick("b"),
                with(pick("free1"), "price", 0.0),
                pick("paid1"),
                with(pick("free2"), "price", null),
                pick("paid2"));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows, picks, true);

        assertEquals(List.of("paid1", "paid2", "free1", "free2"), addedSessions(plan));
        assertEquals(List.of(4, 5, 6, 7), addedOrders(plan));
        assertTrue(plan.deactivations().isEmpty());
    }

    @Test
    @DisplayName("the first priced row decides the gateway even when its invite names none (the institute default)")
    void pricedRowOnTheInstituteDefaultDecides() {
        List<CatalogueSyncPlanner.Row> rows = List.of(
                rowSold("m1", 0, "a", "STRIPE", "INR", 0),
                rowWith(row("m2", 1, "b"), "vendor", " "));
        List<CatalogueSyncPlanner.Pick> picks = List.of(
                sold("a", "STRIPE", "INR", 0),
                with(pick("b"), "vendor", " "),
                with(pick("onstripe"), "vendor", "STRIPE"),
                with(pick("ondefault"), "vendor", null),
                with(with(pick("freestripe"), "vendor", "STRIPE"), "price", 0.0));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows, picks, true);

        assertEquals(new CatalogueSyncPlanner.Terms(null, "INR", true),
                CatalogueSyncPlanner.pageTerms(rows, picks.subList(2, 5)));
        assertEquals(List.of("ondefault", "freestripe"), addedSessions(plan));
        assertEquals(List.of("onstripe:" + CatalogueSyncPlanner.VENDOR_MISMATCH), skippedReasons(plan));
    }

    @Test
    @DisplayName("a page where nothing is priced (basket pricing) keeps its first course's gateway: a free course on another is skipped, as before")
    void pageWithNothingPricedKeepsTheFirstCoursesGateway() {
        // FLAT basket pricing: every course is 0 and the basket sets the money,
        // so a cart is charged through its first course's gateway.
        List<CatalogueSyncPlanner.Row> rows = List.of(rowSold("m1", 0, "a", "RAZORPAY", "INR", 0));
        List<CatalogueSyncPlanner.Pick> picks = List.of(sold("a", "RAZORPAY", "INR", 0),
                sold("b", "RAZORPAY", "INR", 0),
                sold("c", "STRIPE", "USD", 0));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows, picks, true);

        assertEquals(new CatalogueSyncPlanner.Terms("RAZORPAY", null, false),
                CatalogueSyncPlanner.pageTerms(rows, picks.subList(1, 3)));
        assertEquals(List.of("b"), addedSessions(plan));
        assertEquals(List.of("c:" + CatalogueSyncPlanner.VENDOR_MISMATCH), skippedReasons(plan));
        assertTrue(plan.warnings().isEmpty(), plan.warnings().toString());
    }

    @Test
    @DisplayName("an empty page where nothing is priced takes its gateway from the first course that can be added, as before")
    void emptyPageWithNothingPricedTakesTheFirstCoursesGateway() {
        List<CatalogueSyncPlanner.Pick> picks = List.of(
                // Cannot be sold at all, so it does not decide anything.
                with(sold("cpo", "EWAY", "AUD", 0), "optionType", "CPO"),
                sold("c", "STRIPE", "USD", 0),
                sold("b", "RAZORPAY", "INR", 0),
                with(sold("d", "STRIPE", "INR", 0), "planCurrency", "GBP"));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(List.of(), picks, true);

        assertEquals(new CatalogueSyncPlanner.Terms("STRIPE", null, false),
                CatalogueSyncPlanner.pageTerms(List.of(), picks));
        assertEquals(List.of("c", "d"), addedSessions(plan));
        assertEquals(List.of(0, 1), addedOrders(plan));
        assertEquals(List.of(
                "cpo:" + CatalogueSyncPlanner.CPO_NOT_SUPPORTED,
                "b:" + CatalogueSyncPlanner.VENDOR_MISMATCH), skippedReasons(plan));
        assertTrue(plan.warnings().isEmpty(), plan.warnings().toString());
    }

    @Test
    @DisplayName("a page where nothing is priced warns when the courses already on it mix gateways")
    void pageWithNothingPricedWarnsOnMixedGateways() {
        // Rows already on the page are never changed, so the page stays mixed.
        List<CatalogueSyncPlanner.Row> rows = List.of(rowSold("m1", 0, "a", "RAZORPAY", "INR", 0),
                rowSold("m2", 1, "d", "STRIPE", "INR", 0));
        List<CatalogueSyncPlanner.Pick> picks = List.of(sold("a", "RAZORPAY", "INR", 0),
                sold("d", "STRIPE", "INR", 0),
                sold("b", "RAZORPAY", "INR", 0),
                sold("c", "STRIPE", "USD", 0));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows, picks, true);

        assertEquals(List.of("b"), addedSessions(plan));
        assertEquals(List.of("c:" + CatalogueSyncPlanner.VENDOR_MISMATCH), skippedReasons(plan));
        assertTrue(plan.deactivations().isEmpty());
        assertTrue(warns(plan, "more than one payment gateway (RAZORPAY, STRIPE). Checkout charges the whole cart "
                + "through the gateway of the first course in it."), plan.warnings().toString());
        assertTrue(plan.warnings().stream().noneMatch(w -> w.contains("currency")), plan.warnings().toString());
    }

    @Test
    @DisplayName("a priced course in the catalogue decides the gateway of a page of free rows, so free courses on any gateway join it")
    void pricedCourseDecidesAPageOfFreeRows() {
        List<CatalogueSyncPlanner.Row> rows = List.of(rowSold("m1", 0, "a", "STRIPE", "INR", 0));
        List<CatalogueSyncPlanner.Pick> picks = List.of(sold("a", "STRIPE", "INR", 0),
                sold("free", "EWAY", "INR", 0),
                sold("bio", "RAZORPAY", "INR", 999),
                sold("chem", "STRIPE", "INR", 1999));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows, picks, true);

        assertEquals(new CatalogueSyncPlanner.Terms("RAZORPAY", "INR", true),
                CatalogueSyncPlanner.pageTerms(rows, picks.subList(1, 4)));
        assertEquals(List.of("bio", "free"), addedSessions(plan));
        assertEquals(List.of(1, 2), addedOrders(plan));
        assertEquals(List.of("chem:" + CatalogueSyncPlanner.VENDOR_MISMATCH), skippedReasons(plan));
        assertTrue(plan.warnings().stream().noneMatch(w -> w.contains("payment gateway")), plan.warnings().toString());
    }

    @Test
    @DisplayName("paid courses on different gateways are warned about with the rule checkout follows")
    void mixedPaidGatewaysNameTheCheckoutRule() {
        List<CatalogueSyncPlanner.Row> rows = List.of(rowSold("m1", 0, "a", "STRIPE", "INR", 0),
                row("m2", 1, "b"),
                rowWith(row("m3", 2, "c"), "vendor", "CASHFREE"));

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows,
                List.of(sold("a", "STRIPE", "INR", 0), pick("b"), pick("c")), true);

        // The free STRIPE row is not a gateway any cart is charged through.
        assertTrue(warns(plan, "more than one payment gateway (CASHFREE, RAZORPAY). Checkout charges the whole cart "
                + "through the gateway of the first paid course in it."), plan.warnings().toString());
    }

    @Test
    @DisplayName("the same page and catalogue always give the same plan")
    void deterministic() {
        List<CatalogueSyncPlanner.Row> rows = List.of(row("m1", 0, "a"), row("m2", 1, "gone"));
        List<CatalogueSyncPlanner.Pick> picks = List.of(pick("a"), pick("b"),
                with(pick("c"), "vendor", "STRIPE"), with(pick("d"), "inviteTag", "PROMO"), pick("e"));

        CatalogueSyncPlanner.Plan first = CatalogueSyncPlanner.plan(rows, picks, true);
        CatalogueSyncPlanner.Plan second = CatalogueSyncPlanner.plan(rows, picks, true);

        assertEquals(first, second);
        assertEquals(List.of("b", "e"), addedSessions(first));
        assertEquals(List.of(2, 3), first.adds().stream().map(CatalogueSyncPlanner.Add::displayOrder).toList());
    }

    @Test
    @DisplayName("labels drop a DEFAULT level")
    void labels() {
        assertEquals("Physics", CatalogueSyncPlanner.label("Physics", "DEFAULT"));
        assertEquals("Physics (Hindi)", CatalogueSyncPlanner.label(" Physics ", "Hindi"));
        assertEquals("Untitled course", CatalogueSyncPlanner.label(null, null));
    }
}
