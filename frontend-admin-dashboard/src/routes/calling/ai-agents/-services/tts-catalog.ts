/**
 * TTS engines and their voices.
 *
 * Standalone on purpose — imported by both the CRM agent dialog and the older
 * Settings card, and importing nothing from either, so there is no module cycle
 * and no third copy of the voice list. The backend serves the authoritative
 * catalog from `GET /ai-agents/voices`; everything here is the offline fallback
 * plus the rules for combining an engine with a voice.
 */

export type TtsModelId =
    | 'google'
    | 'edge'
    | 'smallest'
    | 'smallest_pro'
    | 'deepgram'
    | 'navana'
    | 'rumik'
    | 'sarvam'
    | 'sarvam_v4';

export interface VoiceOption {
    id: string;
    gender: string;
    /** Which engine this voice belongs to. Palettes do not overlap. */
    model: string;
    /** Display name when the id is not readable on its own (Bulbul v4: "Shubh · Hinglish · ads"). */
    label?: string;
}

export interface TtsModelMeta {
    id: TtsModelId;
    label: string;
    /** Shown under the picker — the price consequence, in the customer's terms. */
    note: string;
    /** Credits/min for the AI leg on this engine (surcharge already applied). */
    aiCreditsPerMin?: number;
    /** Credits/min for the telephony leg. */
    telephonyCreditsPerMin?: number;
    /** This engine's adjustment in credits/min — negative means a discount. */
    ttsCreditsPerMin?: number;
    /** What a minute on this engine really costs the institute. */
    totalCreditsPerMin?: number;
    defaultVoice: string;
}

export const TTS_MODELS: TtsModelMeta[] = [
    {
        id: 'google',
        label: 'Google Chirp3-HD',
        // The founder chose this by ear over every other engine, and it is also
        // cheaper per call-minute than Sarvam (measured on our own traffic:
        // 779 characters per call-minute, so $30/1M lands at ~Rs 2.06 against
        // Sarvam's Rs 2.34), with ~1,280 free minutes a month.
        note: 'Recommended — clearest Hindi, and cheaper per minute than Sarvam.',
        defaultVoice: 'hi-IN-Chirp3-HD-Achird',
    },
    {
        id: 'edge',
        label: 'Microsoft Edge (free)',
        // Costs us nothing per character, so it is sold at a flat Rs 2/minute.
        // Slower to first audio than Chirp3-HD (0.27s vs 0.18s, measured), and
        // despite "offline" it calls Microsoft's public endpoint — a network
        // dependency with no SLA behind it.
        note: 'Free TTS — no vendor charge, so it is sold cheaper. Starts ~0.1s slower.',
        defaultVoice: 'hi-IN-SwaraNeural',
    },
    {
        id: 'smallest',
        label: 'Smallest.ai Lightning v3.1',
        note: 'Indian-language specialist. Included in the standard per-minute rate.',
        defaultVoice: 'devansh',
    },
    {
        id: 'smallest_pro',
        label: 'Smallest.ai Lightning v3.1 Pro',
        // A SEPARATE engine, not a variant: the v3.1 and v3.1_pro voice lists are
        // disjoint and the API hard-rejects a cross-model name ("Voice 'devansh' is
        // not available on the lightning_v3.1_pro model") — a silent call. Costs
        // $0.195/10K chars (~Rs 1.34/call-min) vs standard's $0.175 (~Rs 1.20);
        // both are under Google's Rs 2.06, so neither carries a surcharge.
        note: 'Higher-quality Indian voices. Different voice list from v3.1.',
        defaultVoice: 'mandar',
    },
    {
        id: 'deepgram',
        label: 'Deepgram Aura-2 (English only)',
        // Verified against Deepgram's live /v1/models catalog: 102 TTS models across
        // en/es/de/fr/nl/it/ja and NO Hindi at any tier. It does NOT refuse other
        // scripts — Devanagari returns HTTP 200 and fluent nonsense — so the backend
        // refuses the pairing at save time. $30/1M chars, same as Chirp3-HD.
        note: 'English only — no Hindi voice exists. Not for a Hinglish agent.',
        defaultVoice: 'aura-2-asteria-en',
    },
    {
        id: 'navana',
        label: 'Navana (Bodhi)',
        // One voice id speaks all ten languages (bn en gu hi kn ml mr or ta te);
        // the agent's language picks which. Genders are read from the names.
        note: 'Indian voices; one voice speaks all ten languages. New — audition first.',
        defaultVoice: 'bhavana',
    },
    {
        id: 'rumik',
        label: 'Rumik Silk Mulberry 1.5',
        note: 'Cheapest, but mispronounces some Hindi words over the phone.',
        defaultVoice: 'ira',
    },
    {
        id: 'sarvam_v4',
        label: 'Sarvam Bulbul v4 Flash',
        // Its OWN engine, not a v3 variant: persona voices ("shubh_enhi_ads") share
        // no id with v3 and the API rejects a v3 name — a silent call. Rs 1/1K chars,
        // a third of v3, so no surcharge. Voices come from GET /ai-agents/voices.
        note: 'New — 200+ persona voices in 10 Indian languages, no extra charge. Audition first.',
        defaultVoice: 'shubh_enhi_ads',
    },
    {
        id: 'sarvam',
        label: 'Sarvam Bulbul v3',
        note: 'Adds 4 credits per minute.',
        defaultVoice: 'priya',
    },
];

