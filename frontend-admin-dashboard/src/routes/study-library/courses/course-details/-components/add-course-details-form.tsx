// add-subject-form.tsx
import { MyInput } from '@/components/design-system/input';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { useRouter } from '@tanstack/react-router';
import { useSelectedSessionStore } from '@/stores/study-library/selected-session-store';
import { Checkbox } from '@/components/ui/checkbox';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { AddSessionInput } from '@/components/design-system/add-session-input';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

const formSchema = z.object({
    id: z.string().optional(),
    new_level: z.boolean(),
    level_name: z.string(),
    duration_in_days: z.number(),
    thumbnail_file_id: z.string().nullable(),
    is_parent: z.boolean().optional(),
    parent_id: z.string().nullable().optional(),
    sessions: z.array(
        z.object({
            id: z.string(),
            new_session: z.boolean().optional(),
            session_name: z.string(),
            status: z.string(),
            start_date: z.string().optional(),
        })
    ),
});

export type AddLevelData = z.infer<typeof formSchema>;

interface Session {
    id: string;
    session_name: string;
    status: string;
    start_date?: string;
}

interface AddLevelFormProps {
    onSubmitSuccess: ({
        requestData,
        packageId,
        sessionId,
    }: {
        requestData: AddLevelData;
        packageId?: string;
        sessionId?: string;
        levelId?: string;
    }) => void;
    initialValues?: AddLevelData;
    setOpenDialog: Dispatch<SetStateAction<boolean>>;
    submitForm: (submitFn: () => void) => void;
    packageId?: string;
}

export const AddCourseDetailsForm = ({
    onSubmitSuccess,
    initialValues,
    setOpenDialog,
    submitForm,
    packageId,
}: AddLevelFormProps) => {
    const { t } = useTranslation('studyLibraryAddCourseDetailsForm');
    const [newSessionName, setNewSessionName] = useState('');
    const { instituteDetails, getAllSessions } = useInstituteDetailsStore();
    const [sessionList, setSessionList] = useState<Session[]>(getAllSessions);
    const [newSessionStartDate, setNewSessionStartDate] = useState<string>('');

    const route = useRouter();
    const search = route.state.location.search;
    const courseId: string = packageId ? packageId : search.courseId || '';
    const { selectedSession } = useSelectedSessionStore();

    const handleAddSession = (sessionName: string, startDate: string) => {
        const newSession = {
            id: '',
            new_session: true,
            session_name: sessionName,
            status: 'INACTIVE',
            start_date: startDate,
        };
        setSessionList((prevSessionList) => [...prevSessionList, newSession]);
    };

    useEffect(() => {
        setSessionList(getAllSessions);
    }, [instituteDetails]);

    const form = useForm<AddLevelData>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            id: initialValues?.id || '',
            level_name: initialValues?.level_name || '',
            new_level: initialValues?.new_level || true,
            duration_in_days: initialValues?.duration_in_days || 0,
            thumbnail_file_id: null,
            is_parent: initialValues?.is_parent ?? false,
            parent_id: initialValues?.parent_id ?? null,
            sessions: [],
        },
    });

    const onSubmit = (data: AddLevelData) => {
        const submissionData = {
            ...data,
            status: 'ACTIVE',
        };
        onSubmitSuccess({
            packageId: packageId ? packageId : courseId,
            sessionId: selectedSession?.id || '',
            requestData: submissionData,
        });
        setOpenDialog(false);
    };

    const requestSubmitFn = () => {
        if (formRef.current) {
            formRef.current.requestSubmit();
        }
    };

    const formRef = useRef<HTMLFormElement>(null);
    useEffect(() => {
        if (submitForm) {
            submitForm(requestSubmitFn);
        }
    }, [submitForm]);

    return (
        <Form {...form}>
            <form
                ref={formRef}
                onSubmit={(e) => {
                    form.handleSubmit(onSubmit)(e);
                }}
                className="flex max-h-[80vh] flex-col gap-6 overflow-y-auto p-2 text-neutral-600"
            >
                <FormField
                    control={form.control}
                    name="level_name"
                    render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <MyInput
                                    label={getTerminology(ContentTerms.Level, SystemTerms.Level)}
                                    required={true}
                                    inputType="text"
                                    inputPlaceholder={t('enterName', {
                                        label: getTerminology(
                                            ContentTerms.Level,
                                            SystemTerms.Level
                                        ).toLowerCase(),
                                    })}
                                    className="w-[352px]"
                                    input={field.value}
                                    onChangeFunction={(e) => field.onChange(e.target.value)}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="duration_in_days"
                    render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <MyInput
                                    label={t('durationDays')}
                                    required={true}
                                    inputType="number"
                                    inputPlaceholder={t('enterDurationInDays')}
                                    className="w-[352px]"
                                    input={field.value?.toString() || ''}
                                    onChangeFunction={(e) =>
                                        field.onChange(Math.floor(Number(e.target.value)))
                                    }
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <div className="flex flex-col gap-6">
                    {!initialValues && (
                        <>
                            <FormField
                                control={form.control}
                                name="sessions"
                                render={({ field }) => (
                                    <FormItem className="w-full">
                                        <FormControl>
                                            <div className="me-4 flex flex-col gap-2 rounded-lg border border-neutral-200 p-4">
                                                {t('sessions')}
                                                {sessionList.map((session) => (
                                                    <div
                                                        key={session.id}
                                                        className="flex items-center gap-3 rounded-md p-2 hover:bg-neutral-50"
                                                    >
                                                        <Checkbox
                                                            className="data-[state=checked]:bg-primary-500 data-[state=checked]:text-white"
                                                            checked={
                                                                field.value?.some(
                                                                    (s) => s.id === session.id
                                                                ) ?? false
                                                            }
                                                            onCheckedChange={(checked) => {
                                                                const sessions = [
                                                                    ...(field.value || []),
                                                                ];
                                                                if (checked) {
                                                                    sessions.push({
                                                                        ...session,
                                                                        new_session:
                                                                            session.id === '',
                                                                    });
                                                                } else {
                                                                    const index =
                                                                        sessions.findIndex(
                                                                            (s) =>
                                                                                s.id === session.id
                                                                        );
                                                                    if (index !== -1) {
                                                                        sessions.splice(index, 1);
                                                                    }
                                                                }
                                                                field.onChange(sessions);
                                                            }}
                                                        />
                                                        <div className="flex flex-col items-center text-sm">
                                                            <p className="text-sm">
                                                                {session.session_name}
                                                            </p>
                                                            <p className="text-caption text-neutral-400">
                                                                {t('startDate', {
                                                                    date: session.start_date,
                                                                })}
                                                            </p>
                                                        </div>
                                                    </div>
                                                ))}
                                                <AddSessionInput
                                                    newSessionName={newSessionName}
                                                    setNewSessionName={setNewSessionName}
                                                    newSessionStartDate={newSessionStartDate}
                                                    setNewSessionStartDate={setNewSessionStartDate}
                                                    handleAddSession={handleAddSession}
                                                />
                                            </div>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </>
                    )}
                </div>
            </form>
        </Form>
    );
};
