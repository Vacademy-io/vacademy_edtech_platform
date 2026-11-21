import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useContentStore } from '../../-stores/chapter-sidebar-store';
import type { ActivityBatch } from './activity-api';
import { storedActivityJson } from './use-sync-activity-draft';

export const ALL_BATCHES = '__all__';

/**
 * Header (icon, title, live / draft / unsaved state) and the Setup / Results tabs shared
 * by the Poll and Game slide editors. Results are staff-only and need a saved slide, so
 * the tabs appear only while editing.
 */
export function ActivityShell({
    slideId,
    icon,
    title,
    json,
    userEdited,
    isEditable,
    setup,
    results,
    resultsLabel,
}: {
    slideId: string;
    icon: ReactNode;
    title: string;
    json: string;
    userEdited: boolean;
    isEditable: boolean;
    setup: ReactNode;
    results: ReactNode;
    resultsLabel: string;
}) {
    const { t } = useTranslation('slideActivity');
    const status = useContentStore((s) => s.items.find((i) => i.id === slideId)?.status);
    const persistedJson = useContentStore((s) =>
        storedActivityJson(s.items.find((i) => i.id === slideId))
    );
    const unsaved = userEdited && persistedJson !== json;
    const hint = unsaved
        ? { tone: 'warning', text: t('status.unsaved') }
        : status === 'PUBLISHED'
          ? { tone: 'success', text: t('status.live') }
          : status === 'UNSYNC'
            ? { tone: 'warning', text: t('status.unsync') }
            : { tone: 'neutral', text: t('status.draft') };

    return (
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6">
            <div className="flex items-center gap-2">
                <span className="flex size-9 items-center justify-center rounded-full bg-primary-50 text-primary-500">
                    {icon}
                </span>
                <div className="flex flex-col">
                    <span className="text-subtitle font-semibold text-neutral-700">{title}</span>
                    <span
                        className={cn(
                            'text-caption',
                            hint.tone === 'warning' && 'text-warning-600',
                            hint.tone === 'success' && 'text-success-600',
                            hint.tone === 'neutral' && 'text-neutral-500'
                        )}
                    >
                        {hint.text}
                    </span>
                </div>
            </div>
            {isEditable ? (
                <Tabs defaultValue="setup">
                    <TabsList>
                        <TabsTrigger value="setup">{t('tabs.setup')}</TabsTrigger>
                        <TabsTrigger value="results">{resultsLabel}</TabsTrigger>
                    </TabsList>
                    <TabsContent value="setup" className="mt-4">
                        {setup}
                    </TabsContent>
                    <TabsContent value="results" className="mt-4">
                        {results}
                    </TabsContent>
                </Tabs>
            ) : (
                setup
            )}
        </div>
    );
}

export function BatchFilter({
    batches,
    value,
    onChange,
}: {
    batches: ActivityBatch[];
    value: string;
    onChange: (value: string) => void;
}) {
    const { t } = useTranslation('slideActivity');
    if (batches.length < 2) return null;
    return (
        <Select value={value} onValueChange={onChange}>
            <SelectTrigger className="h-9 w-full sm:w-64" aria-label={t('results.batch')}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value={ALL_BATCHES}>{t('results.allBatches')}</SelectItem>
                {batches.map((b) => (
                    <SelectItem key={b.packageSessionId} value={b.packageSessionId}>
                        {b.name || b.packageSessionId}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
