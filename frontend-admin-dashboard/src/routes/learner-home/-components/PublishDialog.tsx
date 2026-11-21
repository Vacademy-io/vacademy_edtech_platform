import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import type { CheckIssue, HomeBlock } from '../-types/learner-home-types';
import { diffBlocks, isEmptyDiff } from '../-utils/diff';
import { errorsOf, mergeIssues, warningsOf } from '../-utils/publish-checks';
import { blockName } from './block-display';
import { useIssueText } from './shared/FieldIssues';

export type PublishOutcome =
    | { ok: true; version: number; warnings: CheckIssue[] }
    | { ok: false; issues: CheckIssue[]; message: string };

/**
 * Publish (spec 8.2): the checks grouped by block, the change summary, then
 * the publish itself. Errors (the editor's own checks, or the server's 422)
 * block it; warnings do not.
 */
export function PublishDialog({
    open,
    onOpenChange,
    blocks,
    clientIssues,
    publishedBlocks,
    onPublish,
    onGoTo,
    loadServerChecks,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    blocks: HomeBlock[];
    clientIssues: CheckIssue[];
    /** The live version's blocks, when the server sends them, for the change summary. */
    publishedBlocks: HomeBlock[] | null;
    onPublish: () => Promise<PublishOutcome>;
    onGoTo: (blockKey: string) => void;
    /** Saves, then runs the server's dry run; null when it could not. */
    loadServerChecks?: () => Promise<CheckIssue[] | null>;
}) {
    const { t } = useTranslation('learnerHome');
    const issueText = useIssueText();
    const [serverIssues, setServerIssues] = useState<CheckIssue[]>([]);
    const [failure, setFailure] = useState<string | null>(null);

    const [checking, setChecking] = useState(false);

    // On open: save what is pending, then show the server's own findings too
    // (missing courses, inactive pages, Fun-look leave-outs) before publishing.
    useEffect(() => {
        if (!open || !loadServerChecks) return;
        let cancelled = false;
        setChecking(true);
        void loadServerChecks().then((found) => {
            if (cancelled) return;
            setChecking(false);
            if (found) setServerIssues(found);
        });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const all = mergeIssues(clientIssues, serverIssues);
    const errors = errorsOf(all);
    const warnings = warningsOf(all);
    const byKey = new Map(blocks.map((b) => [b.block_key, b]));
    const diff = publishedBlocks ? diffBlocks(publishedBlocks, blocks) : null;

    const group = (list: CheckIssue[]) => {
        const map = new Map<string, CheckIssue[]>();
        list.forEach((i) => {
            const k = i.block_key ?? '';
            map.set(k, [...(map.get(k) ?? []), i]);
        });
        return [...map.entries()];
    };

    const renderGroup = (list: CheckIssue[], tone: 'error' | 'warning') => (
        <ul className="space-y-2">
            {group(list).map(([key, items]) => {
                const block = key ? byKey.get(key) : undefined;
                return (
                    <li key={key || 'layout'} className="rounded-md border border-neutral-200 p-2">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-body font-semibold">
                                {block ? blockName(block, t) : t('publish.layout')}
                            </span>
                            {block && (
                                <MyButton
                                    type="button"
                                    buttonType="text"
                                    scale="small"
                                    onClick={() => {
                                        onGoTo(block.block_key);
                                        onOpenChange(false);
                                    }}
                                >
                                    {t('publish.goTo')}
                                </MyButton>
                            )}
                        </div>
                        <ul
                            className={
                                tone === 'error'
                                    ? 'text-caption text-danger-600'
                                    : 'text-caption text-warning-700'
                            }
                        >
                            {items.map((i, n) => (
                                <li key={`${i.path}-${i.code}-${n}`}>{issueText(i)}</li>
                            ))}
                        </ul>
                    </li>
                );
            })}
        </ul>
    );

    return (
        <MyDialog
            heading={t('publish.title')}
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    setServerIssues([]);
                    setFailure(null);
                }
                onOpenChange(next);
            }}
            footerLeft={
                failure ? (
                    <span className="text-caption text-danger-600">{failure}</span>
                ) : undefined
            }
            footer={
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="medium"
                    disable={errors.length > 0 || checking}
                    loadingText={t('publish.checking')}
                    onAsyncClick={async () => {
                        setFailure(null);
                        const res = await onPublish();
                        if (res.ok) {
                            onOpenChange(false);
                        } else {
                            setServerIssues(res.issues);
                            setFailure(res.message);
                        }
                    }}
                >
                    {t('publish.publishNow')}
                </MyButton>
            }
        >
            <div className="space-y-4">
                {checking && (
                    <p className="text-caption text-neutral-500" aria-live="polite">
                        {t('publish.checking')}
                    </p>
                )}
                {diff && (
                    <p className="text-body text-neutral-700">
                        {isEmptyDiff(diff)
                            ? t('publish.noChanges')
                            : t('publish.diff', { ...diff })}
                    </p>
                )}
                {errors.length > 0 && (
                    <section className="space-y-2">
                        <h3 className="text-subtitle font-semibold text-danger-600">
                            {t('publish.errors')}
                        </h3>
                        {renderGroup(errors, 'error')}
                    </section>
                )}
                {warnings.length > 0 && (
                    <section className="space-y-2">
                        <h3 className="text-subtitle font-semibold text-warning-700">
                            {t('publish.warnings')}
                        </h3>
                        {renderGroup(warnings, 'warning')}
                    </section>
                )}
                {!checking && errors.length === 0 && warnings.length === 0 && (
                    <p className="flex items-center gap-2 text-body text-success-700">
                        <CheckCircle className="size-5" weight="fill" aria-hidden />
                        {t('publish.noIssues')}
                    </p>
                )}
                <p className="text-caption text-neutral-500">{t('topbar.reachNote')}</p>
            </div>
        </MyDialog>
    );
}
