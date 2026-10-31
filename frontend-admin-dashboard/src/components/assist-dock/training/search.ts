/**
 * Training library: turns the raw training_video rows into a browsable library and searches it.
 *
 * Pure TS, no React / DOM. The health-check dashboard keeps a byte-for-byte copy
 * (src/lib/training-search.ts) for its "search preview", so super admins see exactly what
 * institute admins will find — change both together.
 *
 * Search is "understand what they meant", not substring matching:
 *  - synonym groups ("homework" finds Assignments, "fees" finds the paid-course video)
 *  - Hinglish ("fees kaise le", "recording kaha milega")
 *  - spelling correction ("attendence" → attendance) and prefix matching while typing
 *  - per-video keywords that super admins add from the health dashboard
 */

export interface TrainingVideoRow {
    id: string;
    title: string;
    description: string | null;
    fileUrl: string;
    modulePath: string[];
    keywords?: string[] | null;
    sortOrder?: number | null;
    createdAt: string;
}

export interface Placement {
    /** Module, e.g. "LMS" / "CRM" (module path level 1). */
    root: string;
    /** Section key (module path level 2, as stored). */
    section: string;
    /** Optional sub-group (level 3) — only when it is not just the video's own title. */
    group: string | null;
    step: number | null;
}

export interface LibraryVideo {
    id: string;
    title: string;
    description: string;
    topics: string[];
    /** Description written as "a → b → c": render the topics as a flow. */
    flow: boolean;
    keywords: string[];
    fileUrl: string;
    createdAt: string;
    placements: Placement[];
    /** Title / topics before naming settings were applied — still searchable. */
    originalTitle: string;
    originalTopics: string[];
}

export interface SectionItem {
    video: LibraryVideo;
    step: number | null;
    group: string | null;
}

export interface Section {
    key: string;
    /** Display name — naming settings applied. */
    name: string;
    root: string;
    items: SectionItem[];
    numbered: boolean;
}

export interface Library {
    videos: LibraryVideo[];
    byId: Map<string, LibraryVideo>;
    sections: Map<string, Section>;
    /** Sections, biggest first. */
    sectionList: Section[];
    /** Modules in the order they first appear in sectionList. */
    roots: string[];
}

export type Rename = (text: string) => string;

const tidy = (s: string | null | undefined) =>
    (s || '')
        .replace(/\s+/g, ' ')
        .replace(/\s+([,.:;!?])/g, '$1')
        .replace(/[\s.,;:]+$/, '')
        .trim();
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** "3. Add Learning Content" → { step: 3, title: "Add Learning Content" } */
export function parseTitle(t: string): { step: number | null; title: string } {
    const m = (t || '').match(/^\s*(\d{1,3})\s*[.)]\s*(\S.*)$/);
    return m ? { step: +m[1]!, title: cap(tidy(m[2])) } : { step: null, title: cap(tidy(t)) };
}

/** Descriptions are topic lists ("a; b; c", "• a • b", "x → y → z") — split them into chips. */
export function parseTopics(d: string | null | undefined): string[] {
    const text = (d || '').trim();
    if (!text) return [];
    let parts: string[];
    if (text.includes('•')) parts = text.split('•');
    else if (text.includes(';')) parts = text.split(/;|,(?=[A-Z])/);
    else if (text.includes('→')) parts = text.replace(/^[^:→]*:/, '').split('→');
    else parts = text.split(',');
    return parts.map((p) => cap(tidy(p))).filter((p) => p.length > 1);
}

const isFlow = (d: string | null | undefined) => !!d && !/[•;]/.test(d) && d.includes('→');

/**
 * Builds the library:
 *  - a level-3 path segment that just repeats the title is dropped (no one-video folders)
 *  - the same video uploaded under two sections shows once, with "Also in …"
 *  - sections are ordered by sortOrder, else by the "N." prefix of the title
 *  - `rename` applies the institute's naming settings to what admins read
 */
