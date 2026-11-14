/**
 * Where is this form actually being opened?
 *
 * Phone fields across the platform pre-select a country code. Which one is
 * decided by `getPreferredPhoneCountries()` in `services/domain-routing`; this
 * module supplies the one input that service cannot get from the institute's
 * configuration — the country the visitor is sitting in right now.
 *
 * ## Why the browser's timezone, and not an IP lookup
 *
 * An IP geo call would be more precise about *which* country, but it is the
 * wrong tool here for three reasons:
 *
 *  1. **It is asynchronous.** The country has to be known at the moment the
 *     phone input mounts. An answer that lands 200ms later re-renders the
 *     input with a different flag — and `react-phone-input-2` rewrites the
 *     field's dial-code prefix when its `country` prop changes, so a visitor
 *     who started typing loses characters. A flag that settles late is worse
 *     than a flag that is occasionally wrong.
 *  2. **It costs a request on every public form**, including catalogue pages
 *     that are otherwise cached at the edge.
 *  3. **It sends the visitor's IP to a third party** from pages that are
 *     public, unauthenticated, and in some cases collecting minors' details.
 *
 * The OS timezone is set from where the device physically is, is available
 * synchronously through `Intl`, needs no network, and is not personally
 * identifying. It is the standard signal for exactly this job.
 *
 * ## Accuracy, honestly
 *
 * A timezone maps to a country cleanly for most of the world. It does not for
 * the handful of zones shared across borders (`Europe/Zurich` also serves
 * Büsingen; `Asia/Bangkok` is used across mainland South-East Asia), and a
 * visitor who never set their clock, or is on a VPN that rewrites it, will be
 * read wrong. That is acceptable: this only picks the *default* selection in a
 * picker the visitor can change in one click, and an institute that wants a
 * fixed answer sets INSTITUTE_ONLY in White Label settings.
 *
 * The zone table below is generated from the IANA tz database (`zone.tab` plus
 * the resolved `backward` aliases), so legacy names browsers still emit —
 * `Asia/Calcutta`, `Europe/Kiev`, `Asia/Saigon` — resolve correctly alongside
 * their modern spellings.
 */

/**
 * IANA zones grouped by their ISO 3166-1 alpha-2 country code (lowercase, the
 * casing `react-phone-input-2` expects). Grouping by country rather than
 * listing 549 zone keys keeps this greppable: to check what we think a country
 * covers, search for its code.
 *
 * Zones with no country — `Etc/GMT+5`, `UTC`, the bare `CET`/`MST` aliases —
 * are deliberately absent. They resolve to null, and the caller falls back.
 */
