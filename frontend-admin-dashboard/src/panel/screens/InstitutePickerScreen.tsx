/**
 * Institute picker for teachers with staff roles in more than one institute.
 * The JWT only carries ids, so each card resolves its name + logo from the
 * public domain-routing endpoint (cached by react-query).
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Buildings, CheckCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Institute } from '@/lib/auth/instituteUtils';
import { getPublicUrl, resolveInstituteById } from '@/services/domain-routing';
import { SHARED_STORAGE_KEYS } from '../config';
import { PanelTopBar } from '../components/PanelTopBar';
import { PanelStage, PanelStageBody } from '../components/PanelStage';
import { PanelEmpty } from '../components/PanelScreenState';
import { refreshBranding } from '../lib/branding';
import { getPanelInstitutes, selectInstitute, signOut } from '../lib/session';
import { readString } from '../lib/storage';
import { goBack, navigate, routeFromNext, usePanelRoute } from '../router';

function useInstituteBrand(instituteId: string) {
    return useQuery({
        queryKey: ['panel-institute-brand', instituteId],
        queryFn: async () => {
            const data = await resolveInstituteById(instituteId);
            const logoUrl = await getPublicUrl(data?.instituteLogoFileId);
            return { name: data?.instituteName || null, logoUrl };
        },
        staleTime: 30 * 60 * 1000,
    });
}

function InstituteCard({
    institute,
    current,
    onSelect,
}: {
    institute: Institute;
    current: boolean;
    onSelect: (id: string) => void;
}) {
    const { t } = useTranslation('panel');
    const brand = useInstituteBrand(institute.id);
    const name = brand.data?.name || t('institutes.unnamed', { id: institute.id.slice(0, 8) });
    return (
        <button
            type="button"
            onClick={() => onSelect(institute.id)}
            className={cn(
                'flex min-h-40 w-full items-center space-x-6 rounded-lg border bg-card p-6 text-left shadow-sm transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-primary-300 active:border-primary-500 active:bg-primary-50',
                current ? 'border-primary-500' : 'border-border'
            )}
        >
            {brand.isLoading ? (
                <Skeleton className="size-20 shrink-0 rounded-md" />
            ) : brand.data?.logoUrl ? (
                <img
                    src={brand.data.logoUrl}
                    alt=""
                    className="size-20 shrink-0 rounded-md object-contain"
                />
            ) : (
                <Buildings size={80} className="shrink-0 text-neutral-400" aria-hidden />
            )}
            <span className="min-w-0 flex-1 space-y-2">
                {brand.isLoading ? (
                    <Skeleton className="h-8 w-3/4" />
                ) : (
                    <span className="block truncate text-h2 font-semibold text-neutral-800">
                        {name}
                    </span>
                )}
                <span className="block text-subtitle text-neutral-500">
                    {institute.roles.filter((role) => role !== 'STUDENT').join(', ')}
                </span>
            </span>
            {current && (
                <CheckCircle
                    size={40}
                    weight="fill"
                    className="shrink-0 text-primary-500"
                    aria-label={t('institutes.current')}
                />
            )}
        </button>
    );
}

export default function InstitutePickerScreen() {
    const { t } = useTranslation('panel');
    const { params } = usePanelRoute();
    const institutes = getPanelInstitutes();
    const currentId = readString(SHARED_STORAGE_KEYS.selectedInstituteId);

    const onSelect = (id: string) => {
        selectInstitute(id);
        void refreshBranding();
        const next = routeFromNext(params.next);
        if (next) navigate(next.screen, next.params, { replace: true });
        else navigate('home', undefined, { replace: true });
    };

    return (
        <PanelStage>
            <PanelTopBar title={t('institutes.title')} onBack={goBack} />
            <PanelStageBody className="p-8">
                <div className="mx-auto max-w-6xl space-y-6">
                    <p className="text-title text-neutral-500">{t('institutes.subtitle')}</p>
                    {institutes.length === 0 ? (
                        <PanelEmpty
                            icon={Buildings}
                            title={t('institutes.emptyTitle')}
                            description={t('institutes.emptyBody')}
                            action={
                                <MyButton
                                    buttonType="primary"
                                    scale="large"
                                    className="h-16 px-8"
                                    onAsyncClick={async () => {
                                        await signOut();
                                        navigate('login', undefined, { replace: true });
                                    }}
                                >
                                    {t('topBar.signOut')}
                                </MyButton>
                            }
                        />
                    ) : (
                        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                            {institutes.map((institute) => (
                                <InstituteCard
                                    key={institute.id}
                                    institute={institute}
                                    current={institute.id === currentId}
                                    onSelect={onSelect}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </PanelStageBody>
        </PanelStage>
    );
}
