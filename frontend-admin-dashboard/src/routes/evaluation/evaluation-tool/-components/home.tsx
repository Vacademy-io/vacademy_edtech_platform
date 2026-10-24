import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { Button } from '@/components/ui/button';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { Link } from '@tanstack/react-router';
import { ArrowRight, CheckCircle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

export default function HeroSection() {
    const { t } = useTranslation('evaluationHome');
    return (
        <section className="w-full bg-white py-12 md:py-24 lg:py-32">
            <div className="container px-4 md:px-6">
                <div className="grid gap-6 lg:grid-cols-[1fr_400px] lg:gap-12 xl:grid-cols-[1fr_500px]">
                    <div className="flex flex-col justify-center space-y-4">
                        <div className="space-y-2">
                            <h1 className="text-3xl font-bold tracking-tighter text-gray-900 sm:text-5xl xl:text-6xl/none">
                                {t('heading')}{' '}
                                <span className="text-primary-400">{t('headingHighlight')}</span>
                            </h1>
                            <p className="max-w-xl text-gray-500 md:text-xl">
                                {t('subtitle', {
                                    learners: getTerminology(
                                        RoleTerms.Learner,
                                        SystemTerms.Learner
                                    ).toLocaleLowerCase(),
                                })}
                            </p>
                        </div>
                        <div className="flex flex-col gap-2 min-[400px]:flex-row">
                            <Link to="/evaluation/evaluation-tool">
                                <Button className="bg-primary-400 text-white hover:bg-primary-500">
                                    {t('getStarted')} <ArrowRight className="ms-2 size-4" />
                                </Button>
                            </Link>
                            <Button className="border border-primary-400 bg-white text-primary-500 hover:bg-primary-50 hover:text-primary-500">
                                {t('watchDemo')}
                            </Button>
                        </div>
                        <div className="flex items-center space-x-4 text-sm text-gray-500">
                            <div className="flex items-center">
                                <CheckCircle className="mr-1 size-4 text-primary-500" />
                                <span>{t('customizable')}</span>
                            </div>
                            <div className="flex items-center">
                                <CheckCircle className="mr-1 size-4 text-primary-500" />
                                <span>{t('easy')}</span>
                            </div>
                            <div className="flex items-center">
                                <CheckCircle className="mr-1 size-4 text-primary-500" />
                                <span>{t('free')}</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center justify-center">
                        <div className="relative h-96 w-full overflow-hidden rounded-xl shadow-xl">
                            <img
                                src="/evaluation.jpg"
                                alt={t('imageAlt')}
                                className="object-cover"
                            />
                            <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-orange-500/20 to-transparent" />
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
