import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { contract_stages } from '@/constants/contract-stage';
import { DBOT_TABS } from '@/constants/bot-contents';
import { api_base, observer as globalObserver } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import {
    calculateDigitPercentagesFromDigits,
    DIGIT_STRATEGIES,
    evaluateDigitStrategy,
    SUPPORTED_VOLATILITY_MARKETS,
    type DigitStrategyId,
} from '@/utils/digit-strategy';
import { getLastDigitFromQuote, getMarketPipSize, isExpectedStreamInterruption } from '@/utils/market-data';
import { buyContractForUi, streamContractUntilSettled } from '@/utils/trade-purchase';
import { safeSubscribe } from '@/utils/websocket-handler';
import './auto-bots.scss';

// ============================================================================
// Types
// ============================================================================

type TTradeType = 'DIGITOVER' | 'DIGITUNDER' | 'DIGITEVEN' | 'DIGITODD' | 'DIGITMATCH' | 'DIGITDIFF' | 'CALL' | 'PUT';
type TStrategyMode = 'MANUAL' | DigitStrategyId;
type TMartingaleMode = 'off' | 'after_1_loss' | 'after_2_losses' | 'after_3_losses';

type TMarketConfig = {
    barrier: string;
    strategyMode: TStrategyMode;
    tradeType: TTradeType;
};

type TMarketRuntime = {
    digits: number[];
    isTrading: boolean;
    lastResult: 'loss' | 'win' | null;
    losses: number;
    pnl: number;
    tradeCount: number;
    wins: number;
};

type TMarket = { label: string; pip: number; symbol: string };

const TRADE_TYPE_LABELS: Record<TTradeType, string> = {
    CALL: 'Rise',
    DIGITDIFF: 'Differs',
    DIGITEVEN: 'Even',
    DIGITMATCH: 'Matches',
    DIGITODD: 'Odd',
    DIGITOVER: 'Over',
    DIGITUNDER: 'Under',
    PUT: 'Fall',
};

const BARRIER_NEEDED: Record<TTradeType, boolean> = {
    CALL: false,
    DIGITDIFF: true,
    DIGITEVEN: false,
    DIGITMATCH: true,
    DIGITODD: false,
    DIGITOVER: true,
    DIGITUNDER: true,
    PUT: false,
};

const TRADE_TYPES: TTradeType[] = ['DIGITOVER', 'DIGITUNDER', 'DIGITEVEN', 'DIGITODD', 'DIGITMATCH', 'DIGITDIFF', 'CALL', 'PUT'];

const STRATEGY_MODE_OPTIONS: { id: TStrategyMode; label: string }[] = [
    { id: 'MANUAL', label: 'Manual (trade type below)' },
    { id: 'OVER_2_MARKET', label: DIGIT_STRATEGIES.OVER_2_MARKET.alertLabel },
    { id: 'UNDER_7_MARKET', label: DIGIT_STRATEGIES.UNDER_7_MARKET.alertLabel },
];

const MARTINGALE_MODE_OPTIONS: { id: TMartingaleMode; label: string }[] = [
    { id: 'off', label: 'No martingale' },
    { id: 'after_1_loss', label: 'After 1 loss' },
    { id: 'after_2_losses', label: 'After 2 losses' },
    { id: 'after_3_losses', label: 'After 3 losses' },
];

const MARTINGALE_THRESHOLD: Record<TMartingaleMode, number> = {
    after_1_loss: 1,
    after_2_losses: 2,
    after_3_losses: 3,
    off: Infinity,
};

const MARKETS: TMarket[] = SUPPORTED_VOLATILITY_MARKETS.map(market => ({
    label: market.label,
    pip: market.pip ?? 2,
    symbol: market.symbol,
}));
const MARKET_LOOKUP = new Map(MARKETS.map(m => [m.symbol, m]));

const DIGIT_HISTORY_LENGTH = 250;
const DEFAULT_STAKE = '0.5';
const DEFAULT_MARTINGALE_MULTIPLIER = 2;
const DEFAULT_TAKE_PROFIT = '10';
const DEFAULT_STOP_LOSS = '20';
const MARTINGALE_STEPS = [1, 1.2, 1.5, 1.8, 2, 2.2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10];