const ZONES_BY_COUNTRY: Record<string, string> = {
    ad: 'Europe/Andorra',
    ae: 'Asia/Dubai',
    af: 'Asia/Kabul',
    ag: 'America/Antigua',
    ai: 'America/Anguilla',
    al: 'Europe/Tirane',
    am: 'Asia/Yerevan',
    ao: 'Africa/Luanda',
    aq: 'Antarctica/Casey Antarctica/Davis Antarctica/DumontDUrville Antarctica/Mawson Antarctica/McMurdo Antarctica/Palmer Antarctica/Rothera Antarctica/South_Pole Antarctica/Syowa Antarctica/Troll Antarctica/Vostok',
    ar: 'America/Argentina/Buenos_Aires America/Argentina/Catamarca America/Argentina/ComodRivadavia America/Argentina/Cordoba America/Argentina/Jujuy America/Argentina/La_Rioja America/Argentina/Mendoza America/Argentina/Rio_Gallegos America/Argentina/Salta America/Argentina/San_Juan America/Argentina/San_Luis America/Argentina/Tucuman America/Argentina/Ushuaia America/Buenos_Aires America/Catamarca America/Cordoba America/Jujuy America/Mendoza America/Rosario',
    as: 'Pacific/Pago_Pago Pacific/Samoa US/Samoa',
    at: 'Europe/Vienna',
    au: 'Antarctica/Macquarie Australia/ACT Australia/Adelaide Australia/Brisbane Australia/Broken_Hill Australia/Canberra Australia/Currie Australia/Darwin Australia/Eucla Australia/Hobart Australia/LHI Australia/Lindeman Australia/Lord_Howe Australia/Melbourne Australia/NSW Australia/North Australia/Perth Australia/Queensland Australia/South Australia/Sydney Australia/Tasmania Australia/Victoria Australia/West Australia/Yancowinna',
    aw: 'America/Aruba',
    ax: 'Europe/Mariehamn',
    az: 'Asia/Baku',
    ba: 'Europe/Sarajevo',
    bb: 'America/Barbados',
    bd: 'Asia/Dacca Asia/Dhaka',
    be: 'Europe/Brussels',
    bf: 'Africa/Ouagadougou',
    bg: 'Europe/Sofia',
    bh: 'Asia/Bahrain',
    bi: 'Africa/Bujumbura',
    bj: 'Africa/Porto-Novo',
    bl: 'America/St_Barthelemy',
    bm: 'Atlantic/Bermuda',
    bn: 'Asia/Brunei',
    bo: 'America/La_Paz',
    bq: 'America/Kralendijk',
    br: 'America/Araguaina America/Bahia America/Belem America/Boa_Vista America/Campo_Grande America/Cuiaba America/Eirunepe America/Fortaleza America/Maceio America/Manaus America/Noronha America/Porto_Acre America/Porto_Velho America/Recife America/Rio_Branco America/Santarem America/Sao_Paulo Brazil/Acre Brazil/DeNoronha Brazil/East Brazil/West',
    bs: 'America/Nassau',
    bt: 'Asia/Thimbu Asia/Thimphu',
    bw: 'Africa/Gaborone',
    by: 'Europe/Minsk',
    bz: 'America/Belize',
    ca: 'America/Atikokan America/Blanc-Sablon America/Cambridge_Bay America/Coral_Harbour America/Creston America/Dawson America/Dawson_Creek America/Edmonton America/Fort_Nelson America/Glace_Bay America/Goose_Bay America/Halifax America/Inuvik America/Iqaluit America/Moncton America/Montreal America/Nipigon America/Pangnirtung America/Rainy_River America/Rankin_Inlet America/Regina America/Resolute America/St_Johns America/Swift_Current America/Thunder_Bay America/Toronto America/Vancouver America/Whitehorse America/Winnipeg America/Yellowknife Canada/Atlantic Canada/Central Canada/Eastern Canada/Mountain Canada/Newfoundland Canada/Pacific Canada/Saskatchewan Canada/Yukon',
    cc: 'Indian/Cocos',
    cd: 'Africa/Kinshasa Africa/Lubumbashi',
    cf: 'Africa/Bangui',
    cg: 'Africa/Brazzaville',
    ch: 'Europe/Zurich',
    ci: 'Africa/Abidjan',
    ck: 'Pacific/Rarotonga',
    cl: 'America/Coyhaique America/Punta_Arenas America/Santiago Chile/Continental Chile/EasterIsland Pacific/Easter',
    cm: 'Africa/Douala',
    cn: 'Asia/Chongqing Asia/Chungking Asia/Harbin Asia/Kashgar Asia/Shanghai Asia/Urumqi PRC',
    co: 'America/Bogota',
    cr: 'America/Costa_Rica',
    cu: 'America/Havana Cuba',
    cv: 'Atlantic/Cape_Verde',
    cw: 'America/Curacao',
    cx: 'Indian/Christmas',
    cy: 'Asia/Famagusta Asia/Nicosia Europe/Nicosia',
    cz: 'Europe/Prague',
    de: 'Europe/Berlin Europe/Busingen',
    dj: 'Africa/Djibouti',
    dk: 'Europe/Copenhagen',
    dm: 'America/Dominica',
    do: 'America/Santo_Domingo',
    dz: 'Africa/Algiers',
    ec: 'America/Guayaquil Pacific/Galapagos',
    ee: 'Europe/Tallinn',
    eg: 'Africa/Cairo Egypt',
    eh: 'Africa/El_Aaiun',
    er: 'Africa/Asmara Africa/Asmera',
    es: 'Africa/Ceuta Atlantic/Canary Europe/Madrid',
    et: 'Africa/Addis_Ababa',
    fi: 'Europe/Helsinki',
    fj: 'Pacific/Fiji',
    fk: 'Atlantic/Stanley',
    fm: 'Pacific/Chuuk Pacific/Kosrae Pacific/Pohnpei Pacific/Ponape Pacific/Truk Pacific/Yap',
    fo: 'Atlantic/Faeroe Atlantic/Faroe',
    fr: 'Europe/Paris',
    ga: 'Africa/Libreville',
    gb: 'Europe/Belfast Europe/London GB GB-Eire',
    gd: 'America/Grenada',
    ge: 'Asia/Tbilisi',
    gf: 'America/Cayenne',
    gg: 'Europe/Guernsey',
    gh: 'Africa/Accra',
    gi: 'Europe/Gibraltar',
    gl: 'America/Danmarkshavn America/Godthab America/Nuuk America/Scoresbysund America/Thule',
    gm: 'Africa/Banjul',
    gn: 'Africa/Conakry',
    gp: 'America/Guadeloupe',
    gq: 'Africa/Malabo',
    gr: 'EET Europe/Athens',
    gs: 'Atlantic/South_Georgia',
    gt: 'America/Guatemala',
    gu: 'Pacific/Guam',
    gw: 'Africa/Bissau',
    gy: 'America/Guyana',
    hk: 'Asia/Hong_Kong Hongkong',
    hn: 'America/Tegucigalpa',
    hr: 'Europe/Zagreb',
    ht: 'America/Port-au-Prince',
    hu: 'Europe/Budapest',
    id: 'Asia/Jakarta Asia/Jayapura Asia/Makassar Asia/Pontianak Asia/Ujung_Pandang',
    ie: 'Eire Europe/Dublin',
    il: 'Asia/Jerusalem Asia/Tel_Aviv Israel',
    im: 'Europe/Isle_of_Man',
    in: 'Asia/Calcutta Asia/Kolkata',
    io: 'Indian/Chagos',
    iq: 'Asia/Baghdad',
    ir: 'Asia/Tehran Iran',
    is: 'Atlantic/Reykjavik Iceland',
    it: 'Europe/Rome',
    je: 'Europe/Jersey',
    jm: 'America/Jamaica Jamaica',
    jo: 'Asia/Amman',
    jp: 'Asia/Tokyo Japan',
    ke: 'Africa/Nairobi',
    kg: 'Asia/Bishkek',
    kh: 'Asia/Phnom_Penh',
    ki: 'Pacific/Enderbury Pacific/Kanton Pacific/Kiritimati Pacific/Tarawa',
    km: 'Indian/Comoro',
    kn: 'America/St_Kitts',
    kp: 'Asia/Pyongyang',
    kr: 'Asia/Seoul ROK',
    kw: 'Asia/Kuwait',
    ky: 'America/Cayman',
    kz: 'Asia/Almaty Asia/Aqtau Asia/Aqtobe Asia/Atyrau Asia/Oral Asia/Qostanay Asia/Qyzylorda',
    la: 'Asia/Vientiane',
    lb: 'Asia/Beirut',
    lc: 'America/St_Lucia',
    li: 'Europe/Vaduz',
    lk: 'Asia/Colombo',
    lr: 'Africa/Monrovia',
    ls: 'Africa/Maseru',
    lt: 'Europe/Vilnius',
    lu: 'Europe/Luxembourg',
    lv: 'Europe/Riga',
    ly: 'Africa/Tripoli Libya',
    ma: 'Africa/Casablanca',
    mc: 'Europe/Monaco',
    md: 'Europe/Chisinau Europe/Tiraspol',
    me: 'Europe/Podgorica',
    mf: 'America/Marigot',
    mg: 'Indian/Antananarivo',
    mh: 'Kwajalein Pacific/Kwajalein Pacific/Majuro',
    mk: 'Europe/Skopje',
    ml: 'Africa/Bamako Africa/Timbuktu',
    mm: 'Asia/Rangoon Asia/Yangon',
    mn: 'Asia/Choibalsan Asia/Hovd Asia/Ulaanbaatar Asia/Ulan_Bator',
    mo: 'Asia/Macao Asia/Macau',
    mp: 'Pacific/Saipan',
    mq: 'America/Martinique',
    mr: 'Africa/Nouakchott',
    ms: 'America/Montserrat',
    mt: 'Europe/Malta',
    mu: 'Indian/Mauritius',
    mv: 'Indian/Maldives',
    mw: 'Africa/Blantyre',
    mx: 'America/Bahia_Banderas America/Cancun America/Chihuahua America/Ciudad_Juarez America/Ensenada America/Hermosillo America/Matamoros America/Mazatlan America/Merida America/Mexico_City America/Monterrey America/Ojinaga America/Santa_Isabel America/Tijuana Mexico/BajaNorte Mexico/BajaSur Mexico/General',
    my: 'Asia/Kuala_Lumpur Asia/Kuching',
    mz: 'Africa/Maputo',
    na: 'Africa/Windhoek',
    nc: 'Pacific/Noumea',
    ne: 'Africa/Niamey',
    nf: 'Pacific/Norfolk',
    ng: 'Africa/Lagos',
    ni: 'America/Managua',
    nl: 'Europe/Amsterdam',
    no: 'Europe/Oslo',
    np: 'Asia/Kathmandu Asia/Katmandu',
    nr: 'Pacific/Nauru',
    nu: 'Pacific/Niue',
    nz: 'NZ NZ-CHAT Pacific/Auckland Pacific/Chatham',
    om: 'Asia/Muscat',
    pa: 'America/Panama',
    pe: 'America/Lima',
    pf: 'Pacific/Gambier Pacific/Marquesas Pacific/Tahiti',
    pg: 'Pacific/Bougainville Pacific/Port_Moresby',
    ph: 'Asia/Manila',
    pk: 'Asia/Karachi',
    pl: 'Europe/Warsaw Poland',
    pm: 'America/Miquelon',
    pn: 'Pacific/Pitcairn',
    pr: 'America/Puerto_Rico',
    ps: 'Asia/Gaza Asia/Hebron',
    pt: 'Atlantic/Azores Atlantic/Madeira Europe/Lisbon Portugal WET',
    pw: 'Pacific/Palau',
    py: 'America/Asuncion',
    qa: 'Asia/Qatar',
    re: 'Indian/Reunion',
    ro: 'Europe/Bucharest',
    rs: 'Europe/Belgrade',
    ru: 'Asia/Anadyr Asia/Barnaul Asia/Chita Asia/Irkutsk Asia/Kamchatka Asia/Khandyga Asia/Krasnoyarsk Asia/Magadan Asia/Novokuznetsk Asia/Novosibirsk Asia/Omsk Asia/Sakhalin Asia/Srednekolymsk Asia/Tomsk Asia/Ust-Nera Asia/Vladivostok Asia/Yakutsk Asia/Yekaterinburg Europe/Astrakhan Europe/Kaliningrad Europe/Kirov Europe/Moscow Europe/Samara Europe/Saratov Europe/Ulyanovsk Europe/Volgograd W-SU',
    rw: 'Africa/Kigali',
    sa: 'Asia/Riyadh',
    sb: 'Pacific/Guadalcanal',
    sc: 'Indian/Mahe',
    sd: 'Africa/Khartoum',
    se: 'Europe/Stockholm',
    sg: 'Asia/Singapore Singapore',
    sh: 'Atlantic/St_Helena',
    si: 'Europe/Ljubljana',
    sj: 'Arctic/Longyearbyen Atlantic/Jan_Mayen',
    sk: 'Europe/Bratislava',
    sl: 'Africa/Freetown',
    sm: 'Europe/San_Marino',
    sn: 'Africa/Dakar',
    so: 'Africa/Mogadishu',
    sr: 'America/Paramaribo',
    ss: 'Africa/Juba',
    st: 'Africa/Sao_Tome',
    sv: 'America/El_Salvador',
    sx: 'America/Lower_Princes',
    sy: 'Asia/Damascus',
    sz: 'Africa/Mbabane',
    tc: 'America/Grand_Turk',
    td: 'Africa/Ndjamena',
    tf: 'Indian/Kerguelen',
    tg: 'Africa/Lome',
    th: 'Asia/Bangkok',
    tj: 'Asia/Dushanbe',
    tk: 'Pacific/Fakaofo',
    tl: 'Asia/Dili',
    tm: 'Asia/Ashgabat Asia/Ashkhabad',
    tn: 'Africa/Tunis',
    to: 'Pacific/Tongatapu',
    tr: 'Asia/Istanbul Europe/Istanbul Turkey',
    tt: 'America/Port_of_Spain',
    tv: 'Pacific/Funafuti',
    tw: 'Asia/Taipei ROC',
    tz: 'Africa/Dar_es_Salaam',
    ua: 'Europe/Kiev Europe/Kyiv Europe/Simferopol Europe/Uzhgorod Europe/Zaporozhye',
    ug: 'Africa/Kampala',
    um: 'Pacific/Midway Pacific/Wake',
    us: 'America/Adak America/Anchorage America/Atka America/Boise America/Chicago America/Denver America/Detroit America/Fort_Wayne America/Indiana/Indianapolis America/Indiana/Knox America/Indiana/Marengo America/Indiana/Petersburg America/Indiana/Tell_City America/Indiana/Vevay America/Indiana/Vincennes America/Indiana/Winamac America/Indianapolis America/Juneau America/Kentucky/Louisville America/Kentucky/Monticello America/Knox_IN America/Los_Angeles America/Louisville America/Menominee America/Metlakatla America/New_York America/Nome America/North_Dakota/Beulah America/North_Dakota/Center America/North_Dakota/New_Salem America/Phoenix America/Shiprock America/Sitka America/Yakutat CST6CDT EST5EDT HST MST7MDT Navajo PST8PDT Pacific/Honolulu Pacific/Johnston US/Alaska US/Aleutian US/Arizona US/Central US/East-Indiana US/Eastern US/Hawaii US/Indiana-Starke US/Michigan US/Mountain US/Pacific',
    uy: 'America/Montevideo',
    uz: 'Asia/Samarkand Asia/Tashkent',
    va: 'Europe/Vatican',
    vc: 'America/St_Vincent',
    ve: 'America/Caracas',
    vg: 'America/Tortola',
    vi: 'America/St_Thomas America/Virgin',
    vn: 'Asia/Ho_Chi_Minh Asia/Saigon',
    vu: 'Pacific/Efate',
    wf: 'Pacific/Wallis',
    ws: 'Pacific/Apia',
    ye: 'Asia/Aden',
    yt: 'Indian/Mayotte',
    za: 'Africa/Johannesburg',
    zm: 'Africa/Lusaka',
    zw: 'Africa/Harare',
};

