package vacademy.io.admin_core_service.features.engagement;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEnums;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementItem;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPlan;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementSlot;
import vacademy.io.admin_core_service.features.engagement.service.EngagementScheduleResolver;
import vacademy.io.admin_core_service.features.engagement.service.EngagementScheduleResolver.SlotState;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The scheduling rules decide what a learner can open and for how many points, so
 * every branch is exercised against a fixed clock. Pure date maths — no Spring, no DB.
 */
class EngagementScheduleResolverTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private final EngagementScheduleResolver resolver = new EngagementScheduleResolver();

    private EngagementPlan plan(String timezone, EngagementEnums.MissPolicy policy,
                                Integer catchUpDays, Integer catchUpPercent) {
        EngagementPlan plan = new EngagementPlan();
        plan.setTimezone(timezone);
        plan.setDefaultMissPolicy(policy.name());
        plan.setDefaultCatchUpDays(catchUpDays);
        plan.setDefaultCatchUpPercent(catchUpPercent);
        return plan;
    }

    /** The canonical case from the brief: a question live 06:00–20:00, answers at 20:00. */
    private EngagementSlot dailySlot() {
        EngagementSlot slot = new EngagementSlot();
        slot.setStartDate(LocalDate.of(2026, 9, 1));
        slot.setEndDate(LocalDate.of(2026, 9, 30));
        slot.setStartTime(LocalTime.of(6, 0));
        slot.setEndTime(LocalTime.of(20, 0));
        return slot;
    }

    private EngagementItem item() {
        return new EngagementItem();
    }

    private ZonedDateTime at(int day, int hour, int minute) {
        return ZonedDateTime.of(2026, 9, day, hour, minute, 0, 0, IST);
    }

    @Nested
    @DisplayName("runsOn")
    class RunsOn {

        @Test
        @DisplayName("inside the date range with no mask, every day runs")
        void everyDayInRange() {
            EngagementSlot slot = dailySlot();
            assertTrue(resolver.runsOn(slot, LocalDate.of(2026, 9, 1)));
            assertTrue(resolver.runsOn(slot, LocalDate.of(2026, 9, 15)));
            assertTrue(resolver.runsOn(slot, LocalDate.of(2026, 9, 30)));
        }

        @Test
        @DisplayName("outside the date range, nothing runs")
        void outsideRange() {
            EngagementSlot slot = dailySlot();
            assertFalse(resolver.runsOn(slot, LocalDate.of(2026, 8, 31)));
            assertFalse(resolver.runsOn(slot, LocalDate.of(2026, 10, 1)));
        }

        @Test
        @DisplayName("a null end date means a single-day slot")
        void singleDay() {
            EngagementSlot slot = dailySlot();
            slot.setEndDate(null);
            assertTrue(resolver.runsOn(slot, LocalDate.of(2026, 9, 1)));
            assertFalse(resolver.runsOn(slot, LocalDate.of(2026, 9, 2)));
        }

        @Test
        @DisplayName("a Mon+Tue mask runs only on Monday and Tuesday")
        void dayOfWeekMask() {
            EngagementSlot slot = dailySlot();
            slot.setDowMask(1 | 2); // Mon | Tue
            // 2026-09-07 is a Monday.
            assertTrue(resolver.runsOn(slot, LocalDate.of(2026, 9, 7)));
            assertTrue(resolver.runsOn(slot, LocalDate.of(2026, 9, 8)));
            assertFalse(resolver.runsOn(slot, LocalDate.of(2026, 9, 9)));
            assertFalse(resolver.runsOn(slot, LocalDate.of(2026, 9, 13)));
        }

        @Test
        @DisplayName("a Sunday-only mask uses the top bit, not an off-by-one")
        void sundayBit() {
            EngagementSlot slot = dailySlot();
            slot.setDowMask(64); // Sun
            assertTrue(resolver.runsOn(slot, LocalDate.of(2026, 9, 13)));
            assertFalse(resolver.runsOn(slot, LocalDate.of(2026, 9, 14)));
        }
    }

    @Nested
    @DisplayName("stateOn")
    class StateOn {

        @Test
        @DisplayName("before the window opens the item is locked")
        void beforeOpen() {
            EngagementPlan plan = plan("Asia/Kolkata", EngagementEnums.MissPolicy.EXPIRES, null, null);
            assertEquals(SlotState.UPCOMING,
                    resolver.stateOn(plan, dailySlot(), item(), LocalDate.of(2026, 9, 15), at(15, 5, 59)));
        }

        @Test
        @DisplayName("inside the window the item is open")
        void insideWindow() {
            EngagementPlan plan = plan("Asia/Kolkata", EngagementEnums.MissPolicy.EXPIRES, null, null);
            assertEquals(SlotState.OPEN,
                    resolver.stateOn(plan, dailySlot(), item(), LocalDate.of(2026, 9, 15), at(15, 6, 0)));
            assertEquals(SlotState.OPEN,
                    resolver.stateOn(plan, dailySlot(), item(), LocalDate.of(2026, 9, 15), at(15, 19, 59)));
        }

        @Test
        @DisplayName("EXPIRES closes exactly at the end time")
        void expiresAtClose() {
            EngagementPlan plan = plan("Asia/Kolkata", EngagementEnums.MissPolicy.EXPIRES, null, null);
            assertEquals(SlotState.CLOSED,
                    resolver.stateOn(plan, dailySlot(), item(), LocalDate.of(2026, 9, 15), at(15, 20, 0)));
        }

        @Test
        @DisplayName("catch-up keeps the item open for the configured days, then closes")
        void catchUpWindow() {
            EngagementPlan plan =
                    plan("Asia/Kolkata", EngagementEnums.MissPolicy.CATCH_UP_REDUCED, 2, 50);
            LocalDate runDate = LocalDate.of(2026, 9, 15);
            assertEquals(SlotState.CATCH_UP,
                    resolver.stateOn(plan, dailySlot(), item(), runDate, at(16, 9, 0)));
            assertEquals(SlotState.CATCH_UP,
                    resolver.stateOn(plan, dailySlot(), item(), runDate, at(17, 19, 59)));
            // 2 days after the 20:00 close is 2026-09-17 20:00.
            assertEquals(SlotState.CLOSED,
                    resolver.stateOn(plan, dailySlot(), item(), runDate, at(17, 20, 0)));
        }

        @Test
        @DisplayName("a catch-up policy with zero days behaves like EXPIRES")
        void catchUpWithNoDays() {
            EngagementPlan plan =
                    plan("Asia/Kolkata", EngagementEnums.MissPolicy.CATCH_UP_FULL, null, null);
            assertEquals(SlotState.CLOSED,
                    resolver.stateOn(plan, dailySlot(), item(), LocalDate.of(2026, 9, 15), at(15, 20, 1)));
        }

        @Test
        @DisplayName("an item's own policy overrides the plan default")
        void itemOverridesPlan() {
            EngagementPlan plan = plan("Asia/Kolkata", EngagementEnums.MissPolicy.EXPIRES, null, null);
            EngagementItem item = item();
            item.setMissPolicy(EngagementEnums.MissPolicy.CATCH_UP_FULL.name());
            item.setCatchUpDays(1);
            assertEquals(SlotState.CATCH_UP,
                    resolver.stateOn(plan, dailySlot(), item, LocalDate.of(2026, 9, 15), at(16, 10, 0)));
        }

        @Test
        @DisplayName("the plan's timezone decides the window, not the server's")
        void timezoneDrivesTheWindow() {
            // 06:00 New York is 15:30 IST. At 10:00 UTC the NY plan has NOT opened
            // (06:00 EDT = 10:00 UTC exactly) but one minute earlier it has not.
            EngagementPlan nyPlan =
                    plan("America/New_York", EngagementEnums.MissPolicy.EXPIRES, null, null);
            ZonedDateTime justBeforeNyOpen =
                    ZonedDateTime.of(2026, 9, 15, 9, 59, 0, 0, ZoneId.of("UTC"));
            ZonedDateTime justAfterNyOpen =
                    ZonedDateTime.of(2026, 9, 15, 10, 1, 0, 0, ZoneId.of("UTC"));

            assertEquals(SlotState.UPCOMING, resolver.stateOn(
                    nyPlan, dailySlot(), item(), LocalDate.of(2026, 9, 15), justBeforeNyOpen));
            assertEquals(SlotState.OPEN, resolver.stateOn(
                    nyPlan, dailySlot(), item(), LocalDate.of(2026, 9, 15), justAfterNyOpen));
        }
    }

    @Nested
    @DisplayName("isRevealed")
    class Revealed {

        @Test
        @DisplayName("answers stay hidden until the reveal time")
        void hiddenUntilReveal() {
            EngagementPlan plan = plan("Asia/Kolkata", EngagementEnums.MissPolicy.EXPIRES, null, null);
            EngagementSlot slot = dailySlot();
            slot.setRevealTime(LocalTime.of(20, 0));
            LocalDate runDate = LocalDate.of(2026, 9, 15);

            assertFalse(resolver.isRevealed(plan, slot, runDate, at(15, 19, 59)));
            assertTrue(resolver.isRevealed(plan, slot, runDate, at(15, 20, 0)));
        }

        @Test
        @DisplayName("with no reveal time configured, the close time is the reveal")
        void defaultsToCloseTime() {
            EngagementPlan plan = plan("Asia/Kolkata", EngagementEnums.MissPolicy.EXPIRES, null, null);
            EngagementSlot slot = dailySlot();
            slot.setRevealTime(null);
            LocalDate runDate = LocalDate.of(2026, 9, 15);

            assertFalse(resolver.isRevealed(plan, slot, runDate, at(15, 19, 59)));
            assertTrue(resolver.isRevealed(plan, slot, runDate, at(15, 20, 0)));
        }
    }

    @Nested
    @DisplayName("catch-up percentage")
    class CatchUpPercent {

        @Test
        @DisplayName("CATCH_UP_FULL keeps all the points; EXPIRES keeps none")
        void fullAndExpires() {
            assertEquals(100, resolver.resolveCatchUpPercent(
                    plan("Asia/Kolkata", EngagementEnums.MissPolicy.CATCH_UP_FULL, 2, null), item()));
            assertEquals(0, resolver.resolveCatchUpPercent(
                    plan("Asia/Kolkata", EngagementEnums.MissPolicy.EXPIRES, null, null), item()));
        }

        @Test
        @DisplayName("CATCH_UP_REDUCED uses the configured percent, halving by default")
        void reduced() {
            assertEquals(40, resolver.resolveCatchUpPercent(
                    plan("Asia/Kolkata", EngagementEnums.MissPolicy.CATCH_UP_REDUCED, 2, 40), item()));
            assertEquals(50, resolver.resolveCatchUpPercent(
                    plan("Asia/Kolkata", EngagementEnums.MissPolicy.CATCH_UP_REDUCED, 2, null), item()));
        }

        @Test
        @DisplayName("an out-of-range percent is clamped, never applied raw")
        void clamped() {
            EngagementItem tooHigh = item();
            tooHigh.setCatchUpPercent(500);
            assertEquals(100, resolver.resolveCatchUpPercent(
                    plan("Asia/Kolkata", EngagementEnums.MissPolicy.CATCH_UP_REDUCED, 2, null), tooHigh));

            EngagementItem negative = item();
            negative.setCatchUpPercent(-10);
            assertEquals(0, resolver.resolveCatchUpPercent(
                    plan("Asia/Kolkata", EngagementEnums.MissPolicy.CATCH_UP_REDUCED, 2, null), negative));
        }

        @Test
        @DisplayName("an unknown policy string falls back to EXPIRES rather than throwing")
        void unknownPolicy() {
            EngagementPlan broken = plan("Asia/Kolkata", EngagementEnums.MissPolicy.EXPIRES, null, null);
            broken.setDefaultMissPolicy("NOT_A_POLICY");
            assertEquals(EngagementEnums.MissPolicy.EXPIRES,
                    resolver.resolveMissPolicy(broken, item()));
        }
    }

    @Nested
    @DisplayName("mostRecentRunDate")
    class MostRecentRunDate {

        @Test
        @DisplayName("an unmasked slot's most recent run is the day asked about")
        void today() {
            assertEquals(LocalDate.of(2026, 9, 15),
                    resolver.mostRecentRunDate(dailySlot(), LocalDate.of(2026, 9, 15)));
        }

        @Test
        @DisplayName("a masked slot walks back to its last running day")
        void walksBack() {
            EngagementSlot slot = dailySlot();
            slot.setDowMask(1); // Mondays only
            // 2026-09-10 is a Thursday; the previous Monday is 2026-09-07.
            assertEquals(LocalDate.of(2026, 9, 7),
                    resolver.mostRecentRunDate(slot, LocalDate.of(2026, 9, 10)));
        }

        @Test
        @DisplayName("past the slot's last day it reports that last day, not today")
        void pastTheEnd() {
            assertEquals(LocalDate.of(2026, 9, 30),
                    resolver.mostRecentRunDate(dailySlot(), LocalDate.of(2026, 10, 20)));
        }

        @Test
        @DisplayName("before the slot ever starts there is no run date")
        void beforeStart() {
            assertNull(resolver.mostRecentRunDate(dailySlot(), LocalDate.of(2026, 8, 20)));
        }
    }
}
