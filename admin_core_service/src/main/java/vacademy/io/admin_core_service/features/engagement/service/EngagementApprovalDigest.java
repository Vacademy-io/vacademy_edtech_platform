package vacademy.io.admin_core_service.features.engagement.service;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Words of the daily approvals notice. Pure: the job decides what each group of waiting rows needs,
 * this turns the groups into a title and an email body a busy admin can act on in one read: who
 * replied, what is waiting on each engine, and the one step that makes it stop waiting.
 */
final class EngagementApprovalDigest {

    private EngagementApprovalDigest() {
    }

    /** What a group of waiting rows needs from a person. */
    enum Need {
        /** Someone wrote in and the engine will not answer by itself. */
        REPLY,
        /** Set to run on its own, but still short of the approvals that earn it. */
        TRIAL,
        /** Not set to run on its own: every one needs a person. */
        MANUAL,
        /** The engine tried to run these by itself and could not. */
        BLOCKED
    }

    /**
     * @param what      plain name of the thing waiting ("Emails", "AI calls")
     * @param remaining for TRIAL: approvals still needed before the engine sends by itself
     */
    record Line(String engineName, String what, Need need, int count, int lapsingSoon, int remaining,
                Instant oldest) {
    }

    record Notice(String title, String html) {
    }

    /** Null when nothing is waiting. */
    static Notice build(List<Line> lines, int lapsedYesterday, String inboxUrl, Instant now) {
        int replies = 0, drafts = 0;
        Instant oldestReply = null;
        for (Line l : lines) {
            if (l.need() == Need.REPLY) {
                replies += l.count();
                if (oldestReply == null || l.oldest().isBefore(oldestReply)) oldestReply = l.oldest();
            } else {
                drafts += l.count();
            }
        }
        if (replies == 0 && drafts == 0) return null;

        List<String> parts = new ArrayList<>();
        if (replies > 0) parts.add(replies + (replies == 1 ? " reply" : " replies"));
        if (drafts > 0) parts.add(drafts + (drafts == 1 ? " draft" : " drafts"));
        String title = "Engagement inbox: " + String.join(" and ", parts)
                + (replies + drafts == 1 ? " is" : " are") + " waiting for you";

        StringBuilder html = new StringBuilder();
        html.append("<p>Nothing below goes out until a person acts on it.</p>");
        if (replies > 0) {
            html.append("<p><b>").append(replies).append(replies == 1 ? " person has" : " people have")
                    .append(" replied and not been answered.</b> The oldest has waited ")
                    .append(age(oldestReply, now)).append(". Answer them first: ");
            List<String> per = new ArrayList<>();
            for (Line l : lines) {
                if (l.need() == Need.REPLY) per.add(l.count() + " on " + esc(l.engineName()));
            }
            html.append(String.join(", ", per)).append(".</p>");
        }
        for (Line l : lines) {
            if (l.need() == Need.REPLY) continue;
            html.append("<p><b>").append(esc(l.engineName())).append(": ").append(l.count()).append(" ")
                    .append(esc(l.count() == 1 ? singular(l.what()) : l.what().toLowerCase())).append(" waiting.</b> ")
                    .append(step(l));
            if (l.lapsingSoon() > 0) {
                html.append(" ").append(l.lapsingSoon()).append(l.lapsingSoon() == 1 ? " lapses" : " lapse")
                        .append(" unsent within a day.");
            }
            html.append("</p>");
        }
        if (lapsedYesterday > 0) {
            html.append("<p>In the last day ").append(lapsedYesterday)
                    .append(lapsedYesterday == 1 ? " draft lapsed" : " drafts lapsed")
                    .append(" without anyone acting on ").append(lapsedYesterday == 1 ? "it" : "them").append(".</p>");
        }
        if (inboxUrl != null) {
            html.append("<p><a href=\"").append(inboxUrl).append("\">Open the Engagement inbox</a></p>");
        }
        return new Notice(title, html.toString());
    }

    private static String step(Line l) {
        return switch (l.need()) {
            case TRIAL -> "Approve " + l.remaining() + " more and the engine handles the rest by itself.";
            case MANUAL -> "This engine asks before every one. Approve them in the inbox, or set "
                    + esc(l.what()) + " to \"Runs on its own\" on the engine page.";
            case BLOCKED -> "The engine could not run these by itself. Open one in the inbox to see why.";
            case REPLY -> "";
        };
    }

    /** "Emails" → "email", "AI calls" → "AI call". */
    private static String singular(String what) {
        String s = what.endsWith("s") ? what.substring(0, what.length() - 1) : what;
        return s.startsWith("AI ") ? s : s.toLowerCase();
    }

    static String age(Instant since, Instant now) {
        long hours = Math.max(0, Duration.between(since, now).toHours());
        if (hours < 1) return "under an hour";
        if (hours < 24) return hours + (hours == 1 ? " hour" : " hours");
        long days = hours / 24;
        return days + (days == 1 ? " day" : " days");
    }

    private static String esc(String s) {
        return EngagementPointsOfContact.esc(s);
    }
}