export function buildLibrary(rows: TrainingVideoRow[], rename: Rename = (s) => s): Library {
    const videos: LibraryVideo[] = [];
    const byId = new Map<string, LibraryVideo>();
    const seen = new Map<string, LibraryVideo>();
    for (const r of rows) {
        const parsed = parseTitle(r.title);
        const step = r.sortOrder && r.sortOrder > 0 ? r.sortOrder : parsed.step;
        const path = (r.modulePath || []).map(tidy).filter(Boolean);
        const root = path[0] || 'Other';
        const section = path[1] || root;
        const rawGroup = path[2] || null;
        const group =
            rawGroup &&
            !squash(parseTitle(rawGroup).title).includes(squash(parsed.title)) &&
            !squash(parsed.title).includes(squash(parseTitle(rawGroup).title))
                ? rawGroup
                : null;
        const key = root + '|' + squash(parsed.title);
        let v = seen.get(key);
        if (!v) {
            v = {
                id: r.id,
                title: rename(parsed.title),
                description: tidy(r.description),
                topics: parseTopics(r.description).map(rename),
                flow: isFlow(r.description),
                keywords: (r.keywords || []).map((k) => k.trim()).filter(Boolean),
                fileUrl: r.fileUrl,
                createdAt: r.createdAt,
                placements: [],
                originalTitle: parsed.title,
                originalTopics: parseTopics(r.description),
            };
            seen.set(key, v);
            videos.push(v);
        } else {
            // Same video uploaded twice: keep every keyword either copy carries.
            for (const k of r.keywords || [])
                if (k.trim() && !v.keywords.includes(k.trim())) v.keywords.push(k.trim());
        }
        byId.set(r.id, v);
        v.placements.push({ root, section, group: group ? rename(group) : null, step });
    }

    const sections = new Map<string, Section>();
    for (const v of videos)
        for (const p of v.placements) {
            const k = p.root + '|' + p.section;
            let s = sections.get(k);
            if (!s) {
                s = { key: k, name: rename(p.section), root: p.root, items: [], numbered: false };
                sections.set(k, s);
            }
            s.items.push({ video: v, step: p.step, group: p.group });
        }
    for (const s of sections.values()) {
        s.items.sort(
            (a, b) =>
                (a.step ?? 1e9) - (b.step ?? 1e9) ||
                String(a.video.createdAt).localeCompare(String(b.video.createdAt))
        );
        s.numbered = s.items.some((i) => i.step != null);
    }
    const sectionList = [...sections.values()].sort(
        (a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name)
    );
    const roots: string[] = [];
    for (const s of sectionList) if (!roots.includes(s.root)) roots.push(s.root);
    // Keep modules in a stable, familiar order (LMS before CRM) regardless of size.
    roots.sort((a, b) => rootRank(a) - rootRank(b));

    return { videos, byId, sections, sectionList, roots };
}

const ROOT_ORDER = ['lms', 'crm', 'ai', 'erp'];
const rootRank = (r: string) => {
    const i = ROOT_ORDER.indexOf(r.toLowerCase());
    return i === -1 ? ROOT_ORDER.length : i;
};

export const sectionKey = (p: Placement) => p.root + '|' + p.section;

/* ------------------------------------------------------------------ search */

const STOP = new Set(
    (
        'how do does did doing i im ive a an the to too of in on for my me can could is are am be been was were with and or what whats ' +
        'which want wanna need needs please help way ways use using from into your you it its this that these those about get got should ' +
        'would will there their them we our us at by as so any all some also just very kind done one lms ' +
        // Hinglish filler — "class kaise banaye", "fees kaise le", "recording kaha milega"
        'kaise kese kaisey kaisa kaisi kare karen karein karna karne karte karu karo kya kyaa hai hain he ho hota hoti hote ka ki ke ko ' +
        'me mein mai main se par pe apne apna apni mera meri mere hum ham mujhe muje mereko humko chahiye chahie wala wali wale ek aur ' +
        'bhi sakte sake sakta sakti skte liye lie tha thi h kr krna kre krne krte kaun kon jab agar ya hi lekin sab sabhi kuch koi ' +
        'hoga hogi karenge kiya kiye kaunsa konsa hu hun bataye batao btao bata samjhao le lo lena lein'
    ).split(/\s+/)
);

export interface SynonymGroup {
    /** Stable id — the UI translates it (trainingViewer:groups.<id>). */
    id: string;
    words: string[];
    /** Generic verbs ("create", "see") only nudge ranking; they never decide it. */
    weak: boolean;
}

const G = (id: string, words: string, weak = false): SynonymGroup => ({
    id,
    words: words.split(/\s+/),
    weak,
});

