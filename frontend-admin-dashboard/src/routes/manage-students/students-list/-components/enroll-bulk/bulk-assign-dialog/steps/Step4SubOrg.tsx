import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Buildings, BookOpen, Envelope, Warning, UserCircle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import {
    PackageSessionSubOrg,
    SelectedPackageSession,
    SubOrgRoleChoice,
} from '../../../../-types/bulk-assign-types';
import { useSubOrgsForPackageSession } from '../../../../-hooks/useSubOrgsForPackageSession';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import {
    ContentTerms,
    RoleTerms,
    SystemTerms,
} from '@/routes/settings/-components/NamingSettings';

/** Sentinel value for the "create a new organisation" entry in the picker. */
const CREATE_NEW = '__CREATE_NEW__';
/** Sentinel for "enroll without linking an organisation". */
const SKIP = '__SKIP__';

interface Props {
    selectedPackageSessions: SelectedPackageSession[];
    onSelectedPackageSessionsChange: (sessions: SelectedPackageSession[]) => void;
}

interface RowProps {
    ps: SelectedPackageSession;
    onUpdate: (patch: Partial<SelectedPackageSession>) => void;
}

/** Read-only contact card for the picked organisation's admins. */
const AdminList = ({ subOrg }: { subOrg: PackageSessionSubOrg }) => {
    const { t } = useTranslation('manageStudentsStep4SubOrg');

    if (!subOrg.admins?.length) {
        return <p className="text-xs text-neutral-400">{t('adminList.noAdmins')}</p>;
    }

    return (
        <div className="flex flex-col gap-1.5">
            {subOrg.admins.map((admin) => (
                <div
                    key={admin.user_id ?? admin.email}
                    className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
                >
                    <UserCircle size={14} weight="duotone" className="shrink-0 text-primary-500" />
                    <span className="font-medium text-neutral-700">
                        {admin.name || t('adminList.unnamedAdmin')}
                    </span>
                    {admin.email ? (
                        <span className="inline-flex items-center gap-1 text-neutral-500">
                            <Envelope size={12} weight="duotone" />
                            {admin.email}
                        </span>
                    ) : (
                        <span className="text-neutral-300">{t('adminList.noEmailOnRecord')}</span>
                    )}
                    {admin.role && (
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-caption font-medium text-neutral-600">
                            {admin.role}
                        </span>
                    )}
                </div>
            ))}
        </div>
    );
};