/**
 * Reverse index, built once on first use. Lazy because most page loads never
 * reach a phone field, and 549 entries is not worth building at import time.
 */
let zoneToCountry: Record<string, string> | null = null;

const getZoneIndex = (): Record<string, string> => {
    if (zoneToCountry) return zoneToCountry;
    const index: Record<string, string> = {};
    for (const [country, zones] of Object.entries(ZONES_BY_COUNTRY)) {
        for (const zone of zones.split(' ')) {
            index[zone.toLowerCase()] = country;
        }
    }
    zoneToCountry = index;
    return index;
};

/**
 * Every zone name the table knows, flattened. Exported so a test can sweep the
 * whole set rather than spot-checking — the invariant that matters is that NO
 * zone anywhere can produce a country the phone input cannot render.
 */
export const ALL_ZONES: string[] = Object.values(ZONES_BY_COUNTRY).flatMap((zones) =>
    zones.split(' ')
);

/**
 * Territories the IANA zone table names but `react-phone-input-2` has no country
 * entry for, mapped to the country whose dialling plan they actually share.
 *
 * This is not cosmetic. Handing the input a country it does not know does NOT
 * fall back to a default — it renders an empty field with no flag and no dial
 * code at all, so the visitor cannot tell what their number will be read as.
 * (Verified against the installed 2.15.1 bundle: `country="gg"` yields "",
 * where `country="ru"` yields "+7".)
 *
 * Every mapping is the territory's real international dialling prefix, so a
 * visitor in Guernsey correctly gets +44 rather than falling back to the
 * institute default.
 */
