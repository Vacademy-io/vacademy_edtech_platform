package vacademy.io.notification_service.features.email_sending_controls.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.notification_service.features.email_sending_controls.service.EmailUnsubscribeService;

/**
 * Unauthenticated unsubscribe endpoint referenced from List-Unsubscribe and the footer.
 * GET shows a confirmation page (link scanners must not unsubscribe people by prefetching);
 * POST performs it — both the page's button and RFC 8058 one-click land here.
 * Lives under /public/** which WebSecurityConfig permits.
 */
@RestController
@RequestMapping("/notification-service/public/v1/email/unsubscribe")
@RequiredArgsConstructor
@Slf4j
public class EmailUnsubscribePublicController {

    private final EmailUnsubscribeService unsubscribes;

    @GetMapping(produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<String> page(@RequestParam("i") String instituteId,
                                       @RequestParam("e") String email,
                                       @RequestParam("t") String token) {
        if (!unsubscribes.verify(instituteId, email, token)) {
            return ResponseEntity.badRequest().contentType(MediaType.TEXT_HTML).body(html("This unsubscribe link is not valid.", null, null));
        }
        if (unsubscribes.isUnsubscribed(email, instituteId)) {
            return ResponseEntity.ok().contentType(MediaType.TEXT_HTML).body(html("You're already unsubscribed.", "<b>" + esc(email) + "</b> will not receive further emails from this sender.", null));
        }
        String form = "<form method=\"post\" action=\"\" style=\"margin-top:18px\">"
                + "<input type=\"hidden\" name=\"i\" value=\"" + esc(instituteId) + "\">"
                + "<input type=\"hidden\" name=\"e\" value=\"" + esc(email) + "\">"
                + "<input type=\"hidden\" name=\"t\" value=\"" + esc(token) + "\">"
                + "<button type=\"submit\" style=\"background:#151c2f;color:#fff;border:0;border-radius:999px;padding:12px 22px;font-size:15px;font-weight:700;cursor:pointer\">Unsubscribe " + esc(email) + "</button>"
                + "</form>";
        return ResponseEntity.ok().contentType(MediaType.TEXT_HTML).body(html("Unsubscribe?", "You'll stop receiving emails from this sender at <b>" + esc(email) + "</b>.", form));
    }

    /** Handles the page's form and one-click POSTs (body {@code List-Unsubscribe=One-Click}). */
    @PostMapping(produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<String> unsubscribe(@RequestParam("i") String instituteId,
                                              @RequestParam("e") String email,
                                              @RequestParam("t") String token,
                                              @RequestParam(value = "List-Unsubscribe", required = false) String oneClick) {
        if (!unsubscribes.verify(instituteId, email, token)) {
            return ResponseEntity.badRequest().contentType(MediaType.TEXT_HTML).body(html("This unsubscribe link is not valid.", null, null));
        }
        String source = oneClick != null ? "ONE_CLICK" : "LINK";
        unsubscribes.unsubscribe(email, instituteId, source, null);
        return ResponseEntity.ok().contentType(MediaType.TEXT_HTML).body(html("You're unsubscribed.", "<b>" + esc(email) + "</b> will not receive further emails from this sender. Sorry to see you go.", null));
    }

    private static String html(String title, String body, String extra) {
        return "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex\"><title>" + esc(title) + "</title></head>"
                + "<body style=\"margin:0;background:#fbf8f2;font-family:Arial,Helvetica,sans-serif;color:#151c2f\">"
                + "<div style=\"max-width:520px;margin:48px auto;background:#fff;border:2px solid #151c2f;border-radius:16px;padding:28px 28px 32px\">"
                + "<h1 style=\"font-size:22px;margin:0 0 10px\">" + esc(title) + "</h1>"
                + (body != null ? "<p style=\"font-size:15px;line-height:1.6;margin:0\">" + body + "</p>" : "")
                + (extra != null ? extra : "")
                + "</div></body></html>";
    }

    private static String esc(String s) {
        return s == null ? "" : s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }
}
