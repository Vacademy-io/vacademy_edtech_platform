import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { FormProvider } from 'react-hook-form';
import { FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { MyInput } from '@/components/design-system/input';
import AddVideoQuestionDialog from './slides-sidebar/add-video-question-dialog';
import { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { UseFormReturn } from 'react-hook-form';
import { UploadQuestionPaperFormType } from '@/routes/assessment/question-papers/-components/QuestionPaperUpload';
import { VideoPlayerTimeFormType } from '../-form-schemas/video-player-time-schema';
import { uploadQuestionPaperFormSchema } from '@/routes/assessment/question-papers/-utils/upload-question-paper-form-schema';
import { z } from 'zod';
import { Switch } from '@/components/ui/switch';
import { getDisplaySettingsFromCache } from '@/services/display-settings';
import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';

type QuestionPaperForm = z.infer<ReturnType<typeof uploadQuestionPaperFormSchema>>;

interface VideoQuestionsTimeFrameDialogProps {
    addedQuestionForm: UseFormReturn<QuestionPaperForm>;
    videoQuestionForm: UseFormReturn<QuestionPaperForm>;
    formRefData: MutableRefObject<UploadQuestionPaperFormType>;
    videoPlayerTimeFrameForm: UseFormReturn<VideoPlayerTimeFormType>; // Replace `any` with your form schema if available
    handleSetCurrentTimeStamp: () => void;
    currentQuestionIndex: number;
    setCurrentQuestionIndex: Dispatch<SetStateAction<number>>;
    previewQuestionDialog: boolean;
    setPreviewQuestionDialog: Dispatch<SetStateAction<boolean>>;
    formData: UploadQuestionPaperFormType;
    setFormData: Dispatch<SetStateAction<UploadQuestionPaperFormType>>;
    isAddTimeFrameRef: React.RefObject<HTMLButtonElement>;
    isAddQuestionTypeRef: React.RefObject<HTMLButtonElement>;
    videoDuration: number;
}

const VideoQuestionsTimeFrameAddDialog = ({
    addedQuestionForm,
    videoQuestionForm,
    formRefData,
    videoPlayerTimeFrameForm,
    handleSetCurrentTimeStamp,
    currentQuestionIndex,
    setCurrentQuestionIndex,
    previewQuestionDialog,
    setPreviewQuestionDialog,
    formData,
    setFormData,
    isAddTimeFrameRef,
    isAddQuestionTypeRef,
    videoDuration,
}: VideoQuestionsTimeFrameDialogProps) => {
    const { t } = useTranslation('studyLibraryVideoQuestionsAddTimeframe');
    // Per-role Display Setting (Settings → Display Settings → Course Permission).
    // Hide the entire "Add Question" affordance when disabled for this role.
    // Fail-open: if settings aren't cached yet, the button stays visible.
    const slideView = getDisplaySettingsFromCache(getActiveRoleDisplaySettingsKey())?.slideView;
    if (slideView?.showAddVideoQuestion === false) return null;

    return (
        <Dialog>
            <DialogTrigger>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="large"
                    layoutVariant="default"
                    className="mt-4"
                >
                    {t('addQuestion')}
                </MyButton>
            </DialogTrigger>
            <DialogContent className="w-full max-w-md p-0">
                <h1 className="rounded-t-lg bg-primary-50 p-4 font-semibold text-primary-500">
                    {t('timeStamp')}
                </h1>
                <FormProvider {...videoPlayerTimeFrameForm}>
                    <form className="flex flex-col items-center gap-2 p-3 sm:p-4">
                        <div className="flex flex-wrap items-center justify-center gap-2 p-2 sm:gap-3 sm:p-4">
                            <FormField
                                control={videoPlayerTimeFrameForm.control}
                                name={`hrs`}
                                render={({ field: { ...field } }) => (
                                    <FormItem>
                                        <FormControl>
                                            <MyInput
                                                inputType="text"
                                                inputPlaceholder="00"
                                                input={field.value}
                                                onKeyPress={(e) => {
                                                    const charCode = e.key;
                                                    if (!/[0-9]/.test(charCode)) {
                                                        e.preventDefault(); // Prevent non-numeric input
                                                    }
                                                }}
                                                onChangeFunction={(e) => {
                                                    const inputValue = e.target.value.replace(
                                                        /[^0-9]/g,
                                                        ''
                                                    ); // Remove non-numeric characters
                                                    field.onChange(inputValue); // Call onChange with the sanitized value
                                                }}
                                                size="large"
                                                {...field}
                                                className="w-14 sm:w-16"
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <span>{t('hrs')}</span>
                            <span>:</span>
                            <FormField
                                control={videoPlayerTimeFrameForm.control}
                                name={`min`}
                                render={({ field: { ...field } }) => (
                                    <FormItem>
                                        <FormControl>
                                            <MyInput
                                                inputType="text"
                                                inputPlaceholder="00"
                                                input={field.value}
                                                onKeyPress={(e) => {
                                                    const charCode = e.key;
                                                    if (!/[0-9]/.test(charCode)) {
                                                        e.preventDefault(); // Prevent non-numeric input
                                                    }
                                                }}
                                                onChangeFunction={(e) => {
                                                    const inputValue = e.target.value.replace(
                                                        /[^0-9]/g,
                                                        ''
                                                    ); // Remove non-numeric characters
                                                    field.onChange(inputValue); // Call onChange with the sanitized value
                                                }}
                                                size="large"
                                                {...field}
                                                className="w-14 sm:w-16"
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <span>{t('min')}</span>
                            <span>:</span>
                            <FormField
                                control={videoPlayerTimeFrameForm.control}
                                name={`sec`}
                                render={({ field: { ...field } }) => (
                                    <FormItem>
                                        <FormControl>
                                            <MyInput
                                                inputType="text"
                                                inputPlaceholder="00"
                                                input={field.value}
                                                onKeyPress={(e) => {
                                                    const charCode = e.key;
                                                    if (!/[0-9]/.test(charCode)) {
                                                        e.preventDefault(); // Prevent non-numeric input
                                                    }
                                                }}
                                                onChangeFunction={(e) => {
                                                    const inputValue = e.target.value.replace(
                                                        /[^0-9]/g,
                                                        ''
                                                    ); // Remove non-numeric characters
                                                    field.onChange(inputValue); // Call onChange with the sanitized value
                                                }}
                                                size="large"
                                                {...field}
                                                className="w-14 sm:w-16"
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <span>{t('sec')}</span>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="medium"
                                layoutVariant="default"
                                className="mt-2 w-full sm:mt-0 sm:w-auto"
                                onClick={handleSetCurrentTimeStamp}
                            >
                                {t('useCurrentPosition')}
                            </MyButton>
                        </div>
                        <div className="mb-2 w-full px-2 sm:px-4">
                            <FormField
                                control={videoPlayerTimeFrameForm.control}
                                name="canSkip"
                                render={({ field }) => (
                                    <FormItem className="flex w-full items-center justify-between gap-4">
                                        <FormLabel>
                                            {t('allowSkip')}
                                            <span className="text-subtitle text-danger-600">*</span>
                                        </FormLabel>
                                        <FormControl>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        </div>
                        <div className="flex w-full justify-end">
                            <AddVideoQuestionDialog
                                addedQuestionForm={addedQuestionForm}
                                videoQuestionForm={videoQuestionForm}
                                videoPlayerTimeFrameForm={videoPlayerTimeFrameForm}
                                formRefData={formRefData}
                                currentQuestionIndex={currentQuestionIndex}
                                setCurrentQuestionIndex={setCurrentQuestionIndex}
                                previewQuestionDialog={previewQuestionDialog}
                                setPreviewQuestionDialog={setPreviewQuestionDialog}
                                formData={formData}
                                setFormData={setFormData}
                                isAddTimeFrameRef={isAddTimeFrameRef}
                                isAddQuestionTypeRef={isAddQuestionTypeRef}
                                videoDuration={videoDuration}
                            />
                        </div>
                    </form>
                </FormProvider>
                <DialogClose asChild>
                    <button ref={isAddTimeFrameRef} className="hidden" />
                </DialogClose>
            </DialogContent>
        </Dialog>
    );
};

export default VideoQuestionsTimeFrameAddDialog;
