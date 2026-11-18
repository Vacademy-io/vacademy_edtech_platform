import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Files, FolderOpen, Trash, UploadSimple } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import {
    filesFromDrop,
    filesFromInput,
    pickFolder,
    setWebkitDirectory,
    supportsDirectoryPicker,
} from '../-lib/folder-intake';

/**
 * Where one pass's scans come in: a dropped folder or files, the folder picker
 * (Chrome / Edge), or a folder input (Safari / Firefox), or plain files.
 */
export const PassDropZone = ({
    label,
    files,
    summary,
    onFiles,
    disabled = false,
}: {
    label: string;
    files: File[];
    /** One line under the zone once files are in, e.g. "24 pages, ordered by scan number". */
    summary?: string | null;
    onFiles: (files: File[]) => void;
    disabled?: boolean;
}) => {
    const { t } = useTranslation('scanStation');
    const folderInput = useRef<HTMLInputElement>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const [over, setOver] = useState(false);

    useEffect(() => {
        setWebkitDirectory(folderInput.current);
    }, []);

    const chooseFolder = async () => {
        if (!supportsDirectoryPicker()) {
            folderInput.current?.click();
            return;
        }
        try {
            const picked = await pickFolder();
            if (picked) onFiles(picked);
        } catch {
            toast.error(t('intake.pickFailed'));
        }
    };

    return (
        <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-body font-medium text-neutral-800">{label}</p>
            <div
                className={cn(
                    'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors',
                    over ? 'border-primary-400 bg-primary-50' : 'border-neutral-300 bg-neutral-50',
                    disabled && 'pointer-events-none opacity-60'
                )}
                onDragOver={(e) => {
                    e.preventDefault();
                    setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setOver(false);
                    // Entries must be taken inside the handler, before anything awaits.
                    filesFromDrop(e.dataTransfer)
                        .then(onFiles)
                        .catch(() => toast.error(t('intake.pickFailed')));
                }}
            >
                <UploadSimple size={24} className="text-primary-500" />
                {files.length > 0 ? (
                    <span className="text-body font-medium text-neutral-800">
                        {t('intake.files', { count: files.length })}
                    </span>
                ) : (
                    <span className="text-body text-neutral-600">{t('intake.drop')}</span>
                )}
                <div className="flex flex-wrap items-center justify-center gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        className="gap-1"
                        disabled={disabled}
                        onClick={() => void chooseFolder()}
                    >
                        <FolderOpen size={14} />
                        {t('intake.chooseFolder')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        className="gap-1"
                        disabled={disabled}
                        onClick={() => fileInput.current?.click()}
                    >
                        <Files size={14} />
                        {t('intake.chooseFiles')}
                    </MyButton>
                    {files.length > 0 && (
                        <MyButton
                            type="button"
                            buttonType="text"
                            scale="small"
                            className="gap-1"
                            disabled={disabled}
                            onClick={() => onFiles([])}
                        >
                            <Trash size={14} />
                            {t('intake.clear')}
                        </MyButton>
                    )}
                </div>
                <input
                    ref={folderInput}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                        onFiles(filesFromInput(e.target));
                        e.target.value = '';
                    }}
                />
                <input
                    ref={fileInput}
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                        onFiles(filesFromInput(e.target));
                        e.target.value = '';
                    }}
                />
            </div>
            {summary && <p className="text-caption text-neutral-600">{summary}</p>}
        </div>
    );
};

export default PassDropZone;
