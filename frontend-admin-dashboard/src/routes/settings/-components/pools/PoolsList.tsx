/**
 * Pools tab content inside Lead Settings. Lists all counselor pools for the
 * institute with a "Create Pool" button. Clicking a pool navigates to the
 * full-page editor at /settings/leads/pools/$poolId.
 */

import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { DotsThreeVertical, PencilSimple, Lightning, Trash } from '@phosphor-icons/react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MyButton } from '@/components/design-system/button';
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
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    AssignmentMode,
    CounselorPoolDTO,
    useCounselorPools,
    useDeletePool,
} from '@/services/counselor-pool';
import { getInstituteId } from '@/constants/helper';
import { TriggerWorkflowDialog } from './TriggerWorkflowDialog';

function buildModeLabel(t: TFunction): Record<AssignmentMode, string> {
    return {
        MANUAL: t('modes.manual'),
        ROUND_ROBIN: t('modes.roundRobin'),
        TIME_BASED: t('modes.timeBased'),
    };
}

const MODE_TONE: Record<AssignmentMode, string> = {
    MANUAL: 'bg-neutral-100 text-neutral-700',
    ROUND_ROBIN: 'bg-blue-100 text-blue-700',
    TIME_BASED: 'bg-purple-100 text-purple-700',
};

export default function PoolsList() {
    const { t } = useTranslation('settingsPoolsList');
    const navigate = useNavigate();
    const { data: pools, isLoading } = useCounselorPools();
    const { mutate: deletePool, isPending: deleting } = useDeletePool();
    const [poolToDelete, setPoolToDelete] = useState<CounselorPoolDTO | null>(null);
    const [triggerPool, setTriggerPool] = useState<CounselorPoolDTO | null>(null);
    const instituteId = getInstituteId() ?? '';

    // Routes are new and not yet picked up by routeTree.gen.ts at type-check time;
    // cast keeps the build green until the generator regenerates the tree.
    const goToCreate = () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        navigate({ to: '/settings/leads/pools/$poolId', params: { poolId: 'new' } } as any);

    const goToEdit = (poolId: string) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        navigate({ to: '/settings/leads/pools/$poolId', params: { poolId } } as any);

    const confirmDelete = () => {
        if (!poolToDelete) return;
        deletePool(poolToDelete.id, {
            onSuccess: () => {
                toast.success(t('toasts.deleted', { name: poolToDelete.name }));
                setPoolToDelete(null);
            },
            onError: (err: unknown) => {
                const message =
                    (err as { response?: { data?: { ex?: string; message?: string } } })?.response
                        ?.data?.ex ??
                    (err as { response?: { data?: { message?: string } } })?.response?.data
                        ?.message ??
                    t('toasts.deleteFailed');
                toast.error(message);
            },
        });
    };

    if (isLoading) {
        return <div className="p-6 text-sm text-muted-foreground">{t('loading')}</div>;
    }

    const modeLabel = buildModeLabel(t);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold">{t('header.title')}</h3>
                    <p className="text-sm text-muted-foreground">{t('header.description')}</p>
                </div>
                <MyButton buttonType="primary" scale="medium" onClick={goToCreate}>
                    {t('header.createPool')}
                </MyButton>
            </div>

            {pools && pools.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center gap-3 py-12">
                        <p className="text-sm text-muted-foreground">{t('emptyState.message')}</p>
                        <MyButton buttonType="primary" scale="medium" onClick={goToCreate}>
                            {t('emptyState.createPool')}
                        </MyButton>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {pools?.map((pool) => (
                        <Card
                            key={pool.id}
                            className="cursor-pointer transition hover:shadow-md"
                            onClick={() => goToEdit(pool.id)}
                        >
                            <CardContent className="space-y-3 p-4">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                        <h4 className="truncate font-medium">{pool.name}</h4>
                                        {pool.description && (
                                            <p className="line-clamp-2 text-xs text-muted-foreground">
                                                {pool.description}
                                            </p>
                                        )}
                                    </div>
                                    <Badge className={MODE_TONE[pool.assignment_mode]}>
                                        {modeLabel[pool.assignment_mode]}
                                    </Badge>
                                </div>
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                    <span>
                                        {t('card.campaignsCount', {
                                            count: pool.audiences?.length ?? 0,
                                        })}
                                    </span>
                                    <span>·</span>
                                    <span>
                                        {t('card.counselorsCount', {
                                            count: countDistinctCounselors(pool.members),
                                        })}
                                    </span>
                                </div>
                                <div className="flex justify-end pt-1">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <button
                                                type="button"
                                                aria-label={t('card.actionsAriaLabel')}
                                                className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <DotsThreeVertical size={18} weight="bold" />
                                            </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent
                                            align="end"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <DropdownMenuItem
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    goToEdit(pool.id);
                                                }}
                                            >
                                                <PencilSimple size={16} /> {t('card.edit')}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setTriggerPool(pool);
                                                }}
                                            >
                                                <Lightning size={16} />{' '}
                                                {t('card.triggerWorkflow')}
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                className="text-danger-600 focus:text-danger-600"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setPoolToDelete(pool);
                                                }}
                                            >
                                                <Trash size={16} /> {t('card.delete')}
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            <AlertDialog
                open={!!poolToDelete}
                onOpenChange={(open) => !open && setPoolToDelete(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {t('deleteDialog.title', { name: poolToDelete?.name })}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('deleteDialog.description')}
                            {poolToDelete?.audiences && poolToDelete.audiences.length > 0 && (
                                <span className="mt-2 block text-amber-600">
                                    {t('deleteDialog.campaignsAttachedWarning', {
                                        count: poolToDelete.audiences.length,
                                    })}
                                </span>
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleting}>
                            {t('deleteDialog.cancel')}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            disabled={
                                deleting ||
                                !!(poolToDelete?.audiences && poolToDelete.audiences.length > 0)
                            }
                            onClick={confirmDelete}
                            className="bg-red-600 hover:bg-red-700"
                        >
                            {deleting ? t('deleteDialog.deleting') : t('deleteDialog.delete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {triggerPool && (
                <TriggerWorkflowDialog
                    open={!!triggerPool}
                    onOpenChange={(open) => !open && setTriggerPool(null)}
                    instituteId={instituteId}
                    poolId={triggerPool.id}
                    scopeLabel={triggerPool.name}
                />
            )}
        </div>
    );
}

function countDistinctCounselors(members?: { counselor_user_id: string }[]) {
    if (!members) return 0;
    return new Set(members.map((m) => m.counselor_user_id)).size;
}