// Google Cloud hi-IN voices, curated from its live list_voices API. Genders are
// Google's OWN ssml_gender: nothing in "Achird" (male) or "Achernar" (female)
// hints at it, and the bot conjugates Hindi verbs from the gender, so a wrong
// entry makes a male voice say "kar rahi hoon".
// ⚠️ CASE IS SIGNIFICANT — Google voice names are exact resource ids. Never
// lowercase them on the way to the API (see voiceIdOf below).
const GOOGLE_MALE = [
    'hi-IN-Chirp3-HD-Achird',
    'hi-IN-Chirp3-HD-Charon',
    'hi-IN-Chirp3-HD-Fenrir',
    'hi-IN-Chirp3-HD-Orus',
    'hi-IN-Chirp3-HD-Puck',
    'hi-IN-Chirp3-HD-Schedar',
    'hi-IN-Neural2-B',
    'hi-IN-Neural2-C',
    'hi-IN-Wavenet-B',
    'hi-IN-Wavenet-C',
];
const GOOGLE_FEMALE = [
    'hi-IN-Chirp3-HD-Achernar',
    'hi-IN-Chirp3-HD-Aoede',
    'hi-IN-Chirp3-HD-Kore',
    'hi-IN-Chirp3-HD-Leda',
    'hi-IN-Chirp3-HD-Zephyr',
    'hi-IN-Chirp3-HD-Sulafat',
    'hi-IN-Neural2-A',
    'hi-IN-Neural2-D',
    'hi-IN-Wavenet-A',
    'hi-IN-Wavenet-D',
];

// Smallest.ai Lightning v3.1 (standard) Hindi voices, Indian accent, from its
// live get_voices catalog. Only v3.1 names: the palettes are per-model and the
// API rejects a _pro voice on the standard model outright — a silent call.
const SMALLEST_MALE = ['devansh', 'kaustubh', 'virat', 'karan', 'yash', 'debashis'];
const SMALLEST_FEMALE = ['imogen', 'nirupma', 'niharika'];

// Smallest.ai Lightning v3.1 PRO. A disjoint palette from standard v3.1 above —
// the API rejects a cross-model name outright, so these must never be merged.
const SMALLEST_PRO_MALE = ['mandar', 'mathan', 'barath'];
const SMALLEST_PRO_FEMALE = ['manasi', 'mrunal', 'ketaki', 'meher'];

// Deepgram Aura-2, American English ONLY — Deepgram publishes no Hindi voice at
// any tier. Genders are Deepgram's own metadata tags, not inferred from the
// mythological names: Janus and Juno are both FEMALE there.
const DEEPGRAM_MALE = [
    'aura-2-apollo-en',
    'aura-2-arcas-en',
    'aura-2-atlas-en',
    'aura-2-hermes-en',
    'aura-2-mars-en',
    'aura-2-odysseus-en',
];
const DEEPGRAM_FEMALE = [
    'aura-2-asteria-en',
    'aura-2-athena-en',
    'aura-2-helena-en',
    'aura-2-hera-en',
    'aura-2-luna-en',
    'aura-2-cordelia-en',
    'aura-2-harmonia-en',
    'aura-2-electra-en',
];

const RUMIK_FEMALE = ['ira', 'emma', 'mia', 'sophia', 'ava', 'siya', 'aisha', 'zoya'];
const RUMIK_MALE = ['adam', 'lucas', 'noah', 'theo'];

const SARVAM_FEMALE = [
    'ritu',
    'priya',
    'neha',
    'pooja',
    'simran',
    'kavya',
    'ishita',
    'shreya',
    'roopa',
    'tanya',
    'shruti',
    'suhani',
    'kavitha',
    'rupali',
    'niharika',
];
const SARVAM_MALE = [
    'shubh',
    'aditya',
    'rahul',
    'rohan',
    'amit',
    'dev',
    'ratan',
    'varun',
    'manan',
    'sumit',
    'kabir',
    'aayan',
    'ashutosh',
    'advait',
    'anand',
    'tarun',
    'sunny',
    'mani',
    'gokul',
    'vijay',
    'mohit',
    'rehan',
    'soham',
];

