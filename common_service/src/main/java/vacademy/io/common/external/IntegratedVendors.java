package vacademy.io.common.external;

import java.util.List;
import java.util.Locale;
import java.util.stream.Collectors;

/**
 * The third-party APIs the platform has integrated, by the hosts they answer on. Only these are
 * recorded in {@code external_api_call_log} and shown on the platform portal: anything else an
 * HTTP client reaches (an institute's website fetched for lead research, a scraped page, a DNS
 * check) is not an integration.
 *
 * <p>Same list in ai_service/app/services/integrated_vendors.py,
 * voice_bot_service/app/vendor_failures.py and the portal's format.ts (INTEGRATED_VENDORS).
 * Add a new integration to all four; {@code IntegratedVendorListsInSyncTest} fails until you do.
 */
public final class IntegratedVendors {

    private IntegratedVendors() {
    }

    /** A host matches a domain exactly or as a subdomain of it. */
    public static final List<String> DOMAINS = List.of(
            "openrouter.ai", "api.isoquant.ai", "api.anthropic.com", "api.openai.com",
            "generativelanguage.googleapis.com", "aiplatform.googleapis.com", "api.parallel.ai",
            "api.sarvam.ai", "smallest.ai", "navana.ai", "rumik.ai", "deepgram.com",
            "texttospeech.googleapis.com", "speech.googleapis.com", "speech.platform.bing.com",
            "fal.run", "fal.ai", "fal.media", "runpod.ai", "runpod.io", "spatius.ai", "api.mathpix.com",
            "api.docconverter.pro", "cloudconvert.com", "google.serper.dev", "api.pexels.com", "pixabay.com",
            "www.googleapis.com", "oauth2.googleapis.com", "meet.googleapis.com", "workspaceevents.googleapis.com",
            "api.plivo.com", "exotel.com", "exotel.in", "api.vonage.com", "api.nexmo.com", "aavtaar.ai",
            "api.razorpay.com", "api.cashfree.com", "sandbox.cashfree.com", "api.stripe.com", "api.phonepe.com",
            "api-preprod.phonepe.com", "api.paypal.com", "api-m.paypal.com", "api.sandbox.paypal.com",
            "api-m.sandbox.paypal.com", "ewaypayments.com", "wati.io", "graph.facebook.com", "api.zoom.us",
            "zoom.us", "zohoapis.in", "zohoapis.com", "zoho.in", "api.cloudflare.com", "open.er-api.com",
            "fcm.googleapis.com", "firebase.googleapis.com", "androidpublisher.googleapis.com",
            "api.appstoreconnect.apple.com", "api.github.com", "manage.devcenter.microsoft.com",
            "login.microsoftonline.com");

    /** Vendors that log under a name rather than a host: ai_service's Serper rows and SDK calls. */
    public static final List<String> NAMES = List.of("serper", "aws-ses", "email-smtp");

    public static boolean isIntegrated(String host) {
        String h = host == null ? "" : host.trim().toLowerCase(Locale.ROOT);
        if (h.endsWith(".")) h = h.substring(0, h.length() - 1);
        if (h.isEmpty()) return false;
        if (NAMES.contains(h)) return true;
        for (String d : DOMAINS) {
            if (h.equals(d) || h.endsWith("." + d)) return true;
        }
        return false;
    }

    /**
     * A SQL condition true when {@code column} holds an integrated vendor. Built only from the
     * constants above, so it is safe to concatenate into a query.
     */
    public static String sqlCondition(String column) {
        String c = "lower(" + column + ")";
        String names = NAMES.stream().map(n -> "'" + n + "'").collect(Collectors.joining(", "));
        String domains = DOMAINS.stream()
                .map(d -> c + " = '" + d + "' OR " + c + " LIKE '%." + d + "'")
                .collect(Collectors.joining(" OR "));
        return "(" + c + " IN (" + names + ") OR " + domains + ")";
    }
}
