import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
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
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { MyButton } from '@/components/design-system/button';
import type { Layout } from '../-types/learner-home-types';
import { learnerHomeApi, toLearnerHomeError } from '../-services/learner-home-service';
import { formatInZone } from '../-utils/schedule';
import { useInstituteZone } from '../-hooks/usePickerOptions';

/** The last 20 published versions, each restorable into the draft (spec 2.5, 8.2). */
export function VersionsDrawer({
    open,
    onOpenChange,
    instituteId,
    hasDraft,
    onRestored,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    instituteId: string;
    hasDraft: boolean;
    onRestored: (layout: Layout) => void;
}) {
    const { t, i18n } = useTranslation('learnerHome');
    const zone = useInstituteZone();
    const [confirming, setConfirming] = useState<number | null>(null);
    const versions = useQuery({
        queryKey: ['learner-home', 'versions', instituteId],
        queryFn: () => learnerHomeApi.listVersions(instituteId),
        enabled: open && !!instituteId,
    });

    const restore = async (version: number) => {
        try {
            const layout = await learnerHomeApi.restoreVersion(instituteId, version, hasDraft);
            onRestored(layout);
            toast.success(t('versions.restored', { version }));
            onOpenChange(false);
        } catch (error) {
            toast.error(toLearnerHomeError(error).message);
        }
    };

    return (
        <>
            <Sheet open={open} onOpenChange={onOpenChange}>
                <SheetContent className="w-full overflow-y-auto sm:max-w-md">
                    <SheetHeader>
                        <SheetTitle>{t('versions.title')}</SheetTitle>
                        <SheetDescription>{t('versions.subtitle')}</SheetDescription>
                    </SheetHeader>
                    <div className="mt-4 space-y-2">
                        {versions.isLoading && (
                            <>
                                <Skeleton className="h-16 w-full" />
                                <Skeleton className="h-16 w-full" />
                            </>
                        )}
                        {versions.isError && (
                            <p className="text-body text-danger-600">{t('versions.failed')}</p>
                        )}
                        {versions.data && versions.data.length === 0 && (
                            <p className="text-body text-neutral-500">{t('versions.empty')}</p>
                        )}
                        <ul className="space-y-2">
                            {(versions.data ?? []).map((v) => (
                                <li
                                    key={v.version}
                                    className="flex items-start justify-between gap-3 rounded-md border border-neutral-200 p-3"
                                >
                                    <div className="min-w-0 space-y-0.5">
                                        <p className="flex items-center gap-2 text-body font-semibold">
                                            {t('versions.version', { version: v.version })}
                                            <Badge
                                                variant={
                                                    v.status === 'PUBLISHED' ? 'default' : 'outline'
                                                }
                                                className="font-normal"
                                            >
                                                {v.status === 'PUBLISHED'
                                                    ? t('versions.live')
                                                    : t('versions.archived')}
                                            </Badge>
                                        </p>
                                        <p className="text-caption text-neutral-500">
                                            {formatInZone(v.published_at, zone, i18n.language)}
                                            {v.published_by
                                                ? ` · ${t('versions.by', { name: v.published_by })}`
                                                : ''}
                                        </p>
                                        <p className="text-caption text-neutral-500">
                                            {t('versions.blocks', { count: v.block_count })}
                                        </p>
                                    </div>
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="small"
                                        onClick={() =>
                                            hasDraft
                                                ? setConfirming(v.version)
                                                : void restore(v.version)
                                        }
                                    >
                                        {t('versions.restore')}
                                    </MyButton>
                                </li>
                            ))}
                        </ul>
                    </div>
                </SheetContent>
            </Sheet>
            <AlertDialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('versions.restoreTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('versions.restoreBody', { version: confirming ?? '' })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('topbar.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                const v = confirming;
                                setConfirming(null);
                                if (v !== null) void restore(v);
                            }}
                        >
                            {t('versions.restoreConfirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