// Microsoft Edge read-aloud. Only five voices exist for India; names are
// locale-prefixed and end in Neural, which is how the bot spots one that
// belongs to another vendor.
const EDGE_FEMALE = ['hi-IN-SwaraNeural', 'en-IN-NeerjaNeural', 'en-IN-NeerjaExpressiveNeural'];
const EDGE_MALE = ['hi-IN-MadhurNeural', 'en-IN-PrabhatNeural'];

// Navana (Bodhi): every id speaks all ten languages. Genders read from the names.
const NAVANA_MALE = [
    'achu',
    'anirban',
    'basava',
    'basheer',
    'bijay',
    'chhotu',
    'elango',
    'faizal',
    'gurdeep',
    'imran',
    'kannan',
    'kishan',
    'murugan',
    'savio',
    'shivanna',
    'srinu',
    'sulaiman',
    'tanaji',
    'temjen',
    'vetri',
    'xavier',
];
const NAVANA_FEMALE = [
    'ammu',
    'ann',
    'arasi',
    'ayesha',
    'bhavana',
    'bimla',
    'champa',
    'falguni',
    'flavia',
    'harleen',
    'ipsita',
    'jayita',
    'jessy',
    'kayal',
    'mahadevi',
    'malar',
    'maria',
    'merin',
    'mukta',
    'nasrin',
    'nayeema',
    'netra',
    'nila',
    'ponni',
    'porkavi',
    'rukhiya',
    'rukhsana',
    'selvi',
    'shabnam',
    'sharon',
    'shikha',
    'vanaja',
    'yasmin',
    'zoya',
];

const tag = (ids: string[], gender: string, model: TtsModelId): VoiceOption[] =>
    ids.map((id) => ({ id, gender, model }));

/** Offline fallback for when the catalog endpoint is unreachable. */
export const FALLBACK_VOICES: VoiceOption[] = [
    ...tag(GOOGLE_MALE, 'male', 'google'),
    ...tag(GOOGLE_FEMALE, 'female', 'google'),
    ...tag(EDGE_FEMALE, 'female', 'edge'),
    ...tag(EDGE_MALE, 'male', 'edge'),
    ...tag(SMALLEST_MALE, 'male', 'smallest'),
    ...tag(SMALLEST_FEMALE, 'female', 'smallest'),
    ...tag(SMALLEST_PRO_MALE, 'male', 'smallest_pro'),
    ...tag(SMALLEST_PRO_FEMALE, 'female', 'smallest_pro'),
    ...tag(DEEPGRAM_MALE, 'male', 'deepgram'),
    ...tag(DEEPGRAM_FEMALE, 'female', 'deepgram'),
    ...tag(NAVANA_MALE, 'male', 'navana'),
    ...tag(NAVANA_FEMALE, 'female', 'navana'),
    ...tag(RUMIK_FEMALE, 'female', 'rumik'),
    ...tag(RUMIK_MALE, 'male', 'rumik'),
    ...tag(SARVAM_FEMALE, 'female', 'sarvam'),
    ...tag(SARVAM_MALE, 'male', 'sarvam'),
];

export function normalizeTtsModel(raw?: string | null): TtsModelId | null {
    const m = (raw ?? '').trim().toLowerCase();
    if (!m) return null;
    // "muga" must NOT map to rumik: Silk Muga 1 is a dearer model we do not sell
    // yet, and folding it into Mulberry would serve one engine at another's price.
    if (m === 'muga' || m.startsWith('silk-muga') || m.startsWith('silk_muga')) return null;
    if (m === 'rumik' || m.startsWith('rumik') || m.startsWith('silk') || m.startsWith('mulberry'))
        return 'rumik';
    // v4 FIRST — 'sarvam_v4' also startsWith('sarvam'), and a v4 voice on v3 is silence.
    if (/^(sarvam[_-]v4|bulbul[:_-]v4)/.test(m)) return 'sarvam_v4';
    if (m === 'sarvam' || m.startsWith('sarvam') || m.startsWith('bulbul')) return 'sarvam';
    if (m === 'google' || m.startsWith('google') || m.startsWith('chirp')) return 'google';
    if (m === 'edge' || m.startsWith('edge') || m.startsWith('microsoft')) return 'edge';
    if (m === 'deepgram' || m.startsWith('deepgram') || m.startsWith('aura')) return 'deepgram';
    if (m === 'navana' || m.startsWith('navana') || m.startsWith('bodhi')) return 'navana';
    // Pro FIRST — 'smallest_pro' also startsWith('smallest'), so the generic test
    // below would swallow it and offer standard voices for the pro model, which the
    // vendor rejects outright. Mirrors TtsVoiceCatalog.normalizeModel on the server.
    if ((m.startsWith('smallest') || m.startsWith('lightning')) && m.includes('pro'))
        return 'smallest_pro';
    if (m === 'smallest' || m.startsWith('smallest') || m.startsWith('lightning'))
        return 'smallest';
    return null;
}

