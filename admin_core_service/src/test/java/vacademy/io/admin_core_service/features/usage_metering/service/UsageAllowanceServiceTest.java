package vacademy.io.admin_core_service.features.usage_metering.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.usage_metering.dto.UsageDTOs.AllowanceStatus;
import vacademy.io.admin_core_service.features.usage_metering.dto.UsageDTOs.UsageAllowance;

import java.time.YearMonth;

import static org.junit.jupiter.api.Assertions.assertEquals;

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
}
