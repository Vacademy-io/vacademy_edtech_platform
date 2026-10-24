import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getTerminology,
  getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/types/naming-settings';
import { ModernButton } from '@/components/design-system/modern-button';
import { 
  ModernCard, 
  ModernCardHeader, 
  ModernCardTitle, 
  ModernCardContent,
  ModernCardFooter 
} from '@/components/design-system/modern-card';
import { ModernInput } from '@/components/design-system/modern-input';
import { 
  Play, 
  Heart, 
  Share, 
  User, 
  Envelope, 
  Lock,
  MagnifyingGlass,
  Bell,
  Gear,
  TrendUp,
  Download
} from '@phosphor-icons/react';

/**
 * Modern Design System Showcase
 * 
 * This component demonstrates the usage of our new design system components
 * and serves as a reference for implementation patterns.
 */
export const ModernDesignShowcase: React.FC = () => {
  const { t } = useTranslation('miscComponents');
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const courses = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);
  const [isLoading, setIsLoading] = useState(false);
  const [notification, setNotification] = useState('');

  const handleAction = async (action: string) => {
    setIsLoading(true);
    setNotification(t('modernDesignShowcase.notification.initiated', { action }));

    // Simulate API call
    setTimeout(() => {
      setIsLoading(false);
      setNotification(
        t('modernDesignShowcase.notification.completed', { action })
      );
      setTimeout(() => setNotification(''), 3000);
    }, 2000);
  };

  return (
    <div className="container-modern py-8 space-y-8">
      {/* Header Section */}
      <div className="text-center space-y-4 animate-fade-down">
        <h1 className="text-h1-semibold text-gradient-primary">
          {t('modernDesignShowcase.header.title')}
        </h1>
        <p className="text-subtitle text-neutral-600 max-w-2xl mx-auto">
          {t('modernDesignShowcase.header.subtitle')}
        </p>
      </div>

      {/* Notification */}
      {notification && (
        <div className="bg-success-50 border border-success-200 text-success-700 px-4 py-3 rounded-lg animate-fade-up">
          {notification}
        </div>
      )}

      {/* Button Showcase */}
      <ModernCard variant="elevated" className="animate-fade-up">
        <ModernCardHeader>
          <ModernCardTitle size="lg">
            {t('modernDesignShowcase.buttons.buttonComponents')}
          </ModernCardTitle>
        </ModernCardHeader>
        <ModernCardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-section">
            {/* Primary Buttons */}
            <div className="space-y-4">
              <h3 className="text-h3-semibold">
                {t('modernDesignShowcase.buttons.primaryActions')}
              </h3>
              <div className="stack-vertical">
                <ModernButton
                  variant="primary"
                  size="lg"
                  leftIcon={<Play weight="duotone" />}
                  onClick={() =>
                    handleAction(t('modernDesignShowcase.actions.play'))
                  }
                  isLoading={isLoading}
                >
                  {t('modernDesignShowcase.buttons.startLearning')}
                </ModernButton>

                <ModernButton
                  variant="primary"
                  size="md"
                  rightIcon={<Download weight="duotone" />}
                  onClick={() =>
                    handleAction(t('modernDesignShowcase.actions.download'))
                  }
                >
                  {t('modernDesignShowcase.buttons.downloadResources')}
                </ModernButton>

                <ModernButton
                  variant="primary"
                  size="sm"
                  rounded="full"
                  className="shadow-colored"
                >
                  {t('modernDesignShowcase.buttons.quickAction')}
                </ModernButton>
              </div>
            </div>

            {/* Secondary Buttons */}
            <div className="space-y-4">
              <h3 className="text-h3-semibold">
                {t('modernDesignShowcase.buttons.secondaryActions')}
              </h3>
              <div className="stack-vertical">
                <ModernButton
                  variant="secondary"
                  size="lg"
                  leftIcon={<Gear weight="duotone" />}
                >
                  {t('modernDesignShowcase.buttons.settings')}
                </ModernButton>

                <ModernButton
                  variant="outline"
                  size="md"
                  leftIcon={<Share weight="duotone" />}
                >
                  {t('modernDesignShowcase.buttons.share')}
                </ModernButton>

                <ModernButton
                  variant="ghost"
                  size="sm"
                  leftIcon={<Heart weight="duotone" />}
                  className="hover-scale-gentle"
                >
                  {t('modernDesignShowcase.buttons.like')}
                </ModernButton>
              </div>
            </div>
          </div>
        </ModernCardContent>
      </ModernCard>

      {/* Card Showcase */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-section">
        {/* Elevated Card */}
        <ModernCard 
          variant="elevated" 
          hoverable 
          interactive
          className="animate-fade-up group"
          style={{ animationDelay: '0.1s' } as React.CSSProperties}
        >
          <ModernCardHeader>
            <div className="flex items-center justify-between">
              <ModernCardTitle size="md">
                {t('modernDesignShowcase.cards.progressTracker')}
              </ModernCardTitle>
              <TrendUp
                weight="duotone"
                className="text-success-500 group-hover:scale-110 transition-transform"
              />
            </div>
          </ModernCardHeader>
          <ModernCardContent>
            <div className="text-h2-semibold text-primary-600 mb-2">
              85%
            </div>
            <p className="text-caption text-neutral-600">
              {t('modernDesignShowcase.cards.courseCompletionRate', { course })}
            </p>
            <div className="w-full bg-neutral-200 rounded-full h-2 mt-3">
              <div className="bg-primary-500 h-2 rounded-full w-[85%] animate-fade-up"></div> {/* design-lint-ignore: decorative positioning */}
            </div>
          </ModernCardContent>
        </ModernCard>

        {/* Glass Card */}
        <ModernCard 
          variant="glass" 
          padding="lg" 
          rounded="2xl"
          className="animate-fade-up"
          style={{ animationDelay: '0.2s' } as React.CSSProperties}
        >
          <ModernCardContent className="text-center">
            <div className="w-16 h-16 bg-gradient-primary rounded-full flex items-center justify-center mx-auto mb-4">
              <Bell weight="duotone" className="text-white text-2xl" />
            </div>
            <ModernCardTitle size="lg" className="mb-2">
              {t('modernDesignShowcase.cards.notificationsTitle')}
            </ModernCardTitle>
            <p className="text-body text-neutral-600 mb-4">
              {t('modernDesignShowcase.cards.notificationsDescription')}
            </p>
            <ModernButton variant="outline" size="sm" className="w-full">
              {t('modernDesignShowcase.cards.enableNotifications')}
            </ModernButton>
          </ModernCardContent>
        </ModernCard>

        {/* Outlined Card */}
        <ModernCard 
          variant="outlined" 
          hoverable
          className="animate-fade-up md:col-span-2 lg:col-span-1"
          style={{ animationDelay: '0.3s' } as React.CSSProperties}
        >
          <ModernCardHeader variant="bordered">
            <ModernCardTitle size="md">
              {t('modernDesignShowcase.cards.quickStats')}
            </ModernCardTitle>
          </ModernCardHeader>
          <ModernCardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center">
                <div className="text-title font-semibold text-primary-600">12</div>
                <div className="text-caption text-neutral-600">
                  {t('modernDesignShowcase.cards.coursesLabel', { courses })}
                </div>
              </div>
              <div className="text-center">
                <div className="text-title font-semibold text-success-600">8</div>
                <div className="text-caption text-neutral-600">
                  {t('modernDesignShowcase.cards.completedLabel')}
                </div>
              </div>
            </div>
          </ModernCardContent>
        </ModernCard>
      </div>

      {/* Input Showcase */}
      <ModernCard variant="default" className="animate-fade-up">
        <ModernCardHeader>
          <ModernCardTitle size="lg">
            {t('modernDesignShowcase.forms.formComponents')}
          </ModernCardTitle>
        </ModernCardHeader>
        <ModernCardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-section">
            {/* Standard Inputs */}
            <div className="space-y-4">
              <h3 className="text-h3-semibold">
                {t('modernDesignShowcase.forms.standardInputs')}
              </h3>

              <ModernInput
                label={t('modernDesignShowcase.forms.fullNameLabel')}
                placeholder={t('modernDesignShowcase.forms.fullNamePlaceholder')}
                leftIcon={<User />}
                variant="default"
              />

              <ModernInput
                label={t('modernDesignShowcase.forms.emailLabel')}
                type="email"
                placeholder={t('modernDesignShowcase.forms.emailPlaceholder')}
                leftIcon={<Envelope />}
                variant="filled"
                helperText={t('modernDesignShowcase.forms.emailHelper')}
              />

              <ModernInput
                label={t('modernDesignShowcase.forms.passwordLabel')}
                type="password"
                placeholder={t('modernDesignShowcase.forms.passwordPlaceholder')}
                leftIcon={<Lock />}
                variant="outlined"
                state="error"
                errorText={t('modernDesignShowcase.forms.passwordError')}
              />
            </div>

            {/* Enhanced Inputs */}
            <div className="space-y-4">
              <h3 className="text-h3-semibold">
                {t('modernDesignShowcase.forms.enhancedInputs')}
              </h3>

              <ModernInput
                label={t('modernDesignShowcase.forms.searchLabel')}
                placeholder={t('modernDesignShowcase.forms.searchPlaceholder', {
                  courses,
                })}
                leftIcon={<MagnifyingGlass />}
                variant="ghost"
              />

              <ModernInput
                label={t('modernDesignShowcase.forms.usernameLabel')}
                placeholder={t('modernDesignShowcase.forms.usernamePlaceholder')}
                variant="default"
                state="success"
                helperText={t('modernDesignShowcase.forms.usernameHelper')}
              />

              <ModernInput
                label={t('modernDesignShowcase.forms.loadingExampleLabel')}
                placeholder={t(
                  'modernDesignShowcase.forms.loadingExamplePlaceholder'
                )}
                isLoading={true}
                variant="filled"
              />
            </div>
          </div>
        </ModernCardContent>
        <ModernCardFooter>
          <ModernButton
            variant="primary"
            size="md"
            className="me-3"
            onClick={() =>
              handleAction(t('modernDesignShowcase.actions.formSubmit'))
            }
            isLoading={isLoading}
          >
            {t('modernDesignShowcase.forms.submitForm')}
          </ModernButton>
          <ModernButton variant="ghost" size="md">
            {t('modernDesignShowcase.forms.reset')}
          </ModernButton>
        </ModernCardFooter>
      </ModernCard>

      {/* Animation Showcase */}
      <ModernCard variant="subtle" className="animate-fade-up">
        <ModernCardHeader>
          <ModernCardTitle size="lg">
            {t('modernDesignShowcase.animations.title')}
          </ModernCardTitle>
        </ModernCardHeader>
        <ModernCardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-section">
            <div className="text-center space-y-4">
              <div className="w-20 h-20 bg-primary-100 rounded-xl flex items-center justify-center mx-auto hover-lift-gentle">
                <div className="w-8 h-8 bg-primary-500 rounded-full animate-pulse-soft"></div>
              </div>
              <div>
                <div className="text-subtitle font-medium">
                  {t('modernDesignShowcase.animations.hoverLift.title')}
                </div>
                <div className="text-caption text-neutral-600">
                  {t('modernDesignShowcase.animations.hoverLift.description')}
                </div>
              </div>
            </div>

            <div className="text-center space-y-4">
              <div className="w-20 h-20 bg-success-100 rounded-xl flex items-center justify-center mx-auto hover-scale-gentle">
                <div className="w-8 h-8 bg-success-500 rounded-full animate-bounce-gentle"></div>
              </div>
              <div>
                <div className="text-subtitle font-medium">
                  {t('modernDesignShowcase.animations.scaleEffect.title')}
                </div>
                <div className="text-caption text-neutral-600">
                  {t('modernDesignShowcase.animations.scaleEffect.description')}
                </div>
              </div>
            </div>

            <div className="text-center space-y-4">
              <div className="w-20 h-20 bg-warning-100 rounded-xl flex items-center justify-center mx-auto clickable">
                <div className="w-8 h-8 bg-warning-500 rounded-full animate-scale-in"></div>
              </div>
              <div>
                <div className="text-subtitle font-medium">
                  {t('modernDesignShowcase.animations.clickEffect.title')}
                </div>
                <div className="text-caption text-neutral-600">
                  {t('modernDesignShowcase.animations.clickEffect.description')}
                </div>
              </div>
            </div>
          </div>
        </ModernCardContent>
      </ModernCard>

      {/* Footer */}
      <div className="text-center space-y-4 animate-fade-up">
        <p className="text-body text-neutral-600">
          {t('modernDesignShowcase.footer.description')}
        </p>
        <div className="flex justify-center space-x-4">
          <ModernButton
            variant="outline"
            size="sm"
            onClick={() => window.open('/docs/DESIGN_SYSTEM.md', '_blank')}
          >
            {t('modernDesignShowcase.footer.viewDocumentation')}
          </ModernButton>
          <ModernButton
            variant="ghost"
            size="sm"
            onClick={() => window.open('https://github.com', '_blank')}
          >
            {t('modernDesignShowcase.footer.githubRepository')}
          </ModernButton>
        </div>
      </div>
    </div>
  );
};

export default ModernDesignShowcase; 