const cleanMoney = (value: string) => value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');

const createRuntime = (): TMarketRuntime => ({
    digits: [],
    isTrading: false,
    lastResult: null,
    losses: 0,
    pnl: 0,
    tradeCount: 0,
    wins: 0,
});

const defaultConfigFor = (symbol: string): TMarketConfig => ({
    barrier: symbol ? '2' : '2',
    strategyMode: 'OVER_2_MARKET',
    tradeType: 'DIGITOVER',
});

// ============================================================================
// TP/SL notification
// ============================================================================

const SessionEndNotification: React.FC<{
    currency: string;
    isTakeProfit: boolean;
    onClose: () => void;
    totalPnl: number;
    totalTrades: number;
}> = ({ currency, isTakeProfit, onClose, totalPnl, totalTrades }) => (
    <div className='at2-notify-overlay' onClick={onClose}>
        <div className={classNames('at2-notify', isTakeProfit ? 'at2-notify--win' : 'at2-notify--loss')} onClick={e => e.stopPropagation()}>
            <div className='at2-notify__icon'>{isTakeProfit ? '🎯' : '🛑'}</div>
            <h3 className='at2-notify__title'>{isTakeProfit ? 'Take Profit Reached' : 'Stop Loss Reached'}</h3>
            <p className='at2-notify__pnl'>
                {totalPnl >= 0 ? '+' : ''}
                {totalPnl.toFixed(2)} {currency}
            </p>
            <p className='at2-notify__meta'>{totalTrades} trade{totalTrades === 1 ? '' : 's'} across all markets</p>
            <button className='at2-notify__ok' onClick={onClose} type='button'>
                Close
            </button>
        </div>
    </div>
);

// ============================================================================
// Component
// ============================================================================

