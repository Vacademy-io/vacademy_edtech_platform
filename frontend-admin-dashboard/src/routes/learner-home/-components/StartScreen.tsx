import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { PencilSimple } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { fetchStudentDisplaySettingsForEdit } from '@/services/student-display-settings';
import type {
    CheckIssue,
    HomeBlock,
    PublishedSummary,
    TemplateKey,
} from '../-types/learner-home-types';
import { convertLegacyHome } from '../-utils/legacy-conversion';
import { conversionCopy, templateCopy } from '../-utils/start-copy';
import { buildTemplate, STARTER_TEMPLATES } from '../-utils/templates';
import { blockName } from './block-display';
import { useIssueLine } from './shared/FieldIssues';

export interface StartChoice {
    templateKey: TemplateKey;
    blocks: HomeBlock[];
}

/** Why POST /draft refused a starting point: the server's message and its issues. */
export interface StartFailure {
    message: string;
    issues: CheckIssue[];
}

/** The server's issues for a refused start, one readable line each, grouped by block. */
function StartFailureList({ failure, blocks }: { failure: StartFailure; blocks: HomeBlock[] }) {
    const { t } = useTranslation('learnerHome');
    const line = useIssueLine();
    const byKey = new Map(blocks.map((b) => [b.block_key, b]));
    return (
        <div
            role="alert"
            className="space-y-2 rounded-md border border-danger-200 bg-danger-50 p-4"
        >
            <p className="text-body font-semibold text-danger-600">{t('start.createFailed')}</p>
            {failure.issues.length === 0 ? (
                <p className="text-caption text-danger-600">{failure.message}</p>
            ) : (
                <ul className="list-disc space-y-1 ps-5 text-caption text-danger-600">
                    {failure.issues.map((issue, i) => {
                        const block = issue.block_key ? byKey.get(issue.block_key) : undefined;
                        const where = block ? blockName(block, t) : t('publish.layout');
                        return (
                            <li
                                key={`${issue.block_key}-${issue.path}-${i}`}
                            >{`${where} · ${line(issue)}`}</li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

/** A tiny phone drawing of the block list. */
function PhoneMock({ blocks }: { blocks: HomeBlock[] }) {
    return (
        <div
            aria-hidden
            className="mx-auto flex h-40 w-20 flex-col gap-1 overflow-hidden rounded-xl border-4 border-neutral-800 bg-white p-1"
        >
            {blocks.slice(0, 12).map((b) => (
                <div
                    key={b.block_key}
                    className={cn(
                        'shrink-0 rounded-sm',
                        b.type === 'BANNER_CAROUSEL' && 'h-6 bg-primary-300',
                        b.type === 'SHORTCUTS' && 'h-3 bg-primary-200',
                        b.type === 'COURSE_SHELF' && 'h-5 bg-primary-100',
                        b.type === 'NOTICE' && 'h-4 bg-info-100',
                        b.type === 'EVENT' && 'h-4 bg-success-100',
                        b.type === 'BUILTIN' &&
                            (b.builtin_widget === 'HERO'
                                ? 'h-5 bg-neutral-300'
                                : 'h-3 bg-neutral-200'),
                        !b.enabled && 'opacity-40'
                    )}
                />
            ))}
        </div>
    );
}

/**
 * No draft yet (spec 8.2 screen 1): start from the current home, one of the
 * three templates, or, when a version is live, a copy of it.
 */
export function StartScreen({
    published,
    hasStoreSite,
    onStart,
    onEditLive,
    onUnpublish,
}: {
    published: PublishedSummary | null;
    hasStoreSite: boolean;
    /** Null when the draft was created; the reason when the server refused it. */
    onStart: (choice: StartChoice) => Promise<StartFailure | null>;
    onEditLive: () => Promise<void>;
    onUnpublish: () => void;
}) {
    const { t } = useTranslation('learnerHome');
    const current = useQuery({
        queryKey: ['learner-home', 'current-home-settings'],
        queryFn: fetchStudentDisplaySettingsForEdit,
        staleTime: 60 * 1000,
    });
    const templates = useMemo(
        () =>
            STARTER_TEMPLATES.map((key) =>
                buildTemplate(key, { copy: templateCopy(t), hasStoreSite })
            ),
        [t, hasStoreSite]
    );
    const conversion = useMemo(
        () => (current.data ? convertLegacyHome(current.data, conversionCopy(t)) : null),
        [current.data, t]
    );
    const currentBlocks = conversion?.blocks ?? null;
    const [failed, setFailed] = useState<{
        key: TemplateKey;
        failure: StartFailure;
        blocks: HomeBlock[];
    } | null>(null);

    const cards: Array<{ key: TemplateKey; blocks: HomeBlock[] | null; recommended?: boolean }> = [
        { key: 'CURRENT', blocks: currentBlocks, recommended: true },
        ...templates.map((tpl) => ({ key: tpl.template_key, blocks: tpl.blocks })),
    ];

    return (
        <div className="space-y-6">
            {published && (
                <Card className="border-primary-200">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-title">
                            <PencilSimple className="size-5 text-primary-500" aria-hidden />
                            {t('start.editLive')}
                        </CardTitle>
                        <CardDescription>
                            {t('start.editLiveBody', { version: published.version })}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2">
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            onAsyncClick={onEditLive}
                            loadingText={t('start.creating')}
                        >
                            {t('start.editLive')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={onUnpublish}
                        >
                            {t('start.unpublish')}
                        </MyButton>
                    </CardContent>
                </Card>
            )}
            <div className="space-y-1">
                <h2 className="text-h3-semibold text-neutral-800">
                    {published ? t('start.orStartFrom') : t('start.title')}
                </h2>
                {!published && <p className="text-body text-neutral-600">{t('start.subtitle')}</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {cards.map(({ key, blocks, recommended }) => (
                    <Card key={key} className="flex flex-col">
                        <CardHeader className="space-y-2">
                            {recommended && (
                                <Badge variant="secondary" className="w-fit font-normal">
                                    {t('start.recommended')}
                                </Badge>
                            )}
                            <CardTitle className="text-title">{t(`start.${key}.title`)}</CardTitle>
                            <CardDescription>{t(`start.${key}.body`)}</CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-1 flex-col gap-3">
                            {blocks ? (
                                <PhoneMock blocks={blocks} />
                            ) : key === 'CURRENT' && current.isError ? (
                                <p className="text-caption text-danger-600">
                                    {t('start.currentFailed')}
                                </p>
                            ) : (
                                <div className="mx-auto h-40 w-20 animate-pulse rounded-xl bg-neutral-100" />
                            )}
                            {key === 'CURRENT' && conversion && conversion.droppedCards > 0 && (
                                <p className="text-caption text-warning-700">
                                    {t('start.cardsLeftOut', { count: conversion.droppedCards })}
                                </p>
                            )}
                            {key === 'CURRENT' && conversion && conversion.clippedCards > 0 && (
                                <p className="text-caption text-warning-700">
                                    {t('start.cardsClipped', { count: conversion.clippedCards })}
                                </p>
                            )}
                            {blocks && (
                                <details className="text-caption text-neutral-600">
                                    <summary className="cursor-pointer">{t('start.adds')}</summary>
                                    <ol className="mt-1 list-decimal space-y-0.5 ps-5">
                                        {blocks
                                            .filter((b) => b.enabled)
                                            .map((b) => (
                                                <li key={b.block_key}>{blockName(b, t)}</li>
                                            ))}
                                    </ol>
                                </details>
                            )}
                            <div className="mt-auto">
                                <MyButton
                                    type="button"
                                    buttonType={recommended && !published ? 'primary' : 'secondary'}
                                    scale="medium"
                                    className="w-full"
                                    disable={!blocks}
                                    loadingText={t('start.creating')}
                                    onAsyncClick={async () => {
                                        if (!blocks) return;
                                        setFailed(null);
                                        const failure = await onStart({ templateKey: key, blocks });
                                        if (failure) setFailed({ key, failure, blocks });
                                    }}
                                >
                                    {t('start.use')}
                                </MyButton>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
            {failed && <StartFailureList failure={failed.failure} blocks={failed.blocks} />}
        </div>
    );
}
