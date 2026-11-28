/**
 * Maps country names to ISO 3166-1 alpha-2 country codes used by react-phone-input-2
 * This allows automatic country code selection based on country field values
 */

export const COUNTRY_NAME_TO_CODE_MAP: Record<string, string> = {
  // A
  afghanistan: "af",
  albania: "al",
  algeria: "dz",
  andorra: "ad",
  angola: "ao",
  argentina: "ar",
  armenia: "am",
  australia: "au",
  austria: "at",
  azerbaijan: "az",

  // B
  bahamas: "bs",
  bahrain: "bh",
  bangladesh: "bd",
  barbados: "bb",
  belarus: "by",
  belgium: "be",
  belize: "bz",
  benin: "bj",
  bhutan: "bt",
  bolivia: "bo",
  "bosnia and herzegovina": "ba",
  botswana: "bw",
  brazil: "br",
  brunei: "bn",
  bulgaria: "bg",
  "burkina faso": "bf",
  burundi: "bi",

  // C
  cambodia: "kh",
  cameroon: "cm",
  canada: "ca",
  "cape verde": "cv",
  "central african republic": "cf",
  chad: "td",
  chile: "cl",
  china: "cn",
  colombia: "co",
  comoros: "km",
  congo: "cg",
  "costa rica": "cr",
  croatia: "hr",
  cuba: "cu",
  cyprus: "cy",
  "czech republic": "cz",
  czechia: "cz",

  // D
  denmark: "dk",
  djibouti: "dj",
  dominica: "dm",
  "dominican republic": "do",

  // E
  ecuador: "ec",
  egypt: "eg",
  "el salvador": "sv",
  "equatorial guinea": "gq",
  eritrea: "er",
  estonia: "ee",
  ethiopia: "et",

  // F
  fiji: "fj",
  finland: "fi",
  france: "fr",

  // G
  gabon: "ga",
  gambia: "gm",
  georgia: "ge",
  germany: "de",
  ghana: "gh",
  greece: "gr",
  grenada: "gd",
  guatemala: "gt",
  guinea: "gn",
  "guinea-bissau": "gw",
  guyana: "gy",

  // H
  haiti: "ht",
  honduras: "hn",
  hungary: "hu",

  // I
  iceland: "is",
  india: "in",
  indonesia: "id",
  iran: "ir",
  iraq: "iq",
  ireland: "ie",
  israel: "il",
  italy: "it",
  "ivory coast": "ci",

  // J
  jamaica: "jm",
  japan: "jp",
  jordan: "jo",

  // K
  kazakhstan: "kz",
  kenya: "ke",
  kiribati: "ki",
  kuwait: "kw",
  kyrgyzstan: "kg",

  // L
  laos: "la",
  latvia: "lv",
  lebanon: "lb",
  lesotho: "ls",
  liberia: "lr",
  libya: "ly",
  liechtenstein: "li",
  lithuania: "lt",
  luxembourg: "lu",

  // M
  madagascar: "mg",
  malawi: "mw",
  malaysia: "my",
  maldives: "mv",
  mali: "ml",
  malta: "mt",
  "marshall islands": "mh",
  mauritania: "mr",
  mauritius: "mu",
  mexico: "mx",
  micronesia: "fm",
  moldova: "md",
  monaco: "mc",
  mongolia: "mn",
  montenegro: "me",
  morocco: "ma",
  mozambique: "mz",
  myanmar: "mm",

  // N
  namibia: "na",
  nauru: "nr",
  nepal: "np",
  netherlands: "nl",
  "new zealand": "nz",
  nicaragua: "ni",
  niger: "ne",
  nigeria: "ng",
  "north korea": "kp",
  "north macedonia": "mk",
  norway: "no",

  // O
  oman: "om",

  // P
  pakistan: "pk",
  palau: "pw",
  palestine: "ps",
  panama: "pa",
  "papua new guinea": "pg",
  paraguay: "py",
  peru: "pe",
  philippines: "ph",
  poland: "pl",
  portugal: "pt",

  // Q
  qatar: "qa",

  // R
  romania: "ro",
  russia: "ru",
  rwanda: "rw",

  // S
  "saint kitts and nevis": "kn",
  "saint lucia": "lc",
  "saint vincent and the grenadines": "vc",
  samoa: "ws",
  "san marino": "sm",
  "sao tome and principe": "st",
  "saudi arabia": "sa",
  senegal: "sn",
  serbia: "rs",
  seychelles: "sc",
  "sierra leone": "sl",
  singapore: "sg",
  slovakia: "sk",
  slovenia: "si",
  "solomon islands": "sb",
  somalia: "so",
  "south africa": "za",
  "south korea": "kr",
  "south sudan": "ss",
  spain: "es",
  "sri lanka": "lk",
  sudan: "sd",
  suriname: "sr",
  sweden: "se",
  switzerland: "ch",
  syria: "sy",

  // T
  taiwan: "tw",
  tajikistan: "tj",
  tanzania: "tz",
  thailand: "th",
  "timor-leste": "tl",
  togo: "tg",
  tonga: "to",
  "trinidad and tobago": "tt",
  tunisia: "tn",
  turkey: "tr",
  turkmenistan: "tm",
  tuvalu: "tv",

  // U
  uganda: "ug",
  ukraine: "ua",
  "united arab emirates": "ae",
  uae: "ae",
  "united kingdom": "gb",
  uk: "gb",
  "united states": "us",
  usa: "us",
  "united states of america": "us",
  uruguay: "uy",
  uzbekistan: "uz",

  // V
  vanuatu: "vu",
  "vatican city": "va",
  venezuela: "ve",
  vietnam: "vn",

  // Y
  yemen: "ye",

  // Z
  zambia: "zm",
  zimbabwe: "zw",
};