const SubOrgConfigRow = ({ ps, onUpdate }: RowProps) => {
    const { t } = useTranslation('manageStudentsStep4SubOrg');
    const learnerTerm = getTerminology(RoleTerms.Learner, SystemTerms.Learner);

    const { data: subOrgs = [], isLoading } = useSubOrgsForPackageSession({
        packageSessionId: ps.packageSessionId,
    });

    const isSkipped = !!ps.subOrgSkipped;
    const isCreatingNew = !isSkipped && !ps.subOrgId && !!ps.newSubOrg;
    const pickerValue = isSkipped ? SKIP : (ps.subOrgId ?? (isCreatingNew ? CREATE_NEW : ''));
    const selectedSubOrg = subOrgs.find((s) => s.sub_org_id === ps.subOrgId);
    const role: SubOrgRoleChoice = ps.subOrgRole ?? 'STAFF';

    const handlePick = (value: string) => {
        if (value === SKIP) {
            onUpdate({
                subOrgSkipped: true,
                subOrgId: null,
                subOrgName: null,
                newSubOrg: undefined,
            });
            return;
        }
        if (value === CREATE_NEW) {
            onUpdate({
                subOrgSkipped: false,
                subOrgId: null,
                subOrgName: null,
                newSubOrg: { name: '' },
            });
            return;
        }
        const picked = subOrgs.find((s) => s.sub_org_id === value);
        onUpdate({
            subOrgSkipped: false,
            subOrgId: value,
            subOrgName: picked?.name ?? null,
            newSubOrg: undefined,
        });
    };

    return (
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
                <BookOpen size={16} weight="duotone" className="text-primary-500" />
                <div>
                    <p className="text-sm font-semibold text-neutral-800">{ps.courseName}</p>
                    <p className="text-xs text-neutral-400">{ps.levelName}</p>
                </div>
            </div>

            <div className="flex flex-col gap-4">
                <div>
                    <Label className="mb-1 text-xs text-neutral-500">{t('picker.label')}</Label>
                    {isLoading ? (
                        <Skeleton className="h-9 w-full" />
                    ) : (
                        <Select value={pickerValue} onValueChange={handlePick}>
                            <SelectTrigger>
                                <SelectValue placeholder={t('picker.placeholder')} />
                            </SelectTrigger>
                            <SelectContent className="z-popover-above-modal">
                                {subOrgs.map((subOrg) => (
                                    <SelectItem key={subOrg.sub_org_id} value={subOrg.sub_org_id}>
                                        {subOrg.name || subOrg.sub_org_id}
                                        {subOrg.member_count
                                            ? t('picker.memberCount', {
                                                  count: subOrg.member_count,
                                              })
                                            : ''}
                                    </SelectItem>
                                ))}
                                <SelectItem value={CREATE_NEW}>
                                    {t('picker.createNewOption')}
                                </SelectItem>
                                <SelectItem value={SKIP}>{t('picker.skipOption')}</SelectItem>
                            </SelectContent>
                        </Select>
                    )}
                    {!isLoading && subOrgs.length === 0 && (
                        <p className="mt-1 text-xs text-neutral-400">
                            {t('picker.emptyState')}
                        </p>
                    )}
                </div>

                {isSkipped && (
                    <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-xs text-neutral-600">
                        {t('skippedNotice', { learnerTerm: learnerTerm.toLowerCase() })}
                    </div>
                )}

                {selectedSubOrg && (
                    <div className="rounded-md border border-neutral-100 bg-neutral-50 px-3 py-2.5">
                        <p className="mb-1.5 text-xs font-semibold text-neutral-600">
                            {t('adminInfo.heading')}
                        </p>
                        <AdminList subOrg={selectedSubOrg} />
                        {selectedSubOrg.email && (
                            <p className="mt-2 text-caption text-neutral-400">
                                {t('adminInfo.contactLine', {
                                    email: selectedSubOrg.email,
                                    mobile: selectedSubOrg.mobile_number
                                        ? ` · ${selectedSubOrg.mobile_number}`
                                        : '',
                                })}
                            </p>
                        )}
                    </div>
                )}

                {isCreatingNew && (
                    <div className="flex flex-col gap-3 rounded-md border border-primary-100 bg-primary-50/40 px-3 py-3">
                        <p className="text-xs font-semibold text-primary-700">
                            {t('newOrgForm.heading')}
                        </p>
                        <div>
                            <Label className="mb-1 text-xs text-neutral-500">
                                {t('newOrgForm.nameLabel')}
                            </Label>
                            <Input
                                type="text"
                                placeholder={t('newOrgForm.namePlaceholder')}
                                value={ps.newSubOrg?.name ?? ''}
                                onChange={(e) =>
                                    onUpdate({
                                        newSubOrg: { ...ps.newSubOrg, name: e.target.value },
                                    })
                                }
                            />
                        </div>
                        <div className="flex flex-col gap-3 sm:flex-row">
                            <div className="flex-1">
                                <Label className="mb-1 text-xs text-neutral-500">
                                    {t('newOrgForm.emailLabel')}
                                </Label>
                                <Input
                                    type="email"
                                    placeholder={t('newOrgForm.emailPlaceholder')}
                                    value={ps.newSubOrg?.email ?? ''}
                                    onChange={(e) =>
                                        onUpdate({
                                            newSubOrg: {
                                                ...ps.newSubOrg,
                                                name: ps.newSubOrg?.name ?? '',
                                                email: e.target.value,
                                            },
                                        })
                                    }
                                />
                            </div>
                            <div className="flex-1">
                                <Label className="mb-1 text-xs text-neutral-500">
                                    {t('newOrgForm.phoneLabel')}
                                </Label>
                                <Input
                                    type="tel"
                                    placeholder={t('newOrgForm.phonePlaceholder')}
                                    value={ps.newSubOrg?.mobileNumber ?? ''}
                                    onChange={(e) =>
                                        onUpdate({
                                            newSubOrg: {
                                                ...ps.newSubOrg,
                                                name: ps.newSubOrg?.name ?? '',
                                                mobileNumber: e.target.value,
                                            },
                                        })
                                    }
                                />
                            </div>
                        </div>
                    </div>
                )}

                <div className={isSkipped ? 'hidden' : undefined}>
                    <Label className="mb-1 text-xs text-neutral-500">
                        {t('role.label')}
                    </Label>
                    <Select
                        value={role}
                        onValueChange={(v) => onUpdate({ subOrgRole: v as SubOrgRoleChoice })}
                    >
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="z-popover-above-modal">
                            <SelectItem value="STAFF">
                                {t('role.staffOption', { learnerTerm })}
                            </SelectItem>
                            <SelectItem value="ADMIN">
                                {t('role.adminOption', { learnerTerm })}
                            </SelectItem>
                            <SelectItem value="ADMIN_ONLY">
                                {t('role.adminOnlyOption')}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                    <p className="mt-1 text-xs text-neutral-400">
                        {role === 'ADMIN_ONLY'
                            ? t('role.adminOnlyDescription')
                            : role === 'ADMIN'
                              ? t('role.adminDescription')
                              : t('role.staffDescription')}
                    </p>
                </div>
            </div>
        </div>
    );
};

