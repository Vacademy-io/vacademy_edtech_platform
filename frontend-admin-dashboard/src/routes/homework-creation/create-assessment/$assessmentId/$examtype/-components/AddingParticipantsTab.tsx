import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TabsContent } from '@radix-ui/react-tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { StudentListTab } from './StudentListTab';
import type { TestAccessFormValues } from '../-utils/add-participants-schema';
import { UseFormReturn } from 'react-hook-form';
import { CheckCircle } from '@phosphor-icons/react';
import { Route } from '..';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

type TestAccessFormType = TestAccessFormValues;

type BatchItem = {
    id: string;
    name: string;
};

interface SectionInfoInterface {
    id: string;
    name: string;
}

type BatchData = Record<string, BatchItem[]>;

export function AddingParticipantsTab({
    batches,
    form,
    totalBatches,
    selectedSection,
    setSelectedSection,
    sectionsInfo,
}: {
    batches: BatchData;
    form: UseFormReturn<TestAccessFormType>;
    totalBatches: BatchData;
    selectedSection: string;
    setSelectedSection: React.Dispatch<React.SetStateAction<string | undefined>>;
    sectionsInfo: SectionInfoInterface[];
}) {
    const { t } = useTranslation('homeworkCreationAddingParticipantsTab');
    const [selectedTab, setSelectedTab] = useState(
        form.getValues('select_individually.checked') === true ? 'Individually' : 'Batch'
    );
    const handleChange = (value: string) => {
        setSelectedTab(value);
    };

    useEffect(() => {
        if (selectedTab === 'Batch') {
            form.setValue('select_batch.checked', true);
            form.setValue('select_individually.checked', false);
        } else {
            form.setValue('select_batch.checked', false);
            form.setValue('select_individually.checked', true);
        }
    }, [selectedTab]);

    return (
        <>
            <Tabs value={selectedTab} onValueChange={handleChange}>
                <TabsList className="mt-4 flex h-auto w-fit flex-wrap justify-start border border-neutral-500 !bg-transparent p-0">
                    <TabsTrigger
                        value="Batch"
                        className={`flex gap-1.5 rounded-l-lg rounded-r-none p-2 pr-4 ${
                            selectedTab === 'Batch'
                                ? '!bg-primary-100 !text-neutral-500'
                                : 'bg-transparent px-4'
                        }`}
                    >
                        {selectedTab === 'Batch' && (
                            <CheckCircle size={18} className="text-teal-800 dark:text-teal-400" />
                        )}
                        <span className={`${selectedTab === 'Batch' ? 'text-neutral-600' : ''}`}>
                            {t('tabs.selectBatch')}
                        </span>
                    </TabsTrigger>
                    <Separator className="!h-9 bg-neutral-600" orientation="vertical" />
                    <TabsTrigger
                        value="Individually"
                        className={`flex gap-1.5 rounded-l-none rounded-r-lg p-2 ${
                            selectedTab === 'Individually'
                                ? '!bg-primary-100 pr-4'
                                : 'bg-transparent px-4'
                        }`}
                    >
                        {selectedTab === 'Individually' && (
                            <CheckCircle size={18} className="text-teal-800 dark:text-teal-400" />
                        )}
                        <span
                            className={`${
                                selectedTab === 'Individually' ? 'text-neutral-600' : ''
                            }`}
                        >
                            {t('tabs.selectIndividually')}
                        </span>
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="Batch" className="mt-6 flex justify-between">
                    <Step3BatchList
                        batchData={batches}
                        form={form}
                        totalBatches={totalBatches}
                        selectedSection={selectedSection}
                        setSelectedSection={setSelectedSection}
                        sectionsInfo={sectionsInfo}
                    />
                </TabsContent>
                <TabsContent value="Individually">
                    <StudentListTab form={form} />
                </TabsContent>
            </Tabs>
        </>
    );
}

