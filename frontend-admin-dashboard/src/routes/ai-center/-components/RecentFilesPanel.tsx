import { ArrowRight, FileAudio, FileImage, FilePdf, FileText, Sparkle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { AITaskIndividualListInterface } from '@/types/ai/generate-assessment/generate-complete-assessment';
import {
    FileFamily,
    buildSourceLabel,
    classifyFile,
    relativeTime,
    statusLabel,
    statusStyles,
    taskDisplayName,
} from '../-utils/format';

const FamilyIcon = ({ family }: { family: FileFamily }) => {
    const cls = 'text-primary-500';
    if (family === 'pdf') return <FilePdf size={18} weight="fill" className={cls} />;
    if (family === 'audio') return <FileAudio size={18} weight="fill" className={cls} />;
    if (family === 'image') return <FileImage size={18} weight="fill" className={cls} />;
    return <FileText size={18} weight="fill" className={cls} />;
};

type Props = {
    tasks: AITaskIndividualListInterface[];
    title: string;
    fallbackLabel: string;
    emptyHint: string;
    onOpenAll: () => void;
    /** Override the auto-detected file-family icon with a tool-specific one (e.g. ChatCircleDots for chat) */
    overrideIcon?: React.ReactNode;
};

export const RecentFilesPanel = ({
    tasks,
    title,
    fallbackLabel,
    emptyHint,
    onOpenAll,
    overrideIcon,
}: Props) => {
    const { t: tFormat } = useTranslation('aiCenterFormat');
    const sourceLabel = buildSourceLabel(tFormat);
    return (
        <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-900">{title}</h2>
                {tasks.length > 0 && (
                    <button
                        type="button"
                        onClick={onOpenAll}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary-500 transition-colors hover:bg-primary-50 hover:text-primary-600"
                    >
                        View all
                        <ArrowRight size={12} weight="bold" />
                    </button>
                )}
            </div>
            {tasks.length > 0 ? (
                <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {tasks.map((task) => {
                        const family = classifyFile(task.file_detail?.file_type);
                        return (
                            <button
                                key={task.id}
                                type="button"
                                onClick={onOpenAll}
                                className="group relative flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md"
                            >
                                <div className="flex items-start gap-3">
                                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50">
                                        {overrideIcon ?? <FamilyIcon family={family} />}
                                    </div>
                                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <span className="line-clamp-2 text-sm font-medium text-gray-900">
                                            {taskDisplayName(task, tFormat, fallbackLabel)}
                                        </span>
                                        <span className="text-xs text-neutral-500">
                                            {sourceLabel[family]} ·{' '}
                                            {relativeTime(task.updated_at, tFormat)}
                                        </span>
                                    </div>
                                    <span
                                        className={`inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-2xs font-medium ring-1 ring-inset ${statusStyles(
                                            task.status
                                        )}`}
                                    >
                                        {statusLabel(task.status, tFormat)}
                                    </span>
                                </div>
                                <div className="flex items-center justify-end gap-1 text-xs text-primary-500 opacity-0 transition-opacity group-hover:opacity-100">
                                    Open
                                    <ArrowRight size={12} weight="bold" />
                                </div>
                            </button>
                        );
                    })}
                </div>
            ) : (
                <div className="flex items-center gap-2 rounded-xl border border-dashed border-neutral-200 bg-white px-4 py-5 text-sm text-neutral-500">
                    <Sparkle size={16} weight="fill" className="text-primary-400" />
                    <span>{emptyHint}</span>
                </div>
            )}
        </section>
    );
};
