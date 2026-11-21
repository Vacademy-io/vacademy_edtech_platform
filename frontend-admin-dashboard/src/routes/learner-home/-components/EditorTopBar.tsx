import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    CheckCircle,
    CircleNotch,
    ClockCounterClockwise,
    GearSix,
    PencilSimpleLine,
    WarningCircle,
} from '@phosphor-icons/react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import type { LayoutSettings, PhoneSpacing, PublishedSummary } from '../-types/learner-home-types';
import type { DraftConflict, SaveStatus } from '../-hooks/useLearnerHomeDraft';
import { formatInZone } from '../-utils/schedule';
import { useInstituteZone } from '../-hooks/usePickerOptions';
import { SwitchField } from './shared/fields';

export function SaveStatusChip({ status, error }: { status: SaveStatus; error: string | null }) {
    const { t } = useTranslation('learnerHome');
    const Icon =
        status === 'saving'
            ? CircleNotch
            : status === 'saved'
              ? CheckCircle
              : status === 'dirty'
                ? PencilSimpleLine
                : WarningCircle;
    return (
        <span
            role="status"
            title={status === 'error' && error ? error : undefined}
            className={cn(
                'inline-flex items-center gap-1 text-caption',
                status === 'saved' && 'text-success-700',
                (status === 'dirty' || status === 'saving') && 'text-neutral-600',
                (status === 'error' || status === 'conflict') && 'text-danger-600'
            )}
        >
            <Icon className={cn('size-4', status === 'saving' && 'animate-spin')} aria-hidden />
            {t(`status.${status}`)}
        </span>
    );
}

function SettingsPopover({
    settings,
    onChange,
}: {
    settings: LayoutSettings;
    onChange: (patch: Partial<LayoutSettings>) => void;
}) {
    const { t } = useTranslation('learnerHome');
    return (
        <Popover>
            <PopoverTrigger asChild>
                <MyButton type="button" buttonType="secondary" scale="medium">
                    <GearSix className="me-1 size-4" aria-hidden />
                    {t('topbar.settings')}
                </MyButton>
            </PopoverTrigger>
            <PopoverContent className="w-80 space-y-4" align="end">
                <p className="text-subtitle font-semibold">{t('settings.title')}</p>
                <fieldset className="space-y-2">
                    <legend className="text-body font-semibold text-neutral-700">
                        {t('settings.phoneSpacing')}
                    </legend>
                    <RadioGroup
                        value={settings.phone_spacing}
                        onValueChange={(v) => onChange({ phone_spacing: v as PhoneSpacing })}
                    >
                        {(['COMPACT', 'COMFORTABLE'] as const).map((s) => (
                            <div key={s} className="flex items-center gap-2">
                                <RadioGroupItem id={`lh-spacing-${s}`} value={s} />
                                <Label htmlFor={`lh-spacing-${s}`} className="font-normal">
                                    {t(`settings.spacing.${s}`)}
                                </Label>
                            </div>
                        ))}
                    </RadioGroup>
                </fieldset>
                <SwitchField
                    id="lh-show-header"
                    label={t('settings.showHeader')}
                    checked={settings.show_header}
                    onChange={(show_header) => onChange({ show_header })}
                />
                <SwitchField
                    id="lh-autoplay"
                    label={t('settings.autoplayDefault')}
                    checked={settings.carousel_autoplay_default}
                    onChange={(carousel_autoplay_default) =>
                        onChange({ carousel_autoplay_default })
                    }
                />
            </PopoverContent>
        </Popover>
    );
}

export function EditorTopBar({
    status,
    lastError,
    published,
    baseVersion,
    settings,
    errorCount,
    onSettings,
    onVersions,
    onDiscard,
    onPublish,
    onRetrySave,
    onUnpublish,
}: {
    status: SaveStatus;
    lastError: string | null;
    published: PublishedSummary | null;
    baseVersion: number | null;
    settings: LayoutSettings;
    errorCount: number;
    onSettings: (patch: Partial<LayoutSettings>) => void;
    onVersions: () => void;
    onDiscard: () => Promise<void>;
    onPublish: () => void;
    onRetrySave: () => void;
    onUnpublish: () => void;
}) {
    const { t, i18n } = useTranslation('learnerHome');
    const zone = useInstituteZone();
    const [confirmDiscard, setConfirmDiscard] = useState(false);
    return (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-neutral-200 bg-card px-3 py-2">
            <div className="flex flex-wrap items-center gap-3">
                <SaveStatusChip status={status} error={lastError} />
                {status === 'error' && (
                    <MyButton type="button" buttonType="text" scale="small" onClick={onRetrySave}>
                        {t('topbar.retrySave')}
                    </MyButton>
                )}
                <Badge variant="outline" className="font-normal">
                    {published
                        ? `${t('topbar.live', { version: published.version })}${published.published_at ? ` · ${formatInZone(published.published_at, zone, i18n.language)}` : ''}`
                        : t('topbar.notLive')}
                </Badge>
                {baseVersion !== null && (
                    <span className="text-caption text-neutral-500">
                        {t('topbar.draftOf', { version: baseVersion })}
                    </span>
                )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <SettingsPopover settings={settings} onChange={onSettings} />
                <MyButton type="button" buttonType="secondary" scale="medium" onClick={onVersions}>
                    <ClockCounterClockwise className="me-1 size-4" aria-hidden />
                    {t('topbar.versions')}
                </MyButton>
                <MyButton
                    type="button"
                    buttonType="text"
                    scale="medium"
                    onClick={() => setConfirmDiscard(true)}
                >
                    {t('topbar.discard')}
                </MyButton>
                {published && (
                    <MyButton type="button" buttonType="text" scale="medium" onClick={onUnpublish}>
                        {t('topbar.unpublish')}
                    </MyButton>
                )}
                <MyButton type="button" buttonType="primary" scale="medium" onClick={onPublish}>
                    {t('topbar.publish')}
                    {errorCount > 0 && (
                        <span className="ms-2 rounded-full bg-white px-1.5 text-caption text-danger-600">
                            {errorCount}
                        </span>
                    )}
                </MyButton>
            </div>
            <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('topbar.discardTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>{t('topbar.discardBody')}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('topbar.cancel')}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void onDiscard()}>
                            {t('topbar.discardConfirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

export function ConflictBanner({
    conflict,
    onReload,
    onOverwrite,
}: {
    conflict: DraftConflict;
    onReload: () => Promise<void>;
    onOverwrite: () => Promise<unknown>;
}) {
    const { t, i18n } = useTranslation('learnerHome');
    const zone = useInstituteZone();
    return (
        <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning-300 bg-warning-50 px-4 py-3"
        >
            <div className="space-y-0.5">
                <p className="text-body font-semibold text-warning-700">{t('conflict.title')}</p>
                <p className="text-caption text-warning-700">
                    {conflict.updatedBy || conflict.updatedAt
                        ? t('conflict.body', {
                              name: conflict.updatedBy ?? '—',
                              time: formatInZone(conflict.updatedAt, zone, i18n.language) || '—',
                          })
                        : t('conflict.bodyUnknown')}
                </p>
            </div>
            <div className="flex gap-2">
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    onAsyncClick={onReload}
                >
                    {t('conflict.reload')}
                </MyButton>
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="medium"
                    onAsyncClick={async () => void (await onOverwrite())}
                >
                    {t('conflict.overwrite')}
                </MyButton>
            </div>
        </div>
    );
}
