import { useEffect, useState } from 'react';
import type { ExportSettings } from '../contexts/export-settings-context';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import useInstituteLogoStore from '@/components/common/layout-container/sidebar/institutelogo-global-zustand';
import { getBase64FromUrl } from '../utils/utils';

interface PaperTitleBlockProps {
    settings: ExportSettings;
    title?: string;
    totalMarks?: number;
    durationMins?: number;
    questionCount?: number;
    setCode?: string;
}

/**
 * First-page letterhead for exported papers: institute logo + name, paper
 * title, an ANSWER KEY badge in answer-key mode, and a marks/duration strip.
 * A custom letterhead image (toolbar upload) replaces the logo + name row.
 */
export function PaperTitleBlock({
    settings,
    title,
    totalMarks,
    durationMins,
    questionCount,
    setCode,
}: PaperTitleBlockProps) {
    const { instituteDetails } = useInstituteDetailsStore();
    const { instituteLogo } = useInstituteLogoStore();
    // html2canvas drops cross-origin images, so embed the logo as a data URL.
    const [logoSrc, setLogoSrc] = useState('');

    useEffect(() => {
        if (!instituteLogo) return;
        getBase64FromUrl(instituteLogo)
            .then((data) => setLogoSrc((data as string) || instituteLogo))
            .catch(() => setLogoSrc(instituteLogo));
    }, [instituteLogo]);

    const meta = [
        totalMarks ? { label: 'Total Marks', value: String(totalMarks) } : null,
        durationMins ? { label: 'Duration', value: `${durationMins} min` } : null,
        questionCount ? { label: 'Questions', value: String(questionCount) } : null,
        setCode ? { label: 'Set', value: setCode } : null,
    ].filter((item): item is { label: string; value: string } => item !== null);

    return (
        <div className="mb-6">
            {settings.showInstitutionLetterhead &&
                (settings.customLetterheadImage ? (
                    <div className="mb-4 border-b-4 border-double border-gray-800 pb-3 text-center">
                        <img
                            src={settings.customLetterheadImage}
                            alt="Letterhead"
                            className="mx-auto max-h-24"
                        />
                    </div>
                ) : (
                    <div className="mb-4 flex items-center justify-center gap-4 border-b-4 border-double border-gray-800 pb-3">
                        {logoSrc && (
                            <img
                                src={logoSrc}
                                alt="Institute logo"
                                className="max-h-16 max-w-24 object-contain"
                            />
                        )}
                        <h1 className="text-2xl font-bold uppercase tracking-wide text-gray-900">
                            {instituteDetails?.institute_name}
                        </h1>
                    </div>
                ))}

            {(title || settings.exportSolutionKey) && (
                <div className="mb-4 flex flex-col items-center gap-2 text-center">
                    {title && <h2 className="text-xl font-semibold text-gray-900">{title}</h2>}
                    {settings.exportSolutionKey && (
                        <span className="rounded-md border-2 border-success-600 px-3 py-0.5 text-xs font-bold uppercase tracking-widest text-success-700">
                            Answer Key
                        </span>
                    )}
                </div>
            )}

            {meta.length > 0 && (
                <div className="flex items-center justify-between border-y border-gray-400 py-2 text-sm text-gray-800">
                    {meta.map((item) => (
                        <span key={item.label}>
                            <span className="font-semibold">{item.label}:</span> {item.value}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

/** Sum of per-question marks (marking_json.data.totalMark); 0 when unknown. */
export function totalMarksOf(questions: { marking_json: string }[]): number {
    return questions.reduce((sum, q) => {
        try {
            return sum + (Number(JSON.parse(q.marking_json)?.data?.totalMark) || 0);
        } catch {
            return sum;
        }
    }, 0);
}