const DIAL_PLAN_ALIASES: Record<string, string> = {
    ax: 'fi', // Åland — +358
    cc: 'au', // Cocos (Keeling) Islands — +61
    cx: 'au', // Christmas Island — +61
    eh: 'ma', // Western Sahara — +212
    gg: 'gb', // Guernsey — +44
    gs: 'fk', // South Georgia — +500
    im: 'gb', // Isle of Man — +44
    pn: 'nz', // Pitcairn — +64
    sj: 'no', // Svalbard and Jan Mayen — +47
    tf: 're', // French Southern Territories — +262
    um: 'us', // US Minor Outlying Islands — +1
    yt: 're', // Mayotte — +262
    uk: 'gb', // Not ISO 3166 at all, but the spelling people type by hand
};

/**
 * The ISO codes present in the zone table that `react-phone-input-2` 2.15.1 has
 * no country entry for, verified by extracting the iso2/dial-code pairs from the
 * installed bundle. Everything here either maps through
 * {@link DIAL_PLAN_ALIASES} or resolves to null.
 */
const UNRENDERABLE = new Set([
    'aq',
    'ax',
    'cc',
    'cx',
    'eh',
    'gg',
    'gs',
    'im',
    'pn',
    'sj',
    'tf',
    'um',
    'yt',
]);