const AutoBots = observer(() => {
    const { client, dashboard, run_panel, summary_card, transactions } = useStore();
    const { active_tab } = dashboard;
    const showAutoTrades = active_tab === DBOT_TABS.AUTO_BOTS;
    const currency = client.currency || 'USD';

    // Shared session settings
    const [stakeInput, setStakeInput] = useState(DEFAULT_STAKE);
    const [martingaleMultiplier, setMartingaleMultiplier] = useState(DEFAULT_MARTINGALE_MULTIPLIER);
    const [martingaleMode, setMartingaleMode] = useState<TMartingaleMode>('after_1_loss');
    const [takeProfitInput, setTakeProfitInput] = useState(DEFAULT_TAKE_PROFIT);
    const [stopLossInput, setStopLossInput] = useState(DEFAULT_STOP_LOSS);

    // Markets
    const [activeSymbols, setActiveSymbols] = useState<string[]>(['1HZ10V']);
    const [configBySymbol, setConfigBySymbol] = useState<Record<string, TMarketConfig>>({
        '1HZ10V': defaultConfigFor('1HZ10V'),
    });
    const [runtimeBySymbol, setRuntimeBySymbol] = useState<Record<string, TMarketRuntime>>({
        '1HZ10V': createRuntime(),
    });

    const [isRunning, setIsRunning] = useState(false);
    const [isConnected, setIsConnected] = useState<Record<string, boolean>>({});
    const [totalPnl, setTotalPnl] = useState(0);
    const [totalTrades, setTotalTrades] = useState(0);
    const [showDisclaimer, setShowDisclaimer] = useState(false);
    const [notification, setNotification] = useState<{ isTakeProfit: boolean } | null>(null);

    // Refs mirroring state for the async trading loop
    const configRef = useRef(configBySymbol);
    const runtimeRef = useRef(runtimeBySymbol);
    const shouldStopRef = useRef(true);
    const totalPnlRef = useRef(0);
    const totalTradesRef = useRef(0);
    const stakeStepRef = useRef<Record<string, number>>({});
    const consecutiveLossRef = useRef<Record<string, number>>({});
    const tradeInFlightRef = useRef<Record<string, boolean>>({});
    const subscriptionsRef = useRef<Record<string, { unsubscribe?: () => void } | null>>({});
    const baseStakeRef = useRef(0);
    const stopLossRef = useRef(0);
    const takeProfitRef = useRef(0);
    const martingaleMultiplierRef = useRef(DEFAULT_MARTINGALE_MULTIPLIER);
    const martingaleModeRef = useRef<TMartingaleMode>('after_1_loss');

    useEffect(() => {
        configRef.current = configBySymbol;
    }, [configBySymbol]);
    useEffect(() => {
        runtimeRef.current = runtimeBySymbol;
    }, [runtimeBySymbol]);
    useEffect(() => {
        martingaleMultiplierRef.current = martingaleMultiplier;
    }, [martingaleMultiplier]);
    useEffect(() => {
        martingaleModeRef.current = martingaleMode;
    }, [martingaleMode]);

    const availableMarkets = useMemo(() => MARKETS.filter(m => !activeSymbols.includes(m.symbol)), [activeSymbols]);

    const patchRuntime = useCallback((symbol: string, patch: Partial<TMarketRuntime>) => {
        setRuntimeBySymbol(previous => {
            const next = { ...previous, [symbol]: { ...(previous[symbol] ?? createRuntime()), ...patch } };
            runtimeRef.current = next;
            return next;
        });
    }, []);

    const pushContract = useCallback(
        (data: any) => {
            try {
                transactions.pushTransaction({ ...data, run_id: run_panel.run_id });
                run_panel.onBotContractEvent(data);
                summary_card.onBotContractEvent(data);
            } catch {
                // side-panel observers may be unavailable
            }
        },
        [run_panel, summary_card, transactions]
    );

    // --- Market add / remove ---------------------------------------------------

    const addMarket = (symbol: string) => {
        setActiveSymbols(previous => [...previous, symbol]);
        setConfigBySymbol(previous => ({ ...previous, [symbol]: defaultConfigFor(symbol) }));
        setRuntimeBySymbol(previous => ({ ...previous, [symbol]: createRuntime() }));
    };

    const removeMarket = (symbol: string) => {
        if (isRunning) return;
        setActiveSymbols(previous => previous.filter(s => s !== symbol));
    };

    const updateConfig = (symbol: string, patch: Partial<TMarketConfig>) => {
        setConfigBySymbol(previous => ({ ...previous, [symbol]: { ...previous[symbol], ...patch } }));
    };

    // --- Ticks stream ------------------------------------------------------------

    const unsubscribeAll = useCallback(() => {
        Object.values(subscriptionsRef.current).forEach(sub => {
            try {
                sub?.unsubscribe?.();
            } catch {
                // stream may already be closed
            }
        });
        subscriptionsRef.current = {};
    }, []);

    const evaluateAndTrade = useCallback(
        async (symbol: string) => {
            if (shouldStopRef.current || tradeInFlightRef.current[symbol]) return;

            const config = configRef.current[symbol];
            const runtime = runtimeRef.current[symbol];
            if (!config || !runtime || runtime.digits.length < 25) return;

            const percentages = calculateDigitPercentagesFromDigits(runtime.digits.slice(-DIGIT_HISTORY_LENGTH));

            let tradeType: TTradeType = config.tradeType;
            let barrier: string | undefined = BARRIER_NEEDED[config.tradeType] ? config.barrier : undefined;
            let shouldTrade = true;

            if (config.strategyMode !== 'MANUAL') {
                const evaluation = evaluateDigitStrategy(config.strategyMode, percentages, runtime.digits.slice(-4));
                const strategy = DIGIT_STRATEGIES[config.strategyMode];
                tradeType = strategy.contractType;
                barrier = strategy.winBarrier;
                shouldTrade = evaluation.entryReady;
            }

            if (!shouldTrade) return;

            tradeInFlightRef.current[symbol] = true;
            const stake = stakeStepRef.current[symbol] ?? baseStakeRef.current;

            try {
                const parameters: Record<string, number | string> = {
                    amount: stake,
                    basis: 'stake',
                    contract_type: tradeType,
                    currency,
                    duration: 1,
                    duration_unit: 't',
                    symbol,
                };
                if (barrier !== undefined) parameters.barrier = barrier;

                const buy = await buyContractForUi({ parameters, price: stake, source: 'AutoTrades' });
                const marketLabel = MARKET_LOOKUP.get(symbol)?.label ?? symbol;
                const buySnapshot = {
                    buy_price: buy.buy_price,
                    contract_id: buy.contract_id,
                    contract_type: tradeType,
                    currency,
                    date_start: Math.floor(Date.now() / 1000),
                    display_name: marketLabel,
                    shortcode: `AUTO_${tradeType}_${symbol}`,
                    transaction_ids: { buy: buy.transaction_id },
                    underlying_symbol: symbol,
                };
                pushContract(buySnapshot);

                const settled = await streamContractUntilSettled({
                    contractId: buy.contract_id,
                    fallback: buySnapshot,
                    onUpdate: snapshot => pushContract(snapshot),
                    source: 'AutoTrades',
                });
                const profit = Number(settled.profit ?? 0);
                const isWin = profit > 0;

                const priorLosses = consecutiveLossRef.current[symbol] ?? 0;
                if (isWin) {
                    consecutiveLossRef.current[symbol] = 0;
                    stakeStepRef.current[symbol] = baseStakeRef.current;
                } else {
                    const nextLosses = priorLosses + 1;
                    consecutiveLossRef.current[symbol] = nextLosses;
                    const threshold = MARTINGALE_THRESHOLD[martingaleModeRef.current];
                    stakeStepRef.current[symbol] =
                        nextLosses >= threshold
                            ? baseStakeRef.current * Math.pow(martingaleMultiplierRef.current, nextLosses - threshold + 1)
                            : baseStakeRef.current;
                }

                const currentRuntime = runtimeRef.current[symbol] ?? createRuntime();
                patchRuntime(symbol, {
                    lastResult: isWin ? 'win' : 'loss',
                    losses: currentRuntime.losses + (isWin ? 0 : 1),
                    pnl: Number((currentRuntime.pnl + profit).toFixed(8)),
                    tradeCount: currentRuntime.tradeCount + 1,
                    wins: currentRuntime.wins + (isWin ? 1 : 0),
                });

                totalPnlRef.current = Number((totalPnlRef.current + profit).toFixed(8));
                totalTradesRef.current += 1;
                setTotalPnl(totalPnlRef.current);
                setTotalTrades(totalTradesRef.current);

                if (totalPnlRef.current <= -stopLossRef.current) {
                    setNotification({ isTakeProfit: false });
                    stopTrading();
                } else if (totalPnlRef.current >= takeProfitRef.current) {
                    setNotification({ isTakeProfit: true });
                    stopTrading();
                }
            } catch {
                // Individual market failures should not stop the other markets.
            } finally {
                tradeInFlightRef.current[symbol] = false;
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [currency, patchRuntime, pushContract]
    );

    const subscribeMarket = useCallback(
        (symbol: string) => {
            if (!api_base.api) return;
            const market = MARKET_LOOKUP.get(symbol);
            const pip = getMarketPipSize(symbol, market?.pip ?? 2);

            const observable = (api_base.api as any).subscribe({ ticks: symbol });
            subscriptionsRef.current[symbol] = safeSubscribe(
                observable,
                (data: any) => {
                    const quote = Number(data?.tick?.quote);
                    if (!Number.isFinite(quote)) return;
                    setIsConnected(previous => ({ ...previous, [symbol]: true }));

                    const digit = getLastDigitFromQuote(quote, symbol, pip);
                    const currentRuntime = runtimeRef.current[symbol] ?? createRuntime();
                    const nextDigits = [...currentRuntime.digits, digit].slice(-DIGIT_HISTORY_LENGTH);
                    patchRuntime(symbol, { digits: nextDigits });

                    if (!shouldStopRef.current) void evaluateAndTrade(symbol);
                },
                error => {
                    if (isExpectedStreamInterruption(error)) return;
                    setIsConnected(previous => ({ ...previous, [symbol]: false }));
                }
            );
        },
        [evaluateAndTrade, patchRuntime]
    );

    // Keep tick subscriptions matched to the active market list.
    useEffect(() => {
        if (!showAutoTrades) return undefined;

        activeSymbols.forEach(symbol => {
            if (!subscriptionsRef.current[symbol]) subscribeMarket(symbol);
        });
        Object.keys(subscriptionsRef.current).forEach(symbol => {
            if (!activeSymbols.includes(symbol)) {
                try {
                    subscriptionsRef.current[symbol]?.unsubscribe?.();
                } catch {
                    // already closed
                }
                delete subscriptionsRef.current[symbol];
            }
        });

        return () => {
            if (!showAutoTrades) unsubscribeAll();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeSymbols, showAutoTrades]);

    useEffect(() => () => unsubscribeAll(), [unsubscribeAll]);

    // --- Start / stop ------------------------------------------------------------

    const stopTrading = useCallback(() => {
        shouldStopRef.current = true;
        setIsRunning(false);
        setRuntimeBySymbol(previous => {
            const next = { ...previous };
            Object.keys(next).forEach(symbol => {
                next[symbol] = { ...next[symbol], isTrading: false };
            });
            runtimeRef.current = next;
            return next;
        });

        try {
            run_panel.setIsRunning(false);
            run_panel.setContractStage?.(contract_stages.NOT_RUNNING);
        } catch {
            // run panel may not be mounted yet
        }
        dashboard.setActiveTradingModule(null);
    }, [dashboard, run_panel]);

    useEffect(() => {
        if (!showAutoTrades) return undefined;
        dashboard.registerTradingStopHandler('auto_bots', stopTrading);
        globalObserver.register('bot.manual_stop', stopTrading);
        return () => {
            dashboard.unregisterTradingStopHandler('auto_bots');
            if (globalObserver.isRegistered('bot.manual_stop')) {
                globalObserver.unregister('bot.manual_stop', stopTrading);
            }
            shouldStopRef.current = true;
        };
    }, [dashboard, showAutoTrades, stopTrading]);

    const startTrading = () => {
        const stake = Number(stakeInput);
        const stopLoss = Number(stopLossInput);
        const takeProfit = Number(takeProfitInput);

        if (!Number.isFinite(stake) || stake <= 0) return;
        if (!Number.isFinite(stopLoss) || stopLoss <= 0 || !Number.isFinite(takeProfit) || takeProfit <= 0) return;
        if (activeSymbols.length === 0) return;

        baseStakeRef.current = stake;
        stopLossRef.current = stopLoss;
        takeProfitRef.current = takeProfit;
        totalPnlRef.current = 0;
        totalTradesRef.current = 0;
        stakeStepRef.current = {};
        consecutiveLossRef.current = {};
        tradeInFlightRef.current = {};
        shouldStopRef.current = false;

        setTotalPnl(0);
        setTotalTrades(0);
        setRuntimeBySymbol(previous => {
            const next: Record<string, TMarketRuntime> = {};
            activeSymbols.forEach(symbol => {
                next[symbol] = { ...(previous[symbol] ?? createRuntime()), isTrading: true, losses: 0, pnl: 0, tradeCount: 0, wins: 0 };
            });
            runtimeRef.current = next;
            return next;
        });
        setIsRunning(true);

        try {
            run_panel.setRunId(`auto-trades-${Date.now()}`);
            run_panel.setIsRunning(true);
            run_panel.setContractStage?.(contract_stages.RUNNING);
            run_panel.toggleDrawer(true);
        } catch {
            // run panel may not be mounted yet
        }
        dashboard.setActiveTradingModule('auto_bots');

        activeSymbols.forEach(symbol => void evaluateAndTrade(symbol));
    };

    if (!showAutoTrades) return null;

    return (
        <div className='at2-page'>
            <div className='at2-scroll'>
                <div className='at2-header'>
                    <div>
                        <h1 className='at2-header__title'>Auto Trades</h1>
                        <p className='at2-header__subtitle'>Run multiple markets at once with independent signals and a shared risk budget</p>
                    </div>
                    {isRunning ? (
                        <button className='at2-btn at2-btn--stop' type='button' onClick={stopTrading}>
                            ■ Stop All
                        </button>
                    ) : (
                        <button className='at2-btn at2-btn--start' type='button' onClick={startTrading} disabled={activeSymbols.length === 0}>
                            ▶ Start All
                        </button>
                    )}
                </div>

                <div className='at2-settings'>
                    <label className='at2-field'>
                        <span>Base stake</span>
                        <input inputMode='decimal' disabled={isRunning} value={stakeInput} onChange={e => setStakeInput(cleanMoney(e.target.value))} />
                    </label>
                    <label className='at2-field'>
                        <span>Martingale mode</span>
                        <select value={martingaleMode} disabled={isRunning} onChange={e => setMartingaleMode(e.target.value as TMartingaleMode)}>
                            {MARTINGALE_MODE_OPTIONS.map(opt => (
                                <option key={opt.id} value={opt.id}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className='at2-field'>
                        <span>Martingale ×</span>
                        <select value={martingaleMultiplier} disabled={isRunning || martingaleMode === 'off'} onChange={e => setMartingaleMultiplier(Number(e.target.value))}>
                            {MARTINGALE_STEPS.map(step => (
                                <option key={step} value={step}>
                                    {step.toFixed(1)}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className='at2-field'>
                        <span>Take profit (total)</span>
                        <input inputMode='decimal' disabled={isRunning} value={takeProfitInput} onChange={e => setTakeProfitInput(cleanMoney(e.target.value))} />
                    </label>
                    <label className='at2-field'>
                        <span>Stop loss (total)</span>
                        <input inputMode='decimal' disabled={isRunning} value={stopLossInput} onChange={e => setStopLossInput(cleanMoney(e.target.value))} />
                    </label>
                </div>

                {isRunning && (
                    <div className='at2-session-bar'>
                        <div>
                            <span>Session P/L</span>
                            <strong className={totalPnl >= 0 ? 'at2-pnl--pos' : 'at2-pnl--neg'}>
                                {totalPnl >= 0 ? '+' : ''}
                                {totalPnl.toFixed(2)} {currency}
                            </strong>
                        </div>
                        <div>
                            <span>Total trades</span>
                            <strong>{totalTrades}</strong>
                        </div>
                        <div>
                            <span>Active markets</span>
                            <strong>{activeSymbols.length}</strong>
                        </div>
                    </div>
                )}

                <div className='at2-markets'>
                    {activeSymbols.map(symbol => {
                        const market = MARKET_LOOKUP.get(symbol);
                        const config = configBySymbol[symbol] ?? defaultConfigFor(symbol);
                        const runtime = runtimeBySymbol[symbol] ?? createRuntime();
                        const connected = Boolean(isConnected[symbol]);

                        return (
                            <div key={symbol} className='at2-card'>
                                <div className='at2-card__header'>
                                    <div>
                                        <p className='at2-card__label'>{market?.label ?? symbol}</p>
                                        <span className={classNames('at2-card__status', { 'at2-card__status--live': connected })}>
                                            {connected ? 'Live' : 'Connecting…'}
                                        </span>
                                    </div>
                                    {!isRunning && (
                                        <button className='at2-card__remove' type='button' onClick={() => removeMarket(symbol)} title='Remove market'>
                                            ✕
                                        </button>
                                    )}
                                </div>

                                <label className='at2-field'>
                                    <span>Strategy</span>
                                    <select
                                        value={config.strategyMode}
                                        disabled={isRunning}
                                        onChange={e => updateConfig(symbol, { strategyMode: e.target.value as TStrategyMode })}
                                    >
                                        {STRATEGY_MODE_OPTIONS.map(opt => (
                                            <option key={opt.id} value={opt.id}>
                                                {opt.label}
                                            </option>
                                        ))}
                                    </select>
                                </label>

                                {config.strategyMode === 'MANUAL' && (
                                    <div className='at2-field-row'>
                                        <label className='at2-field'>
                                            <span>Trade type</span>
                                            <select value={config.tradeType} disabled={isRunning} onChange={e => updateConfig(symbol, { tradeType: e.target.value as TTradeType })}>
                                                {TRADE_TYPES.map(type => (
                                                    <option key={type} value={type}>
                                                        {TRADE_TYPE_LABELS[type]}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                        {BARRIER_NEEDED[config.tradeType] && (
                                            <label className='at2-field'>
                                                <span>Barrier</span>
                                                <select value={config.barrier} disabled={isRunning} onChange={e => updateConfig(symbol, { barrier: e.target.value })}>
                                                    {Array.from({ length: 10 }, (_, digit) => (
                                                        <option key={digit} value={digit}>
                                                            {digit}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                        )}
                                    </div>
                                )}

                                {runtime.digits.length > 0 && (
                                    <div className='at2-card__digits'>
                                        {runtime.digits.slice(-8).map((digit, idx) => (
                                            <span key={idx} className={classNames('at2-digit', { 'at2-digit--low': digit <= 4, 'at2-digit--high': digit > 4 })}>
                                                {digit}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {runtime.tradeCount > 0 && (
                                    <div className='at2-card__footer'>
                                        <span>
                                            {runtime.wins}W / {runtime.losses}L
                                        </span>
                                        <span className={runtime.pnl >= 0 ? 'at2-pnl--pos' : 'at2-pnl--neg'}>
                                            {runtime.pnl >= 0 ? '+' : ''}
                                            {runtime.pnl.toFixed(2)} {currency}
                                        </span>
                                        {runtime.lastResult && (
                                            <span className={runtime.lastResult === 'win' ? 'at2-pnl--pos' : 'at2-pnl--neg'}>
                                                {runtime.lastResult === 'win' ? '✓' : '✗'}
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {!isRunning && availableMarkets.length > 0 && (
                    <div className='at2-available'>
                        <h3 className='at2-available__title'>Add a market</h3>
                        <div className='at2-available__grid'>
                            {availableMarkets.map(market => (
                                <button key={market.symbol} className='at2-add-btn' type='button' onClick={() => addMarket(market.symbol)}>
                                    + {market.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <button className='at2-disclaimer-btn' type='button' onClick={() => setShowDisclaimer(true)}>
                ⚠ Risk Disclaimer
            </button>

            {showDisclaimer && (
                <div className='at2-disclaimer-overlay' onClick={() => setShowDisclaimer(false)}>
                    <div className='at2-disclaimer-modal' onClick={e => e.stopPropagation()}>
                        <div className='at2-disclaimer-modal__header'>
                            <span>⚠</span>
                            <h3>Risk Disclaimer</h3>
                            <button type='button' onClick={() => setShowDisclaimer(false)}>
                                ✕
                            </button>
                        </div>
                        <div className='at2-disclaimer-modal__body'>
                            <p>
                                Deriv offers complex derivatives, such as options and contracts for difference (&ldquo;CFDs&rdquo;). These products may not be
                                suitable for all clients, and trading them puts you at risk.
                            </p>
                            <ul>
                                <li>You may lose some or all of the money you invest in the trade.</li>
                                <li>If your trade involves currency conversion, exchange rates will affect your profit and loss.</li>
                                <li>You should never trade with borrowed money or with money you cannot afford to lose.</li>
                            </ul>
                        </div>
                        <button className='at2-disclaimer-modal__ok' type='button' onClick={() => setShowDisclaimer(false)}>
                            I Understand
                        </button>
                    </div>
                </div>
            )}

            {notification && (
                <SessionEndNotification
                    currency={currency}
                    isTakeProfit={notification.isTakeProfit}
                    onClose={() => setNotification(null)}
                    totalPnl={totalPnlRef.current}
                    totalTrades={totalTradesRef.current}
                />
            )}
        </div>
    );
});

export default AutoBots;
