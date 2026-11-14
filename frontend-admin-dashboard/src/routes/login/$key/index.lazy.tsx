import { createLazyFileRoute, useNavigate, useParams } from '@tanstack/react-router';
import { TokenKey } from '@/constants/auth/tokens';
import { loginUser } from '@/hooks/login/login-button';
import { setAuthorizationCookie } from '@/lib/auth/sessionUtility';
import { handleLoginFlow, navigateFromLoginFlow } from '@/lib/auth/loginFlowHandler';
import { loginSchema } from '@/schemas/login/login';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import CryptoJS from 'crypto-js';
import ClipLoader from 'react-spinners/ClipLoader';
import { getCachedInstituteBranding } from '@/services/domain-routing';
import { useTheme } from '@/providers/theme/theme-provider';
import { useTranslation } from 'react-i18next';

export const Route = createLazyFileRoute('/login/$key/')({
  component: RouteComponent,
});

type FormValues = z.infer<typeof loginSchema>;

function RouteComponent() {
  const { t } = useTranslation('loginKeyIndex');
  const queryClient = useQueryClient();
  const { key } = useParams({ from: '/login/$key/' });
  const secretKey = 'asjhdjyehbadkjakykajnasdajgasdas';
  const bytes = CryptoJS.AES.decrypt(key, secretKey);
  const text = bytes.toString(CryptoJS.enc.Utf8);
  const credentials = JSON.parse(text);

  const navigate = useNavigate();

  // Drive the spinner from the institute theme (never the hardcoded Vacademy
  // orange) so it stays on-brand on white-labelled domains. Mirrors DashboardLoader.
  const { getPrimaryColorCode } = useTheme();
  const loaderColor = getCachedInstituteBranding()?.instituteThemeCode || getPrimaryColorCode();

  const mutation = useMutation({
    mutationFn: (values: FormValues) => loginUser(values.username, values.password),
    onSuccess: async (response) => {
      if (response) {
        // Use centralized login flow
        const result = await handleLoginFlow({
          loginMethod: 'demo_account',
          accessToken: response.accessToken,
          refreshToken: response.refreshToken,
          queryClient
        });

        if (result.shouldShowInstituteSelection) {
          // For demo accounts, we'll redirect to institute selection page
          window.location.href = '/login?showInstituteSelection=true';
        } else {
          navigateFromLoginFlow(result);
        }
      } else {
        toast.error(t('loginError'), {
          description: t('invalidCredentials'),
          className: 'error-toast',
          duration: 3000,
        });
      }
    },
    onError: (error: unknown) => {
      console.error(error);
    },
  });

  useEffect(() => {
    setTimeout(() => {
      mutation.mutate({
        username: credentials.username,
        password: credentials.password,
      });
    }, 10);
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center">
      <h1 className="mb-4">{t('loadingDemoAccount')}</h1>
      <ClipLoader size={40} color={loaderColor} />
    </div>
  );
}
