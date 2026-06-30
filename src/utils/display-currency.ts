import { addComma, formatMoney } from '@/components/shared';

export const DISPLAY_CURRENCIES = ['USD', 'KES', 'TZS', 'NGN'] as const;

export type TDisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

// Default fallback rates (used until live rates are fetched)
const DEFAULT_RATES: Record<Exclude<TDisplayCurrency, 'USD'>, number> = {
    KES: 129,
    TZS: 2700,
    NGN: 1600,
};

// Flag shown next to each currency. USD intentionally has no flag —
// it is the base/neutral currency.
export const CURRENCY_FLAGS: Record<TDisplayCurrency, string> = {
    USD: '🇺🇸',
    KES: '🇰🇪',
    TZS: '🇹🇿',
    NGN: '🇳🇬',
};

export const getCurrencyFlag = (currency?: string | null): string =>
    CURRENCY_FLAGS[resolveDisplayCurrency(currency, 'USD')];

const normalizeCurrency = (currency?: string | null) => (currency || 'USD').toUpperCase();

export const isSupportedDisplayCurrency = (currency?: string | null): currency is TDisplayCurrency =>
    DISPLAY_CURRENCIES.includes(normalizeCurrency(currency) as TDisplayCurrency);

export const sanitizeRate = (value?: number | null, fallback = 1) =>
    Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback;

// Kept for backwards compatibility with existing call sites
export const sanitizeUsdKesRate = (value?: number | null) => sanitizeRate(value, DEFAULT_RATES.KES);

export const resolveDisplayCurrency = (currency?: string | null, fallback: TDisplayCurrency = 'USD'): TDisplayCurrency =>
    isSupportedDisplayCurrency(currency) ? (normalizeCurrency(currency) as TDisplayCurrency) : fallback;

export type TUsdRates = Partial<Record<Exclude<TDisplayCurrency, 'USD'>, number | null>>;

const getRate = (displayCurrency: TDisplayCurrency, rates?: TUsdRates | null) => {
    if (displayCurrency === 'USD') return 1;
    const fallback = DEFAULT_RATES[displayCurrency];
    return sanitizeRate(rates?.[displayCurrency], fallback);
};

export const convertDisplayAmount = (
    amount: number | string,
    sourceCurrency: string,
    displayCurrency: TDisplayCurrency,
    rates?: TUsdRates | null
) => {
    const numericAmount = Number(String(amount ?? 0).replace(/,/g, ''));
    if (!Number.isFinite(numericAmount)) return 0;

    const normalizedSource = normalizeCurrency(sourceCurrency);
    const normalizedDisplay = resolveDisplayCurrency(displayCurrency);

    if (normalizedSource === normalizedDisplay) return numericAmount;

    const rate = getRate(normalizedDisplay as TDisplayCurrency, rates);

    if (normalizedSource === 'USD') return numericAmount * rate;

    if (DISPLAY_CURRENCIES.includes(normalizedSource as TDisplayCurrency) && normalizedDisplay === 'USD') {
        const sourceRate = getRate(normalizedSource as TDisplayCurrency, rates);
        return numericAmount / sourceRate;
    }

    return numericAmount;
};

export const getDisplayMoney = (
    amount: number | string,
    sourceCurrency: string,
    displayCurrency: TDisplayCurrency,
    rates?: TUsdRates | null
) => {
    const normalizedSource = normalizeCurrency(sourceCurrency);
    const normalizedDisplay = resolveDisplayCurrency(displayCurrency);

    if (!DISPLAY_CURRENCIES.includes(normalizedSource as TDisplayCurrency)) {
        return {
            amount: Number(String(amount ?? 0).replace(/,/g, '')) || 0,
            currency: normalizedSource || 'USD',
        };
    }

    return {
        amount: convertDisplayAmount(amount, normalizedSource, normalizedDisplay, rates),
        currency: normalizedDisplay,
    };
};

export const formatDisplayMoneyValue = (
    amount: number | string,
    sourceCurrency: string,
    displayCurrency: TDisplayCurrency,
    rates?: TUsdRates | null,
    showCurrency = true
) => {
    const resolved = getDisplayMoney(amount, sourceCurrency, displayCurrency, rates);
    const formattedAmount = formatMoney(resolved.currency, resolved.amount, true, 0, 0);
    return showCurrency ? `${formattedAmount} ${resolved.currency}` : formattedAmount;
};

export const formatDisplayBalanceValue = (
    amount: number | string,
    sourceCurrency: string,
    displayCurrency: TDisplayCurrency,
    rates?: TUsdRates | null
) => {
    const resolved = getDisplayMoney(amount, sourceCurrency, displayCurrency, rates);
    return `${addComma(resolved.amount.toFixed(2))} ${resolved.currency}`;
};
