import { Lock } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useHrRole } from '@/hooks/use-hr-role';
import { ComponentsTab } from './ComponentsTab';
import { TemplatesTab } from './TemplatesTab';
import { AssignTab } from './AssignTab';

/**
 * Salary configuration, in the order it has to be done: define the pay
 * components, arrange them into a template, then put an employee on that
 * template at a CTC. The tabs are that sequence, not three unrelated screens —
 * a template can't reference a component that doesn't exist, and an assignment
 * can't happen without a template.
 */
export const SalarySetupMain = () => {
    const { t } = useTranslation('erpSalarySetupMain');
    const { isHrAdmin, isHrStaff } = useHrRole();

    if (!isHrStaff) {
        return (
            <Card className="mx-auto max-w-xl">
                <CardHeader className="flex flex-row items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
                        <Lock size={20} />
                    </span>
                    <CardTitle className="text-title">{t('restricted.title')}</CardTitle>
                </CardHeader>
                <CardContent className="text-body text-neutral-600">
                    {t('restricted.description')}
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <p className="max-w-3xl text-body text-neutral-600">{t('intro')}</p>

            <Tabs defaultValue="components" className="flex flex-col gap-2">
                <TabsList className="h-auto w-full flex-wrap justify-start sm:w-fit">
                    <TabsTrigger value="components">{t('tabs.components')}</TabsTrigger>
                    <TabsTrigger value="templates">{t('tabs.templates')}</TabsTrigger>
                    <TabsTrigger value="assign">{t('tabs.assign')}</TabsTrigger>
                </TabsList>

                <TabsContent value="components" className="mt-4">
                    <ComponentsTab isHrAdmin={isHrAdmin} />
                </TabsContent>
                <TabsContent value="templates" className="mt-4">
                    <TemplatesTab isHrAdmin={isHrAdmin} />
                </TabsContent>
                <TabsContent value="assign" className="mt-4">
                    <AssignTab isHrAdmin={isHrAdmin} />
                </TabsContent>
            </Tabs>
        </div>
    );
};
