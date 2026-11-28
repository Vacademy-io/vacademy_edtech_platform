package vacademy.io.notification_service.constants;

public class NotificationConstants {
    private NotificationConstants() {
    } // prevent instantiation

    // Common JSON keys
    public static final String SETTING = "setting";
    public static final String EMAIL_SETTING = "EMAIL_SETTING";
    public static final String DATA = "data";
    public static final String UTILITY_EMAIL = "UTILITY_EMAIL";

    // Email fields
    public static final String FROM = "from";
    public static final String HOST = "host";
    public static final String PORT = "port";
    public static final String USERNAME = "username";
    public static final String PASSWORD = "password";

    // SES sender-identity verification fields (stored inside each EMAIL_SETTING.data.<type> node)
    public static final String VERIFIED = "verified";                       // boolean: SES identity confirmed
    public static final String VERIFICATION_STATUS = "verification_status"; // NOT_STARTED | PENDING | VERIFIED | FAILED
    public static final String VERIFICATION_MODE = "verification_mode";     // EMAIL | DOMAIN
    public static final String VERIFICATION_IDENTITY = "verification_identity"; // the email or domain sent to SES
    public static final String VERIFIED_AT = "verified_at";                 // epoch millis when it became VERIFIED

    // Sending controls (stored inside each EMAIL_SETTING.data.<type> node; all optional)
    public static final String PROMOTIONAL_EMAIL = "PROMOTIONAL_EMAIL";
    public static final String MARKETING_EMAIL = "MARKETING_EMAIL";   // what Settings saves a marketing sender as
    public static final String MAX_PER_DAY = "max_per_day";               // int, 0/absent = unlimited
    public static final String TIMEZONE = "timezone";                     // IANA zone the day boundary is measured in
    public static final String SEND_AFTER_HOUR = "send_after_hour";       // local hour (0-23) the next day's window opens
    public static final String POSTAL_ADDRESS = "postal_address";         // CAN-SPAM footer address
    public static final String LIST_UNSUBSCRIBE = "list_unsubscribe";     // boolean: add unsubscribe headers/footer for non-promotional types too

    // Warm-up ramp: the daily cap grows on a cadence instead of being a flat number.
    public static final String RAMP_ENABLED = "ramp_enabled";
    public static final String RAMP_START_PER_DAY = "ramp_start_per_day";
    public static final String RAMP_STEP = "ramp_step";                   // added at each increase
    public static final String RAMP_EVERY_DAYS = "ramp_every_days";       // days between increases
    public static final String RAMP_CEILING = "ramp_ceiling";             // cap never exceeds this
    public static final String RAMP_STARTED_ON = "ramp_started_on";       // ISO date = day 0
    public static final String SKIP_WEEKENDS = "skip_weekends";           // no sending Sat/Sun

    // WhatsApp constants
    public static final String WHATSAPP_SETTING = "WHATSAPP_SETTING";
    public static final String UTILITY_WHATSAPP = "UTILITY_WHATSAPP";
    public static final String APP_ID = "appId";
    public static final String ACCESS_TOKEN = "accessToken";

    // WhatsApp Provider constants
    public static final String PROVIDER = "provider";
    public static final String WATI = "wati";
    public static final String META = "meta";
    public static final String COMBOT = "combot";
    public static final String API_KEY = "apiKey";
    public static final String API_URL = "apiUrl";
    public static final String PHONE_NUMBER_ID = "phone_number_id";
    public static final String WHATSAPP_NUMBER = "whatsappNumber";
    // Testing allowlist for WhatsApp sending
    public static final String TEST_PHONE_NUMBER = "TEST_PHONE_NUMBER";
    public static final String FLAG = "flag";

    // OTP Type constants
    public static final String OTP_TYPE_EMAIL = "EMAIL";
    public static final String OTP_TYPE_WHATSAPP = "WHATSAPP";

    // OTP Service Type constants
    public static final String OTP_SERVICE_EMAIL_AUTH = "EMAIL_AUTH";
    public static final String OTP_SERVICE_WHATSAPP_AUTH = "WHATSAPP_AUTH";
}
