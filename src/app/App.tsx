import React, { lazy, Suspense } from 'react';
import { createBrowserRouter, createRoutesFromElements, Navigate, Route, RouterProvider } from 'react-router-dom';
import ChunkLoader from '@/components/loader/chunk-loader';
import LocalStorageSyncWrapper from '@/components/localStorage-sync-wrapper';
import RoutePromptDialog from '@/components/route-prompt-dialog';
import AIAssistant from '@/components/ai-assistant/AIAssistant';
import { useAccountSwitching } from '@/hooks/useAccountSwitching';
import { useLanguageFromURL } from '@/hooks/useLanguageFromURL';
import { useOAuthCallback, LegacyAccount } from '@/hooks/useOAuthCallback';
import { StoreProvider } from '@/hooks/useStore';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import { initializeI18n, localize, TranslationProvider } from '@deriv-com/translations';
import CoreStoreProvider from './CoreStoreProvider';
import ErrorBoundary from './ErrorBoundary';
import './app-root.scss';

const Layout = lazy(() => import('../components/layout'));
// AppRoot shouldn't be lazy-loaded if it contains critical initialization
// If you must lazy-load it, ensure the API init happens elsewhere
const AppRoot = lazy(() => import('./app-root'));

const i18nInstance = initializeI18n({ 
    cdnUrl: process.env.TRANSLATIONS_CDN_URL || '' 
});

const LanguageHandler = ({ children }: { children: React.ReactNode }) => {
    useLanguageFromURL();
    return <>{children}</>;
};

const router = createBrowserRouter(
    createRoutesFromElements(
        <Route
            path='/'
            element={
                <Suspense
                    fallback={<ChunkLoader message={localize('Please wait while we connect to the server...')} />}
                >
                    <TranslationProvider defaultLang='EN' i18nInstance={i18nInstance}>
                        <LanguageHandler>
                            <StoreProvider>
                                <LocalStorageSyncWrapper>
                                    <RoutePromptDialog />
                                    <AIAssistant />
                                    <CoreStoreProvider>
                                        <Layout />
                                    </CoreStoreProvider>
                                </LocalStorageSyncWrapper>
                            </StoreProvider>
                        </LanguageHandler>
                    </TranslationProvider>
                </Suspense>
            }
        >
            <Route index element={<AppRoot />} />
            <Route path='*' element={<Navigate to='/' replace />} />
        </Route>
    )
);

function storeLegacyAccounts(accounts: LegacyAccount[]): void {
    if (!accounts || accounts.length === 0) {
        console.warn('[Legacy OAuth] No accounts provided to store');
        return;
    }

    const accountsList: Record<string, string> = {};
    const clientAccounts: Record<string, { currency: string; token: string }> = {};

    for (const { loginid, token, currency } of accounts) {
        accountsList[loginid] = token;
        clientAccounts[loginid] = { currency, token };
    }

    localStorage.setItem('accountsList', JSON.stringify(accountsList));
    localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));

    const realAccount = accounts.find(a => !a.loginid.startsWith('VRT')) ?? accounts[0];
    if (realAccount) {
        localStorage.setItem('authToken', realAccount.token);
        localStorage.setItem('active_loginid', realAccount.loginid);
        const isDemo = realAccount.loginid.startsWith('VRT') || realAccount.loginid.startsWith('VRTC');
        localStorage.setItem('account_type', isDemo ? 'demo' : 'real');

        console.log('[Legacy OAuth] ✅ Legacy account stored:', {
            loginid: realAccount.loginid,
            token_type: typeof realAccount.token,
            token_length: realAccount.token.length,
            account_type: isDemo ? 'demo' : 'real',
        });
    } else {
        console.error('[Legacy OAuth] ❌ No valid account found in OAuth response:', accounts);
    }
}

function App() {
    const { 
        isProcessing, 
        isValid, 
        params: { code }, 
        legacyAccounts, 
        error, 
        cleanupURL 
    } = useOAuthCallback();

    useAccountSwitching();

    // ── Legacy Deriv OAuth ────────────────────────────────
    React.useEffect(() => {
        if (!isProcessing && legacyAccounts && legacyAccounts.length > 0) {
            cleanupURL();
            storeLegacyAccounts(legacyAccounts);
        }
    }, [isProcessing, legacyAccounts, cleanupURL]);

    // ── New OAuth2 PKCE ───────────────────────────────────
    React.useEffect(() => {
        if (isProcessing || !isValid || !code) return;

        OAuthTokenExchangeService.exchangeCodeForToken(code)
            .then(response => {
                if (response.access_token || response.error) {
                    cleanupURL();
                }
                if (response.error) {
                    console.error('❌ Token exchange failed:', response.error, response.error_description);
                }
            })
            .catch(err => {
                console.error('❌ Token exchange request failed:', err);
                cleanupURL();
            });
    }, [isProcessing, isValid, code, cleanupURL]);

    // Log errors separately
    React.useEffect(() => {
        if (!isProcessing && error) {
            console.error('OAuth callback error:', error);
        }
    }, [isProcessing, error]);

    return (
        <ErrorBoundary>
            <RouterProvider router={router} />
        </ErrorBoundary>
    );
}

export default App;
