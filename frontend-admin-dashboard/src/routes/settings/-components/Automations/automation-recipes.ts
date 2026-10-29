/**
 * Source of truth for the "Automations" Settings tab.
 *
 * Each recipe maps 1:1 to a use-case template from
 * `../../workflow/create/-components/use-case-templates.ts`. The recipe
 * provides plain-language copy + which trigger event to use + any extra
 * end-user-friendly questions to ask. Technical concepts (trigger, event,
 * SpEL, node, cron) are kept entirely out of this file.
 *
 * We deliberately curate a SUBSET of the 26 wizard templates: only those
 * that produce a working workflow without a target picker (no batch /
 * audience / session selection). Templates that need a specific target stay
 * available via the advanced `/workflow/create` builder.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Node, Edge } from 'reactflow';

export type RecipeMode = 'event' | 'scheduled';

export type ExtraQuestion = 'days_after_submission' | 'days_before_expiry';

/**
 * Some recipes genuinely need a learner-group selection (the platform stores
 * batch membership outside the trigger context, so we can't auto-derive it).
 * `batch_single`  → one batch.
 * `batch_multi`   → many batches (sent as CSV to the backend).
 * Omit the field when the recipe applies to all learners or pulls the audience
 * from the trigger context.
 */
export type TargetKind = 'batch_single' | 'batch_multi';

export interface AutomationRecipe {
    /** Stable id. Used as the `[auto:<id>]` marker in workflow description. */
    id: string;
    /**
     * Which existing UseCaseTemplate to invoke for `generateWorkflow`. Either
     * this OR `customGenerator` must be set. Use `customGenerator` for
     * recipes whose semantics differ from any wizard template (e.g. splitting
     * the "present + absent" recap into two independent automations).
     */
    useCaseTemplateId?: string;
    customGenerator?: (form: import('./buildRecipeWorkflow').RecipeFormAnswers) => {
        nodes: Node[];
        edges: Edge[];
    };
    /** The trigger event name (only used when mode === 'event'). */
    triggerEvent?: string;
    /** Plain-language label shown as the row title. */
    label: string;
    /** One short sentence explaining what happens. No jargon. */
    whatHappens: string;
    /** Emoji shown beside the row title. */
    icon: string;
    mode: RecipeMode;
    /**
     * The default sample-template key from `sample-email-templates.ts`. When
     * the user has no templates yet, we offer this as a "Use sample" button.
     * Falls back to `useCaseTemplateId` if omitted.
     */
    defaultSampleTemplateKey?: string;
    /**
     * For multi-template recipes (e.g. live class recap has present + absent
     * templates). Each entry produces a separate dropdown in the configure form
     * and a separate answer key in the wizard answers map.
     */
    templateSlots?: Array<{
        answerKey: string;
        label: string;
        sampleTemplateKey?: string;
    }>;
    /** Friendly extra questions. */
    extraQuestions?: ExtraQuestion[];
    /**
     * When set, the configure form asks "Which batch?" (or "Which batches?")
     * with a plain-language dropdown. Used only for templates whose underlying
     * QUERY needs a batchId that isn't available in the trigger context.
     */
    target?: TargetKind;
}

/** Groups feature cards into the page's three top-level sections. */
export type AutomationSection = 'general' | 'parents' | 'admin';

export interface AutomationFeature {
    id: string;
    icon: string;
    title: string;
    description: string;
    recipes: AutomationRecipe[];
    /** Defaults to 'general' when omitted. */
    section?: AutomationSection;
}

// ─── Helpers for customGenerator recipes — mirror the makeNode/makeEdge
//     pattern in use-case-templates.ts so workflows look identical in the
//     diagram view.
function makeNode(
    type: string,
    name: string,
    config: Record<string, unknown>,
    x: number,
    y: number,
    isStart = false,
): Node {
    return {
        id: `node-${uuidv4()}`,
        type: 'workflowNode',
        position: { x, y },
        data: { name, nodeType: type, config, isStartNode: isStart, isEndNode: false },
    };
}

function makeEdge(source: string, target: string, label = ''): Edge {
    return {
        id: `edge-${uuidv4()}`,
        source,
        target,
        label,
        type: 'smoothstep',
        animated: true,
    };
}

