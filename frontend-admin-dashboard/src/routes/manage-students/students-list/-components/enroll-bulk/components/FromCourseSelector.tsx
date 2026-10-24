import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { MyButton } from '@/components/design-system/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_STUDENTS } from '@/constants/urls';
import { SelectedLearner } from '../../../-types/bulk-assign-types';
import { toast } from 'sonner';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import {
    ContentTerms,
    RoleTerms,
    SystemTerms,
} from '@/routes/settings/-components/NamingSettings';

interface Props {
    instituteId: string;
    selectedLearners: SelectedLearner[];
    onAdd: (learners: SelectedLearner[]) => void;
}

interface StudentRow {
    user_id: string;
    username: string;
    email: string;
    name?: string;
}

export const FromCourseSelector = ({ instituteId, selectedLearners, onAdd }: Props) => {
    const { t } = useTranslation('manageStudentsFromCourseSelector');
    const { getPackageWiseLevels, instituteDetails } = useInstituteDetailsStore();
    const packageGroups = getPackageWiseLevels();

    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const levelTerm = getTerminology(ContentTerms.Level, SystemTerms.Level);
    const learnerTerm = getTerminology(RoleTerms.Learner, SystemTerms.Learner);
    const learnersTerm = getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner);

    const [selectedCourseId, setSelectedCourseId] = useState('');
    const [selectedPackageSessionId, setSelectedPackageSessionId] = useState('');
    const [statusFilter, setStatusFilter] = useState('ACTIVE');
    const [students, setStudents] = useState<StudentRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

    // Every batch of the course, not getPackageWiseLevels' one-per-level list — that
    // keeps only the first session's batch per level, so a course running the same
    // level in two sessions loaded learners from whichever batch happened to come first.
    const batches = (instituteDetails?.batches_for_sessions ?? []).filter(
        (b) => b.package_dto.id === selectedCourseId
    );
    const batchLabel = (b: (typeof batches)[number]) =>
        [b.name?.trim() || b.level.level_name, b.session.session_name].filter(Boolean).join(' · ');

    const selectCourse = (courseId: string) => {
        setSelectedCourseId(courseId);
        setStudents([]);
        // A course with a single real batch has nothing to choose — pick it so "Load" is
        // live. The INVITED placeholder batch every course carries doesn't count.
        const realBatches = (instituteDetails?.batches_for_sessions ?? []).filter(
            (b) => b.package_dto.id === courseId && b.status !== 'INVITED'
        );
        setSelectedPackageSessionId(realBatches.length === 1 ? realBatches[0]!.id : '');
    };

    const handleSearch = async () => {
        if (!selectedPackageSessionId) {
            toast.error(t('toasts.selectLevelFirst'));
            return;
        }
        setLoading(true);
        try {
            const response = await authenticatedAxiosInstance.post(
                GET_STUDENTS,
                {
                    institute_ids: [instituteId],
                    package_session_ids: [selectedPackageSessionId],
                    statuses: [statusFilter],
                },
                { params: { pageNo: 0, pageSize: 500 } }
            );
            const content = response.data?.content ?? [];
            setStudents(
                content.map((s: any) => ({
                    user_id: s.user_id,
                    username: s.username,
                    email: s.email,
                    name: s.full_name || s.username,
                }))
            );
            setCheckedIds(new Set());
        } catch {
            toast.error(t('toasts.loadFailed'));
        } finally {
            setLoading(false);
        }
    };

    const toggleCheck = (id: string) => {
        setCheckedIds((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const toggleAll = () => {
        if (checkedIds.size === students.length) {
            setCheckedIds(new Set());
        } else {
            setCheckedIds(new Set(students.map((s) => s.user_id)));
        }
    };

    const handleAdd = () => {
        const alreadySelected = new Set(
            selectedLearners
                .filter((l) => l.type === 'existing')
                .map((l) => (l as Extract<SelectedLearner, { type: 'existing' }>).userId)
        );

        const toAdd: SelectedLearner[] = students
            .filter((s) => checkedIds.has(s.user_id) && !alreadySelected.has(s.user_id))
            .map((s) => ({
                type: 'existing' as const,
                userId: s.user_id,
                email: s.email,
                name: s.name || s.username,
            }));

        if (toAdd.length === 0) {
            toast.info(t('toasts.alreadyInList'));
            return;
        }
        onAdd(toAdd);
        toast.success(t('toasts.added', { count: toAdd.length }));
    };

    return (
        <div className="flex flex-col gap-4">
            {/* Source course picker */}
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <Label className="mb-1 text-xs text-neutral-500">
                        {t('labels.sourceCourse', { courseTerm })}
                    </Label>
                    <Select value={selectedCourseId} onValueChange={selectCourse}>
                        <SelectTrigger>
                            <SelectValue
                                placeholder={t('placeholders.select', {
                                    term: courseTerm.toLowerCase(),
                                })}
                            />
                        </SelectTrigger>
                        <SelectContent className="z-popover-above-modal">
                            {packageGroups.map((g) => (
                                <SelectItem key={g.package_dto.id} value={g.package_dto.id}>
                                    {g.package_dto.package_name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div>
                    <Label className="mb-1 text-xs text-neutral-500">{levelTerm}</Label>
                    <Select
                        value={selectedPackageSessionId}
                        onValueChange={(v) => {
                            setSelectedPackageSessionId(v);
                            setStudents([]);
                        }}
                        disabled={!selectedCourseId}
                    >
                        <SelectTrigger>
                            <SelectValue
                                placeholder={t('placeholders.select', {
                                    term: levelTerm.toLowerCase(),
                                })}
                            />
                        </SelectTrigger>
                        <SelectContent className="z-popover-above-modal">
                            {batches.map((b) => (
                                <SelectItem key={b.id} value={b.id}>
                                    {batchLabel(b)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div>
                    <Label className="mb-1 text-xs text-neutral-500">
                        {t('labels.statusFilter')}
                    </Label>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="z-popover-above-modal">
                            <SelectItem value="ACTIVE">{t('status.active')}</SelectItem>
                            <SelectItem value="INACTIVE">{t('status.inactive')}</SelectItem>
                            <SelectItem value="INVITED">{t('status.invited')}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex items-end">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        layoutVariant="default"
                        onClick={handleSearch}
                        disable={!selectedPackageSessionId || loading}
                    >
                        {loading ? t('actions.loading') : t('actions.load', { learnersTerm })}
                    </MyButton>
                </div>
            </div>

            {/* Student list */}
            {students.length > 0 && (
                <div className="rounded-lg border border-neutral-200 bg-white">
                    <div className="flex items-center gap-3 border-b border-neutral-100 px-4 py-2">
                        <Checkbox
                            checked={checkedIds.size === students.length}
                            onCheckedChange={toggleAll}
                        />
                        <span className="text-xs font-semibold text-neutral-500">
                            {t('list.selectedCount', {
                                checked: checkedIds.size,
                                total: students.length,
                            })}
                        </span>
                        {checkedIds.size > 0 && (
                            <MyButton
                                buttonType="primary"
                                scale="small"
                                layoutVariant="default"
                                onClick={handleAdd}
                            >
                                {t('actions.add', {
                                    count: checkedIds.size,
                                    term: (checkedIds.size !== 1
                                        ? learnersTerm
                                        : learnerTerm
                                    ).toLowerCase(),
                                })}
                            </MyButton>
                        )}
                    </div>
                    <div className="max-h-60 overflow-y-auto divide-y divide-neutral-50">
                        {students.map((s) => (
                            <button
                                key={s.user_id}
                                onClick={() => toggleCheck(s.user_id)}
                                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-neutral-50"
                            >
                                <Checkbox
                                    checked={checkedIds.has(s.user_id)}
                                    onCheckedChange={() => toggleCheck(s.user_id)}
                                    className="pointer-events-none"
                                />
                                <div>
                                    <p className="font-medium text-neutral-800">
                                        {s.name || s.username}
                                    </p>
                                    <p className="text-xs text-neutral-400">{s.email}</p>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}
            {students.length === 0 && !loading && selectedPackageSessionId && (
                <p className="text-center text-sm text-neutral-400 py-6">
                    {t('list.empty', {
                        learnersTerm: learnersTerm.toLowerCase(),
                        loadLabel: t('actions.load', { learnersTerm }),
                    })}
                </p>
            )}
        </div>
    );
};