/** Words that mean the same thing to an institute admin. */
export const SYNONYM_GROUPS: SynonymGroup[] = [
    G('liveClasses', 'class session lecture meeting zoom meet live kaksha'),
    G('webinars', 'webinar seminar event masterclass workshop'),
    G(
        'students',
        'student learner pupil candidate trainee chatra chhatra vidyarthi bacche bachche baccho bachcho bache children kids participant'
    ),
    G('teachers', 'teacher admin faculty tutor instructor mentor shikshak staff'),
    G('enrolling', 'enroll enrol enrollment enrolment admit admission onboard invite'),
    G('tests', 'assessment test exam examination mock paper pariksha olympiad'),
    G('quizzes', 'quiz mcq poll'),
    G('questions', 'question sawal prashn prashna'),
    G('assignments', 'assignment homework hw classwork task project'),
    G(
        'evaluation',
        'evaluate evaluation evaluator grading grade correction subjective handwritten copy'
    ),
    G(
        'payments',
        'payment pay paid fee fees price pricing sell selling charge monetize monetise purchase buy shulk razorpay stripe money revenue paise paisa invoice'
    ),
    G('coupons', 'coupon discount offer promo promocode voucher'),
    G('doubts', 'doubt query queries shanka'),
    G(
        'attendance',
        'attendance attend attended present absent presence hajri haziri hazri participation'
    ),
    G('recordings', 'recording record recorded replay playback'),
    G(
        'reports',
        'report analytics analysis progress performance stats statistics insight dashboard track tracking monitor result score marks'
    ),
    G('content', 'content material pdf ppt slide document doc video youtube file upload'),
    G('structure', 'structure syllabus curriculum chapter module subject topic lesson unit'),
    G('courses', 'course program programme batch cohort package'),
    G('scheduling', 'schedule timetable calendar reschedule recurring'),
    G('bulk', 'bulk multiple mass together csv import excel sheet'),
    G('ai', 'ai gpt chatgpt automatic auto generate generator'),
    G('coding', 'code coding compiler python java javascript editor'),
    G('terminology', 'terminology rename naming name label term wording customize customise'),
    G('feedback', 'feedback rating review survey response opinion'),
    G('classLink', 'link url join joining'),
    G('hosting', 'host conduct teach padhana padhaye padhao'),
    G('learnerView', 'preview experience'),
    G('registration', 'registration register signup form'),
    G('certificates', 'certificate certification'),
    G('publishing', 'publish launch release'),
    G('notes', 'note summary'),
    G('engagement', 'engagement activity opened read spent usage'),
    // CRM
    G('leads', 'lead leads enquiry enquiries inquiry prospect contact contacts crm'),
    G('audience', 'audience segment'),
    G('whatsapp', 'whatsapp wa template broadcast'),
    G('messages', 'message messaging sms'),
    G('email', 'email mail newsletter'),
    G('campaigns', 'campaign campaigns drip automation workflow'),
    G('followUps', 'followup reminder callback'),
    G('calls', 'call calling dialer ivr phone'),
    G('counsellors', 'counsellor counselor telecaller agent owner'),
    G('pipeline', 'pipeline stage funnel status'),
    // weak verbs
    G(
        'create',
        'create make add new build setup generate banaye banana banao banaen bnaye bnana jode jodna jodo dale daale',
        true
    ),
    G(
        'find',
        'see view check find where locate show detail dekhe dekhen dekhna dekho dikhe dikhega dikhegi dikhta dikhti kaha kahan kidhar milega mile milta',
        true
    ),
    G('edit', 'edit change update modify badle badlo badalna sudhare', true),
    G('delete', 'delete remove cancel hatao hataye hatana mitao mitaye', true),
    G('manage', 'manage handle organise organize assign', true),
];