export const AUTOMATION_FEATURES: AutomationFeature[] = [
    {
        id: 'audience',
        icon: '📝',
        title: 'Audience & Leads',
        description: 'Automatic messages for anyone who fills your forms.',
        recipes: [
            {
                id: 'audience_welcome',
                useCaseTemplateId: 'audience_lead_confirmation',
                triggerEvent: 'AUDIENCE_LEAD_SUBMISSION',
                icon: '👋',
                label: 'Welcome anyone who fills your form',
                whatHappens:
                    'Sends an instant welcome / thank-you email every time someone submits an audience form.',
                mode: 'event',
            },
            {
                id: 'audience_opt_out_confirmation',
                triggerEvent: 'AUDIENCE_OPT_OUT',
                icon: '🚫',
                label: 'Confirm to a contact when they opt out',
                whatHappens:
                    'When someone unsubscribes from your audience, sends them a confirmation email so they know they’ve been removed.',
                mode: 'event',
                customGenerator: (form) => {
                    const trigger = makeNode('TRIGGER', 'Trigger: Contact opted out', {
                        triggerEvent: 'AUDIENCE_OPT_OUT',
                    }, 250, 50, true);
                    const fetchUser = makeNode('QUERY', 'Fetch contact details', {
                        prebuiltKey: 'fetch_user_with_password',
                        params: { userId: "#ctx['userId']" },
                        resultKey: 'optedOutUser',
                    }, 250, 230);
                    const sendEmail = makeNode('SEND_EMAIL', `Send: ${form.templateName ?? ''}`, {
                        templateName: form.templateName as string,
                        on: "{#ctx['optedOutUser']}",
                        forEach: { operation: 'SEND_EMAIL', eval: "#ctx['item']" },
                        recipientField: 'email',
                        templateVars: {
                            fullName: "#ctx['optedOutUser'].fullName",
                            email: "#ctx['optedOutUser'].email",
                            instituteName: "#ctx['instituteName']",
                        },
                    }, 250, 410);
                    return {
                        nodes: [trigger, fetchUser, sendEmail],
                        edges: [makeEdge(trigger.id, fetchUser.id), makeEdge(fetchUser.id, sendEmail.id)],
                    };
                },
            },
            {
                id: 'audience_immediate_nurture',
                useCaseTemplateId: 'lead_followup_email',
                triggerEvent: 'AUDIENCE_LEAD_SUBMISSION',
                icon: '💌',
                label: 'Send a nurture / second-touch email right after the form',
                whatHappens:
                    'Sends a second, different email immediately after someone fills your form — useful for sharing a brochure, video, or next steps.',
                mode: 'event',
            },
            {
                id: 'audience_followup_days_later',
                useCaseTemplateId: 'scheduled_audience_followup',
                icon: '⏰',
                label: 'Follow up with a lead a few days later',
                whatHappens:
                    'Each day, sends a follow-up email to people who filled your form a chosen number of days ago.',
                mode: 'scheduled',
                extraQuestions: ['days_after_submission'],
            },
        ],
    },
    {
        id: 'courses',
        icon: '📚',
        title: 'Courses',
        description: 'Announce new courses to your existing learners.',
        recipes: [
            {
                id: 'course_created_announce_learners',
                useCaseTemplateId: 'email_batch_students',
                triggerEvent: 'COURSE_CREATED',
                icon: '🎉',
                label: 'Announce a new course to your learners',
                whatHappens:
                    'When you publish a new course, emails the learners in the batches you pick to let them know — useful for cross-selling existing learners on new offerings.',
                mode: 'event',
                target: 'batch_multi',
            },
        ],
    },
    {
        id: 'live_classes',
        icon: '🎥',
        title: 'Live Classes',
        description: 'Automatic emails around your live sessions.',
        recipes: [
            {
                id: 'live_class_starting_now',
                useCaseTemplateId: 'email_batch_students',
                triggerEvent: 'LIVE_SESSION_START',
                icon: '🔴',
                label: 'Tell a batch a live class is starting right now',
                whatHappens:
                    'The moment a class actually starts (the first person joins), emails every learner in the chosen batches a "we’re live now" notification.',
                mode: 'event',
                target: 'batch_multi',
            },
            {
                id: 'live_class_created_invite',
                useCaseTemplateId: 'email_batch_students',
                triggerEvent: 'LIVE_SESSION_CREATE',
                icon: '📅',
                label: 'Email a batch when a new live class is scheduled',
                whatHappens:
                    'When a live class is created, sends an invite-style email to every learner in the batches you pick.',
                mode: 'event',
                target: 'batch_multi',
            },
            {
                id: 'live_class_followup_batch',
                useCaseTemplateId: 'post_session_followup',
                triggerEvent: 'LIVE_SESSION_END',
                icon: '📩',
                label: 'Send a simple follow-up to a batch after every class',
                whatHappens:
                    'When any live class ends, sends a single follow-up email (e.g. recording link, homework) to a chosen batch.',
                mode: 'event',
                target: 'batch_single',
            },
            {
                id: 'live_class_student_present',
                triggerEvent: 'LIVE_SESSION_END',
                icon: '✅',
                label: 'Email a learner when they attended a class',
                whatHappens:
                    'Each time a live class ends, sends an email only to the learners who were marked present (e.g. a thank-you, recording, or notes).',
                mode: 'event',
                customGenerator: (form) => {
                    const trigger = makeNode('TRIGGER', 'Trigger: Live class ended', {
                        triggerEvent: 'LIVE_SESSION_END',
                    }, 250, 50, true);
                    const fetch = makeNode('QUERY', 'Fetch attendance', {
                        prebuiltKey: 'fetch_live_session_attendance',
                        params: {
                            sessionId: "#ctx['sessionId']",
                            scheduleId: "#ctx['scheduleId']",
                        },
                    }, 250, 230);
                    const send = makeNode('SEND_EMAIL', `Send: ${form.templateName ?? ''}`, {
                        templateName: form.templateName as string,
                        on: "#ctx['presentStudents']",
                        forEach: { operation: 'SEND_EMAIL', eval: "#ctx['item']" },
                    }, 250, 410);
                    return {
                        nodes: [trigger, fetch, send],
                        edges: [makeEdge(trigger.id, fetch.id), makeEdge(fetch.id, send.id)],
                    };
                },
            },
            {
                id: 'live_class_student_absent',
                triggerEvent: 'LIVE_SESSION_END',
                icon: '🚷',
                label: 'Email a learner when they missed a class',
                whatHappens:
                    'Each time a live class ends, sends an email only to the learners who were marked absent (e.g. catch-up notes, recording link).',
                mode: 'event',
                customGenerator: (form) => {
                    const trigger = makeNode('TRIGGER', 'Trigger: Live class ended', {
                        triggerEvent: 'LIVE_SESSION_END',
                    }, 250, 50, true);
                    const fetch = makeNode('QUERY', 'Fetch attendance', {
                        prebuiltKey: 'fetch_live_session_attendance',
                        params: {
                            sessionId: "#ctx['sessionId']",
                            scheduleId: "#ctx['scheduleId']",
                        },
                    }, 250, 230);
                    const send = makeNode('SEND_EMAIL', `Send: ${form.templateName ?? ''}`, {
                        templateName: form.templateName as string,
                        on: "#ctx['absentStudents']",
                        forEach: { operation: 'SEND_EMAIL', eval: "#ctx['item']" },
                    }, 250, 410);
                    return {
                        nodes: [trigger, fetch, send],
                        edges: [makeEdge(trigger.id, fetch.id), makeEdge(fetch.id, send.id)],
                    };
                },
            },
            {
                id: 'live_class_recap',
                useCaseTemplateId: 'live_session_end_recap',
                triggerEvent: 'LIVE_SESSION_END',
                icon: '📨',
                label: 'Send detailed recap emails after every live class',
                whatHappens:
                    'When a live class ends, sends one email to students who attended and a different email to those who missed it.',
                mode: 'event',
                templateSlots: [
                    {
                        answerKey: 'presentTemplate',
                        label: 'Message for students who attended',
                        sampleTemplateKey: 'live_session_recap_present',
                    },
                    {
                        answerKey: 'absentTemplate',
                        label: 'Message for students who missed the class',
                        sampleTemplateKey: 'live_session_recap_absent',
                    },
                ],
            },
        ],
    },
    {
        id: 'enrollment',
        icon: '🎓',
        title: 'Enrollment & Onboarding',
        description: 'Welcome new learners and notify when access changes.',
        recipes: [
            {
                id: 'welcome_new_learner',
                useCaseTemplateId: 'welcome_enrolled_student',
                triggerEvent: 'LEARNER_BATCH_ENROLLMENT',
                icon: '🎓',
                label: 'Welcome every new learner',
                whatHappens:
                    'Sends a welcome email — with login details — the moment a learner is enrolled in any batch.',
                mode: 'event',
            },
            {
                id: 'welcome_sub_org_member',
                useCaseTemplateId: 'welcome_enrolled_student',
                triggerEvent: 'SUB_ORG_MEMBER_ENROLLMENT',
                icon: '🤝',
                label: 'Welcome new sub-organisation members',
                whatHappens:
                    'Sends a welcome email when someone joins one of your sub-organisations.',
                mode: 'event',
            },
            {
                id: 'member_removed_notice',
                useCaseTemplateId: 'termination_notice',
                triggerEvent: 'SUB_ORG_MEMBER_TERMINATION',
                icon: '🚪',
                label: 'Notify a learner when they lose access',
                whatHappens:
                    'Sends an email when a learner is removed from a sub-organisation, so they aren’t left guessing.',
                mode: 'event',
            },
            {
                id: 'learner_re_enrolment_welcome_back',
                triggerEvent: 'LEARNER_RE_ENROLLMENT',
                icon: '🔁',
                label: 'Welcome a learner back when they re-enrol',
                whatHappens:
                    'Fires when a learner buys / activates another plan for a course they already had — sends them a "welcome back" / "good to have you again" email.',
                mode: 'event',
                customGenerator: (form) => {
                    const trigger = makeNode('TRIGGER', 'Trigger: Learner re-enrolled', {
                        triggerEvent: 'LEARNER_RE_ENROLLMENT',
                    }, 250, 50, true);
                    const fetchUser = makeNode('QUERY', 'Fetch learner', {
                        prebuiltKey: 'fetch_user_with_password',
                        params: { userId: "#ctx['userId']" },
                        resultKey: 'returningUser',
                    }, 250, 230);
                    const send = makeNode('SEND_EMAIL', `Send: ${form.templateName ?? ''}`, {
                        templateName: form.templateName as string,
                        on: "{#ctx['returningUser']}",
                        forEach: { operation: 'SEND_EMAIL', eval: "#ctx['item']" },
                        recipientField: 'email',
                        templateVars: {
                            fullName: "#ctx['returningUser'].fullName",
                            email: "#ctx['returningUser'].email",
                            startDate: "#ctx['startDate']",
                            endDate: "#ctx['endDate']",
                            instituteName: "#ctx['instituteName']",
                        },
                    }, 250, 410);
                    return {
                        nodes: [trigger, fetchUser, send],
                        edges: [makeEdge(trigger.id, fetchUser.id), makeEdge(fetchUser.id, send.id)],
                    };
                },
            },
        ],
    },
    {
        id: 'payments',
        icon: '💰',
        title: 'Payments & Fees',
        description: 'Automatic reminders for fees and checkout issues.',
        recipes: [
            {
                id: 'fee_due_reminder',
                useCaseTemplateId: 'scheduled_fee_reminder',
                icon: '🔔',
                label: 'Remind learners before fees are due',
                whatHappens:
                    'Each day, emails learners with upcoming fee installments — pick the message and the time to send.',
                mode: 'scheduled',
            },
            {
                id: 'payment_success_confirmation',
                triggerEvent: 'PAYMENT_SUCCESS',
                icon: '✅',
                label: 'Send a confirmation when a payment succeeds',
                whatHappens:
                    'Every time a learner’s payment goes through, sends them a thank-you / receipt email automatically.',
                mode: 'event',
                customGenerator: (form) => {
                    const trigger = makeNode('TRIGGER', 'Trigger: Payment success', {
                        triggerEvent: 'PAYMENT_SUCCESS',
                    }, 250, 50, true);
                    const fetchUser = makeNode('QUERY', 'Fetch paying learner', {
                        prebuiltKey: 'fetch_user_with_password',
                        params: { userId: "#ctx['userId']" },
                        resultKey: 'paidUser',
                    }, 250, 230);
                    const send = makeNode('SEND_EMAIL', `Send: ${form.templateName ?? ''}`, {
                        templateName: form.templateName as string,
                        on: "{#ctx['paidUser']}",
                        forEach: { operation: 'SEND_EMAIL', eval: "#ctx['item']" },
                        recipientField: 'email',
                        templateVars: {
                            fullName: "#ctx['paidUser'].fullName",
                            email: "#ctx['paidUser'].email",
                            amount: "#ctx['amount']",
                            vendor: "#ctx['vendor']",
                            instituteName: "#ctx['instituteName']",
                        },
                    }, 250, 410);
                    return {
                        nodes: [trigger, fetchUser, send],
                        edges: [makeEdge(trigger.id, fetchUser.id), makeEdge(fetchUser.id, send.id)],
                    };
                },
            },
            {
                id: 'payment_failed',
                useCaseTemplateId: 'payment_failed_email',
                triggerEvent: 'PAYMENT_FAILED',
                icon: '⚠️',
                label: 'Email the learner when a payment fails',
                whatHappens:
                    'Whenever a payment fails, sends the learner a friendly note with a link to retry.',
                mode: 'event',
            },
            {
                id: 'abandoned_checkout',
                useCaseTemplateId: 'abandoned_cart_reminder',
                triggerEvent: 'ABANDONED_CART',
                icon: '🛒',
                label: 'Nudge people who left checkout',
                whatHappens:
                    'When someone starts a purchase but doesn’t finish, sends them a gentle reminder.',
                mode: 'event',
            },
        ],
    },
    {
        id: 'memberships',
        icon: '🪪',
        title: 'Memberships & Renewals',
        description: 'Keep learners ahead of expiring access.',
        recipes: [
            {
                id: 'membership_renewal_reminder',
                useCaseTemplateId: 'scheduled_expiry_check',
                icon: '🔁',
                label: 'Remind learners before their access expires (scheduled scan)',
                whatHappens:
                    'On the schedule you pick, emails learners whose membership is expiring soon — you choose how many days’ notice.',
                mode: 'scheduled',
                extraQuestions: ['days_before_expiry'],
            },
            {
                id: 'membership_expiring_event',
                triggerEvent: 'MEMBERSHIP_EXPIRY',
                icon: '⚠️',
                label: 'Email a learner the day their plan enters the renewal window',
                whatHappens:
                    'Fires automatically once per learner when their plan is 7 days away from expiring — they get a single renewal nudge, not a daily one.',
                mode: 'event',
                customGenerator: (form) => {
                    const trigger = makeNode('TRIGGER', 'Trigger: Membership expiring', {
                        triggerEvent: 'MEMBERSHIP_EXPIRY',
                    }, 250, 50, true);
                    const fetchUser = makeNode('QUERY', 'Fetch learner contact', {
                        prebuiltKey: 'fetch_user_with_password',
                        params: { userId: "#ctx['userId']" },
                        resultKey: 'expiringUser',
                    }, 250, 230);
                    const send = makeNode('SEND_EMAIL', `Send: ${form.templateName ?? ''}`, {
                        templateName: form.templateName as string,
                        on: "{#ctx['expiringUser']}",
                        forEach: { operation: 'SEND_EMAIL', eval: "#ctx['item']" },
                        recipientField: 'email',
                        templateVars: {
                            fullName: "#ctx['expiringUser'].fullName",
                            email: "#ctx['expiringUser'].email",
                            daysToExpiry: "#ctx['daysToExpiry']",
                            endDate: "#ctx['endDate']",
                            instituteName: "#ctx['instituteName']",
                        },
                    }, 250, 410);
                    return {
                        nodes: [trigger, fetchUser, send],
                        edges: [makeEdge(trigger.id, fetchUser.id), makeEdge(fetchUser.id, send.id)],
                    };
                },
            },
            {
                id: 'subscription_cancelled_winback',
                triggerEvent: 'SUBSCRIPTION_CANCELLED',
                icon: '👋',
                label: 'Win-back email when a learner cancels their subscription',
                whatHappens:
                    'When a learner cancels on their own, sends them a "sorry to see you go / here’s what you’ll miss" email — useful for nurturing returning customers.',
                mode: 'event',
                customGenerator: (form) => {
                    const trigger = makeNode('TRIGGER', 'Trigger: Subscription cancelled', {
                        triggerEvent: 'SUBSCRIPTION_CANCELLED',
                    }, 250, 50, true);
                    const fetchUser = makeNode('QUERY', 'Fetch learner', {
                        prebuiltKey: 'fetch_user_with_password',
                        params: { userId: "#ctx['userId']" },
                        resultKey: 'cancelledUser',
                    }, 250, 230);
                    const send = makeNode('SEND_EMAIL', `Send: ${form.templateName ?? ''}`, {
                        templateName: form.templateName as string,
                        on: "{#ctx['cancelledUser']}",
                        forEach: { operation: 'SEND_EMAIL', eval: "#ctx['item']" },
                        recipientField: 'email',
                        templateVars: {
                            fullName: "#ctx['cancelledUser'].fullName",
                            email: "#ctx['cancelledUser'].email",
                            endDate: "#ctx['endDate']",
                            instituteName: "#ctx['instituteName']",
                        },
                    }, 250, 410);
                    return {
                        nodes: [trigger, fetchUser, send],
                        edges: [makeEdge(trigger.id, fetchUser.id), makeEdge(fetchUser.id, send.id)],
                    };
                },
            },
            {
                id: 'subscription_terminated_notice',
                triggerEvent: 'SUBSCRIPTION_TERMINATED',
                icon: '🛑',
                label: 'Notify a learner when their access is removed by an admin',
                whatHappens:
                    'When an admin terminates a learner’s plan, sends them an email so they aren’t surprised when their access stops working.',
                mode: 'event',
                customGenerator: (form) => {
                    const trigger = makeNode('TRIGGER', 'Trigger: Subscription terminated', {
                        triggerEvent: 'SUBSCRIPTION_TERMINATED',
                    }, 250, 50, true);
                    const fetchUser = makeNode('QUERY', 'Fetch learner', {
                        prebuiltKey: 'fetch_user_with_password',
                        params: { userId: "#ctx['userId']" },
                        resultKey: 'terminatedUser',
                    }, 250, 230);
                    const send = makeNode('SEND_EMAIL', `Send: ${form.templateName ?? ''}`, {
                        templateName: form.templateName as string,
                        on: "{#ctx['terminatedUser']}",
                        forEach: { operation: 'SEND_EMAIL', eval: "#ctx['item']" },
                        recipientField: 'email',
                        templateVars: {
                            fullName: "#ctx['terminatedUser'].fullName",
                            email: "#ctx['terminatedUser'].email",
                            endDate: "#ctx['endDate']",
                            instituteName: "#ctx['instituteName']",
                        },
                    }, 250, 410);
                    return {
                        nodes: [trigger, fetchUser, send],
                        edges: [makeEdge(trigger.id, fetchUser.id), makeEdge(fetchUser.id, send.id)],
                    };
                },
            },
        ],
    },
    {
        id: 'attendance',
        icon: '📊',
        title: 'Attendance & Engagement',
        description: 'Scheduled reports on how learners are doing.',
        recipes: [
            {
                id: 'institute_attendance_report',
                useCaseTemplateId: 'scheduled_batch_report',
                icon: '📈',
                label: 'Send a regular attendance report (all batches)',
                whatHappens:
                    'Emails an attendance summary across every active batch on the schedule you pick.',
                mode: 'scheduled',
            },
            {
                id: 'batch_engagement_summary',
                useCaseTemplateId: 'scheduled_engagement_summary',
                icon: '📊',
                label: 'Send each learner their own engagement summary',
                whatHappens:
                    'On the schedule you pick, emails every learner in a batch a personalised summary of their attendance and engagement.',
                mode: 'scheduled',
                target: 'batch_single',
            },
            {
                id: 'parents_attendance_update',
                useCaseTemplateId: 'scheduled_parents_attendance',
                icon: '👨‍👩‍👧',
                label: 'Send parents a weekly attendance update',
                whatHappens:
                    'On the schedule you pick, emails parents an attendance update for their child’s batch.',
                mode: 'scheduled',
                target: 'batch_single',
            },
        ],
    },
    {
        id: 'parents_live_class',
        section: 'parents',
        icon: '🎥',
        title: 'Live Class',
        description: 'Keep parents in the loop on whether their child attended each live class.',
        recipes: [
            {
                id: 'parent_live_class_present',
                triggerEvent: 'LIVE_SESSION_END',
                icon: '✅',
                label: 'Tell parents when their child attended a class',
                whatHappens:
                    'Each time a live class ends, emails the parent of every learner marked present.',
                mode: 'event',
                customGenerator: (form) => {
                    const trigger = makeNode('TRIGGER', 'Trigger: Live class ended', {
                        triggerEvent: 'LIVE_SESSION_END',
                    }, 250, 50, true);
                    const fetch = makeNode('QUERY', 'Fetch attendance', {
                        prebuiltKey: 'fetch_live_session_attendance',
                        params: {
                            sessionId: "#ctx['sessionId']",
                            scheduleId: "#ctx['scheduleId']",
                        },
                    }, 250, 230);
                    const send = makeNode('SEND_EMAIL', `Send to parents: ${form.templateName ?? ''}`, {
                        templateName: form.templateName as string,
                        on: "#ctx['presentStudents']",
                        forEach: { operation: 'SEND_EMAIL', eval: "#ctx['item']" },
                        recipientField: 'parentsEmail',
                    }, 250, 410);
                    return {
                        nodes: [trigger, fetch, send],
                        edges: [makeEdge(trigger.id, fetch.id), makeEdge(fetch.id, send.id)],
                    };
                },
            },
            {
                id: 'parent_live_class_absent',
                triggerEvent: 'LIVE_SESSION_END',
                icon: '🚷',
                label: 'Tell parents when their child missed a class',
                whatHappens:
                    'Each time a live class ends, emails the parent of every learner marked absent.',
                mode: 'event',
                customGenerator: (form) => {
                    const trigger = makeNode('TRIGGER', 'Trigger: Live class ended', {
                        triggerEvent: 'LIVE_SESSION_END',
                    }, 250, 50, true);
                    const fetch = makeNode('QUERY', 'Fetch attendance', {
                        prebuiltKey: 'fetch_live_session_attendance',
                        params: {
                            sessionId: "#ctx['sessionId']",
                            scheduleId: "#ctx['scheduleId']",
                        },
                    }, 250, 230);
                    const send = makeNode('SEND_EMAIL', `Send to parents: ${form.templateName ?? ''}`, {
                        templateName: form.templateName as string,
                        on: "#ctx['absentStudents']",
                        forEach: { operation: 'SEND_EMAIL', eval: "#ctx['item']" },
                        recipientField: 'parentsEmail',
                    }, 250, 410);
                    return {
                        nodes: [trigger, fetch, send],
                        edges: [makeEdge(trigger.id, fetch.id), makeEdge(fetch.id, send.id)],
                    };
                },
            },
        ],
    },
    {
        id: 'parents_attendance_reports',
        section: 'parents',
        icon: '📊',
        title: 'Attendance Reports',
        description: 'Scheduled attendance roll-ups for parents — how their child is doing over time.',
        recipes: [
            {
                id: 'parent_weekly_attendance',
                useCaseTemplateId: 'scheduled_parents_attendance',
                icon: '📅',
                label: 'Send parents a weekly attendance update',
                whatHappens:
                    'On the schedule you pick, emails parents an attendance roll-up for their child’s batch.',
                mode: 'scheduled',
                target: 'batch_single',
            },
        ],
    },
    {
        id: 'admin_live_class',
        section: 'admin',
        icon: '🎥',
        title: 'Live Class',
        description: 'Operational alerts to your team about live sessions.',
        recipes: [
            {
                id: 'admin_notify_live_class_ended',
                triggerEvent: 'LIVE_SESSION_END',
                icon: '🎬',
                label: 'Email the team when a live class ends',
                whatHappens:
                    'After every live class, the admin team gets a summary email with present/absent counts — useful for ops review and attendance audits.',
                mode: 'event',
                customGenerator: (form) => {
                    const trigger = makeNode('TRIGGER', 'Trigger: Live class ended', {
                        triggerEvent: 'LIVE_SESSION_END',
                    }, 250, 50, true);
                    const fetchAttendance = makeNode('QUERY', 'Fetch attendance', {
                        prebuiltKey: 'fetch_live_session_attendance',
                        params: {
                            sessionId: "#ctx['sessionId']",
                            scheduleId: "#ctx['scheduleId']",
                        },
                    }, 250, 230);
                    const fetchAdmins = makeNode('QUERY', 'Fetch admin team', {
                        prebuiltKey: 'fetch_institute_admin_emails',
                        params: {},
                    }, 250, 410);
                    const send = makeNode('SEND_EMAIL', `Send to team: ${form.templateName ?? ''}`, {
                        templateName: form.templateName as string,
                        on: "#ctx['adminContacts']",
                        forEach: { operation: 'SEND_EMAIL', eval: "#ctx['item']" },
                        recipientField: 'email',
                        templateVars: {
                            adminName: "#ctx['item'].fullName",
                            sessionTitle: "#ctx['sessionTitle']",
                            presentCount: "#ctx['presentCount']",
                            absentCount: "#ctx['absentCount']",
                            instituteName: "#ctx['instituteName']",
                        },
                    }, 250, 590);
                    return {
                        nodes: [trigger, fetchAttendance, fetchAdmins, send],
                        edges: [
                            makeEdge(trigger.id, fetchAttendance.id),
                            makeEdge(fetchAttendance.id, fetchAdmins.id),
                            makeEdge(fetchAdmins.id, send.id),
                        ],
                    };
                },
            },
        ],
    },
    {
        id: 'admin_attendance',
        section: 'admin',
        icon: '📊',
        title: 'Attendance',
        description: 'Periodic attendance summaries delivered to the admin team.',
        recipes: [
            {
                id: 'admin_attendance_summary',
                icon: '📈',
                label: 'Send the admin team a scheduled attendance summary',
                whatHappens:
                    'On the schedule you pick, runs an institute-wide attendance scan and emails the team a summary covering every active batch.',
                mode: 'scheduled',
                customGenerator: (form) => {
                    const fetchReport = makeNode('QUERY', 'Fetch attendance report', {
                        prebuiltKey: 'fetch_batch_attendance_report',
                        params: { daysBack: 7 },
                    }, 250, 50, true);
                    const fetchAdmins = makeNode('QUERY', 'Fetch admin team', {
                        prebuiltKey: 'fetch_institute_admin_emails',
                        params: {},
                    }, 250, 230);
                    const send = makeNode('SEND_EMAIL', `Send to team: ${form.templateName ?? ''}`, {
                        templateName: form.templateName as string,
                        on: "#ctx['adminContacts']",
                        forEach: { operation: 'SEND_EMAIL', eval: "#ctx['item']" },
                        recipientField: 'email',
                        templateVars: {
                            adminName: "#ctx['item'].fullName",
                            totalStudents: "#ctx['totalStudents']",
                            batchCount: "#ctx['batchCount']",
                            startDate: "#ctx['startDate']",
                            endDate: "#ctx['endDate']",
                            instituteName: "#ctx['instituteName']",
                        },
                    }, 250, 410);
                    return {
                        nodes: [fetchReport, fetchAdmins, send],
                        edges: [
                            makeEdge(fetchReport.id, fetchAdmins.id),
                            makeEdge(fetchAdmins.id, send.id),
                        ],
                    };
                },
            },
        ],
    },
    {
        id: 'admin_enrollment_stats',
        section: 'admin',
        icon: '🎓',
        title: 'Enrollment Stats',
        description: 'New enrolments and payment outcomes — straight to the team.',
        recipes: [
            {
                id: 'admin_notify_new_enrolment',
                triggerEvent: 'LEARNER_BATCH_ENROLLMENT',
                icon: '🎓',
                label: 'Email the team every time a learner enrols',
                whatHappens:
                    'When a new learner is enrolled, every admin / teacher in your institute gets a heads-up with the learner’s name and email.',
                mode: 'event',
                customGenerator: (form) => {
                    const trigger = makeNode('TRIGGER', 'Trigger: Learner enrolled', {
                        triggerEvent: 'LEARNER_BATCH_ENROLLMENT',
                    }, 250, 50, true);
                    const fetchAdmins = makeNode('QUERY', 'Fetch admin team', {
                        prebuiltKey: 'fetch_institute_admin_emails',
                        params: {},
                    }, 250, 230);
                    const send = makeNode('SEND_EMAIL', `Send to team: ${form.templateName ?? ''}`, {
                        templateName: form.templateName as string,
                        on: "#ctx['adminContacts']",
                        forEach: { operation: 'SEND_EMAIL', eval: "#ctx['item']" },
                        recipientField: 'email',
                        templateVars: {
                            adminName: "#ctx['item'].fullName",
                            learnerName: "#ctx['user'].fullName",
                            learnerEmail: "#ctx['user'].email",
                            instituteName: "#ctx['instituteName']",
                        },
                    }, 250, 410);
                    return {
                        nodes: [trigger, fetchAdmins, send],
                        edges: [makeEdge(trigger.id, fetchAdmins.id), makeEdge(fetchAdmins.id, send.id)],
                    };
                },
            },
            {
                id: 'admin_notify_payment_success',
                triggerEvent: 'PAYMENT_SUCCESS',
                icon: '💳',
                label: 'Email the team when a payment succeeds',
                whatHappens:
                    'Every successful payment sends a notification to the admin team with the amount and learner.',
                mode: 'event',
                customGenerator: (form) => {
                    const trigger = makeNode('TRIGGER', 'Trigger: Payment success', {
                        triggerEvent: 'PAYMENT_SUCCESS',
                    }, 250, 50, true);
                    const fetchAdmins = makeNode('QUERY', 'Fetch admin team', {
                        prebuiltKey: 'fetch_institute_admin_emails',
                        params: {},
                    }, 250, 230);
                    const send = makeNode('SEND_EMAIL', `Send to team: ${form.templateName ?? ''}`, {
                        templateName: form.templateName as string,
                        on: "#ctx['adminContacts']",
                        forEach: { operation: 'SEND_EMAIL', eval: "#ctx['item']" },
                        recipientField: 'email',
                        templateVars: {
                            adminName: "#ctx['item'].fullName",
                            amount: "#ctx['amount']",
                            vendor: "#ctx['vendor']",
                            payerUserId: "#ctx['userId']",
                            instituteName: "#ctx['instituteName']",
                        },
                    }, 250, 410);
                    return {
                        nodes: [trigger, fetchAdmins, send],
                        edges: [makeEdge(trigger.id, fetchAdmins.id), makeEdge(fetchAdmins.id, send.id)],
                    };
                },
            },
            {
                id: 'admin_notify_payment_failed',
                triggerEvent: 'PAYMENT_FAILED',
                icon: '⚠️',
                label: 'Email the team when a payment fails',
                whatHappens:
                    'Every failed payment sends a notification to the admin team so they can follow up with the learner.',
                mode: 'event',
                customGenerator: (form) => {
                    const trigger = makeNode('TRIGGER', 'Trigger: Payment failed', {
                        triggerEvent: 'PAYMENT_FAILED',
                    }, 250, 50, true);
                    const fetchAdmins = makeNode('QUERY', 'Fetch admin team', {
                        prebuiltKey: 'fetch_institute_admin_emails',
                        params: {},
                    }, 250, 230);
                    const send = makeNode('SEND_EMAIL', `Send to team: ${form.templateName ?? ''}`, {
                        templateName: form.templateName as string,
                        on: "#ctx['adminContacts']",
                        forEach: { operation: 'SEND_EMAIL', eval: "#ctx['item']" },
                        recipientField: 'email',
                        templateVars: {
                            adminName: "#ctx['item'].fullName",
                            amount: "#ctx['amount']",
                            vendor: "#ctx['vendor']",
                            payerUserId: "#ctx['userId']",
                            instituteName: "#ctx['instituteName']",
                        },
                    }, 250, 410);
                    return {
                        nodes: [trigger, fetchAdmins, send],
                        edges: [makeEdge(trigger.id, fetchAdmins.id), makeEdge(fetchAdmins.id, send.id)],
                    };
                },
            },
        ],
    },
    {
        id: 'admin_leads_stats',
        section: 'admin',
        icon: '📝',
        title: 'Leads Stats',
        description: 'Real-time alerts when new leads come in through your audience forms.',
        recipes: [
            {
                id: 'admin_notify_new_lead',
                triggerEvent: 'AUDIENCE_LEAD_SUBMISSION',
                icon: '📝',
                label: 'Email the team when a new lead arrives',
                whatHappens:
                    'When someone fills your audience form, the admin team gets a copy with the lead’s details.',
                mode: 'event',
                customGenerator: (form) => {
                    const trigger = makeNode('TRIGGER', 'Trigger: Lead submitted', {
                        triggerEvent: 'AUDIENCE_LEAD_SUBMISSION',
                    }, 250, 50, true);
                    const fetchAdmins = makeNode('QUERY', 'Fetch admin team', {
                        prebuiltKey: 'fetch_institute_admin_emails',
                        params: {},
                    }, 250, 230);
                    const send = makeNode('SEND_EMAIL', `Send to team: ${form.templateName ?? ''}`, {
                        templateName: form.templateName as string,
                        on: "#ctx['adminContacts']",
                        forEach: { operation: 'SEND_EMAIL', eval: "#ctx['item']" },
                        recipientField: 'email',
                        // The lead-submission context carries the lead as `user` (every
                        // path sets it) and its number as `phone` (not on form-webhook
                        // leads, hence the fallback). There is no `lead` key, and a var
                        // that fails to evaluate is sent as its expression text, so each
                        // one is written to come out blank rather than fail.
                        templateVars: {
                            adminName: "#ctx['item'].fullName",
                            campaignName: "#ctx['campaignName']",
                            leadName: "#ctx['user']?.fullName",
                            leadEmail: "#ctx['user']?.email",
                            leadMobile: "#ctx['phone'] ?: #ctx['user']?.mobileNumber",
                            submissionTime: "#ctx['submissionTime']",
                            instituteName: "#ctx['instituteName']",
                        },
                    }, 250, 410);
                    return {
                        nodes: [trigger, fetchAdmins, send],
                        edges: [makeEdge(trigger.id, fetchAdmins.id), makeEdge(fetchAdmins.id, send.id)],
                    };
                },
            },
        ],
    },
    {
        id: 'admin_courses',
        section: 'admin',
        icon: '📚',
        title: 'Courses',
        description: 'Operational alerts to the team about course / content changes.',
        recipes: [
            {
                id: 'admin_notify_course_created',
                triggerEvent: 'COURSE_CREATED',
                icon: '📚',
                label: 'Email the team when a new course is published',
                whatHappens:
                    'When a new course is created in your institute, every admin / teacher gets a heads-up email with the course name.',
                mode: 'event',
                customGenerator: (form) => {
                    const trigger = makeNode('TRIGGER', 'Trigger: Course created', {
                        triggerEvent: 'COURSE_CREATED',
                    }, 250, 50, true);
                    const fetchAdmins = makeNode('QUERY', 'Fetch admin team', {
                        prebuiltKey: 'fetch_institute_admin_emails',
                        params: {},
                    }, 250, 230);
                    const send = makeNode('SEND_EMAIL', `Send to team: ${form.templateName ?? ''}`, {
                        templateName: form.templateName as string,
                        on: "#ctx['adminContacts']",
                        forEach: { operation: 'SEND_EMAIL', eval: "#ctx['item']" },
                        recipientField: 'email',
                        templateVars: {
                            adminName: "#ctx['item'].fullName",
                            courseName: "#ctx['packageName']",
                            courseId: "#ctx['packageId']",
                            instituteName: "#ctx['instituteName']",
                        },
                    }, 250, 410);
                    return {
                        nodes: [trigger, fetchAdmins, send],
                        edges: [makeEdge(trigger.id, fetchAdmins.id), makeEdge(fetchAdmins.id, send.id)],
                    };
                },
            },
        ],
    },
    {
        id: 'admin_doubts',
        section: 'admin',
        icon: '❓',
        title: 'Doubts',
        description: 'Real-time alerts when learners post new doubts.',
        recipes: [
            {
                id: 'admin_notify_doubt_raised',
                triggerEvent: 'DOUBT_RAISED',
                icon: '❓',
                label: 'Email the team when a learner raises a doubt',
                whatHappens:
                    'When a learner posts a new doubt, the admin / teacher team gets an email with the question text so they can jump in.',
                mode: 'event',
                customGenerator: (form) => {
                    const trigger = makeNode('TRIGGER', 'Trigger: Doubt raised', {
                        triggerEvent: 'DOUBT_RAISED',
                    }, 250, 50, true);
                    const fetchAdmins = makeNode('QUERY', 'Fetch admin team', {
                        prebuiltKey: 'fetch_institute_admin_emails',
                        params: {},
                    }, 250, 230);
                    const send = makeNode('SEND_EMAIL', `Send to team: ${form.templateName ?? ''}`, {
                        templateName: form.templateName as string,
                        on: "#ctx['adminContacts']",
                        forEach: { operation: 'SEND_EMAIL', eval: "#ctx['item']" },
                        recipientField: 'email',
                        templateVars: {
                            adminName: "#ctx['item'].fullName",
                            learnerUserId: "#ctx['userId']",
                            doubtId: "#ctx['doubtId']",
                            doubtText: "#ctx['htmlText']",
                            contentType: "#ctx['contentType']",
                            batchId: "#ctx['packageSessionId']",
                            instituteName: "#ctx['instituteName']",
                        },
                    }, 250, 410);
                    return {
                        nodes: [trigger, fetchAdmins, send],
                        edges: [makeEdge(trigger.id, fetchAdmins.id), makeEdge(fetchAdmins.id, send.id)],
                    };
                },
            },
        ],
    },
    {
        id: 'admin_reviews',
        section: 'admin',
        icon: '⭐',
        title: 'Website reviews',
        description: 'Know as soon as a visitor sends a review from your website.',
        recipes: [
            {
                id: 'admin_notify_review_submitted',
                triggerEvent: 'REVIEW_SUBMITTED',
                icon: '⭐',
                label: 'Email the team when a visitor sends a review',
                whatHappens:
                    'When someone sends a review through the Reviews & feedback section of your website, the admin team gets an email with the stars and the review so it can be approved quickly. Change the channel (WhatsApp, in-app) or who gets it in the workflow builder.',
                mode: 'event',
                customGenerator: (form) => {
                    const trigger = makeNode('TRIGGER', 'Trigger: Site review submitted', {
                        triggerEvent: 'REVIEW_SUBMITTED',
                    }, 250, 50, true);
                    const fetchAdmins = makeNode('QUERY', 'Fetch admin team', {
                        prebuiltKey: 'fetch_institute_admin_emails',
                        params: {},
                    }, 250, 230);
                    const send = makeNode('SEND_EMAIL', `Send to team: ${form.templateName ?? ''}`, {
                        templateName: form.templateName as string,
                        on: "#ctx['adminContacts']",
                        forEach: { operation: 'SEND_EMAIL', eval: "#ctx['item']" },
                        recipientField: 'email',
                        templateVars: {
                            adminName: "#ctx['item'].fullName",
                            reviewerName: "#ctx['reviewerName']",
                            rating: "#ctx['rating']",
                            ratingStars: "#ctx['ratingStars']",
                            reviewText: "#ctx['reviewText']",
                            courseName: "#ctx['courseName']",
                            city: "#ctx['city']",
                            designation: "#ctx['designation']",
                            answersText: "#ctx['answersText']",
                            siteTag: "#ctx['siteTag']",
                            instituteName: "#ctx['instituteName']",
                        },
                    }, 250, 410);
                    return {
                        nodes: [trigger, fetchAdmins, send],
                        edges: [makeEdge(trigger.id, fetchAdmins.id), makeEdge(fetchAdmins.id, send.id)],
                    };
                },
            },
        ],
    },
    {
        id: 'admin_assignments',
        section: 'admin',
        icon: '✍️',
        title: 'Assignments',
        description: 'Alerts when learners submit their work.',
        recipes: [
            {
                id: 'admin_notify_assignment_submitted',
                triggerEvent: 'ASSIGNMENT_SUBMITTED',
                icon: '✍️',
                label: 'Email the team when a learner submits an assignment',
                whatHappens:
                    'When a learner submits an assignment slide for the first time, every admin / teacher gets a notification so it can be reviewed quickly.',
                mode: 'event',
                customGenerator: (form) => {
                    const trigger = makeNode('TRIGGER', 'Trigger: Assignment submitted', {
                        triggerEvent: 'ASSIGNMENT_SUBMITTED',
                    }, 250, 50, true);
                    const fetchAdmins = makeNode('QUERY', 'Fetch admin team', {
                        prebuiltKey: 'fetch_institute_admin_emails',
                        params: {},
                    }, 250, 230);
                    const send = makeNode('SEND_EMAIL', `Send to team: ${form.templateName ?? ''}`, {
                        templateName: form.templateName as string,
                        on: "#ctx['adminContacts']",
                        forEach: { operation: 'SEND_EMAIL', eval: "#ctx['item']" },
                        recipientField: 'email',
                        templateVars: {
                            adminName: "#ctx['item'].fullName",
                            learnerUserId: "#ctx['userId']",
                            slideId: "#ctx['slideId']",
                            chapterId: "#ctx['chapterId']",
                            subjectId: "#ctx['subjectId']",
                            batchId: "#ctx['packageSessionId']",
                            instituteName: "#ctx['instituteName']",
                        },
                    }, 250, 410);
                    return {
                        nodes: [trigger, fetchAdmins, send],
                        edges: [makeEdge(trigger.id, fetchAdmins.id), makeEdge(fetchAdmins.id, send.id)],
                    };
                },
            },
        ],
    },
    {
        id: 'assessments',
        icon: '📝',
        title: 'Assessments',
        description: 'Automatic messages around tests and assignments.',
        recipes: [
            {
                id: 'assessment_created_notify',
                useCaseTemplateId: 'assessment_created_notify',
                triggerEvent: 'ASSESSMENT_CREATE',
                icon: '📣',
                label: 'Tell a batch when a new assessment is published',
                whatHappens:
                    'When you create an assessment, sends a heads-up email to every learner in the chosen batch.',
                mode: 'event',
                target: 'batch_single',
            },
            {
                id: 'assessment_start_notify',
                useCaseTemplateId: 'assessment_start_notify',
                triggerEvent: 'ASSESSMENT_START',
                icon: '⏳',
                label: 'Remind a batch when an assessment is starting',
                whatHappens:
                    'When an assessment window opens, sends a start reminder to the chosen batch.',
                mode: 'event',
                target: 'batch_single',
            },
        ],
    },
];

/** Flat lookup helper. */
export function findRecipeById(recipeId: string): {
    feature: AutomationFeature;
    recipe: AutomationRecipe;
} | undefined {
    for (const feature of AUTOMATION_FEATURES) {
        const recipe = feature.recipes.find((r) => r.id === recipeId);
        if (recipe) return { feature, recipe };
    }
    return undefined;
}

/**
 * Parses the `[auto:<recipeId>]` marker from a workflow description's first
 * token. Returns null if the workflow wasn't created via this Settings tab.
 */
export function extractRecipeMarker(description: string | null | undefined): string | null {
    if (!description) return null;
    const match = description.match(/^\[auto:([a-z0-9_]+)\]/i);
    return match ? match[1]! : null;
}

/** The marker prefix we write to identify settings-managed workflows. */
export function buildRecipeMarker(recipeId: string, whatHappens: string): string {
    return `[auto:${recipeId}] ${whatHappens}`;
}