/**
 * Normalises any country code — from a timezone, a locale, or the `phoneCountry`
 * override — into one a phone input can actually render, or null.
 *
 * Null is the honest answer for anything we cannot render: the caller falls back
 * to the institute's preference or the platform default, which is always better
 * than a field with no dial code. Antarctica has no single dialling plan and so
 * has no alias; it lands here and returns null.
 */
const toDialableCountry = (code: string | null | undefined): string | null => {
    if (!code) return null;
    const mapped = DIAL_PLAN_ALIASES[code] ?? code;
    // 'aq' is the one unrenderable code with no sensible alias, so it survives the
    // mapping and has to be caught here.
    if (UNRENDERABLE.has(mapped)) return null;
    // And the code must name a country we actually know — this is what stops an
    // arbitrary locale subtag or a hand-typed override from reaching the input.
    return mapped in ZONES_BY_COUNTRY ? mapped : null;
};

/** Resolves an IANA timezone name to a lowercase ISO 3166-1 alpha-2 code. */
export const countryFromTimeZone = (timeZone: string | null | undefined): string | null => {
    if (!timeZone) return null;
    return toDialableCountry(getZoneIndex()[timeZone.trim().toLowerCase()] ?? null);
};

/**
 * Pulls the region subtag out of a BCP 47 language tag: `ru-RU` -> `ru`,
 * `en-GB` -> `gb`, `zh-Hant-TW` -> `tw`. Returns null for a bare language
 * (`en`), which tells us nothing about location.
 *
 * This is a weaker signal than the timezone — it reflects the language the
 * device is set to, not where it is — so it is only consulted when the
 * timezone yields nothing.
 */
