import { SessionData } from '@/types/study-library/session-types';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CalendarBlank, DotsThree, PencilSimple, TrashSimple } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { DeleteSessionDialog } from './deleteSessionDialog';
import { MyButton } from '@/components/design-system/button';
import { AddSessionDialog } from './session-operations/add-session/add-session-dialog';
import { useRef, useState } from 'react';
import { AddSessionDataType } from './session-operations/add-session/add-session-form';
import { useEditSession } from '@/services/study-library/session-management/editSession';
import { toast } from 'sonner';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { cn, convertCapitalToTitleCase } from '@/lib/utils';
import dayjs from 'dayjs';
import { CountChip, StatusPill } from '@/components/shared/crm-enhance/screen-header';
import { useTranslation } from 'react-i18next';

interface SessionCardProps {
    data: SessionData;
}

export function SessionCard({ data }: SessionCardProps) {
    const { t } = useTranslation('manageInstituteSessionCard');
    const [disableAddButton, setDisableAddButton] = useState(true);
    const editSessionMutation = useEditSession();

    const [isAddSessionDiaogOpen, setIsAddSessionDiaogOpen] = useState(false);
    const handleOpenAddSessionDialog = () => {
        setIsAddSessionDiaogOpen(!isAddSessionDiaogOpen);
    };

    const handleEditSession = (sessionData: AddSessionDataType) => {
        // Get all the selected package_session_ids from the form
        const allPackageSessionIds: string[] = [];
        data.packages.forEach((pkg) => {
            pkg.level.forEach((level) => {
                allPackageSessionIds.push(level.package_session_id);
            });
        });

        const visiblePackageSessionIds = sessionData.levels.map((level) => {
            return level.package_session_id;
        });

        const hiddenPackageSessionIds = allPackageSessionIds.filter((pksId) => {
            return !visiblePackageSessionIds.includes(pksId);
        });

        const commaSeparatedVisiblePackageSessionIds = visiblePackageSessionIds.join(',');
        const commaSeparatedHiddenPackageSessionIds = hiddenPackageSessionIds.join(',');

        const requestData = {
            comma_separated_hidden_package_session_ids: commaSeparatedHiddenPackageSessionIds,
            session_name: sessionData.session_name,
            start_date: sessionData.start_date,
            status: sessionData.status,
            comma_separated_visible_package_session_ids: commaSeparatedVisiblePackageSessionIds,
        };

        editSessionMutation.mutate(
            { requestData: requestData, sessionId: sessionData.id || '' },
            {
                onSuccess: () => {
                    toast.success(
                        t('toast.sessionEditedSuccess', {
                            term: getTerminology(ContentTerms.Session, SystemTerms.Session),
                        })
                    );
                    setIsAddSessionDiaogOpen(false);
                },
                onError: (error) => {
                    toast.error(
                        error.message ||
                            t('toast.sessionEditFailed', {
                                term: getTerminology(
                                    ContentTerms.Session,
                                    SystemTerms.Session
                                ).toLocaleLowerCase(),
                            })
                    );
                },
            }
        );
    };

    const formSubmitRef = useRef(() => { });

    const submitButton = (
        <div className="flex items-center justify-end">
            <MyButton
                type="submit"
                buttonType="primary"
                layoutVariant="default"
                scale="large"
                className="w-36"
                disable={disableAddButton}
                onClick={() => formSubmitRef.current()}
            >
                {t('button.saveChanges')}
            </MyButton>
        </div>
    );

    const submitFn = (fn: () => void) => {
        formSubmitRef.current = fn;
    };

    const sessionTerm = getTerminology(ContentTerms.Session, SystemTerms.Session);
    const start = data?.session?.start_date ? dayjs(data.session.start_date) : null;
    const isActive = data?.session?.status === 'ACTIVE';
    const batchCount = data?.packages.reduce(
        (sum, pkg) => sum + pkg.level.filter((l) => l.package_session_status === 'ACTIVE').length,
        0
    );
    const courseCount = data?.packages.filter((pkg) => pkg.level.length > 0).length;

    return (
        <div className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                        <CalendarBlank size={20} />
                    </span>
                    <div className="flex min-w-0 flex-col gap-0.5">
                        <p className="truncate text-title font-semibold text-neutral-800">
                            {convertCapitalToTitleCase(data?.session?.session_name)}
                        </p>
                        <p className="text-caption text-neutral-500">
                            {t('card.startDate')}
                            {': '}
                            {start?.isValid() ? start.format('DD MMM YYYY') : '—'}
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={isActive ? 'success' : 'neutral'}>
                        {isActive ? t('card.active') : t('card.inactive')}
                    </StatusPill>
                    <CountChip>
                        {t('card.courseCount', {
                            count: courseCount,
                            term: (courseCount === 1
                                ? getTerminology(ContentTerms.Course, SystemTerms.Course)
                                : getTerminologyPlural(ContentTerms.Course, SystemTerms.Course)
                            ).toLocaleLowerCase(),
                        })}
                    </CountChip>
                    <CountChip>
                        {t('card.batchCount', {
                            count: batchCount,
                            term: (batchCount === 1
                                ? getTerminology(ContentTerms.Batch, SystemTerms.Batch)
                                : getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch)
                            ).toLocaleLowerCase(),
                        })}
                    </CountChip>
                    <AddSessionDialog
                        isAddSessionDiaogOpen={isAddSessionDiaogOpen}
                        handleOpenAddSessionDialog={handleOpenAddSessionDialog}
                        handleSubmit={handleEditSession}
                        trigger={
                            <MyButton buttonType="secondary" scale="small" className="gap-1.5">
                                <PencilSimple size={14} />
                                {t('card.editButton', { term: sessionTerm })}
                            </MyButton>
                        }
                        initialValues={data}
                        submitButton={submitButton}
                        setDisableAddButton={setDisableAddButton}
                        submitFn={submitFn}
                    />
                    <DropdownMenu>
                        <DropdownMenuTrigger>
                            <Button
                                variant="outline"
                                className="size-8 bg-transparent p-1 shadow-none"
                                aria-label={t('card.moreActions')}
                            >
                                <DotsThree size={20} />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                            <DropdownMenuItem
                                className="cursor-pointer hover:bg-white"
                                onSelect={(e) => e.preventDefault()}
                            >
                                <DeleteSessionDialog
                                    triggerButton={
                                        <MyButton
                                            buttonType="text"
                                            className="gap-1.5 !text-danger-600"
                                        >
                                            <TrashSimple size={16} />
                                            {t('card.deleteButton', { term: sessionTerm })}
                                        </MyButton>
                                    }
                                    session={data}
                                />
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
            {data?.packages.some((pkg) => pkg.level.length > 0) ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {data.packages.map((item) =>
                        item.level.length > 0 ? (
                            <div
                                key={item.package_dto.id}
                                className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3"
                            >
                                <p className="truncate text-body font-semibold text-neutral-800">
                                    {convertCapitalToTitleCase(item?.package_dto.package_name)}
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                    {item.level.map((level) => {
                                        const hidden = level.package_session_status !== 'ACTIVE';
                                        return (
                                            <span
                                                key={level.package_session_id}
                                                title={hidden ? t('card.hiddenLevel') : undefined}
                                                className={cn(
                                                    'rounded-md border bg-white px-2 py-0.5 text-caption',
                                                    hidden
                                                        ? 'border-dashed border-neutral-300 text-neutral-400 line-through'
                                                        : 'border-neutral-200 text-neutral-700'
                                                )}
                                            >
                                                {convertCapitalToTitleCase(
                                                    level.level_dto.level_name
                                                )}
                                            </span>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : null
                    )}
                </div>
            ) : (
                <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-6 text-center text-caption text-neutral-500">
                    {t('card.noCourses', {
                        term: getTerminologyPlural(
                            ContentTerms.Course,
                            SystemTerms.Course
                        ).toLocaleLowerCase(),
                    })}
                </p>
            )}
        </div>
    );
}
