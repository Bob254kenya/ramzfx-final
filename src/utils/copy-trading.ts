import { api_base } from '@/external/bot-skeleton';
import { getDomainConfig, isProduction } from '@/components/shared/utils/config/config';
import brandConfig from '../../brand.config.json';

export type TCopierSettings = {
    max_trade_stake?: number;
    min_trade_stake?: number;
    trade_types?: string[];
};

export type TCopyTradingStats = {
    active_since?: number;
    avg_duration?: string;
    avg_loss?: number;
    avg_profit?: number;
    avg_stake?: number;
    breakeven_trades_percentage?: number;
    copiers?: number;
    last_updated?: number;
    losing_trades_percentage?: number;
    monthly_profitable_trades?: Record<string, number>;
    performance_probability?: number;
    profitable_trades_percentage?: number;
    total_profitable_runs?: number;
    total_trades?: number;
    trades_breakdown?: Record<string, number>;
    trades_profitable_breakdown?: Record<string, number>;
    yearly_profitable_trades?: Record<string, number>;
};

export type TTokenAccountInfo = {
    balance: number;
    currency: string;
    email?: string;
    is_virtual: boolean;
    loginid: string;
};

const throwIfError = (response: any, fallback_message: string) => {
    if (response?.error) {
        throw new Error(response.error.message || fallback_message);
    }
    return response;
};

const ensureAuthorized = async () => {
    if (api_base.is_authorized) return;
    await (api_base as any).authorizeAndSubscribe?.();
    if (!api_base.is_authorized) {
        throw new Error('Please log in to your Deriv account before using Copy Trading.');
    }
};

/**
 * Deriv now issues "pat_..." Personal Access Tokens from the standard API Token page.
 * These are NOT compatible with the classic `wss://ws.derivws.com/websockets/v3`
 * `{ authorize: token }` message — that legacy call only understands the old short
 * alphanumeric tokens. New-format PATs (and OAuth access tokens) are meant to be sent
 * as a REST `Authorization: Bearer` header instead. See DerivWSAccountsService, which
 * already implements this same REST flow for the app's own login session.
 */
const getDerivWSBaseURL = () => {
    const environment = isProduction() ? 'production' : 'staging';
    return brandConfig.platform.derivws.url[environment as 'production' | 'staging'];
};

type TRestDerivAccount = {
    account_id: string;
    balance: string;
    currency: string;
    group?: string;
    status?: string;
    account_type: 'demo' | 'real';
};

/**
 * Verifies a token via Deriv's newer REST `accounts` endpoint using Bearer auth.
 * Works for both new-format PATs and OAuth access tokens. Returns null (rather than
 * throwing) if the token doesn't look like it belongs to this newer auth system, so
 * the caller can fall back to the legacy websocket flow for old-style tokens.
 */
const fetchAccountInfoViaRest = async (token: string): Promise<TTokenAccountInfo | null> => {
    try {
        const { appId } = getDomainConfig();
        const baseURL = getDerivWSBaseURL();
        const optionsDir = brandConfig.platform.derivws.directories.options;
        const endpoint = `${baseURL}${optionsDir}accounts`;

        const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
                'Deriv-App-ID': String(appId),
            },
        });

        if (response.status === 401 || response.status === 403) {
            throw new Error('This API token is invalid or has expired.');
        }
        if (!response.ok) {
            // Not a recognizable REST/PAT response (e.g. this endpoint doesn't
            // exist for old-style tokens) — let the caller try the legacy path.
            return null;
        }

        const data = await response.json();
        const accounts: TRestDerivAccount[] = data?.data ?? [];
        if (!accounts.length) {
            throw new Error('No accounts were found for this token.');
        }

        const account = accounts.find(item => !item.status || item.status === 'active') ?? accounts[0];
        return {
            balance: Number(account.balance ?? 0),
            currency: account.currency ?? 'USD',
            is_virtual: account.account_type === 'demo',
            loginid: account.account_id ?? '',
        };
    } catch (error) {
        if (error instanceof Error && error.message.includes('invalid or has expired')) throw error;
        // Network/parse issues on the REST path — fall back to the legacy websocket check.
        return null;
    }
};

