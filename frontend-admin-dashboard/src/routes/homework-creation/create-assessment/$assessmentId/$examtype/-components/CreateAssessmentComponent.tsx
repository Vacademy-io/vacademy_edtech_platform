import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useEffect, useState } from 'react';
import { MainStepComponent } from './StepComponents/MainStepComponent';
import { CheckCircle } from '@phosphor-icons/react';
import { Helmet } from 'react-helmet';
import { useSidebar } from '@/components/ui/sidebar';
import { Route } from '..';
import { useNavigate } from '@tanstack/react-router';
import { useFilterDataForAssesment } from '@/routes/assessment/assessment-list/-utils.ts/useFiltersData';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { NoCourseDialog } from '@/components/common/students/no-course-dialog';
import { useTranslation } from 'react-i18next';
// Define interfaces for props
interface CreateAssessmentSidebarProps {
    steps: {
        label: string;
        id: string;
    }[];
    currentStep: number;
    completedSteps: boolean[];
    onStepClick: (index: number) => void;
}

const CreateAssessmentSidebar: React.FC<CreateAssessmentSidebarProps> = ({
    steps,
    currentStep,
    completedSteps,
    onStepClick,
}) => {
    const { open } = useSidebar();
    return (
        <>
            {steps.map((step, index) => (
                <div
                    key={step.id}
                    onClick={() => onStepClick(index)}
                    id={step.id}
                    className={`mx-6 flex items-center justify-between px-6 py-3 ${
                        index <= currentStep || completedSteps[index - 1]
                            ? 'cursor-pointer'
                            : 'cursor-not-allowed'
                    } ${
                        currentStep === index
                            ? 'rounded-lg border-2 bg-white !text-primary-500'
                            : completedSteps[index]
                              ? 'bg-transparent text-black'
                              : `bg-transparent ${
                                    index > 0 && completedSteps[index - 1]
                                        ? 'text-black'
                                        : 'text-gray-300'
                                } `
                    } focus:outline-none`}
                >
                    <div className="flex items-center gap-6">
                        {!open && !completedSteps[index] && (
                            <span className="text-lg font-semibold">{index + 1}</span>
                        )}
                        {open && <span className="text-lg font-semibold">{index + 1}</span>}
                        {open && <span className="font-thin">{step.label}</span>}
                    </div>

                    {completedSteps[index] && (
                        <CheckCircle size={24} weight="fill" className="!text-green-500" />
                    )}
                </div>
            ))}
        </>
    );
};

const CreateAssessmentComponent = () => {
    const { t } = useTranslation('homeworkCreationCreateAssessmentComponent');
    const navigate = useNavigate();
    const [isOpen, setIsOpen] = useState(false);
    const { assessmentId, examtype } = Route.useParams();
    const { currentStep: presentStep } = Route.useSearch();
    const { data: instituteDetails } = useSuspenseQuery(useInstituteQuery());
    const { SubjectFilterData } = useFilterDataForAssesment(instituteDetails);

    const steps = [
        {
            label: t('steps.basicInfo'),
            id: 'basic-info',
        },
        {
            label: t('steps.addQuestion'),
            id: 'add-question',
        },
        {
            label: t('steps.addParticipants'),
            id: 'add-participants',
        },
        {
            label: t('steps.accessControl'),
            id: 'access-control',
        },
    ];
    const [currentStep, setCurrentStep] = useState(presentStep);
    const [completedSteps, setCompletedSteps] = useState([false, false, false, false]);
    const completeCurrentStep = () => {
        setCompletedSteps((prev) => {
            const updated = [...prev];
            updated[currentStep] = true;
            return updated;
        });
        if (currentStep < steps.length - 1) {
            setCurrentStep((prev) => prev + 1);
            // Update URL `currentStep` without reloading
            navigate({
                to: '/homework-creation/create-assessment/$assessmentId/$examtype',
                params: {
                    assessmentId: assessmentId,
                    examtype: examtype,
                },
                search: {
                    currentStep: currentStep,
                },
            });
        }
    };

    useEffect(() => {
        if (SubjectFilterData.length === 0) {
            setIsOpen(true);
        }
    }, []);

    const goToStep = (index: number) => {
        if (index <= currentStep || completedSteps[index - 1]) {
            setCurrentStep(index);
        }
    };
    return (
        <LayoutContainer
            sidebarComponent={
                <CreateAssessmentSidebar
                    steps={steps}
                    currentStep={currentStep}
                    completedSteps={completedSteps}
                    onStepClick={goToStep}
                />
            }
        >
            <Helmet>
                <title>{t('page.title')}</title>
                <meta name="description" content={t('page.metaDescription')} />
            </Helmet>
            <MainStepComponent
                currentStep={currentStep}
                handleCompleteCurrentStep={completeCurrentStep}
                completedSteps={completedSteps}
            />
            <NoCourseDialog
                isOpen={isOpen}
                setIsOpen={setIsOpen}
                type={t('noCourseDialog.type')}
            />
        </LayoutContainer>
    );
};

export default CreateAssessmentComponent;