const Step3BatchList = ({
    batchData,
    form,
    totalBatches,
    selectedSection,
    setSelectedSection,
    sectionsInfo,
}: {
    batchData: BatchData;
    form: UseFormReturn<TestAccessFormType>;
    totalBatches: BatchData;
    selectedSection: string;
    setSelectedSection: React.Dispatch<React.SetStateAction<string | undefined>>;
    sectionsInfo: SectionInfoInterface[];
}) => {
    const { t } = useTranslation('homeworkCreationAddingParticipantsTab');
    const params = Route.useParams();
    const assessmentId = params.assessmentId ?? '';
    const { setValue, watch } = form;

    // Ensure batchDetails is initialized before using it
    const transformedBatches: Record<string, string[]> = Object.fromEntries(
        Object.entries(batchData).map(([key, value]) => [key, value.map((item) => item.id)])
    );

    // Ensure checkedState only contains string IDs
    const [checkedState, setCheckedState] = useState<Record<string, string[]>>(
        assessmentId === 'defaultId' ? {} : transformedBatches
    );

    // Watch for changes in form state
    watch('select_batch.batch_details');

    // Handle parent checkbox toggle
    const handleParentToggle = (parentId: string, isChecked: boolean) => {
        setCheckedState((prev) => ({
            ...prev,
            [parentId]: isChecked ? totalBatches[parentId]?.map((item) => item.id) || [] : [],
        }));
    };

    // Handle child checkbox toggle
    const handleChildToggle = (parentId: string, childId: string, isChecked: boolean) => {
        setCheckedState((prev) => {
            const currentChildren = prev[parentId] || [];
            return {
                ...prev,
                [parentId]: isChecked
                    ? [...currentChildren, childId]
                    : currentChildren.filter((id) => id !== childId),
            };
        });
    };

    // Check if all children are selected
    const isAllChildrenSelected = (parentId: string) => {
        const currentChildren = totalBatches[parentId]?.map((item) => item.id) || [];
        return (
            currentChildren.length > 0 &&
            currentChildren.every((id) => checkedState[parentId]?.includes(id))
        );
    };

    // Ensure form value updates immediately
    useEffect(() => {
        setValue('select_batch.batch_details', checkedState);
    }, [checkedState, setValue, selectedSection]);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
                <span>{getTerminology(ContentTerms.Session, SystemTerms.Session)}</span>
                <Select value={selectedSection} onValueChange={setSelectedSection}>
                    <SelectTrigger className="w-44 text-subtitle">
                        <SelectValue placeholder={t('batchList.selectSectionPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                        {sectionsInfo?.map((section) => (
                            <SelectItem key={section.id} value={section.id}>
                                {section.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <div className="flex w-full flex-wrap justify-between gap-4">
                {Object.entries(totalBatches).map(([batchName, packages]) => (
                    <div key={batchName}>
                        {/* Parent Checkbox */}
                        <label>
                            <Checkbox
                                checked={isAllChildrenSelected(batchName)}
                                onCheckedChange={(isChecked) =>
                                    handleParentToggle(batchName, !!isChecked)
                                }
                                className={`size-4 rounded-sm border-2 shadow-none ${
                                    isAllChildrenSelected(batchName)
                                        ? 'border-none bg-primary-500 text-white'
                                        : ''
                                }`}
                            />
                            <span className="ml-2 font-thin">{batchName}</span>
                        </label>

                        {/* Child Checkboxes */}
                        <ul className="ml-4 mt-3 flex flex-col gap-3">
                            {packages.map((pkg) => (
                                <li key={pkg.id}>
                                    <label>
                                        <Checkbox
                                            checked={checkedState[batchName]?.includes(pkg.id)}
                                            onCheckedChange={(isChecked) =>
                                                handleChildToggle(batchName, pkg.id, !!isChecked)
                                            }
                                            className={`size-4 rounded-sm border-2 shadow-none ${
                                                checkedState[batchName]?.includes(pkg.id)
                                                    ? 'border-none bg-primary-500 text-white'
                                                    : ''
                                            }`}
                                        />
                                        <span className="ml-2 font-thin">{pkg.name}</span>
                                    </label>
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
            </div>
        </div>
    );
};
