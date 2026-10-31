import { useAddSession } from '@/services/study-library/session-management/addSession';
import { AddSessionDialog } from './session-operations/add-session/add-session-dialog';
import { AddSessionDataType } from './session-operations/add-session/add-session-form';
import { toast } from 'sonner';
import { ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { CalendarDots, Plus } from '@phosphor-icons/react';
import { ScreenHeader } from '@/components/shared/crm-enhance/screen-header';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { NoCourseDialog } from '@/components/common/students/no-course-dialog';
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

export default function SessionHeader({ actions }: { actions?: ReactNode } = {}) {
    const { t } = useTranslation('manageInstituteSessionHeader');
    const [disableAddButton, setDisableAddButton] = useState(true);
    const { instituteDetails } = useInstituteDetailsStore();
    const addSessionMutation = useAddSession();
    const [isAddSessionDiaogOpen, setIsAddSessionDiaogOpen] = useState(false);
    const handleOpenAddSessionDialog = () => {
        setIsAddSessionDiaogOpen(!isAddSessionDiaogOpen);
    };
    const [isOpen, setIsOpen] = useState(false);
    const handleAddSession = (sessionData: AddSessionDataType) => {
        const processedData = structuredClone(sessionData);

        const transformedData = {
            ...processedData,
            levels: processedData.levels.map((level) => ({
                id: level.level_dto.id,
                new_level: level.level_dto.new_level === true,
                level_name: level.level_dto.level_name,
                duration_in_days: level.level_dto.duration_in_days,
                thumbnail_file_id: level.level_dto.thumbnail_file_id,
                package_id: level.level_dto.package_id,
            })),
        };

        // Use type assertion since we know this is the correct format for the API
        addSessionMutation.mutate(
            { requestData: transformedData as unknown as AddSessionDataType },
            {
                onSuccess: () => {
                    toast.success(
                        t('toast.added', {
                            session: getTerminology(ContentTerms.Session, SystemTerms.Session),
                        })
                    );
                    setIsAddSessionDiaogOpen(false);
                },
                onError: (error) => {
                    toast.error(
                        error.message ||
                        t('toast.addFailed', {
                            session: getTerminology(
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
                {t('add')}
            </MyButton>
        </div>
    );

    const submitFn = (fn: () => void) => {
        formSubmitRef.current = fn;
    };

    const sessionTerm = getTerminology(ContentTerms.Session, SystemTerms.Session);
    const addButtonLabel = t('addNew', { session: sessionTerm });

    return (
        <ScreenHeader
            icon={CalendarDots}
            title={t('manageYourSessions', { session: sessionTerm })}
            subtitle={t('subtitle', {
                session: sessionTerm.toLocaleLowerCase(),
                course: getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase(),
                level: getTerminology(ContentTerms.Level, SystemTerms.Level).toLocaleLowerCase(),
                batch: getTerminology(ContentTerms.Batch, SystemTerms.Batch).toLocaleLowerCase(),
                learnerPlural: getTerminologyPlural(
                    RoleTerms.Learner,
                    SystemTerms.Learner
                ).toLocaleLowerCase(),
            })}
            actions={
                <>
                    {actions}
                    {!instituteDetails?.batches_for_sessions.length ? (
                        <NoCourseDialog
                            isOpen={isOpen}
                            setIsOpen={setIsOpen}
                            type={t('noCourseDialog.type')}
                            content={t('noCourseDialog.content')}
                            trigger={
                                <MyButton scale="large">
                                    <Plus /> {addButtonLabel}
                                </MyButton>
                            }
                        />
                    ) : (
                        <AddSessionDialog
                            isAddSessionDiaogOpen={isAddSessionDiaogOpen}
                            handleOpenAddSessionDialog={handleOpenAddSessionDialog}
                            handleSubmit={handleAddSession}
                            trigger={
                                <div className="flex flex-col items-center gap-1">
                                    <MyButton
                                        scale="large"
                                        disable={!instituteDetails?.batches_for_sessions.length}
                                    >
                                        <Plus /> {addButtonLabel}
                                    </MyButton>
                                </div>
                            }
                            submitButton={submitButton}
                            setDisableAddButton={setDisableAddButton}
                            submitFn={submitFn}
                        />
                    )}
                </>
            }
        />
    );
}
