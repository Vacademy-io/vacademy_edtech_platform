package vacademy.io.assessment_service.features.open_evaluation.ratelimit;

import java.util.Locale;

/**
 * Published rate limits per tier (spec 11.5). Cluster-wide numbers; each pod enforces its
 * share (see {@link ApiRateLimiter}).
 *
 * <pre>
 * tier      scope       reads             writes            uploads (files presigned)
 * standard  key         20/s, 600/min     5/s, 120/min      3,000/min
 * standard  institute   40/s              10/s              6,000/min
 * high      both        2.5 x standard    4 x standard      4 x standard
 * </pre>
 * {@code custom} is "set by super-admin", but no custom numbers travel with the key yet,
 * so it is served as {@code high} (the more generous fixed tier) rather than throttling a
 * contract customer to the default. Unknown tier names fall back to {@code standard}.
 */
public enum RateLimitTier {

    STANDARD(1.0, 1.0, 1.0),
    HIGH(2.5, 4.0, 4.0);

    // standard, per key
    static final int KEY_READS_PER_SECOND = 20;
    static final int KEY_READS_PER_MINUTE = 600;
    static final int KEY_WRITES_PER_SECOND = 5;
    static final int KEY_WRITES_PER_MINUTE = 120;
    static final int KEY_UPLOADS_PER_MINUTE = 3_000;
    // standard, per institute
    static final int INSTITUTE_READS_PER_SECOND = 40;
    static final int INSTITUTE_WRITES_PER_SECOND = 10;
    static final int INSTITUTE_UPLOADS_PER_MINUTE = 6_000;

    private final double readFactor;
    private final double writeFactor;
    private final double uploadFactor;

    RateLimitTier(double readFactor, double writeFactor, double uploadFactor) {
        this.readFactor = readFactor;
        this.writeFactor = writeFactor;
        this.uploadFactor = uploadFactor;
    }

    public static RateLimitTier of(String name) {
        if (name == null) {
            return STANDARD;
        }
        return switch (name.trim().toLowerCase(Locale.ROOT)) {
            case "high", "custom" -> HIGH;
            default -> STANDARD;
        };
    }

    int keyReadsPerSecond() {
        return scale(KEY_READS_PER_SECOND, readFactor);
    }

    int keyReadsPerMinute() {
        return scale(KEY_READS_PER_MINUTE, readFactor);
    }

    int keyWritesPerSecond() {
        return scale(KEY_WRITES_PER_SECOND, writeFactor);
    }

    int keyWritesPerMinute() {
        return scale(KEY_WRITES_PER_MINUTE, writeFactor);
    }

    int keyUploadsPerMinute() {
        return scale(KEY_UPLOADS_PER_MINUTE, uploadFactor);
    }

    int instituteReadsPerSecond() {
        return scale(INSTITUTE_READS_PER_SECOND, readFactor);
    }

    int instituteWritesPerSecond() {
        return scale(INSTITUTE_WRITES_PER_SECOND, writeFactor);
    }

    int instituteUploadsPerMinute() {
        return scale(INSTITUTE_UPLOADS_PER_MINUTE, uploadFactor);
    }

    private static int scale(int base, double factor) {
        return (int) Math.round(base * factor);
    }
}