export const countryFromLanguageTag = (tag: string | null | undefined): string | null => {
    if (!tag) return null;
    const parts = tag.replace('_', '-').split('-');
    // BCP 47 puts the region immediately after the language and an optional
    // 4-letter script, and nowhere else. Walking the whole tag for "any two
    // letters" instead would read the `ca` in `en-u-ca-gregory` — a calendar
    // extension key — as Canada.
    for (const part of parts.slice(1)) {
        // A single-character subtag is an extension singleton ('u', 't', 'x');
        // everything after it is extension data, never a region.
        if (part.length === 1) break;
        if (/^[A-Za-z]{4}$/.test(part)) continue; // script, e.g. the Hant in zh-Hant-TW
        if (/^[A-Za-z]{2}$/.test(part)) return toDialableCountry(part.toLowerCase());
        // A UN M.49 region ('419') or a variant — neither names a country we can
        // dial, and nothing after it will either.
        break;
    }
    return null;
};

/**
 * An explicit override, for previewing and for support reproducing what a
 * visitor abroad sees without a VPN: `?phoneCountry=ru` on a form URL.
 *
 * Read once, on the first detection of a page load — arriving at a form by
 * client-side navigation with the param appended will not re-trigger it.
 *
 * It only overrides the *detected* country, never the institute's configured
 * preference — so it cannot be used to bypass an INSTITUTE_ONLY portal.
 */