/**
 * Converts a country name to its ISO 3166-1 alpha-2 country code
 * @param countryName - The name of the country (case-insensitive)
 * @param defaultCode - Default country code to return if mapping not found (default: "au")
 * @returns ISO 3166-1 alpha-2 country code (e.g., "au", "us", "gb")
 */
export const getCountryCode = (
  countryName: string,
  defaultCode: string = "au"
): string => lookupCountryCode(countryName) ?? defaultCode;

/**
 * The same lookup, but able to say "no opinion".
 *
 * A form that asks the visitor for their country should let that answer drive
 * the phone field — but only when there IS an answer. `getCountryCode` folds
 * "nothing selected" and "selected something we cannot map" into its caller's
 * fallback, which means a caller cannot tell whether the country it got back
 * was really chosen. Callers that hand the result to `PhoneInputField` need
 * that distinction: passing a `country` prop overrides the field's own
 * institute-preference / geo resolution, so passing a *guess* would suppress
 * the correct answer. Returning undefined lets the field resolve for itself.
 */
export const lookupCountryCode = (
  countryName: string | null | undefined
): string | undefined => {
  // Guarded at runtime, not just by the signature. The callers read this out of
  // dynamically-built form state (`formValues[countryFieldKey]?.value`), whose
  // static type is `string` but whose real content is whatever a custom field
  // put there — a dropdown could hand back a number. `getCountryCode` used to
  // be reached through a `|| ""`, so this keeps the same "never throw on a
  // surprise value" behaviour now that the coercion is gone.
  if (typeof countryName !== "string" || !countryName) return undefined;
  return COUNTRY_NAME_TO_CODE_MAP[countryName.toLowerCase().trim()];
};

/**
 * Helper function to find a field with "country" in its key
 * @param formValues - The form values object
 * @returns The key of the country field, or null if not found
 */
export const findCountryFieldKey = (
  formValues: Record<string, unknown>
): string | null => {
  const countryEntry = Object.entries(formValues).find(([key]) => {
    const lowerKey = key.toLowerCase();
    return lowerKey.includes("country");
  });
  return countryEntry ? countryEntry[0] : null;
};