/** Multi-word things people type, rewritten to words the library actually uses. */
const PHRASES: Array<[RegExp, string]> = [
    [/\b(ek\s*sa+th|at\s+once|at\s+a\s+time|in\s+one\s+go)\b/g, 'bulk'],
    [/\banswer\s*(sheet|copy|copies|script)s?\b/g, 'evaluate copy'],
    [/\b(check(ing)?|evaluat\w*)\s+cop(y|ies)\b|\bcopy\s+check(ing)?\b/g, 'evaluate copy'],
    [
        /\bwho\s+(all\s+)?(attended|joined|came)\b|\b(kaun|kon)\s+(aaya|aya|aye|aaye)\b/g,
        'attendance',
    ],
    [/\b(zoom|meeting|meet|joining|class|live)\s+link\b/g, 'class link'],
    [
        /\bsell(ing)?\s+(my\s+|a\s+|the\s+)?courses?\b|\b(take|collect|accept)\s+(online\s+)?fees?\b|\bfees?\s+(kaise\s+)?(le|lena|lein|lu|lo)\b|\bpaise\s+(le|lena)\b|\bonline\s+payments?\b/g,
        'paid course payment',
    ],
    [
        /\b(create|make|add|start|banaye|banao|banana|bnaye|bnana)\s+(a\s+|new\s+)*(live\s+)?(class|session|lecture)(es|s)?\b|\b(live\s+)?(class|session|lecture)(es|s)?\s+(kaise\s+|ko\s+)?(create|make|add|start|banaye|banao|banana|bnaye|bnana)\b/g,
        'schedule live class',
    ],
    [
        /\b(rename|change|call)\s+(the\s+)?(course|batch|student|learner|teacher)s?\s+(name\s+)?(to|as|into)\s+[a-z]+\b/g,
        'terminology',
    ],
    [/\bgo\s+live\b/g, 'publish'],
    [
        /\b(add|jod[eo]?|jodna)\s+(new\s+)?(students?|learners?|bacch?[eo]n?)\b|\b(students?|learners?|bacch?[eo])\s+(kaise\s+|ko\s+)?(add|jod[eo]?|jodna)\b/g,
        'enroll student',
    ],
    [
        /\b(students?|learners?)\s+(side|view|app|panel)\b|\bwhat\s+(students?|learners?)\s+see\b/g,
        'learner experience',
    ],
    [/\bsign\s*up\b/g, 'registration'],
    [/\bpromo\s*code\b/g, 'coupon'],
    [/\bhome\s*work\b/g, 'homework'],
    [/\btime\s*table\b/g, 'timetable'],
    [/\bset\s*up\b/g, 'setup'],
    [/\bfollow[\s-]*ups?\b/g, 'followup'],
    [/\b(class|lecture|session)\s+videos?\b|\bvideos?\s+of\s+(the\s+)?class\b/g, 'recording'],
    [
        /\b(change|badal\w*|badl\w*)\s+(the\s+)?names?\b|\bnames?\s+(change|badal\w*|badl\w*)\b/g,
        'rename',
    ],
    [/\bquestion\s+papers?\b/g, 'assessment question'],
    [/\bhow\s+many\b/g, ''],
];

