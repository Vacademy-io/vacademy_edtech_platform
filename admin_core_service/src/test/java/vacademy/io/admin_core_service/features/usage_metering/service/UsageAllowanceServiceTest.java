package vacademy.io.admin_core_service.features.usage_metering.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.usage_metering.dto.UsageDTOs.AllowanceStatus;
import vacademy.io.admin_core_service.features.usage_metering.dto.UsageDTOs.UsageAllowance;

import java.time.LocalDate;
import java.time.YearMonth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class UsageAllowanceServiceTest {

    private static final long GB = 1024L * 1024 * 1024;
    private static final YearMonth NOV = YearMonth.of(2026, 11);

    private static UsageAllowance allowance(double storageGb, double bandwidthGb, double storageRate, double bandwidthRate) {
        UsageAllowance a = new UsageAllowance();
        a.setInstituteId("inst-1");
        a.setIncludedStorageGb(storageGb);
        a.setIncludedBandwidthGb(bandwidthGb);
        a.setStorageRatePerGb(storageRate);
        a.setBandwidthRatePerGb(bandwidthRate);
        a.setCurrency("INR");
        return a;
    }

    @Test
    void withinAllowanceCostsNothing() {
        AllowanceStatus s = UsageAllowanceService.price(allowance(100, 200, 5, 10), NOV, 20, 80 * GB, 150 * GB);
        assertEquals(0, s.getStorageExtraBytes());
        assertEquals(0, s.getBandwidthExtraBytes());
        assertEquals(0.0, s.getTotalCharge());
    }

    @Test
    void chargesOnlyTheExtraGb() {
        // 130 GB stored on average against 100 included -> 30 GB x 5 = 150
        // 260 GB delivered against 200 included -> 60 GB x 10 = 600
        AllowanceStatus s = UsageAllowanceService.price(allowance(100, 200, 5, 10), NOV, 20, 130 * GB, 260 * GB);
        assertEquals(30 * GB, s.getStorageExtraBytes());
        assertEquals(60 * GB, s.getBandwidthExtraBytes());
        assertEquals(150.0, s.getStorageCharge());
        assertEquals(600.0, s.getBandwidthCharge());
        assertEquals(750.0, s.getTotalCharge());
        assertEquals("2026-11", s.getMonth());
    }

    @Test
    void fractionalGbRoundsToPaise() {
        // 0.5 GB extra bandwidth at 9.99 per GB = 4.995 -> 5.00
        AllowanceStatus s = UsageAllowanceService.price(allowance(0, 1, 0, 9.99), NOV, 0, 0, GB + GB / 2);
        assertEquals(5.0, s.getBandwidthCharge());
        assertEquals(5.0, s.getTotalCharge());
    }

    @Test
    void zeroIncludedChargesEveryGb() {
        AllowanceStatus s = UsageAllowanceService.price(allowance(0, 0, 2, 3), NOV, 30, 10 * GB, 10 * GB);
        assertEquals(20.0, s.getStorageCharge());
        assertEquals(30.0, s.getBandwidthCharge());
    }

    @Test
    void addonRaisesIncludedStorageAndAddsItsPrice() {
        UsageAllowance a = allowance(10, 50, 5, 2);
        a.setCurrency(UsageAllowanceService.CREDITS);
        a.setAddonStorageGb(50);
        a.setAddonPricePerMonth(250);
        // 82 GB average against 10 + 50 -> 22 GB x 5 = 110; 29 GB bandwidth within 50; + 250 pack
        AllowanceStatus s = UsageAllowanceService.price(a, NOV, 30, 82 * GB, 29 * GB);
        assertEquals(22 * GB, s.getStorageExtraBytes());
        assertEquals(110.0, s.getStorageCharge());
        assertEquals(0.0, s.getBandwidthCharge());
        assertEquals(250.0, s.getAddonPrice());
        assertEquals(360.0, s.getTotalCharge());
    }

    @Test
    void proposalExampleShikshaNationScale() {
        UsageAllowance a = allowance(10, 50, 5, 2);
        AllowanceStatus s = UsageAllowanceService.price(a, NOV, 30, 3137 * GB, 701 * GB);
        assertEquals(15635.0, s.getStorageCharge());
        assertEquals(1302.0, s.getBandwidthCharge());
    }

    @Test
    void onlyCreditPlansFromTheirFirstMonthAreCharged() {
        UsageAllowance a = allowance(10, 50, 5, 2);
        a.setCurrency("INR");
        a.setChargeFromMonth("2026-11");
        assertFalse(UsageAllowanceService.chargeable(a, NOV));
        a.setCurrency(UsageAllowanceService.CREDITS);
        assertTrue(UsageAllowanceService.chargeable(a, NOV));
        assertFalse(UsageAllowanceService.chargeable(a, YearMonth.of(2026, 10)));
        a.setChargeFromMonth(null);
        assertFalse(UsageAllowanceService.chargeable(a, NOV));
    }

    @Test
    void lastMonthIsChargedFromTheThird() {
        assertNull(UsageAllowanceService.monthToCharge(LocalDate.of(2026, 12, 2)));
        assertEquals(NOV, UsageAllowanceService.monthToCharge(LocalDate.of(2026, 12, 3)));
        assertEquals(NOV, UsageAllowanceService.monthToCharge(LocalDate.of(2026, 12, 31)));
        assertEquals(YearMonth.of(2026, 12), UsageAllowanceService.monthToCharge(LocalDate.of(2027, 1, 5)));
    }

    @Test
    void descriptionNamesTheMonthAndTheOverage() {
        UsageAllowance a = allowance(10, 50, 5, 2);
        AllowanceStatus s = UsageAllowanceService.price(a, NOV, 30, 12 * GB, 50 * GB);
        assertEquals("Storage & bandwidth, November 2026: 2.00 GB storage over plan", UsageAllowanceService.description(NOV, s));
    }
}
