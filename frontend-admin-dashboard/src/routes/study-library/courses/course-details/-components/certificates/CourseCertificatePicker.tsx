import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Star } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import {
    readTemplateLibrary,
    type SavedCertificateTemplate,
} from '@/routes/settings/-utils/certificate-template-library';

/**
 * Which certificate this course hands out.
 *
 * <p>Reads the institute's saved designs straight from the settings blob the
 * store already holds — the same list Settings → Certificates shows. There is no
 * separate per-course template library, and there should not be: a course
 * choosing a design is choosing one of the institute's, not inventing one.
 *
 * <p>A choice here is stored as an <b>id</b>, so the course follows that design
 * rather than freezing a copy of it. Editing the template in Settings updates
 * every course pointing at it; that is the whole difference between this and the
 * upload below it.
 */
export interface CourseTemplateChoice {
    /** A saved institute design, by id. */
    templateId: string | null;
    /** HTML uploaded for this course alone. */
    templateHtml: string | null;
}

interface Props {
    value: CourseTemplateChoice;
    onChange: (next: CourseTemplateChoice) => void;
    disabled?: boolean;
}

/** The institute's saved designs and which of them is its default. */
export const useInstituteTemplates = (): {
    templates: SavedCertificateTemplate[];
    defaultTemplateId: string | null;
} => {
    const { instituteDetails } = useInstituteDetailsStore();
    const settingString = instituteDetails?.setting || '';
    return useMemo(() => {
        try {
            const parsed = JSON.parse(settingString || '{}');
            const record = parsed?.setting?.CERTIFICATE_SETTING?.data?.data?.[0];
            const editorJson = record?.imageTemplateJson;
            if (!editorJson) return { templates: [], defaultTemplateId: null };
            const { library, defaultTemplateId } = readTemplateLibrary(JSON.parse(editorJson));
            return { templates: library, defaultTemplateId };
        } catch {
            return { templates: [], defaultTemplateId: null };
        }
    }, [settingString]);
};

export const CourseCertificatePicker = ({ value, onChange, disabled }: Props) => {
    const { t } = useTranslation('studyLibraryCourseCertificatePicker');
    const { templates, defaultTemplateId } = useInstituteTemplates();

    // A course with its own uploaded HTML is on neither card; the upload block
    // below the picker owns that state and says so.
    const usingOwnUpload = !value.templateId && !!value.templateHtml;
    const inheriting = !value.templateId && !value.templateHtml;

    const defaultName =
        templates.find((template) => template.id === defaultTemplateId)?.name ??
        t('theInstituteTemplate');

    return (
        <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange({ templateId: null, templateHtml: null })}
                    className={cn(
                        'flex flex-col overflow-hidden rounded-md border text-left transition-all',
                        inheriting
                            ? 'border-primary-500 ring-2 ring-primary-100'
                            : 'border-neutral-200 hover:border-primary-300',
                        disabled && 'cursor-not-allowed opacity-60'
                    )}
                >
                    <div className="flex aspect-[1123/794] w-full flex-col items-center justify-center gap-1 bg-neutral-50 px-2 text-center">
                        <Star size={20} weight="fill" className="text-amber-500" />
                        <span className="text-caption text-neutral-500">
                            {t('whateverTheInstituteDefaultIs')}
                        </span>
                    </div>
                    <div className="border-t px-2.5 py-2">
                        <div className="truncate text-caption font-semibold text-neutral-800">
                            {t('instituteDefault')}
                        </div>
                        <div className="truncate text-caption text-neutral-500">{defaultName}</div>
                    </div>
                </button>

                {templates.map((template) => {
                    const selected = value.templateId === template.id;
                    return (
                        <button
                            key={template.id}
                            type="button"
                            disabled={disabled}
                            // Choosing a saved design clears any HTML this course
                            // had uploaded — otherwise two designs would be set
                            // and only one could be issued.
                            onClick={() =>
                                onChange({ templateId: template.id, templateHtml: null })
                            }
                            className={cn(
                                'relative flex flex-col overflow-hidden rounded-md border text-left transition-all',
                                selected
                                    ? 'border-primary-500 ring-2 ring-primary-100'
                                    : 'border-neutral-200 hover:border-primary-300',
                                disabled && 'cursor-not-allowed opacity-60'
                            )}
                        >
                            <div className="relative aspect-[1123/794] w-full bg-neutral-50">
                                <img
                                    src={template.imageTemplate.imageDataUrl}
                                    alt={template.name}
                                    className="size-full object-contain"
                                    draggable={false}
                                />
                                {selected && (
                                    <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-primary-500 px-2 py-0.5 text-caption font-medium text-white">
                                        <Check size={10} weight="bold" />
                                        {t('inUse')}
                                    </span>
                                )}
                            </div>
                            <div className="border-t px-2.5 py-2">
                                <div className="truncate text-caption font-semibold text-neutral-800">
                                    {template.name}
                                </div>
                                <div className="truncate text-caption text-neutral-500">
                                    {template.id === defaultTemplateId
                                        ? t('instituteDefault')
                                        : t('savedTemplate')}
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>

            {templates.length === 0 && (
                <p className="text-caption text-neutral-500">{t('noSavedDesignsYet')}</p>
            )}

            <p className="text-caption text-neutral-500">
                {usingOwnUpload ? t('usingOwnUploadHint') : t('savedDesignFollowsHint')}
            </p>
        </div>
    );
};
