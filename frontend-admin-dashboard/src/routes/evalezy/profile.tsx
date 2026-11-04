import { useEffect, type ReactNode } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Buildings, CaretRight, Sparkle } from '@phosphor-icons/react';
import useAdminLogoStore from '@/components/common/layout-container/sidebar/admin-logo-zustand';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { MyButton } from '@/components/design-system/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import AdminProfile from '@/routes/dashboard/-components/AdminProfile';
import { getDisplaySettingsFromCache } from '@/services/display-settings';
import { handleGetAdminDetails } from '@/services/student-list-section/getAdminDetails';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { getPublicUrl } from '@/services/upload_file';
import { isUserAdmin, getUserName } from '@/utils/userDetails';

export const Route = createFileRoute('/evalezy/profile')({
    component: EvalezyProfile,
});

const initialsOf = (name?: string | null) =>
    (name ?? '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join('') || '?';

const DetailRow = ({ label, value }: { label: string; value: ReactNode }) => (
    <div className="flex items-start justify-between gap-4 py-2">
        <span className="shrink-0 text-body text-neutral-500">{label}</span>
        <span className="min-w-0 break-words text-right text-body text-neutral-800">{value}</span>
    </div>
);

/**
 * Who is signed in and to which institute. Edit is the portal's own profile dialog,
 * under the same display setting; roles stay read-only there.
 */
function EvalezyProfile() {
    const { t } = useTranslation('evalezy');
    const admin = useQuery(handleGetAdminDetails());
    const { data: institute } = useQuery(useInstituteQuery());
    const { adminLogo, setAdminLogo } = useAdminLogoStore();

    const pictureId = admin.data?.profile_pic_file_id;
    useEffect(() => {
        if (!pictureId) return;
        void getPublicUrl(pictureId).then((url) => setAdminLogo(url || ''));
    }, [pictureId, setAdminLogo]);

    const logoId = institute?.institute_logo_file_id;
    const { data: instituteLogo } = useQuery({
        queryKey: ['EVALEZY_INSTITUTE_LOGO', logoId],
        queryFn: () => getPublicUrl(logoId),
        enabled: !!logoId,
    });

    const canEdit =
        getDisplaySettingsFromCache(getActiveRoleDisplaySettingsKey())?.permissions
            ?.canEditProfileDetails ?? isUserAdmin();

    if (admin.isLoading) return <DashboardLoader />;

    if (admin.isError || !admin.data) {
        return (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-neutral-200 bg-white p-6 text-center">
                <p className="text-body text-danger-700">{t('profile.loadError')}</p>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    onClick={() => void admin.refetch()}
                >
                    {t('credits.retry')}
                </MyButton>
            </div>
        );
    }

    const user = admin.data;

    return (
        <div className="flex flex-col gap-4">
            <h1 className="text-h3 font-semibold text-neutral-800">{t('profile.title')}</h1>

            <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4">
                <div className="flex items-center gap-3">
                    <Avatar className="size-14 shrink-0">
                        {adminLogo ? <AvatarImage src={adminLogo} alt="" /> : null}
                        <AvatarFallback className="bg-primary-100 font-semibold text-primary-500">
                            {initialsOf(user.full_name)}
                        </AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-col gap-1">
                        <p className="break-words text-subtitle font-semibold text-neutral-800">
                            {user.full_name || getUserName()}
                        </p>
                        {user.roles?.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                                {user.roles.map((role) => (
                                    <span
                                        key={role.id}
                                        className="rounded-md border border-primary-200 bg-primary-50 px-2 py-0.5 text-caption font-semibold uppercase text-primary-500"
                                    >
                                        {role.role_name}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex flex-col divide-y divide-neutral-100">
                    <DetailRow label={t('profile.username')} value={getUserName()} />
                    <DetailRow
                        label={t('profile.email')}
                        value={user.email || t('profile.notSet')}
                    />
                    <DetailRow
                        label={t('profile.mobile')}
                        value={user.mobile_number || t('profile.notSet')}
                    />
                </div>
                {canEdit && <AdminProfile adminDetails={user} />}
            </section>

            {institute && (
                <section className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-4">
                    <p className="text-caption text-neutral-500">{t('profile.institute')}</p>
                    <div className="flex items-center gap-3">
                        <Avatar className="size-10 shrink-0 rounded-md">
                            {instituteLogo ? (
                                <AvatarImage
                                    src={instituteLogo}
                                    alt=""
                                    className="object-contain"
                                />
                            ) : null}
                            <AvatarFallback className="rounded-md bg-neutral-100 text-neutral-500">
                                <Buildings size={20} />
                            </AvatarFallback>
                        </Avatar>
                        <p className="min-w-0 break-words text-body font-semibold text-neutral-800">
                            {institute.institute_name}
                        </p>
                    </div>
                </section>
            )}

            <Link
                to="/evalezy/credits"
                className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white p-4 text-body font-medium text-neutral-800"
            >
                <Sparkle size={16} weight="fill" className="shrink-0 text-purple-700" />
                {t('credits.title')}
                <CaretRight size={14} className="ml-auto shrink-0 text-neutral-400" />
            </Link>
        </div>
    );
}