export const words = (s: string | null | undefined): string[] =>
    (s || '')
        .toLowerCase()
        .replace(/['’`]/g, '')
        .match(/[a-z0-9]+/g) || [];

/** Tiny stemmer: classes→class, quizzes→quiz, scheduling/scheduled/schedule→schedul, pricing/price→pric. */
export function stem(input: string): string {
    let w = input.toLowerCase();
    if (w.length <= 3) return w;
    if (w.endsWith('zzes')) w = w.slice(0, -3);
    else if (w.endsWith('ies') && w.length > 4) w = w.slice(0, -3) + 'y';
    else if (w.endsWith('sses')) w = w.slice(0, -2);
    else if (/(ch|sh|x)es$/.test(w)) w = w.slice(0, -2);
    else if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
    let cut = false;
    if (w.length > 5 && w.endsWith('ing') && w.length - 3 >= 4) {
        w = w.slice(0, -3);
        cut = true;
    } else if (w.length > 4 && w.endsWith('ed')) {
        w = w.slice(0, -2);
        cut = true;
    }
    if (cut && /([^aeioulsz])\1$/.test(w)) w = w.slice(0, -1);
    if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
    return w;
}

/** Damerau (OSA) distance with an early exit once it passes max. */
function distance(a: string, b: string, max: number): number {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev2: number[] = [];
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
            let v = Math.min(
                prev[j]! + 1,
                cur[j - 1]! + 1,
                prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
                v = Math.min(v, prev2[j - 2]! + 1);
            cur[j] = v;
            if (v < rowMin) rowMin = v;
        }
        if (rowMin > max) return max + 1;
        prev2 = prev;
        prev = cur;
    }
    return prev[b.length]!;
}

export type MatchField = 'title' | 'keywords' | 'topics' | 'section' | 'description';

export interface Concept {
    /** Tokens after phrase rewriting. */
    typed: string[];
    /** What the user actually typed for these tokens (phrase or word). */
    user: string[];
    /** Human form: the corrected word, or the phrase the user typed. */
    display: string;
    terms: Map<string, number>;
    groups: SynonymGroup[];
    weak: boolean;
    key: string;
}

export interface SearchResult {
    video: LibraryVideo;
    score: number;
    coverage: number;
    why: Array<{ concept: Concept; stem: string; field: MatchField }>;
    /** Stems to highlight in titles / topics. */
    marks: Set<string>;
}

export interface SearchOutcome {
    concepts: Concept[];
    unknown: string[];
    corrections: Array<[string, string]>;
    results: SearchResult[];
}

interface IndexedVideo {
    video: LibraryVideo;
    idx: Map<string, { w: number; field: MatchField }>;
    norm: string;
    step: number;
}

const FIELD_WEIGHT: Record<MatchField, number> = {
    title: 5,
    keywords: 4,
    topics: 3,
    section: 2,
    description: 1.5,
};

export function createSearchIndex(library: Library) {
    const vocab = new Map<string, number>();
    const stemToGroups = new Map<string, SynonymGroup[]>();
    const groupStems = new Map<SynonymGroup, Set<string>>();
    const docStems = new Set<string>();

    SYNONYM_GROUPS.forEach((g) => {
        const stems = new Set(g.words.map(stem));
        groupStems.set(g, stems);
        stems.forEach((s) => {
            if (!stemToGroups.has(s)) stemToGroups.set(s, []);
            stemToGroups.get(s)!.push(g);
        });
        g.words.forEach((w) => vocab.set(w, vocab.get(w) || 0));
    });

    const docs: IndexedVideo[] = library.videos.map((video) => {
        const idx = new Map<string, { w: number; field: MatchField }>();
        const add = (text: string, field: MatchField) => {
            for (const raw of words(text)) {
                if (STOP.has(raw) || raw.length < 2) continue;
                vocab.set(raw, (vocab.get(raw) || 0) + 1);
                const s = stem(raw);
                docStems.add(s);
                const cur = idx.get(s);
                if (!cur || cur.w < FIELD_WEIGHT[field])
                    idx.set(s, { w: FIELD_WEIGHT[field], field });
            }
        };
        // Displayed (naming-settings) words and the original ones are both searchable:
        // "programme" and "course" find the same video.
        add(`${video.title} ${video.originalTitle}`, 'title');
        video.keywords.forEach((k) => add(k, 'keywords'));
        [...video.topics, ...video.originalTopics].forEach((t) => add(t, 'topics'));
        video.placements.forEach((p) => {
            const s = library.sections.get(sectionKey(p));
            add(`${p.section} ${s?.name || ''} ${p.group || ''}`, 'section');
        });
        add(video.description, 'description');
        const norm =
            ' ' +
            words(video.title)
                .filter((w) => !STOP.has(w))
                .map(stem)
                .join(' ') +
            ' ';
        const step = Math.min(...video.placements.map((p) => p.step ?? 99));
        return { video, idx, norm, step };
    });

    const correct = (tok: string): { word: string; freq: number } | null => {
        if (tok.length < 4 || /\d/.test(tok)) return null;
        const max = tok.length >= 7 ? 2 : 1;
        let best: string | null = null;
        let bd = max + 1;
        let bf = -1;
        for (const [w, f] of vocab) {
            if (w === tok || Math.abs(w.length - tok.length) > max) continue;
            const d = distance(tok, w, max);
            if (d < bd || (d === bd && f > bf)) {
                best = w;
                bd = d;
                bf = f;
            }
        }
        return best && bd <= max ? { word: best, freq: bf } : null;
    };

    function parse(q: string, opts: { typing?: boolean; noCorrect?: boolean }) {
        const typing = opts.typing !== false && !/\s$/.test(q);
        let s = ' ' + q.toLowerCase().replace(/['’`]/g, '') + ' ';
        const origin = new Map<string, string>();
        for (const [re, rep] of PHRASES)
            s = s.replace(re, (m) => {
                rep.split(' ')
                    .filter(Boolean)
                    .forEach((w) => origin.set(w, m.trim()));
                return ` ${rep} `;
            });
        const toks = words(s).filter((w) => !STOP.has(w));
        const concepts: Concept[] = [];
        const unknown: string[] = [];
        const corrections: Array<[string, string]> = [];
        toks.forEach((tok, i) => {
            const terms = new Map<string, number>();
            const put = (st: string, w: number) => {
                if (!((terms.get(st) ?? -1) >= w)) terms.set(st, w);
            };
            const st0 = stem(tok);
            let display = origin.get(tok) || tok;
            if (vocab.has(tok) || docStems.has(st0) || stemToGroups.has(st0)) {
                put(st0, 1);
                // A rare word is probably a typo in the data itself ("clas") — also search the common spelling.
                if ((vocab.get(tok) || 0) <= 1 && !stemToGroups.has(st0)) {
                    const fix = correct(tok);
                    if (fix && fix.freq >= 3) put(stem(fix.word), 0.9);
                }
            } else {
                if (typing && i === toks.length - 1 && tok.length >= 3) {
                    let n = 0;
                    for (const w of vocab.keys())
                        if (w.startsWith(tok)) {
                            put(stem(w), 0.9);
                            if (++n >= 12) break;
                        }
                }
                if (!terms.size && !opts.noCorrect) {
                    const fix = correct(tok);
                    if (fix) {
                        put(stem(fix.word), 0.95);
                        corrections.push([tok, fix.word]);
                        display = fix.word;
                    }
                }
                if (!terms.size) {
                    unknown.push(tok);
                    return;
                }
            }
            const groups = new Set<SynonymGroup>();
            for (const st of [...terms.keys()])
                for (const g of stemToGroups.get(st) || []) groups.add(g);
            for (const g of groups) for (const st of groupStems.get(g)!) put(st, 0.8);
            const gl = [...groups];
            concepts.push({
                typed: [tok],
                user: words(origin.get(tok) || tok),
                display,
                terms,
                groups: gl,
                weak: gl.length > 0 && gl.every((g) => g.weak),
                key: gl.length
                    ? gl
                          .map((g) => g.id)
                          .sort()
                          .join(',')
                    : 't:' + [...terms.keys()].sort().join(','),
            });
        });
        // "paid" + "payment" are one idea, not two — merge so coverage isn't double-counted.
        const merged: Concept[] = [];
        const byKey = new Map<string, Concept>();
        for (const c of concepts) {
            const m = byKey.get(c.key);
            if (!m) {
                byKey.set(c.key, c);
                merged.push(c);
                continue;
            }
            m.typed.push(...c.typed);
            m.user.push(...c.user);
            for (const [st, w] of c.terms) if (!((m.terms.get(st) ?? -1) >= w)) m.terms.set(st, w);
        }
        return { concepts: merged, unknown, corrections, phrase: toks.map(stem).join(' ') };
    }

    function search(
        q: string,
        opts: { typing?: boolean; noCorrect?: boolean } = {}
    ): SearchOutcome {
        const P = parse(q, opts);
        const strong = P.concepts.filter((c) => !c.weak);
        const base = { concepts: P.concepts, unknown: P.unknown, corrections: P.corrections };
        if (!P.concepts.length || (P.unknown.length && !strong.length))
            return { ...base, results: [] };
        const out: Array<SearchResult & { step: number }> = [];
        for (const d of docs) {
            let sum = 0;
            let hit = 0;
            let titleHits = 0;
            const why: SearchResult['why'] = [];
            const marks = new Set<string>();
            for (const c of P.concepts) {
                let best = 0;
                let bt: string | null = null;
                let bf: MatchField | null = null;
                for (const [st, w] of c.terms) {
                    const f = d.idx.get(st);
                    if (!f) continue;
                    if (!c.weak) marks.add(st);
                    if (f.w * w > best) {
                        best = f.w * w;
                        bt = st;
                        bf = f.field;
                    }
                }
                if (!best || !bt || !bf) continue;
                // Every other word the user typed for this idea that also matches adds a little ("pdf upload").
                for (const st of new Set(c.typed.map(stem))) {
                    const f = st !== bt ? d.idx.get(st) : undefined;
                    if (f) best += 0.4 * f.w;
                }
                sum += best * (c.weak ? 0.35 : 1);
                if (!c.weak) {
                    hit++;
                    if (bf === 'title') titleHits++;
                    why.push({ concept: c, stem: bt, field: bf });
                }
            }
            if (strong.length ? hit === 0 : sum === 0) continue;
            const coverage = strong.length ? hit / strong.length : 1;
            let score = sum * (0.3 + 0.7 * coverage * coverage);
            if (strong.length && titleHits === strong.length) score += 2;
            if (P.phrase.includes(' ') && d.norm.includes(` ${P.phrase} `)) score += 6;
            out.push({ video: d.video, score, coverage, why, marks, step: d.step });
        }
        out.sort((a, b) => b.score - a.score || a.step - b.step);
        let res = out;
        if (strong.length > 1 && res.some((r) => r.coverage === 1))
            res = res.filter((r) => r.coverage >= 0.5);
        const top = res[0] ? res[0].score : 0;
        res = res.filter((r) => r.score >= top * 0.28);
        return { ...base, results: res };
    }

    return { search };
}

export type SearchIndex = ReturnType<typeof createSearchIndex>;