const readOverride = (): string | null => {
    try {
        const raw = new URLSearchParams(window.location.search).get('phoneCountry');
        if (raw && /^[A-Za-z]{2}$/.test(raw.trim()))
            return toDialableCountry(raw.trim().toLowerCase());
    } catch {
        // No URL / no window (SSR, tests) — nothing to override with.
    }
    return null;
};

/**
 * Memoized: a page's timezone does not change under it, and every phone field
 * on a form would otherwise redo this.
 *
 * `undefined` = not yet computed, `null` = computed and genuinely unknown.
 */
let detected: string | null | undefined;

/**
 * The lowercase ISO 3166-1 alpha-2 country the visitor appears to be in, or
 * null when it cannot be told (a non-country zone, a locked-down browser, SSR).
 *
 * Callers must treat null as "no opinion" and fall back — never as a country.
 */
export const detectVisitorCountry = (): string | null => {
    if (detected !== undefined) return detected;

    if (typeof window === 'undefined') {
        // Do not memoize an SSR miss: the same module instance may serve a
        // later client render that CAN detect.
        return null;
    }

    const override = readOverride();
    if (override) {
        detected = override;
        return detected;
    }

    // Distinguish "this browser has no timezone API" from "this browser reported a
    // deliberately non-geographic zone". Both leave `country` null, but they mean
    // opposite things, and only the first justifies falling back to the locale.
    let zone: string | null = null;
    try {
        zone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch {
        // Intl unavailable — no timezone signal at all.
    }

    let country = countryFromTimeZone(zone);

    if (!country && !zone) {
        // Only when there was no timezone to read. A locale region is a far weaker
        // signal than a timezone — it says what language the device is set to, not
        // where it is, and `en-US` is the factory default on devices all over the
        // world. Consulting it when the browser DID report a zone we could not
        // place (`UTC`, `Etc/GMT+5` — the signature of a privacy browser that
        // withholds location on purpose) would manufacture a confident "us" out of
        // exactly the case where we know least, and hand an Indian visitor +1
        // where the institute default would have given them +91.
        try {
            const tags: readonly string[] = navigator.languages?.length
                ? navigator.languages
                : [navigator.language];
            for (const tag of tags) {
                country = countryFromLanguageTag(tag);
                if (country) break;
            }
        } catch {
            // No navigator — leave it unknown.
        }
    }

    detected = country;
    return detected;
};

/** Test seam: forces the next {@link detectVisitorCountry} to recompute. */
export const resetDetectedCountryForTests = (): void => {
    detected = undefined;
};
