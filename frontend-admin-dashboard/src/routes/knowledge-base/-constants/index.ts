import type { TFunction } from 'i18next';
import type { KbPurpose, SourceKind, SourceStatus } from '../-types';
import type { StatusType } from '@/components/design-system/status-chips';

/**
 * Purposes in plain language. The wording matters more than it looks: this is the
 * screen where a non-technical academic head decides what a "knowledge base" even
 * is, so each option names a real thing they already have on a shelf.
 */
export const buildPurposeOptions = (
    t: TFunction
): Array<{
    value: KbPurpose;
    label: string;
    hint: string;
}> => [
    {
        value: 'teaching',
        label: t('purpose.teaching.label'),
        hint: t('purpose.teaching.hint'),
    },
    {
        value: 'question_bank',
        label: t('purpose.questionBank.label'),
        hint: t('purpose.questionBank.hint'),
    },
    {
        value: 'general',
        label: t('purpose.general.label'),
        hint: t('purpose.general.hint'),
    },
];

export const buildSourceKindLabel = (t: TFunction): Record<SourceKind, string> => ({
    PDF: t('sourceKind.pdf'),
    URL: t('sourceKind.url'),
    YOUTUBE: t('sourceKind.youtube'),
    TEXT: t('sourceKind.text'),
});

/**
 * Status wording is deliberately plain and honest. "Partly readable" exists
 * because a scanned regional-language book genuinely produces some unusable
 * pages, and hiding that behind a green tick is how a teacher ends up with a
 * question paper built on garbled text.
 */
export const buildSourceStatusMeta = (
    t: TFunction
): Record<SourceStatus, { label: string; tone: StatusType; hint: string }> => ({
    PENDING: { label: t('sourceStatus.pending.label'), tone: 'INFO', hint: t('sourceStatus.pending.hint') },
    PROCESSING: {
        label: t('sourceStatus.processing.label'),
        tone: 'INFO',
        hint: t('sourceStatus.processing.hint'),
    },
    READY: { label: t('sourceStatus.ready.label'), tone: 'SUCCESS', hint: t('sourceStatus.ready.hint') },
    PARTIAL: {
        label: t('sourceStatus.partial.label'),
        tone: 'WARNING',
        hint: t('sourceStatus.partial.hint'),
    },
    FAILED: { label: t('sourceStatus.failed.label'), tone: 'DANGER', hint: t('sourceStatus.failed.hint') },
});

/** Fallback labels shown while a source's stage is unknown or not yet set. */
export const buildSourceStatusFallbackLabels = (
    t: TFunction
): { working: string; gettingStarted: string } => ({
    working: t('sourceStatus.working'),
    gettingStarted: t('sourceStatus.gettingStarted'),
});

/** Stage → what the user is actually waiting for. */
export const buildStageLabel = (t: TFunction): Record<string, string> => ({
    parsing: t('stage.parsing'),
    figures: t('stage.figures'),
    chunking: t('stage.chunking'),
    embedding: t('stage.embedding'),
    summarizing: t('stage.summarizing'),
});

/** Language hints offered when creating a knowledge base. */
export const buildLanguageOptions = (t: TFunction): Array<{ value: string; label: string }> => [
    { value: 'en', label: t('language.en') },
    { value: 'hi', label: t('language.hi') },
    { value: 'mr', label: t('language.mr') },
    { value: 'ta', label: t('language.ta') },
    { value: 'te', label: t('language.te') },
    { value: 'kn', label: t('language.kn') },
    { value: 'ml', label: t('language.ml') },
    { value: 'bn', label: t('language.bn') },
    { value: 'gu', label: t('language.gu') },
    { value: 'pa', label: t('language.pa') },
    { value: 'ur', label: t('language.ur') },
];

export const buildLanguageLabel = (t: TFunction): Record<string, string> =>
    buildLanguageOptions(t).reduce(
        (acc, opt) => ({ ...acc, [opt.value]: opt.label }),
        {} as Record<string, string>
    );

/** Matches MAX_PAGES_PER_SOURCE in ai_service/app/services/kb/parsing.py. */
export const MAX_PAGES_PER_SOURCE = 1200;

/** Poll interval while any source is still being processed. */
export const POLL_INTERVAL_MS = 4000;

/**
 * The institute that publishes the shared library.
 *
 * A UI hint only — it decides whether the publishing entry point is worth
 * showing. The API is the authority and refuses anyone else with a 403, so a
 * stale value here can never grant publishing rights.
 * Mirrors KB_PUBLISHER_INSTITUTE_ID in ai_service.
 */
export const PUBLISHER_INSTITUTE_ID = '6b600940-2134-40ec-93ed-b61e403c5a87';