/**
 * The id to send to the API for a voice the user picked or an agent has stored.
 *
 * Case matters for Google (`hi-IN-Chirp3-HD-Achird` is an exact resource name —
 * lowercasing it makes Google reject the request, and the bot then falls back to
 * Sarvam, so the admin picks one engine and the caller hears another). Sarvam,
 * Rumik and Smallest ids are already lowercase, so canonicalising against the
 * palette is both safe and enough: match case-insensitively, return the
 * palette's spelling.
 */
export function voiceIdOf(voice: string | undefined, voices: VoiceOption[]): string {
    const raw = (voice ?? '').trim();
    if (!raw) return '';
    const hit = voices.find((v) => v.id.toLowerCase() === raw.toLowerCase());
    return hit ? hit.id : raw;
}

/**
 * The engine an agent is on.
 *
 * A saved agent always carries one (V421 backfilled every existing row), so a
 * missing value on a SAVED agent means we are looking at a stale cache — and the
 * backend and voice bot both treat missing as `sarvam`, so we must display the
 * same thing rather than a cheerier guess. An unsaved draft has no history to
 * preserve and gets the default engine.
 */
export function resolveTtsModel(agent: { id?: string; ttsModel?: string }): TtsModelId {
    // A SAVED agent without the field is a stale cache, and the backend and bot
    // both read a missing value as sarvam — so show that, not a cheerier guess.
    // An unsaved draft has no history to preserve and gets the default engine.
    return normalizeTtsModel(agent.ttsModel) ?? (agent.id ? 'sarvam' : 'google');
}

/** What the picker shows for a voice: its label when it has one, else the capitalised id. */
export function voiceLabel(v: VoiceOption): string {
    if (v.label) return v.label;
    return v.id.charAt(0).toUpperCase() + v.id.slice(1);
}

export function voicesForModel(voices: VoiceOption[], model: TtsModelId): VoiceOption[] {
    const own = voices.filter((v) => normalizeTtsModel(v.model) === model);
    // A backend that predates model tagging returns untagged Sarvam voices; better
    // to show that list than an empty dropdown.
    return own.length ? own : voices.filter((v) => !v.model);
}

export function defaultVoiceFor(model: TtsModelId): string {
    return TTS_MODELS.find((m) => m.id === model)?.defaultVoice ?? 'priya';
}

/**
 * Switching engine also has to settle the voice, because the two palettes share no
 * names. Carried across, a voice either kills the audio (Sarvam rejects unknown
 * speakers) or is quietly swapped for a default one (Rumik does that) — and the
 * quiet swap is worse, since the call sounds fine while nobody picked that voice.
 */
export function patchForModelChange(
    model: TtsModelId,
    currentVoice: string | undefined,
    voices: VoiceOption[]
): { ttsModel: TtsModelId; voice: string } {
    const palette = voicesForModel(voices, model);
    // Case-insensitive match, but keep the PALETTE's spelling: Google's ids are
    // case-sensitive resource names (see voiceIdOf).
    const hit = currentVoice
        ? palette.find((v) => v.id.toLowerCase() === currentVoice.trim().toLowerCase())
        : undefined;
    return { ttsModel: model, voice: hit ? hit.id : defaultVoiceFor(model) };
}

/**
 * "3 credits per minute — 2 AI + 1 telephony"
 *
 * Picking an engine is a pricing decision, and the prose note only ever
 * mentioned Sarvam's surcharge — the smallest part of the bill. A minute is
 * billed on TWO legs, so show both. Returns null when the API served no pricing
 * (the annotator degrades rather than 500s) and callers keep the prose note.
 */
export function creditLine(m?: TtsModelMeta | null): string | null {
    if (!m || m.totalCreditsPerMin == null) return null;
    const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));
    const line = `${n(m.totalCreditsPerMin)} credits per minute`;
    if (m.aiCreditsPerMin == null || m.telephonyCreditsPerMin == null) return line;
    return `${line} — ${n(m.aiCreditsPerMin)} AI calling + ${n(m.telephonyCreditsPerMin)} telephony`;
}
