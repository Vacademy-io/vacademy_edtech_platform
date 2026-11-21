package vacademy.io.admin_core_service.features.user_subscription.util;

import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Date;

import static org.junit.jupiter.api.Assertions.*;

class BillingPeriodTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private static Date at(String t) { return Date.from(LocalDateTime.parse(t).atZone(IST).toInstant()); }
    private static LocalDateTime local(Date d) { return LocalDateTime.ofInstant(d.toInstant(), IST); }

    @Test
    void monthShapedPlans() {
        assertEquals(1, BillingPeriod.calendarMonths(30));
        assertEquals(3, BillingPeriod.calendarMonths(90));
        assertEquals(6, BillingPeriod.calendarMonths(180));
        assertEquals(12, BillingPeriod.calendarMonths(365));
        assertNull(BillingPeriod.calendarMonths(14));
        assertNull(BillingPeriod.calendarMonths(null));
    }

    @Test
    void calendarModeKeepsTheDayOfMonthAndTime() {
        assertEquals(LocalDateTime.parse("2027-02-28T23:59:59"),
                local(BillingPeriod.add(at("2027-01-31T23:59:59"), 30, true, IST)), "end of short month");
        assertEquals(LocalDateTime.parse("2026-12-05T10:00"),
                local(BillingPeriod.add(at("2026-11-05T10:00"), 30, true, IST)));
        assertEquals(LocalDateTime.parse("2026-12-05T10:00"),
                local(BillingPeriod.add(at("2026-11-05T10:00"), 30, false, IST)), "30 days from 5 Nov is 5 Dec");
        assertEquals(LocalDateTime.parse("2027-02-05T10:00"),
                local(BillingPeriod.add(at("2026-11-05T10:00"), 90, true, IST)), "3 months, not 90 days");
        assertEquals(LocalDateTime.parse("2026-11-19T10:00"),
                local(BillingPeriod.add(at("2026-11-05T10:00"), 14, true, IST)), "non-month plan stays in days");
    }

    @Test
    void latePaymentKeepsTheDueDateInCalendarModeOnly() {
        Date due = at("2026-11-05T10:00");
        Date paidLate = at("2026-11-12T09:00");
        assertEquals(due, BillingPeriod.renewalBase(due, paidLate, 30, true, IST), "calendar: keep 5th");
        assertEquals(paidLate, BillingPeriod.renewalBase(due, paidLate, 30, false, IST), "days: unchanged behaviour");
        Date longLapse = at("2027-01-10T09:00");
        assertEquals(longLapse, BillingPeriod.renewalBase(due, longLapse, 30, true, IST), "over a period late: restart");
        Date early = at("2026-11-01T09:00");
        assertEquals(due, BillingPeriod.renewalBase(due, early, 30, false, IST));
    }
}
