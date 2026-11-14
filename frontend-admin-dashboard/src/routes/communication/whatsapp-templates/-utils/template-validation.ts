import type { TFunction } from 'i18next';
import type { TemplateButton, WhatsAppTemplateDTO } from '../-services/template-api';

/**
 * Client-side mirror of the server's WhatsAppTemplateValidator.
 *
 * Meta answers nearly every content problem with the same opaque error code 100 "Invalid parameter",
 * so both layers check these rules: the server because it is the real gate, and here so the admin sees
 * "Body text cannot end with a variable" the moment they hit Submit instead of after a round trip.
 *
 * `validateDraft`/`validateForSubmit` are plain functions called from the TemplateBuilder
 * component's event handlers, not hooks, so they cannot call `useTranslation()` themselves — the
 * caller threads its own `t` in instead (see `communicationTemplateBuilder`'s useTranslation()).
 */

export interface TemplateProblem {
    field: string;
    message: string;
}

const PLACEHOLDER = /\{\{\s*(\d+)\s*\}\}/g;

const BODY_MAX = 1024;
const HEADER_TEXT_MAX = 60;
const FOOTER_MAX = 60;
const BUTTON_TEXT_MAX = 25;
/** Meta's own ceiling. The builder offers 3, but a template synced from Meta may carry more. */
const MAX_BUTTONS = 10;

/**
 * Query parameters that only ever appear on temporary, signed links (S3 presigned GETs,
 * CloudFront signed URLs, GCS/Azure SAS). Such a link passes Meta's review — the signature is
 * still valid that day — and then the header media 403s on every send once it expires, because
 * the send path attaches `header_sample_url` as the template's media on each message.
 */
const SIGNED_URL_PARAMS =
    /[?&](Signature|Expires|X-Amz-Signature|X-Amz-Expires|Key-Pair-Id|Policy|sig)=/i;

export const looksLikeSignedUrl = (url: string): boolean => SIGNED_URL_PARAMS.test(url.trim());

/** Meta allows lowercase letters, digits and underscores, up to 512 characters. */
export const normalizeTemplateName = (raw: string): string =>
    raw.toLowerCase().replace(/[^a-z0-9_]/g, '_');

export const placeholderIndexes = (text: string): number[] => {
    const found: number[] = [];
    for (const match of text.matchAll(PLACEHOLDER)) {
        found.push(Number(match[1]));
    }
    return found;
};

/** Meta requires variables numbered 1..N with no gaps — `{{1}} … {{3}}` is rejected. */
const sequenceProblem = (
    t: TFunction,
    indexes: number[],
    where: 'body' | 'header'
): string | null => {
    if (indexes.length === 0) return null;
    const distinct = [...new Set(indexes)].sort((a, b) => a - b);
    if (distinct[0] !== 1) {
        return t('sequenceMustStartAtOne', {
            where: t(`fieldName.${where}`),
            startToken: '{{1}}',
            found: `{{${distinct[0]}}}`,
        });
    }
    for (let i = 0; i < distinct.length; i++) {
        if (distinct[i] !== i + 1) {
            return t('sequenceMustBeConsecutive', {
                where: t(`fieldName.${where}`),
                missing: `{{${i + 1}}}`,
                used: `{{${distinct[i]}}}`,
            });
        }
    }
    return null;
};

const endsWithPlaceholder = (trimmed: string): boolean => {
    let end = -1;
    for (const match of trimmed.matchAll(PLACEHOLDER)) {
        end = (match.index ?? 0) + match[0].length;
    }
    return end === trimmed.length;
};

const startsWithPlaceholder = (trimmed: string): boolean => /^\{\{\s*\d+\s*\}\}/.test(trimmed);

/** Everything that must hold before a draft can be saved. Deliberately permissive. */
export const validateDraft = (
    t: TFunction,
    dto: {
        name: string;
        category: string;
        bodyText: string;
    }
): TemplateProblem[] => {
    const problems: TemplateProblem[] = [];
    const normalized = normalizeTemplateName(dto.name.trim());

    if (!dto.name.trim()) {
        problems.push({ field: 'name', message: t('nameRequired') });
    } else if (!normalized.replace(/_/g, '')) {
        problems.push({
            field: 'name',
            message: t('nameMustContainLetterOrNumber'),
        });
    } else if (normalized.length > 512) {
        problems.push({
            field: 'name',
            message: t('nameTooLong'),
        });
    }

    if (!dto.category) {
        problems.push({ field: 'category', message: t('categoryRequired') });
    }

    if (!dto.bodyText.trim()) {
        problems.push({
            field: 'bodyText',
            message: t('bodyRequired'),
        });
    }

    return problems;
};

