/**
 * Starter use cases for AI agents.
 *
 * Each entry is a ready-made shape of an agent an education institute actually
 * wants — doubt solving, mentoring, parent updates, admissions — plus the three
 * or four questions we need answered before the prompt assistant can draft it.
 * The `brief` becomes the input to /ai-agents/assist/draft; `fallbackPrompt` is
 * what we save if that call fails (no credits, model down) so the flow never
 * dead-ends.
 */
import {
    Compass,
    CurrencyInr,
    HandHeart,
    Question,
    Sparkle,
    Users,
    type Icon,
} from '@phosphor-icons/react';
import type { AiAgent } from '../-services/ai-agents';

export type UseCaseAccent = 'primary' | 'success' | 'info' | 'warning' | 'danger';

export interface UseCaseQuestion {
    id: string;
    label: string;
    placeholder?: string;
    help?: string;
    type: 'text' | 'textarea' | 'select';
    /** Only for type 'select'. First option is the default. */
    options?: string[];
    required?: boolean;
}

/** A two-line sample exchange rendered on the card so the pitch is concrete. */
export interface SampleTurn {
    speaker: 'agent' | 'person';
    text: string;
}

export interface AgentUseCase {
    id: string;
    title: string;
    tagline: string;
    /** Who the agent is on the phone with — shown as the card's context line. */
    audience: string;
    icon: Icon;
    accent: UseCaseAccent;
    bullets: string[];
    sample: SampleTurn[];
    /** Seed values for the created agent (the AI fills prompt/opening line). */
    defaults: Pick<AiAgent, 'direction' | 'language' | 'voice' | 'maxCallMinutes'> & {
        name: string;
        extractionQuestions: string[];
        dispositions: string[];
    };
    questions: UseCaseQuestion[];
    /** Plain-English brief handed to the prompt assistant. */
    brief: (a: Record<string, string>) => string;
    /** Deterministic prompt used when the AI draft is unavailable. */
    fallbackPrompt: (a: Record<string, string>) => string;
    fallbackOpeningLine: (a: Record<string, string>) => string;
}

/** Questions almost every use case needs, so each list stays short. */
const instituteQ: UseCaseQuestion = {
    id: 'institute',
    label: 'Institute name (as the agent should say it)',
    placeholder: 'e.g. Shiksha Nation',
    type: 'text',
    required: true,
};
const languageQ: UseCaseQuestion = {
    id: 'language',
    label: 'Language on the call',
    type: 'select',
    options: ['Hinglish', 'Hindi', 'English'],
};

const commonRules = (a: Record<string, string>) =>
    `
Rules:
- Speak in ${a.language || 'Hinglish'}, warm and natural, short sentences — this is a phone call, not an essay.
- One question at a time. Wait for the answer before moving on.
- Never invent facts about ${a.institute || 'the institute'}. If you don't know, say you'll have someone confirm.
- If the person sounds busy or annoyed, apologise, offer to call back, and end politely.
- Close by confirming the agreed next step out loud.`.trim();

