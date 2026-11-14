import { useEffect, useState } from 'react';
import { createLazyFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Ticket } from '@phosphor-icons/react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ACCESS_PASS_QUERY_KEYS, formatPassPrice, listAccessPasses, type AccessPass } from '@/services/access-pass';
import { AccessPassEditorDialog } from './-components/AccessPassEditorDialog';
import { AccessPassDetail } from './-components/AccessPassDetail';
import { AccessPassStatusBadge } from './-components/AccessPassStatusBadge';

export const Route = createLazyFileRoute('/access-passes/')({
    component: () => (
        <LayoutContainer>
            <AccessPassesPage />
        </LayoutContainer>
    ),
});

/**
 * Access Passes: one purchase that unlocks a set of courses. List on the left,
 * the selected pass (courses, sell link, holders) on the right.
 */
function AccessPassesPage() {
    const { t } = useTranslation('manageAccessPasses');
    const { setNavHeading } = useNavHeadingStore();
    const queryClient = useQueryClient();
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [createOpen, setCreateOpen] = useState(false);

    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('navHeading', 'Access Passes')}</h1>);
    }, [setNavHeading, t]);

    const { data: passes = [], isLoading } = useQuery({
        queryKey: ACCESS_PASS_QUERY_KEYS.list,
        queryFn: listAccessPasses,
    });

    useEffect(() => {
        if (!selectedId && passes.length > 0) setSelectedId(passes[0]!.id);
        if (selectedId && passes.length > 0 && !passes.some((p) => p.id === selectedId)) {
            setSelectedId(passes[0]!.id);
        }
    }, [passes, selectedId]);

    const onCreated = (pass: AccessPass) => {
        queryClient.invalidateQueries({ queryKey: ACCESS_PASS_QUERY_KEYS.list });
        setSelectedId(pass.id);
    };

    return (
        <div className="flex flex-col gap-4 p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <p className="text-sm text-neutral-600">
                    {t(
                        'intro',
                        'Sell several courses as one purchase. Courses you add later are delivered to everyone who already holds the pass.'
                    )}
                </p>
                <Button onClick={() => setCreateOpen(true)}>
                    <Plus className="mr-1 size-4" />
                    {t('newPass', 'New access pass')}
                </Button>
            </div>

            {isLoading ? (
                <p className="text-sm text-neutral-500">{t('common.loading', 'Loading…')}</p>
            ) : passes.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
                    <Ticket className="size-10 text-neutral-400" />
                    <p className="font-medium">{t('empty.title', 'No access passes yet')}</p>
                    <p className="max-w-md text-sm text-neutral-500">
                        {t(
                            'empty.body',
                            'Create a pass, pick the courses it unlocks and how it is priced, then publish it.'
                        )}
                    </p>
                    <Button onClick={() => setCreateOpen(true)}>{t('newPass', 'New access pass')}</Button>
                </div>
            ) : (
                <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
                    <ul className="flex flex-col gap-2">
                        {passes.map((p) => (
                            <li key={p.id}>
                                <button
                                    type="button"
                                    onClick={() => setSelectedId(p.id)}
                                    className={cn(
                                        'flex w-full flex-col gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-neutral-50',
                                        selectedId === p.id && 'border-primary-500 bg-primary-50'
                                    )}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="truncate font-medium">{p.name}</span>
                                        <AccessPassStatusBadge status={p.status} />
                                    </div>
                                    <span className="text-xs text-neutral-500">
                                        {p.audience_type === 'B2B' ? 'B2B' : 'B2C'} · {formatPassPrice(p.price)} ·{' '}
                                        {p.course_scope === 'ALL_COURSES'
                                            ? t('common.allCourses', 'all courses')
                                            : `${p.course_count ?? 0} ${t('common.courses', 'courses')}`}{' '}
                                        ·{' '}
                                        {p.audience_type === 'B2B'
                                            ? `${p.sub_org_count ?? 0} ${t('common.subOrgs', 'sub-orgs')}`
                                            : `${p.current_holder_count ?? 0} ${t('common.holders', 'holders')}`}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                    <div>
                        {selectedId && (
                            <AccessPassDetail
                                key={selectedId}
                                passId={selectedId}
                                onDeleted={() => setSelectedId(null)}
                            />
                        )}
                    </div>
                </div>
            )}

            <AccessPassEditorDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={onCreated} />
        </div>
    );
}