/**
 * Sub-org step — rendered only when at least one selected batch is flagged
 * `is_org_associated`. Those batches are sold to an organisation rather than to an
 * individual, so every enrollment has to say which organisation the member joins and what
 * role they hold inside it. Without this the backend would mint a fresh duplicate
 * organisation from the learner's (absent) custom-field answers.
 *
 * The choice is per batch and applies to every selected learner in the run.
 */
export const Step4SubOrg = ({
    selectedPackageSessions,
    onSelectedPackageSessionsChange,
}: Props) => {
    const { t } = useTranslation('manageStudentsStep4SubOrg');
    const learnersTerm = getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner);
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);

    const orgAssociated = selectedPackageSessions.filter((ps) => ps.isOrgAssociated);

    const updateSession = (packageSessionId: string, patch: Partial<SelectedPackageSession>) => {
        onSelectedPackageSessionsChange(
            selectedPackageSessions.map((ps) =>
                ps.packageSessionId === packageSessionId ? { ...ps, ...patch } : ps
            )
        );
    };

    if (orgAssociated.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <Buildings size={36} weight="duotone" className="text-neutral-300" />
                <p className="text-sm font-medium text-neutral-500">
                    {t('emptyState.heading', { batchTerm: batchTerm.toLowerCase() })}
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4 px-6 py-5">
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
                <Warning size={15} weight="fill" className="mt-0.5 shrink-0" />
                <span>
                    {t('warningBanner.message', {
                        count: orgAssociated.length,
                        learnerSingular: learnersTerm.toLowerCase().replace(/s$/, ''),
                        learnerPlural: learnersTerm.toLowerCase(),
                    })}
                </span>
            </div>

            <div className="flex flex-col gap-3">
                {orgAssociated.map((ps) => (
                    <SubOrgConfigRow
                        key={ps.packageSessionId}
                        ps={ps}
                        onUpdate={(patch) => updateSession(ps.packageSessionId, patch)}
                    />
                ))}
            </div>
        </div>
    );
};