/** Everything Meta checks at registration. Returns every problem, not just the first. */
export const validateForSubmit = (
    t: TFunction,
    dto: {
        name: string;
        language: string;
        category: string;
        headerType: string;
        headerText: string;
        headerSampleUrl: string;
        headerSampleValues?: string[];
        bodyText: string;
        footerText: string;
        buttons: TemplateButton[];
        bodySampleValues: string[];
    }
): TemplateProblem[] => {
    const problems: TemplateProblem[] = validateDraft(t, dto);

    if (!dto.language) {
        problems.push({ field: 'language', message: t('languageRequired') });
    }

    // --- Body ---
    const body = dto.bodyText;
    if (body.trim()) {
        if (body.length > BODY_MAX) {
            problems.push({
                field: 'bodyText',
                message: t('bodyTooLong', { length: body.length, max: BODY_MAX }),
            });
        }
        const indexes = placeholderIndexes(body);
        const seqProblem = sequenceProblem(t, indexes, 'body');
        if (seqProblem) problems.push({ field: 'bodyText', message: seqProblem });

        if (indexes.length > 0) {
            const trimmed = body.trim();
            if (startsWithPlaceholder(trimmed)) {
                problems.push({
                    field: 'bodyText',
                    message: t('bodyCannotStartWithVariable'),
                });
            }
            if (endsWithPlaceholder(trimmed)) {
                problems.push({
                    field: 'bodyText',
                    message: t('bodyCannotEndWithVariable'),
                });
            }
            const expected = Math.max(...indexes);
            for (let i = 0; i < expected; i++) {
                if (!dto.bodySampleValues[i]?.trim()) {
                    problems.push({
                        field: 'bodySampleValues',
                        message: t('sampleValueEmpty', { index: `{{${i + 1}}}` }),
                    });
                }
            }
        }
    }

    // --- Header ---
    if (dto.headerType === 'TEXT') {
        if (!dto.headerText.trim()) {
            problems.push({
                field: 'headerText',
                message: t('headerTextMissing'),
            });
        } else {
            if (dto.headerText.length > HEADER_TEXT_MAX) {
                problems.push({
                    field: 'headerText',
                    message: t('headerTooLong', {
                        length: dto.headerText.length,
                        max: HEADER_TEXT_MAX,
                    }),
                });
            }
            const headerVars = placeholderIndexes(dto.headerText);
            if (headerVars.length > 1) {
                problems.push({
                    field: 'headerText',
                    message: t('headerTooManyVariables', { count: headerVars.length }),
                });
            } else if (headerVars.length === 1 && !dto.headerSampleValues?.[0]?.trim()) {
                problems.push({
                    field: 'headerSampleValues',
                    message: t('headerSampleValueMissing'),
                });
            }
        }
    } else if (dto.headerType !== 'NONE' && !dto.headerSampleUrl.trim()) {
        problems.push({
            field: 'headerSampleUrl',
            message: t('headerSampleUrlRequired', { type: dto.headerType.toLowerCase() }),
        });
    } else if (dto.headerType !== 'NONE' && looksLikeSignedUrl(dto.headerSampleUrl)) {
        problems.push({
            field: 'headerSampleUrl',
            message: t('headerSampleUrlExpiring', { type: dto.headerType.toLowerCase() }),
        });
    }

    // --- Footer ---
    if (dto.footerText.trim()) {
        if (dto.footerText.length > FOOTER_MAX) {
            problems.push({
                field: 'footerText',
                message: t('footerTooLong', { length: dto.footerText.length, max: FOOTER_MAX }),
            });
        }
        if (placeholderIndexes(dto.footerText).length > 0) {
            problems.push({
                field: 'footerText',
                message: t('footerCannotContainVariables', { token: '{{…}}' }),
            });
        }
    }

    // --- Buttons ---
    if (dto.buttons.length > MAX_BUTTONS) {
        problems.push({
            field: 'buttons',
            message: t('tooManyButtons', { max: MAX_BUTTONS }),
        });
    }
    let phoneButtons = 0;
    dto.buttons.forEach((btn, i) => {
        const label = t('buttonLabel', { index: i + 1 });
        if (!btn.text?.trim()) {
            problems.push({ field: `buttons.${i}.text`, message: t('buttonNoText', { label }) });
        } else if (btn.text.length > BUTTON_TEXT_MAX) {
            problems.push({
                field: `buttons.${i}.text`,
                message: t('buttonTextTooLong', {
                    label,
                    length: btn.text.length,
                    max: BUTTON_TEXT_MAX,
                }),
            });
        }
        if (btn.type === 'URL') {
            const url = btn.url?.trim() ?? '';
            if (!url || url === 'https://') {
                problems.push({
                    field: `buttons.${i}.url`,
                    message: t('buttonNoUrl', { label }),
                });
            } else if (!/^https?:\/\//.test(url)) {
                problems.push({
                    field: `buttons.${i}.url`,
                    message: t('buttonUrlProtocol', { label }),
                });
            } else if (placeholderIndexes(url).length > 0 && !btn.example?.[0]?.trim()) {
                problems.push({
                    field: `buttons.${i}.example`,
                    message: t('buttonUrlSampleMissing', { label }),
                });
            }
        }
        if (btn.type === 'PHONE_NUMBER') {
            phoneButtons++;
            const phone = btn.phoneNumber?.trim() ?? '';
            if (!phone) {
                problems.push({
                    field: `buttons.${i}.phoneNumber`,
                    message: t('buttonNoPhone', { label }),
                });
            } else if (!phone.startsWith('+')) {
                problems.push({
                    field: `buttons.${i}.phoneNumber`,
                    message: t('buttonPhoneFormat', { label }),
                });
            }
        }
    });
    if (phoneButtons > 1) {
        problems.push({
            field: 'buttons',
            message: t('onlyOnePhoneButton'),
        });
    }

    return problems;
};

/** Fields the server flagged, keyed the same way the builder keys its inputs. */
export const problemFields = (problems: TemplateProblem[]): Set<string> =>
    new Set(problems.map((p) => p.field));

export type TemplateDraftInput = Pick<
    WhatsAppTemplateDTO,
    'name' | 'language' | 'category' | 'headerType' | 'bodyText'
>;
