package vacademy.io.notification_service.features.combot.constants;

/**
 * Constants for Com.bot webhook payload keys and values
 * Used for parsing webhook JSON structures
 */
public final class CombotWebhookKeys {

    public static final String CODE = "code";
    public static final String CONTACTS = "contacts";
    public static final Object WA_ID = "wa_id";

    // Private constructor to prevent instantiation
    private CombotWebhookKeys() {
        throw new UnsupportedOperationException("This is a utility class and cannot be instantiated");
    }

    // ========== Top Level Keys ==========
    public static final String ENTRY = "entry";
    public static final String CHANGES = "changes";
    public static final String VALUE = "value";
    public static final String MESSAGE = "message";
    public static final String RESPONSE = "response";
    
    // ========== Metadata Keys ==========
    public static final String METADATA = "metadata";
    public static final String PHONE_NUMBER_ID = "phone_number_id";
    public static final String DISPLAY_PHONE_NUMBER = "display_phone_number";
    
    // ========== Message Keys ==========
    public static final String MESSAGES = "messages";
    public static final String MESSAGE_ID = "id";
    public static final String FROM = "from";
    public static final String TO = "to";
    public static final String TYPE = "type";
    public static final String TIMESTAMP = "timestamp";
    
    // ========== Message Content Keys ==========
    public static final String TEXT = "text";
    public static final String BODY = "body";
    public static final String BUTTON = "button";
    public static final String INTERACTIVE = "interactive";
    public static final String LIST_REPLY = "list_reply";
    public static final String BUTTON_REPLY = "button_reply";
    public static final String TITLE = "title";
    public static final String CAPTION = "caption";
    
    // ========== Status Keys ==========
    public static final String STATUSES = "statuses";
    public static final String STATUS = "status";
    public static final String RECIPIENT_ID = "recipient_id";
    public static final String ERRORS = "errors";
    public static final String ERROR_CODE = "code";
    public static final String ERROR_MESSAGE = "message";
    
    // ========== Template Keys ==========
    public static final String TEMPLATE = "template";
    public static final String NAME = "name";
    public static final String LANGUAGE = "language";
    public static final String LANGUAGE_CODE = "code";
    public static final String COMPONENTS = "components";
    public static final String PARAMETERS = "parameters";
    
    // ========== Com.bot Response Keys ==========
    public static final String MESSAGING_CHANNEL = "messaging_channel";
    public static final String QUEUE_ID = "queue_id";
    public static final String MESSAGE_STATUS = "message_status";
    
    // ========== Verification Keys ==========
    public static final String CHALLENGE = "challenge";
    public static final String CHALLANGE = "challange"; // Typo variant
    public static final String HUB_CHALLENGE = "hub.challenge";
    public static final String HUB_MODE = "hub.mode";
    public static final String HUB_VERIFY_TOKEN = "hub.verify_token";
    public static final String SUBSCRIBE = "subscribe";
    
    // ========== System Keys ==========
    public static final String MESSAGING_PRODUCT = "messaging_product";
    public static final String WHATSAPP = "whatsapp";
    public static final String DEFAULT = "default";
}