/**
 * Verifies an arbitrary API token and returns the balance/currency/loginid behind it,
 * WITHOUT touching the app's own authorized trading session. Opens a short-lived,
 * isolated WebSocket connection that is closed as soon as the answer arrives.
 *
 * Tries the newer REST (Bearer/PAT) flow first, since that's what Deriv now issues
 * from the API Token page, then falls back to the classic websocket `authorize`
 * message for anyone still holding an old-format short token.
 */
export const fetchAccountInfoForToken = async (token: string): Promise<TTokenAccountInfo> => {
    const trimmed_token = token.trim();
    if (!trimmed_token) {
        throw new Error('Enter an API token first.');
    }

    const restResult = await fetchAccountInfoViaRest(trimmed_token);
    if (restResult) return restResult;

    return new Promise((resolve, reject) => {
        const { appId } = getDomainConfig();
        const socket = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId)}`);

        const timeout = setTimeout(() => {
            socket.close();
            reject(new Error('Timed out verifying this token. Please try again.'));
        }, 10000);

        socket.onopen = () => {
            socket.send(JSON.stringify({ authorize: trimmed_token }));
        };

        socket.onmessage = event => {
            try {
                const data = JSON.parse(event.data);
                if (data.msg_type !== 'authorize') return;

                clearTimeout(timeout);
                socket.close();

                if (data.error) {
                    reject(new Error(data.error.message || 'This API token is invalid or has expired.'));
                    return;
                }

                const authorize = data.authorize ?? {};
                resolve({
                    balance: Number(authorize.balance ?? 0),
                    currency: authorize.currency ?? 'USD',
                    email: authorize.email,
                    is_virtual: Boolean(authorize.is_virtual),
                    loginid: authorize.loginid ?? '',
                });
            } catch {
                clearTimeout(timeout);
                socket.close();
                reject(new Error('Unexpected response while verifying this token.'));
            }
        };

        socket.onerror = () => {
            clearTimeout(timeout);
            socket.close();
            reject(new Error('Could not connect to Deriv to verify this token.'));
        };
    });
};

/**
 * Starts copying another trader's real-money trades into the currently
 * authorized account. `master_token` must be a read-only API token
 * generated by the trader being copied (with `allow_copiers` enabled).
 */
export const startCopyTrading = async (master_token: string, settings: TCopierSettings = {}) => {
    await ensureAuthorized();

    const request: Record<string, unknown> = { copy_start: master_token.trim() };
    if (settings.max_trade_stake) request.max_trade_stake = settings.max_trade_stake;
    if (settings.min_trade_stake) request.min_trade_stake = settings.min_trade_stake;
    if (settings.trade_types?.length) request.trade_types = settings.trade_types;

    const response = await (api_base.api as any).send(request);
    return throwIfError(response, 'Unable to start copy trading with this token.');
};

/** Stops copying the trader identified by the given read-only token. */
export const stopCopyTrading = async (master_token: string) => {
    await ensureAuthorized();

    const response = await (api_base.api as any).send({ copy_stop: master_token.trim() });
    return throwIfError(response, 'Unable to stop copy trading.');
};

/** Fetches performance/risk/copier statistics for the account behind the given token. */
export const fetchCopyTradingStatistics = async (master_token: string): Promise<TCopyTradingStats> => {
    await ensureAuthorized();

    const response = await (api_base.api as any).send({
        copytrading_statistics: 1,
        trader_id: master_token.trim(),
    });
    const result = throwIfError(response, 'Unable to fetch trader statistics.');
    return (result?.copytrading_statistics ?? {}) as TCopyTradingStats;
};

/** Fetches the current account's own copiers list / active copy relationships, when available. */
export const fetchCopiersList = async () => {
    await ensureAuthorized();

    const response = await (api_base.api as any).send({ copytrading_list: 1 });
    return throwIfError(response, 'Unable to fetch copiers list.');
};

/** Enables or disables `allow_copiers` on the currently authorized (real-money) account. */
export const setAllowCopiers = async (allow: boolean) => {
    await ensureAuthorized();

    const response = await (api_base.api as any).send({
        set_settings: 1,
        allow_copiers: allow ? 1 : 0,
    });
    return throwIfError(response, 'Unable to update copy trading permission.');
};
