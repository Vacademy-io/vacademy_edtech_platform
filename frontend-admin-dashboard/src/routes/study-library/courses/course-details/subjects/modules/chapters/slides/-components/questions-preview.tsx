import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { MainViewComponentFactory } from '@/routes/assessment/question-papers/-components/QuestionPaperTemplatesTypes/MainViewComponentFactory';
import { UploadQuestionPaperFormType } from '@/routes/assessment/question-papers/-components/QuestionPaperUpload';
import { uploadQuestionPaperFormSchema } from '@/routes/assessment/question-papers/-utils/upload-question-paper-form-schema';
import { QuestionType } from '@/constants/dummy-data';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Slide } from '../-hooks/use-slides';
import { useContentStore } from '../-stores/chapter-sidebar-store';
import { mergeCbeSecret } from '@/components/cbe/types';
import {
    ensureCbeConfig,
    isCbeQuestionType,
} from '@/routes/assessment/question-papers/-utils/cbe-question';
import { CbeSlideSecretContext } from '@/routes/assessment/question-papers/-components/QuestionPaperTemplatesTypes/CbeResponse/cbe-slide-secret-context';
import { fetchQuestionSlideCbeSecret } from '../-services/cbe-evaluation-secret';

export const StudyLibraryQuestionsPreview = ({ activeItem }: { activeItem: Slide }) => {
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const { setItems, setActiveItem, items } = useContentStore();

    const form = useForm<UploadQuestionPaperFormType>({
        resolver: zodResolver(uploadQuestionPaperFormSchema()),
        mode: 'onChange',
        defaultValues: {
            questionPaperId: '1',
            isFavourite: false,
            title: '',
            createdOn: new Date(),
            yearClass: '',
            subject: '',
            questionsType: '',
            optionsType: '',
            answersType: '',
            explanationsType: '',
            fileUpload: undefined,
            questions: [activeItem.question_slide || {}],
        },
    });

    const { watch } = form;

    useEffect(() => {
        form.reset({
            ...form.getValues(),
            questions: [activeItem.question_slide || {}],
        });
    }, [activeItem.question_slide]);

    useEffect(() => {
        const subscription = watch((_, { name }) => {
            if (name?.startsWith('questions')) {
                setActiveItem({
                    ...activeItem,
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-expect-error
                    question_slide: form.getValues(`questions.${currentQuestionIndex}`),
                });
            }
        });

        return () => subscription.unsubscribe(); // cleanup
    }, [watch, items, activeItem, form, setItems]);

    // ---- Spreadsheet & Written Response: the slide's stored secret ----------
    // The slide JSON carries only the learner-safe config; the solution, marking
    // scheme and grading notes are read from the admin endpoint and merged into
    // the form. Until that succeeds they stay locked, and a save sends no secret
    // (the stored one is kept).
    const slideQuestion = activeItem.question_slide as
        | { questionType?: string; cbeSecretStatus?: string }
        | undefined;
    const isCbe = isCbeQuestionType(slideQuestion?.questionType);
    const slideId = activeItem.id;
    const loadToken = useRef(0);

    const loadCbeSecret = useCallback(async () => {
        const token = ++loadToken.current;
        form.setValue('questions.0.cbeSecretStatus', 'loading', { shouldDirty: false });
        try {
            const secret = await fetchQuestionSlideCbeSecret(slideId);
            if (token !== loadToken.current) return;
            const merged = mergeCbeSecret(
                ensureCbeConfig(form.getValues('questions.0.cbeConfig')),
                secret
            );
            form.setValue('questions.0.cbeConfig', merged, { shouldDirty: false });
            form.setValue('questions.0.cbeSecretStatus', 'owned', { shouldDirty: false });
        } catch (error) {
            if (token !== loadToken.current) return;
            console.error('[cbe] could not load the slide solution', error);
            form.setValue('questions.0.cbeSecretStatus', 'failed', { shouldDirty: false });
        }
    }, [form, slideId]);

    // Load whenever the slide's question arrives without its secret: on open, and
    // again when a refetch replaces the question (that copy is redacted too).
    // `failed` waits for the editor's Retry; `loading` / `owned` need nothing.
    const storeSecretStatus = slideQuestion?.cbeSecretStatus;
    useEffect(() => {
        if (!isCbe || !slideId || storeSecretStatus !== undefined) return;
        void loadCbeSecret();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isCbe, slideId, storeSecretStatus]);
    // An answer that arrives after unmount is dropped.
    useEffect(
        () => () => {
            loadToken.current += 1;
        },
        []
    );

    const cbeSecretContext = useMemo(
        () => (isCbe ? { retry: () => void loadCbeSecret() } : null),
        [isCbe, loadCbeSecret]
    );

    return (
        <div key={`question-${activeItem.id}`} className="size-full">
            <FormProvider {...form}>
                <CbeSlideSecretContext.Provider value={cbeSecretContext}>
                    <MainViewComponentFactory
                        key={currentQuestionIndex}
                        type={
                            form.getValues(
                                `questions.${currentQuestionIndex}.questionType`
                            ) as QuestionType
                        }
                        props={{
                            form,
                            currentQuestionIndex,
                            setCurrentQuestionIndex,
                            className:
                                'dialog-height overflow-auto ml-6 flex w-full flex-col gap-6 pr-6 pt-4',
                        }}
                    />
                </CbeSlideSecretContext.Provider>
            </FormProvider>
        </div>
    );
};
