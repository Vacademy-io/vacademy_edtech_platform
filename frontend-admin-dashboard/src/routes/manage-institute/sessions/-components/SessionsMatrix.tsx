import { useTranslation } from 'react-i18next';
import type { SessionsResponse } from '@/types/study-library/session-types';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { convertCapitalToTitleCase } from '@/lib/utils';
import { StatusPill } from '@/components/shared/crm-enhance/screen-header';

/**
 * Course × level rows against session columns — every filled cell is a batch.
 * Built from the sessions list the page already loaded.
 */
export function SessionsMatrix({ sessions }: { sessions: SessionsResponse }) {
    const { t } = useTranslation('manageInstituteSessionsPage');
    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const levelTerm = getTerminology(ContentTerms.Level, SystemTerms.Level);

    // Key: course id + level id → { session id → status }
    const rows = new Map<string, { course: string; level: string; cells: Map<string, string> }>();
    sessions.forEach((s) =>
        s.packages.forEach((p) =>
            p.level.forEach((l) => {
                const key = `${p.package_dto.id}::${l.level_dto.id}`;
                const row = rows.get(key) ?? {
                    course: p.package_dto.package_name,
                    level: l.level_dto.level_name,
                    cells: new Map<string, string>(),
                };
                row.cells.set(s.session.id, l.package_session_status);
                rows.set(key, row);
            })
        )
    );
    const sorted = [...rows.values()].sort(
        (a, b) => a.course.localeCompare(b.course) || a.level.localeCompare(b.level)
    );

    return (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
            <div className="overflow-x-auto">
                <table className="w-full text-start text-body text-neutral-600">
                    <thead className="bg-neutral-50 text-caption font-medium uppercase text-neutral-500">
                        <tr>
                            <th className="px-4 py-2 text-start">{courseTerm}</th>
                            <th className="px-4 py-2 text-start">{levelTerm}</th>
                            {sessions.map((s) => (
                                <th
                                    key={s.session.id}
                                    className="whitespace-nowrap px-4 py-2 text-end"
                                >
                                    {convertCapitalToTitleCase(s.session.session_name)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                        {sorted.map((row) => (
                            <tr key={`${row.course}-${row.level}`}>
                                <td className="px-4 py-2.5 font-medium text-neutral-800">
                                    {convertCapitalToTitleCase(row.course)}
                                </td>
                                <td className="px-4 py-2.5">
                                    {convertCapitalToTitleCase(row.level)}
                                </td>
                                {sessions.map((s) => {
                                    const cell = row.cells.get(s.session.id);
                                    return (
                                        <td key={s.session.id} className="px-4 py-2.5 text-end">
                                            {!cell ? (
                                                <span className="text-neutral-400">—</span>
                                            ) : (
                                                <span className="inline-flex justify-end">
                                                    <StatusPill
                                                        tone={
                                                            cell === 'ACTIVE'
                                                                ? 'success'
                                                                : 'neutral'
                                                        }
                                                    >
                                                        {cell === 'ACTIVE'
                                                            ? t('matrix.active')
                                                            : t('matrix.hidden')}
                                                    </StatusPill>
                                                </span>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="border-t border-neutral-100 px-4 py-2 text-neutral-500">
                <span className="text-caption">{t('matrix.foot')}</span>
            </p>
        </div>
    );
}