export const AGENT_USE_CASES: AgentUseCase[] = [
    {
        id: 'doubt-solver',
        title: 'Doubt Solver',
        tagline: 'Picks up when a student calls with a doubt and answers it, subject by subject.',
        audience: 'Inbound · students',
        icon: Question,
        accent: 'primary',
        bullets: [
            'Answers syllabus doubts in plain language',
            'Escalates to a teacher when it is out of depth',
            'Logs the topic so you see what the batch struggles with',
        ],
        sample: [
            { speaker: 'person', text: 'Ma’am, integration by parts samajh nahi aaya.' },
            {
                speaker: 'agent',
                text: 'Koi baat nahi — ek simple example se start karte hain. Aapka chapter kaunsa hai?',
            },
        ],
        defaults: {
            name: 'Doubt Solver',
            direction: 'INBOUND',
            language: 'hinglish',
            maxCallMinutes: 8,
            extractionQuestions: [
                'Which subject and chapter was the doubt about?',
                'Was the doubt resolved on the call?',
                'Does the student need a teacher callback?',
            ],
            dispositions: ['DOUBT_RESOLVED', 'NEEDS_TEACHER', 'CALL_BACK_LATER'],
        },
        questions: [
            instituteQ,
            {
                id: 'subjects',
                label: 'Subjects and classes it should handle',
                placeholder: 'e.g. Physics, Chemistry, Maths for Class 11 & 12 JEE',
                type: 'text',
                required: true,
            },
            {
                id: 'escalation',
                label: 'When it cannot answer, it should',
                type: 'select',
                options: [
                    'Promise a teacher callback and log the doubt',
                    'Transfer the call to a teacher right away',
                    'Book a doubt-clearing session',
                ],
            },
            languageQ,
        ],
        brief: (a) =>
            `An inbound doubt-solving phone agent for ${a.institute}, an education institute. Students call in with academic doubts in ${a.subjects}. The agent explains concepts simply, step by step, checks whether the student understood, and asks if there is another doubt. When the doubt is beyond it or needs a diagram, it ${(a.escalation || '').toLowerCase()}. It must never guess an answer it is unsure of. Language: ${a.language || 'Hinglish'}.`,
        fallbackPrompt: (a) =>
            `You are the doubt-solving assistant for ${a.institute}. Students call you with doubts in ${a.subjects}.

Your job:
- Understand the exact doubt: subject, chapter, and where the student got stuck.
- Explain the concept step by step in simple language, with one small example.
- Check understanding: ask the student to say the step back in their own words.
- Ask if there is another doubt before ending.
- If the doubt needs a diagram, is outside ${a.subjects}, or you are not confident: ${a.escalation || 'promise a teacher callback and log the doubt'}.

${commonRules(a)}`,
        fallbackOpeningLine: (a) =>
            `Namaste, ${a.institute} doubt helpline. Boliye, kis subject mein doubt hai?`,
    },
    {
        id: 'study-mentor',
        title: 'Study Mentor',
        tagline: 'Weekly check-in call that keeps a student on track between classes.',
        audience: 'Outbound · students',
        icon: Compass,
        accent: 'info',
        bullets: [
            'Asks what got done and what slipped',
            'Agrees one concrete goal for the week',
            'Flags students who are drifting before they drop off',
        ],
        sample: [
            {
                speaker: 'agent',
                text: 'Is hafte ke 3 chapters mein se kitne ho gaye?',
            },
            { speaker: 'person', text: 'Do ho gaye, teesra pending hai.' },
        ],
        defaults: {
            name: 'Study Mentor',
            direction: 'OUTBOUND',
            language: 'hinglish',
            maxCallMinutes: 6,
            extractionQuestions: [
                'What did the student complete since the last check-in?',
                'What is blocking them right now?',
                'What goal did they commit to for the coming week?',
            ],
            dispositions: ['ON_TRACK', 'NEEDS_SUPPORT', 'AT_RISK', 'NOT_REACHABLE'],
        },
        questions: [
            instituteQ,
            {
                id: 'program',
                label: 'Which batch or programme is being mentored',
                placeholder: 'e.g. NEET 2027 dropper batch',
                type: 'text',
                required: true,
            },
            {
                id: 'focus',
                label: 'What a good check-in should cover',
                placeholder:
                    'e.g. last week’s chapters, test scores, revision plan, and any personal blocker',
                type: 'textarea',
            },
            languageQ,
        ],
        brief: (a) =>
            `An outbound weekly mentoring call for students of ${a.institute} in the ${a.program} programme. The mentor asks how the past week went, what was completed, what slipped and why, then agrees one specific, achievable goal for the coming week and confirms it out loud. It should cover: ${a.focus || 'progress since last week, current blockers, and the plan for the coming week'}. Encouraging, never scolding. Language: ${a.language || 'Hinglish'}.`,
        fallbackPrompt: (a) =>
            `You are a study mentor calling students of ${a.institute} in the ${a.program} programme for their weekly check-in.

Your job:
- Ask how the week went and what they actually completed.
- Find the real blocker behind anything that slipped (time, difficulty, motivation, health).
- Cover: ${a.focus || 'progress since last week, current blockers, and the plan for the coming week'}.
- Agree ONE specific goal for the coming week and repeat it back so it is committed.
- Encourage genuinely — name what went well before what did not.
- If the student sounds seriously demotivated or mentions a personal problem, do not counsel them yourself: tell them a mentor from ${a.institute} will call, and flag it.

${commonRules(a)}`,
        fallbackOpeningLine: (a) =>
            `Hi, main ${a.institute} se aapki weekly check-in ke liye call kar rahi hoon. Do minute baat kar sakte hain?`,
    },
    {
        id: 'parent-update',
        title: 'Parent Update',
        tagline: 'Calls parents with an honest progress update — and listens to their concerns.',
        audience: 'Outbound · parents',
        icon: Users,
        accent: 'success',
        bullets: [
            'Shares attendance, tests and effort in plain words',
            'Captures the parent’s worry in their own words',
            'Books a teacher meeting when one is needed',
        ],
        sample: [
            {
                speaker: 'agent',
                text: 'Aditya ki attendance 92% hai, aur last test mein improvement dikha.',
            },
            { speaker: 'person', text: 'Ghar pe padhai kam kar raha hai, kya karein?' },
        ],
        defaults: {
            name: 'Parent Update',
            direction: 'OUTBOUND',
            language: 'hinglish',
            maxCallMinutes: 7,
            extractionQuestions: [
                'What is the parent’s main concern?',
                'Did the parent ask for a teacher meeting?',
                'How satisfied did the parent sound (happy / neutral / unhappy)?',
            ],
            dispositions: ['UPDATE_GIVEN', 'MEETING_REQUESTED', 'ESCALATE_TO_TEACHER', 'NO_ANSWER'],
        },
        questions: [
            instituteQ,
            {
                id: 'covers',
                label: 'What the update should cover',
                placeholder: 'e.g. attendance, last two test scores, homework regularity',
                type: 'text',
                required: true,
            },
            {
                id: 'nextStep',
                label: 'Preferred next step when a parent is concerned',
                type: 'select',
                options: [
                    'Book a meeting with the class teacher',
                    'Promise a callback from the academic head',
                    'Share a study plan on WhatsApp',
                ],
            },
            languageQ,
        ],
        brief: (a) =>
            `An outbound call to a PARENT of a student at ${a.institute}, giving an honest progress update covering ${a.covers}. The agent greets respectfully, confirms it is speaking to the parent, gives the update in plain language without jargon, then asks whether they have any concern about their child. It listens fully, does not get defensive about the institute, and when the parent is worried it will ${(a.nextStep || '').toLowerCase()}. It must never share another student's information or make promises about results. Language: ${a.language || 'Hinglish'}.`,
        fallbackPrompt: (a) =>
            `You are calling a PARENT of a student at ${a.institute} with a progress update.

Your job:
- Confirm you are speaking to the student's parent or guardian before sharing anything.
- Give the update in plain language: ${a.covers}. Be honest — mention what is going well AND what needs work.
- Ask if they have any concern about their child's studies, and let them finish speaking.
- When they are worried: ${a.nextStep || 'book a meeting with the class teacher'}.
- Never share any other student's information. Never promise ranks, marks or admission outcomes.
- If the parent is upset with ${a.institute}, do not argue. Acknowledge, note the complaint, and escalate.

${commonRules(a)}`,
        fallbackOpeningLine: (a) =>
            `Namaste, main ${a.institute} se bol rahi hoon. Kya main student ke parent se baat kar rahi hoon?`,
    },
    {
        id: 'admissions-counsellor',
        title: 'Admissions Counsellor',
        tagline: 'Calls new enquiries, qualifies them, and books the demo or campus visit.',
        audience: 'Outbound · leads',
        icon: Sparkle,
        accent: 'warning',
        bullets: [
            'Qualifies class, goal, budget and timeline',
            'Handles the usual objections without pushing',
            'Books a demo class straight into your calendar',
        ],
        sample: [
            { speaker: 'agent', text: 'Aap kis class ke liye coaching dekh rahe hain?' },
            { speaker: 'person', text: 'Class 11, JEE ke liye. Fees kitni hai?' },
        ],
        defaults: {
            name: 'Admissions Counsellor',
            direction: 'OUTBOUND',
            language: 'hinglish',
            maxCallMinutes: 6,
            extractionQuestions: [
                'Which class or exam is the student preparing for?',
                'What is the timeline for joining?',
                'What objection or concern did they raise?',
            ],
            dispositions: [
                'DEMO_BOOKED',
                'INTERESTED',
                'CALL_BACK_LATER',
                'NOT_INTERESTED',
                'WRONG_NUMBER',
            ],
        },
        questions: [
            instituteQ,
            {
                id: 'offering',
                label: 'What you are selling',
                placeholder: 'e.g. 2-year JEE classroom programme, ₹85,000/year',
                type: 'text',
                required: true,
            },
            {
                id: 'goal',
                label: 'The next step you want from the call',
                type: 'select',
                options: [
                    'Book a free demo class',
                    'Book a campus visit',
                    'Schedule a counsellor callback',
                    'Get them to start the application',
                ],
            },
            {
                id: 'objections',
                label: 'Common objections and your honest answers',
                placeholder:
                    'e.g. “Fees zyada hai” → instalments available; “Distance” → weekend batch',
                type: 'textarea',
            },
            languageQ,
        ],
        brief: (a) =>
            `An outbound admissions/sales call for ${a.institute}, an education institute selling ${a.offering}. The agent introduces itself, confirms it is a good time, understands what the student needs (class, target exam, current preparation, timeline), then positions ${a.offering} against that need. The goal of the call is: ${a.goal || 'book a free demo class'}. It handles objections honestly using these notes: ${a.objections || 'no specific objections provided'}. It never pressures, never promises ranks or guaranteed selection, and always confirms the agreed next step with a time. Language: ${a.language || 'Hinglish'}.`,
        fallbackPrompt: (a) =>
            `You are an admissions counsellor for ${a.institute}. You are calling someone who enquired about ${a.offering}.

Your job:
- Introduce yourself and ${a.institute}, and check it is a good time to talk.
- Understand before you pitch: which class/exam, current preparation, what they are looking for, and by when.
- Position ${a.offering} against what they actually said they need — not a generic pitch.
- Handle objections honestly. Notes: ${a.objections || 'answer honestly; if you do not know, say a counsellor will confirm.'}
- Drive to one next step: ${a.goal || 'book a free demo class'}. Offer two specific time options and confirm the chosen one.
- Never promise ranks, selection or guaranteed results. Never pressure someone who says no.

${commonRules(a)}`,
        fallbackOpeningLine: (a) =>
            `Namaste, main ${a.institute} se bol rahi hoon — aapne hamare course ke baare mein enquiry ki thi. Do minute baat kar sakte hain?`,
    },
    {
        id: 'fee-reminder',
        title: 'Fee Reminder',
        tagline: 'Reminds families about a due instalment — politely, and without nagging.',
        audience: 'Outbound · parents',
        icon: CurrencyInr,
        accent: 'danger',
        bullets: [
            'States the amount and due date clearly',
            'Offers the payment link or instalment option',
            'Records a promise-to-pay date you can follow up on',
        ],
        sample: [
            {
                speaker: 'agent',
                text: 'Second instalment 15 tarikh ko due hai. Payment link bhej doon?',
            },
            { speaker: 'person', text: 'Haan, agle hafte kar denge.' },
        ],
        defaults: {
            name: 'Fee Reminder',
            direction: 'OUTBOUND',
            language: 'hinglish',
            maxCallMinutes: 4,
            extractionQuestions: [
                'By what date did they promise to pay?',
                'What reason did they give for the delay?',
                'Do they want an instalment plan?',
            ],
            dispositions: [
                'WILL_PAY',
                'PROMISE_TO_PAY',
                'DISPUTE',
                'NEEDS_INSTALMENT',
                'NO_ANSWER',
            ],
        },
        questions: [
            instituteQ,
            {
                id: 'options',
                label: 'Payment options you can offer',
                placeholder: 'e.g. UPI link on WhatsApp, 3-instalment plan, cash at the front desk',
                type: 'text',
                required: true,
            },
            {
                id: 'tone',
                label: 'How firm should it be',
                type: 'select',
                options: [
                    'Gentle reminder only',
                    'Firm but respectful, mention the late fee',
                    'Final reminder before class access pauses',
                ],
            },
            languageQ,
        ],
        brief: (a) =>
            `An outbound fee-reminder call to a parent of a student at ${a.institute}. The agent confirms it is the parent, states the pending instalment and due date clearly, and offers these payment options: ${a.options}. Tone: ${a.tone || 'gentle reminder only'}. If the family cannot pay now, it asks for a specific date and records it rather than arguing. It stays respectful throughout and never shames anyone. Language: ${a.language || 'Hinglish'}.`,
        fallbackPrompt: (a) =>
            `You are calling a parent of a student at ${a.institute} about a pending fee instalment.

Your job:
- Confirm you are speaking to the parent or guardian.
- State the pending amount and due date clearly and calmly, once.
- Offer the ways to pay: ${a.options}.
- Tone: ${a.tone || 'gentle reminder only'}.
- If they cannot pay now, ask for a specific date they can commit to and repeat it back. Do not argue or push.
- If they dispute the amount, do not defend it — note the dispute and tell them the accounts team will call.
- Never shame the family, never discuss the fee with anyone other than the parent or guardian.

${commonRules(a)}`,
        fallbackOpeningLine: (a) =>
            `Namaste, main ${a.institute} se bol rahi hoon, fees ke reminder ke liye. Kya main parent se baat kar rahi hoon?`,
    },
    {
        id: 'winback',
        title: 'Re-engagement',
        tagline: 'Calls learners who have gone quiet and finds out what actually happened.',
        audience: 'Outbound · dormant learners',
        icon: HandHeart,
        accent: 'primary',
        bullets: [
            'Opens without guilt-tripping',
            'Digs for the real reason they stopped',
            'Offers one specific way back in',
        ],
        sample: [
            { speaker: 'agent', text: 'Ek mahine se classes miss ho rahi hain — sab theek hai?' },
            { speaker: 'person', text: 'Timing clash ho raha tha office ke saath.' },
        ],
        defaults: {
            name: 'Re-engagement',
            direction: 'OUTBOUND',
            language: 'hinglish',
            maxCallMinutes: 5,
            extractionQuestions: [
                'Why did the learner stop attending?',
                'What would bring them back?',
                'Did they agree to a specific return date or batch?',
            ],
            dispositions: ['RETURNING', 'INTERESTED', 'BLOCKED', 'DROPPED_OUT', 'NO_ANSWER'],
        },
        questions: [
            instituteQ,
            {
                id: 'program',
                label: 'Which course or batch they went quiet on',
                placeholder: 'e.g. Weekend Spoken English batch',
                type: 'text',
                required: true,
            },
            {
                id: 'offer',
                label: 'What you can offer to bring them back',
                placeholder: 'e.g. switch to the weekend batch free, recorded catch-up classes',
                type: 'textarea',
            },
            languageQ,
        ],
        brief: (a) =>
            `An outbound win-back call to a learner of ${a.institute} who has stopped attending ${a.program}. The agent opens with genuine concern rather than blame, asks what got in the way, and listens. Based on the reason, it offers: ${a.offer || 'a way to catch up on what they missed'}. It aims to agree one concrete return step — a date, a batch switch, or a catch-up plan. If the learner has genuinely moved on, it thanks them and closes warmly. Language: ${a.language || 'Hinglish'}.`,
        fallbackPrompt: (a) =>
            `You are calling a learner of ${a.institute} who has stopped attending ${a.program}.

Your job:
- Open with concern, not blame: you noticed they have not been attending and wanted to check in.
- Find the REAL reason: timing, difficulty, fees, health, motivation, or something personal.
- Based on that reason, offer: ${a.offer || 'a specific way to catch up on what they missed'}.
- Agree one concrete step — a return date, a batch switch, or a catch-up plan — and confirm it.
- If they have genuinely moved on, thank them warmly, ask for one line of honest feedback, and close.
- Never guilt-trip, never imply they wasted money.

${commonRules(a)}`,
        fallbackOpeningLine: (a) =>
            `Hi, main ${a.institute} se bol rahi hoon — kaafi din se aapki classes miss ho rahi hain, sab theek hai?`,
    },
];

/** Card chrome per accent — kept here so the gallery stays presentational. */
export const ACCENT_CLASSES: Record<
    UseCaseAccent,
    { border: string; iconBg: string; iconText: string; bubble: string }
> = {
    primary: {
        border: 'hover:border-primary-300',
        iconBg: 'bg-primary-50',
        iconText: 'text-primary-500',
        bubble: 'bg-primary-50 text-primary-500',
    },
    success: {
        border: 'hover:border-success-300',
        iconBg: 'bg-success-50',
        iconText: 'text-success-600',
        bubble: 'bg-success-50 text-success-600',
    },
    info: {
        border: 'hover:border-info-300',
        iconBg: 'bg-info-50',
        iconText: 'text-info-600',
        bubble: 'bg-info-50 text-info-600',
    },
    warning: {
        border: 'hover:border-warning-300',
        iconBg: 'bg-warning-50',
        iconText: 'text-warning-600',
        bubble: 'bg-warning-50 text-warning-600',
    },
    danger: {
        border: 'hover:border-danger-300',
        iconBg: 'bg-danger-50',
        iconText: 'text-danger-600',
        bubble: 'bg-danger-50 text-danger-600',
    },
};
