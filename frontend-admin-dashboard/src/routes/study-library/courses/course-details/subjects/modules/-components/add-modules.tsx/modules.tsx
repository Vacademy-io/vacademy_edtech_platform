// modules.tsx
import { EmptyModulesImage } from '@/assets/svgs';
import { ModuleCard } from './module-card';
import { Sortable, SortableItem } from '@/components/ui/sortable';
import { closestCorners } from '@dnd-kit/core';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Module,
    ModulesWithChapters,
} from '@/stores/study-library/use-modules-with-chapters-store';
import { orderModulePayloadType } from '@/routes/study-library/courses/-types/order-payload';

interface ModulesProps {
    modules: ModulesWithChapters[] | null;
    onDeleteModule: (module: Module) => void;
    onEditModule: (updatedModule: Module) => void;
    onOrderChange?: (updatedOrder: orderModulePayloadType[]) => void;
    subjectId: string;
    isLoading?: boolean;
}

export const Modules = ({
    modules: initialModules,
    onDeleteModule,
    onEditModule,
    onOrderChange,
    subjectId,
    isLoading = false,
}: ModulesProps) => {
    const { t } = useTranslation('studyLibraryModules');
    const [modules, setModules] = useState<ModulesWithChapters[] | null>(initialModules);

    const handleValueChange = (updatedModules: ModulesWithChapters[]) => {
        setModules(updatedModules);

        // Create the order payload
        const orderPayload = updatedModules.map((moduleWithChapters, index) => ({
            module_id: moduleWithChapters.module.id,
            subject_id: subjectId,
            module_order: index + 1,
        }));

        onOrderChange?.(orderPayload);
    };

    useEffect(() => {
        setModules(initialModules);
    }, [initialModules]);

    if (isLoading) return <DashboardLoader />;

    return (
        <div className="size-full">
            {(!modules || !modules.length) && (
                <div className="flex w-full flex-col items-center justify-center gap-8 rounded-lg py-10">
                    <EmptyModulesImage />
                    <div>{t('emptyState')}</div>
                </div>
            )}
            <Sortable
                orientation="mixed"
                collisionDetection={closestCorners}
                value={modules?.map((m) => m.module) || []} // Pass only the modules for sorting
                onValueChange={(sortedModules) => {
                    // Reconstruct the ModulesWithChapters array with sorted modules
                    if (modules) {
                        const newOrder = sortedModules.map(
                            (sortedModule) => modules.find((m) => m.module.id === sortedModule.id)!
                        );
                        handleValueChange(newOrder);
                    }
                }}
                overlay={<div className="bg-primary/10 size-full rounded-md" />}
                fast={false}
            >
                <div className="grid grid-cols-3 gap-10">
                    {modules?.map((moduleWithChapters, index) => (
                        <SortableItem
                            key={moduleWithChapters.module.id}
                            value={moduleWithChapters.module.id}
                            asChild
                        >
                            <div className="cursor-grab active:cursor-grabbing">
                                <ModuleCard
                                    key={index}
                                    module={moduleWithChapters}
                                    onDelete={() => onDeleteModule(moduleWithChapters.module)}
                                    onEdit={(updatedModule) => onEditModule(updatedModule)}
                                />
                            </div>
                        </SortableItem>
                    ))}
                </div>
            </Sortable>
        </div>
    );
};
