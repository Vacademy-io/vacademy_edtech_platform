import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import type { TFunction } from 'i18next';
import { FileArrowUp, FilePdf, UploadSimple, WarningCircle, X } from '@phosphor-icons/react';
import { FileUploadComponent } from '@/components/design-system/file-upload';
import { MyButton } from '@/components/design-system/button';
import { Form } from '@/components/ui/form';
import { AttachmentSlot, OfflineAttachmentFiles } from '../-utils/types';

interface SlotConfig {
    slot: AttachmentSlot;
    label: string;
    hint: string;
}

// The three artifacts a pen-and-paper exam leaves behind. Each one lands in a
// different place on the attempt (see attachOfflineFiles), so they are collected
// separately rather than as one generic "attachments" list.
const buildSlots = (t: TFunction): SlotConfig[] => [
    {
        slot: 'student',
        label: t('slots.student.label'),
        hint: t('slots.student.hint'),
    },
    {
        slot: 'checked',
        label: t('slots.checked.label'),
        hint: t('slots.checked.hint'),
    },
    {
        slot: 'report',
        label: t('slots.report.label'),
        hint: t('slots.report.hint'),
    },
];

interface OfflineAttachmentsPanelProps {
    files: OfflineAttachmentFiles;
    onChange: (files: OfflineAttachmentFiles) => void;
    disabled?: boolean;
    /** Failure from the parent's submit (e.g. an upload that didn't go through). */
    error?: string | null;
}

// Validated here rather than handed to the dropzone's `accept`: react-dropzone
// drops a rejected file on the floor without telling anyone, so a dragged-in
// .docx just silently did nothing. Checking it ourselves means we can say why.
const isAcceptedPdf = (file: File): boolean =>
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

const describeRejection = (file: File): string | null => {
    if (!isAcceptedPdf(file)) {
        return i18next.t('assessmentOfflineAttachmentsPanel:rejections.notPdf', {
            fileName: file.name,
        });
    }
    if (file.size === 0) {
        return i18next.t('assessmentOfflineAttachmentsPanel:rejections.emptyFile', {
            fileName: file.name,
        });
    }
    return null;
};

interface AttachmentsForm {
    student: FileList | null;
    checked: FileList | null;
    report: FileList | null;
}

/**
 * Optional PDF attachments for an offline data entry. Files are only held in
 * component state here — the parent uploads them to S3 and attaches them to the
 * attempt on submit, so abandoning the entry never leaves orphaned uploads.
 */
export const OfflineAttachmentsPanel = ({
    files,
    onChange,
    disabled = false,
    error = null,
}: OfflineAttachmentsPanelProps) => {
    const { t } = useTranslation('assessmentOfflineAttachmentsPanel');
    const slots = buildSlots(t);
    const [rejections, setRejections] = useState<Partial<Record<AttachmentSlot, string>>>({});
    const form = useForm<AttachmentsForm>({
        defaultValues: { student: null, checked: null, report: null },
    });
    const studentInputRef = useRef<HTMLInputElement | null>(null);
    const checkedInputRef = useRef<HTMLInputElement | null>(null);
    const reportInputRef = useRef<HTMLInputElement | null>(null);
    const inputRefs: Record<AttachmentSlot, React.MutableRefObject<HTMLInputElement | null>> = {
        student: studentInputRef,
        checked: checkedInputRef,
        report: reportInputRef,
    };

    const setRejection = (slot: AttachmentSlot, message: string | null) =>
        setRejections((prev) => {
            const next = { ...prev };
            if (message) next[slot] = message;
            else delete next[slot];
            return next;
        });

    const setFile = (slot: AttachmentSlot, file: File | undefined) => {
        if (file) {
            const rejection = describeRejection(file);
            if (rejection) {
                // Keep whatever was already attached — replacing a good file with
                // nothing because the new pick was bad loses the admin's work.
                setRejection(slot, rejection);
                return;
            }
        }
        setRejection(slot, null);
        const next = { ...files };
        if (file) next[slot] = file;
        else delete next[slot];
        onChange(next);
    };

    const attachedCount = slots.filter(({ slot }) => files[slot]).length;

    return (
        <section className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="mb-1 flex flex-wrap items-center gap-2">
                <FilePdf className="size-5 text-primary-500" />
                <h2 className="text-subtitle font-semibold text-neutral-700">{t('header.title')}</h2>
                <span className="text-caption text-neutral-400">
                    {t('header.optionalPdfOnly')}
                    {attachedCount > 0
                        ? ` ${t('header.selectedCount', { count: attachedCount })}`
                        : ''}
                </span>
            </div>
            <p className="mb-4 text-caption text-neutral-500">{t('description')}</p>

            {error && (
                <div
                    role="alert"
                    className="mb-4 flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 p-3"
                >
                    <WarningCircle className="mt-0.5 size-4 shrink-0 text-danger-600" />
                    <p className="text-caption text-danger-700">{error}</p>
                </div>
            )}

            <Form {...form}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {slots.map(({ slot, label, hint }) => {
                        const file = files[slot];
                        const rejection = rejections[slot];
                        return (
                            <div key={slot} className="flex flex-col gap-2">
                                <div>
                                    <p className="text-body font-medium text-neutral-700">{label}</p>
                                    <p className="text-caption text-neutral-400">{hint}</p>
                                </div>

                                <FileUploadComponent
                                    fileInputRef={inputRefs[slot]}
                                    onFileSubmit={(picked) => setFile(slot, picked)}
                                    control={form.control}
                                    name={slot}
                                    // No `acceptedFileTypes`: it makes the dropzone
                                    // discard non-PDFs before we ever see them, so a
                                    // dragged-in .docx failed silently. We validate
                                    // in setFile and say what was wrong instead.
                                    isUploading={disabled}
                                    error={rejection}
                                >
                                    {file ? (
                                        <div className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 p-3">
                                            <div className="flex items-center gap-2 overflow-hidden">
                                                <FileArrowUp className="size-5 shrink-0 text-primary-500" />
                                                <span className="truncate text-caption text-neutral-700">
                                                    {file.name}
                                                </span>
                                            </div>
                                            <MyButton
                                                buttonType="secondary"
                                                scale="small"
                                                layoutVariant="icon"
                                                type="button"
                                                disable={disabled}
                                                aria-label={t('removeAria', { label })}
                                                // Stop the dropzone (the parent) from
                                                // re-opening the file picker on remove.
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setFile(slot, undefined);
                                                }}
                                            >
                                                <X className="size-3" />
                                            </MyButton>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-neutral-300 p-6 text-center hover:border-primary-300">
                                            <UploadSimple className="size-6 text-neutral-400" />
                                            <p className="text-caption font-medium text-neutral-700">
                                                {t('dropzone.uploadPrompt')}
                                            </p>
                                        </div>
                                    )}
                                </FileUploadComponent>
                            </div>
                        );
                    })}
                </div>
            </Form>
        </section>
    );
};
