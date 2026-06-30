import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { DBOT_TABS } from '@/constants/bot-contents';
import { api_base, MessageTypes } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { buyContractForUi, streamContractUntilSettled } from '@/utils/trade-purchase';
import { safeSubscribe } from '@/utils/websocket-handler';
import { Localize } from '@deriv-com/translations';
import './aviator-accumulator.scss';

type TPhase = 'idle' | 'flying' | 'crashed' | 'cashed';
type TWinStrategy = 'reset' | 'compound';

type TBreakoutRecord = {
    id: string;
    multiplier: number;
    won: boolean;
    profit: number;
    stake: number;
    time: number;
};

type TVolatilitySnapshot = {
    quote: number;
    prevQuote: number | null;
    epoch: number;
};

const ACCUMULATOR_MARKETS = [
    { label: 'Volatility 10 (1s) Index', symbol: '1HZ10V' },
    { label: 'Volatility 25 (1s) Index', symbol: '1HZ25V' },
    { label: 'Volatility 50 (1s) Index', symbol: '1HZ50V' },
    { label: 'Volatility 75 (1s) Index', symbol: '1HZ75V' },
    { label: 'Volatility 100 (1s) Index', symbol: '1HZ100V' },
];

const GROWTH_RATES = [
    { label: '1%', value: '0.01' },
    { label: '2%', value: '0.02' },
    { label: '3%', value: '0.03' },
    { label: '4%', value: '0.04' },
    { label: '5%', value: '0.05' },
];

const DEFAULT_SYMBOL = '1HZ100V';
const DEFAULT_GROWTH_RATE = '0.02';
const DEFAULT_STAKE = '1';
const DEFAULT_TAKE_PROFIT_PERCENT = '10';
const DEFAULT_STOP_LOSS = '20';
const DEFAULT_SESSION_TAKE_PROFIT = '0';
const DEFAULT_MARTINGALE_TRIGGER = '1.10';
const DEFAULT_MARTINGALE_FACTOR = '2';
const DEFAULT_MAX_MARTINGALE_STEPS = '5';
const DEFAULT_COMPOUND_PERCENT = '10';
const MAX_HISTORY = 15;
const RESULT_PAUSE_MS = 1400;

const cleanMoneyInput = (value: string) => value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
const cleanIntegerInput = (value: string) => value.replace(/[^\d]/g, '');

const getMultiplierClass = (multiplier: number) => {
    if (multiplier < 1.3) return 'aviator-chip--low';
    if (multiplier < 2) return 'aviator-chip--mid';
    if (multiplier < 5) return 'aviator-chip--high';
    return 'aviator-chip--epic';
};

const AviatorAccumulator = observer(() => {
    const { client, dashboard, run_panel, journal, transactions, summary_card } = useStore();
    const { active_tab } = dashboard;
    const showAviatorAccumulator = active_tab === DBOT_TABS.AVIATOR_ACCUMULATOR;

    // ==================== Strategy inputs ====================
    const [selectedSymbol, setSelectedSymbol] = useState(DEFAULT_SYMBOL);
    const [growthRate, setGrowthRate] = useState(DEFAULT_GROWTH_RATE);
    const [stakeInput, setStakeInput] = useState(DEFAULT_STAKE);
    const [takeProfitPercentInput, setTakeProfitPercentInput] = useState(DEFAULT_TAKE_PROFIT_PERCENT);
    const [stopLossInput, setStopLossInput] = useState(DEFAULT_STOP_LOSS);
    const [sessionTakeProfitInput, setSessionTakeProfitInput] = useState(DEFAULT_SESSION_TAKE_PROFIT);

    const [useMartingale, setUseMartingale] = useState(true);
    const [martingaleTriggerInput, setMartingaleTriggerInput] = useState(DEFAULT_MARTINGALE_TRIGGER);
    const [martingaleFactorInput, setMartingaleFactorInput] = useState(DEFAULT_MARTINGALE_FACTOR);
    const [maxMartingaleStepsInput, setMaxMartingaleStepsInput] = useState(DEFAULT_MAX_MARTINGALE_STEPS);

    const [winStrategy, setWinStrategy] = useState<TWinStrategy>('reset');
    const [compoundPercentInput, setCompoundPercentInput] = useState(DEFAULT_COMPOUND_PERCENT);

    // ==================== Session / trading state ====================
    const [isTrading, setIsTrading] = useState(false);
    const [isTradeInFlight, setIsTradeInFlight] = useState(false);
    const [sessionPnl, setSessionPnl] = useState(0);
    const [roundsPlayed, setRoundsPlayed] = useState(0);
    const [currentStakeDisplay, setCurrentStakeDisplay] = useState(parseFloat(DEFAULT_STAKE));
    const [statusMessage, setStatusMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    // ==================== Aviator visual state ====================
    const [phase, setPhase] = useState<TPhase>('idle');
    const [liveMultiplier, setLiveMultiplier] = useState(1);
    const [history, setHistory] = useState<TBreakoutRecord[]>([]);

    // ==================== Live "all volatilities" feed (updates even when bot isn't trading) ====================
    const [volatilityTicks, setVolatilityTicks] = useState<Record<string, TVolatilitySnapshot>>({});
    const volatilitySubsRef = useRef<Array<{ unsubscribe?: () => void } | null>>([]);

    const shouldStopRef = useRef(true);
    const selectedSymbolRef = useRef(selectedSymbol);
    const growthRateRef = useRef(growthRate);
    const takeProfitPercentRef = useRef(parseFloat(DEFAULT_TAKE_PROFIT_PERCENT));
    const stopLossRef = useRef(parseFloat(DEFAULT_STOP_LOSS));
    const sessionTakeProfitRef = useRef(0);
    const useMartingaleRef = useRef(true);
    const martingaleTriggerRef = useRef(parseFloat(DEFAULT_MARTINGALE_TRIGGER));
    const martingaleFactorRef = useRef(parseFloat(DEFAULT_MARTINGALE_FACTOR));
    const maxMartingaleStepsRef = useRef(parseInt(DEFAULT_MAX_MARTINGALE_STEPS, 10));
    const winStrategyRef = useRef<TWinStrategy>('reset');
    const compoundPercentRef = useRef(parseFloat(DEFAULT_COMPOUND_PERCENT));

    const baseStakeRef = useRef(0);
    const currentStakeRef = useRef(0);
    const martingaleStepRef = useRef(0);
    const sessionPnlRef = useRef(0);
    const peakMultiplierRef = useRef(1);

    useEffect(() => {
        selectedSymbolRef.current = selectedSymbol;
    }, [selectedSymbol]);
    useEffect(() => {
        growthRateRef.current = growthRate;
    }, [growthRate]);
    useEffect(() => {
        const parsed = parseFloat(takeProfitPercentInput);
        takeProfitPercentRef.current = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }, [takeProfitPercentInput]);
    useEffect(() => {
        const parsed = parseFloat(stopLossInput);
        stopLossRef.current = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }, [stopLossInput]);
    useEffect(() => {
        const parsed = parseFloat(sessionTakeProfitInput);
        sessionTakeProfitRef.current = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }, [sessionTakeProfitInput]);
    useEffect(() => {
        useMartingaleRef.current = useMartingale;
    }, [useMartingale]);
    useEffect(() => {
        const parsed = parseFloat(martingaleTriggerInput);
        martingaleTriggerRef.current = Number.isFinite(parsed) && parsed > 1 ? parsed : 1.1;
    }, [martingaleTriggerInput]);
    useEffect(() => {
        const parsed = parseFloat(martingaleFactorInput);
        martingaleFactorRef.current = Number.isFinite(parsed) && parsed > 1 ? parsed : 2;
    }, [martingaleFactorInput]);
    useEffect(() => {
        const parsed = parseInt(maxMartingaleStepsInput, 10);
        maxMartingaleStepsRef.current = Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
    }, [maxMartingaleStepsInput]);
    useEffect(() => {
        winStrategyRef.current = winStrategy;
    }, [winStrategy]);
    useEffect(() => {
        const parsed = parseFloat(compoundPercentInput);
        compoundPercentRef.current = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    }, [compoundPercentInput]);

    const currency = client?.currency || 'USD';
    const selectedMarket =
        ACCUMULATOR_MARKETS.find(market => market.symbol === selectedSymbol) ?? ACCUMULATOR_MARKETS[4];

    // ==================== Live "all volatilities" feed ====================
    // Subscribes to every accumulator-eligible volatility symbol and keeps updating
    // regardless of whether the bot is actively trading, so the page never goes stale.
    useEffect(() => {
        if (!showAviatorAccumulator) return undefined;

        let cancelled = false;

        const subscribeAll = async () => {
            if (!api_base.api) {
                if (!cancelled) setTimeout(subscribeAll, 1000);
                return;
            }

            ACCUMULATOR_MARKETS.forEach((market, index) => {
                try {
                    const observable = (api_base.api as any).subscribe({ ticks: market.symbol });
                    const subscription = safeSubscribe(observable, (data: any) => {
                        if (cancelled) return;
                        if (data?.error) {
                            // Stream hiccups for the overview panel are non-fatal; ignore unless logging is needed.
                            return;
                        }
                        const quote = Number(data?.tick?.quote);
                        const epoch = Number(data?.tick?.epoch) || Math.floor(Date.now() / 1000);
                        if (!Number.isFinite(quote)) return;

                        setVolatilityTicks(prev => {
                            const previous = prev[market.symbol];
                            return {
                                ...prev,
                                [market.symbol]: {
                                    quote,
                                    prevQuote: previous ? previous.quote : null,
                                    epoch,
                                },
                            };
                        });
                    });
                    volatilitySubsRef.current[index] = subscription;
                } catch {
                    // Subscription failures for the overview panel are non-fatal.
                }
            });
        };

        void subscribeAll();

        return () => {
            cancelled = true;
            volatilitySubsRef.current.forEach(sub => {
                try {
                    sub?.unsubscribe?.();
                } catch {
                    // Already closed.
                }
            });
            volatilitySubsRef.current = [];
        };
    }, [showAviatorAccumulator]);

    // ==================== Transactions & Journal ====================

    const pushContract = useCallback(
        (data: Record<string, any>) => {
            try {
                transactions.pushTransaction(data as any);
                run_panel?.onBotContractEvent?.(data as any);
                summary_card?.onBotContractEvent?.(data as any);
            } catch {
                // Stores may not be ready yet; safe to ignore.
            }
        },
        [run_panel, summary_card, transactions]
    );

    const logJournal = useCallback(
        (message: string, message_type: string = MessageTypes.NOTIFY) => {
            try {
                journal?.pushMessage?.(message, message_type, '');
            } catch {
                // Journal may not be ready yet; safe to ignore.
            }
        },
        [journal]
    );

    // ==================== Trading ====================

    const buildTradeParameters = useCallback(
        (stake: number, takeProfitAmount: number) => ({
            amount: stake,
            basis: 'stake',
            contract_type: 'ACCU',
            currency,
            growth_rate: Number(growthRateRef.current),
            limit_order: { take_profit: Number(takeProfitAmount.toFixed(2)) },
            symbol: selectedSymbolRef.current,
        }),
        [currency]
    );

    const runSingleRound = useCallback(
        async (stake: number): Promise<{ profit: number; exitMultiplier: number }> => {
            const symbol = selectedSymbolRef.current;
            const tradeStartTime = Math.floor(Date.now() / 1000);
            const takeProfitAmount = stake * (takeProfitPercentRef.current / 100);

            setPhase('flying');
            setLiveMultiplier(1);
            peakMultiplierRef.current = 1;

            const buy = await buyContractForUi({
                parameters: buildTradeParameters(stake, takeProfitAmount) as any,
                price: stake,
                source: 'Aviator Accumulator',
            });

            const buyPrice = Number(buy.buy_price) || stake;

            const fallback = {
                buy_price: buy.buy_price,
                contract_id: buy.contract_id,
                transaction_ids: { buy: buy.transaction_id },
                date_start: tradeStartTime,
                display_name: symbol,
                underlying_symbol: symbol,
                shortcode: `ACCU_${symbol}_${growthRateRef.current}`,
                contract_type: 'ACCU',
                currency,
            };

            pushContract(fallback);
            logJournal(
                `🛫 Aviator Accumulator bought ${symbol} — stake ${stake.toFixed(2)} ${currency} @ growth ${(
                    Number(growthRateRef.current) * 100
                ).toFixed(0)}%`,
                MessageTypes.SUCCESS
            );

            const settled = await streamContractUntilSettled({
                contractId: buy.contract_id,
                fallback,
                onUpdate: (snapshot, rawContract) => {
                    const bid = Number((rawContract as any)?.bid_price ?? (snapshot as any)?.bid_price);
                    if (Number.isFinite(bid) && buyPrice > 0) {
                        const mult = Math.max(1, bid / buyPrice);
                        peakMultiplierRef.current = Math.max(peakMultiplierRef.current, mult);
                        setLiveMultiplier(mult);
                    }
                    pushContract(snapshot);
                },
                source: 'Aviator Accumulator',
            });

            const profit = Number(settled.profit ?? 0);
            const won = profit > 0;
            const sellPrice = Number((settled as any)?.sell_price);
            const exitFromSell = Number.isFinite(sellPrice) && buyPrice > 0 ? sellPrice / buyPrice : null;
            const exitMultiplier = won
                ? Math.max(exitFromSell ?? peakMultiplierRef.current, 1)
                : Math.max(peakMultiplierRef.current, 1);

            setPhase(won ? 'cashed' : 'crashed');
            setLiveMultiplier(exitMultiplier);

            logJournal(
                won
                    ? `✅ Cashed out at ${exitMultiplier.toFixed(2)}x — won ${profit.toFixed(2)} ${currency}`
                    : `💥 Broke at ${exitMultiplier.toFixed(2)}x — lost ${Math.abs(profit).toFixed(2)} ${currency}`,
                won ? MessageTypes.SUCCESS : MessageTypes.ERROR
            );

            return { profit, exitMultiplier };
        },
        [buildTradeParameters, currency, logJournal, pushContract]
    );

    const stopTrading = useCallback(() => {
        shouldStopRef.current = true;
        setIsTrading(false);
        setPhase('idle');

        try {
            run_panel?.setIsRunning?.(false);
        } catch {
            // Run panel can be unavailable while the app is still initializing.
        }

        try {
            dashboard.unregisterTradingStopHandler('aviator_accumulator');
        } catch {
            // Handler may not be registered yet.
        }
        dashboard.setActiveTradingModule(null);
    }, [dashboard, run_panel]);

    const tradingLoop = useCallback(async () => {
        const stake = parseFloat(stakeInput);

        if (!Number.isFinite(stake) || stake <= 0) {
            setErrorMessage('Enter a valid stake amount.');
            setIsTrading(false);
            return;
        }

        baseStakeRef.current = stake;
        currentStakeRef.current = stake;
        setCurrentStakeDisplay(stake);
        martingaleStepRef.current = 0;
        sessionPnlRef.current = 0;
        setSessionPnl(0);
        setRoundsPlayed(0);
        shouldStopRef.current = false;

        while (!shouldStopRef.current) {
            setIsTradeInFlight(true);
            const tradeStake = Number(currentStakeRef.current.toFixed(2));
            setCurrentStakeDisplay(tradeStake);
            setStatusMessage(`Flying with stake ${tradeStake.toFixed(2)} ${currency}...`);

            try {
                const { profit, exitMultiplier } = await runSingleRound(tradeStake);
                if (shouldStopRef.current) break;

                sessionPnlRef.current = parseFloat((sessionPnlRef.current + profit).toFixed(8));
                setSessionPnl(sessionPnlRef.current);
                setRoundsPlayed(prev => prev + 1);

                const won = profit > 0;
                setHistory(prev =>
                    [
                        {
                            id: `${Date.now()}-${prev.length}`,
                            multiplier: exitMultiplier,
                            won,
                            profit,
                            stake: tradeStake,
                            time: Date.now(),
                        },
                        ...prev,
                    ].slice(0, MAX_HISTORY)
                );

                if (won) {
                    martingaleStepRef.current = 0;
                    if (winStrategyRef.current === 'compound') {
                        const grown = tradeStake * (1 + compoundPercentRef.current / 100);
                        currentStakeRef.current = Number(Math.min(grown, baseStakeRef.current * 20).toFixed(2));
                    } else {
                        currentStakeRef.current = baseStakeRef.current;
                    }
                    setStatusMessage(`✅ Cashed out at ${exitMultiplier.toFixed(2)}x — +${profit.toFixed(2)} ${currency}`);
                } else {
                    martingaleStepRef.current += 1;
                    if (
                        useMartingaleRef.current &&
                        exitMultiplier < martingaleTriggerRef.current &&
                        martingaleStepRef.current <= maxMartingaleStepsRef.current
                    ) {
                        currentStakeRef.current = Number((tradeStake * martingaleFactorRef.current).toFixed(2));
                    } else {
                        currentStakeRef.current = baseStakeRef.current;
                        martingaleStepRef.current = 0;
                    }
                    setStatusMessage(`💥 Broke at ${exitMultiplier.toFixed(2)}x — ${profit.toFixed(2)} ${currency}`);
                }

                const stopLoss = stopLossRef.current;
                const sessionTakeProfit = sessionTakeProfitRef.current;
                if (stopLoss > 0 && sessionPnlRef.current <= -stopLoss) {
                    logJournal(
                        `🛑 Aviator Accumulator stopped — Stop Loss of ${stopLoss.toFixed(2)} ${currency} reached (session P/L: ${sessionPnlRef.current.toFixed(2)} ${currency}).`,
                        MessageTypes.ERROR
                    );
                    break;
                }
                if (sessionTakeProfit > 0 && sessionPnlRef.current >= sessionTakeProfit) {
                    logJournal(
                        `🎯 Aviator Accumulator stopped — Take Profit of ${sessionTakeProfit.toFixed(2)} ${currency} reached (session P/L: ${sessionPnlRef.current.toFixed(2)} ${currency}).`,
                        MessageTypes.SUCCESS
                    );
                    break;
                }
            } catch (error) {
                setErrorMessage(error instanceof Error ? error.message : 'Trade failed.');
                break;
            } finally {
                setIsTradeInFlight(false);
            }

            // Brief pause so the crash / cash-out animation is visible before the next round starts.
            await new Promise(resolve => setTimeout(resolve, RESULT_PAUSE_MS));
            if (shouldStopRef.current) break;
            setPhase('idle');
            setLiveMultiplier(1);
        }

        shouldStopRef.current = true;
        setIsTrading(false);
        setPhase('idle');
    }, [currency, logJournal, runSingleRound, stakeInput]);

    const handleStartTrading = useCallback(() => {
        if (isTrading) {
            stopTrading();
            return;
        }

        setErrorMessage('');
        setStatusMessage('');
        setIsTrading(true);
        shouldStopRef.current = false;

        try {
            dashboard.setActiveTradingModule('aviator_accumulator');
            dashboard.registerTradingStopHandler('aviator_accumulator', stopTrading);
            run_panel?.setIsRunning?.(true);
        } catch {
            // Non-fatal: dashboard/run panel may not be ready yet.
        }

        void tradingLoop();
    }, [dashboard, isTrading, run_panel, stopTrading, tradingLoop]);

    useEffect(() => {
        if (!showAviatorAccumulator) return undefined;
        dashboard.registerTradingStopHandler('aviator_accumulator', stopTrading);
        return () => {
            dashboard.unregisterTradingStopHandler('aviator_accumulator');
        };
    }, [dashboard, showAviatorAccumulator, stopTrading]);

    useEffect(
        () => () => {
            shouldStopRef.current = true;
        },
        []
    );

    // ==================== Jet position ====================
    const jetStyle = useMemo(() => {
        const progress = Math.min(1 - 1 / Math.max(liveMultiplier, 1), 0.92);
        const left = 6 + progress * 78;
        const bottom = 8 + progress * 68;
        return { left: `${left}%`, bottom: `${bottom}%` };
    }, [liveMultiplier]);

    if (!showAviatorAccumulator) return null;

    return (
        <div className='aviator-page'>
            <div className='aviator-layout'>
                {/* ==================== Aviator visual scene ==================== */}
                <div className='aviator-main'>
                    <div className={`aviator-scene aviator-scene--${phase}`}>
                        <div className='aviator-scene__grid' />
                        <div className='aviator-multiplier'>{liveMultiplier.toFixed(2)}x</div>

                        <div className='aviator-jet-track'>
                            <svg
                                className='aviator-flight-path'
                                viewBox='0 0 100 100'
                                preserveAspectRatio='none'
                                aria-hidden='true'
                            >
                                <path d='M6,92 Q40,85 84,15' />
                            </svg>
                            <div className='aviator-jet' style={jetStyle}>
                                <span className='aviator-jet__trail' />
                                <span className='aviator-jet__body' role='img' aria-label='jet'>
                                    ✈️
                                </span>
                            </div>
                        </div>

                        {phase === 'crashed' && (
                            <div className='aviator-result-badge aviator-result-badge--crashed'>
                                💥 <Localize i18n_default_text='BROKE AT' /> {liveMultiplier.toFixed(2)}x
                            </div>
                        )}
                        {phase === 'cashed' && (
                            <div className='aviator-result-badge aviator-result-badge--cashed'>
                                ✅ <Localize i18n_default_text='CASHED OUT' /> {liveMultiplier.toFixed(2)}x
                            </div>
                        )}
                        {phase === 'idle' && !isTrading && (
                            <div className='aviator-result-badge aviator-result-badge--ready'>
                                <Localize i18n_default_text='Ready for takeoff' />
                            </div>
                        )}
                    </div>

                    {/* ==================== All volatilities — live ==================== */}
                    <div className='aviator-volatilities'>
                        <div className='aviator-volatilities__title'>
                            <Localize i18n_default_text='All Volatilities — Live' />
                        </div>
                        <div className='aviator-volatilities__grid'>
                            {ACCUMULATOR_MARKETS.map(market => {
                                const snapshot = volatilityTicks[market.symbol];
                                const direction =
                                    snapshot && snapshot.prevQuote != null
                                        ? snapshot.quote > snapshot.prevQuote
                                            ? 'up'
                                            : snapshot.quote < snapshot.prevQuote
                                              ? 'down'
                                              : 'flat'
                                        : 'flat';
                                return (
                                    <div
                                        key={market.symbol}
                                        className={`aviator-volatility-card ${
                                            market.symbol === selectedSymbol ? 'aviator-volatility-card--active' : ''
                                        }`}
                                    >
                                        <span className='aviator-volatility-card__label'>{market.label}</span>
                                        <span className={`aviator-volatility-card__quote aviator-volatility-card__quote--${direction}`}>
                                            {snapshot ? snapshot.quote.toFixed(4) : '—'}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* ==================== Last 15 breakouts ==================== */}
                    <div className='aviator-history'>
                        <div className='aviator-history__title'>
                            <Localize i18n_default_text='Last 15 Breakouts' />
                        </div>
                        <div className='aviator-history__track'>
                            {history.length === 0 && (
                                <span className='aviator-history__empty'>
                                    <Localize i18n_default_text='No rounds played yet' />
                                </span>
                            )}
                            {history.map(item => (
                                <span
                                    key={item.id}
                                    className={`aviator-chip ${item.won ? 'aviator-chip--win' : 'aviator-chip--loss'} ${getMultiplierClass(item.multiplier)}`}
                                    title={`${item.won ? 'Won' : 'Lost'} ${item.profit.toFixed(2)} ${currency} · stake ${item.stake.toFixed(2)}`}
                                >
                                    {item.multiplier.toFixed(2)}x
                                </span>
                            ))}
                        </div>
                    </div>

                    <div className='aviator-footer'>
                        <div>
                            <Localize i18n_default_text='Rounds:' /> <strong>{roundsPlayed}</strong>
                        </div>
                        <div>
                            <Localize i18n_default_text='Current Stake:' />{' '}
                            <strong>
                                {currentStakeDisplay.toFixed(2)} {currency}
                            </strong>
                        </div>
                        <div>
                            <Localize i18n_default_text='Session P/L:' />{' '}
                            <strong
                                className={
                                    sessionPnl > 0
                                        ? 'aviator-pnl--positive'
                                        : sessionPnl < 0
                                          ? 'aviator-pnl--negative'
                                          : ''
                                }
                            >
                                {sessionPnl >= 0 ? '+' : ''}
                                {sessionPnl.toFixed(2)} {currency}
                            </strong>
                        </div>
                    </div>

                    {statusMessage && <p className='aviator-status'>{statusMessage}</p>}
                    {errorMessage && <p className='aviator-error'>{errorMessage}</p>}
                </div>

                {/* ==================== Strategy configuration panel ==================== */}
                <div className='aviator-panel'>
                    <div className='aviator-panel__section'>
                        <label className='aviator-field'>
                            <span>
                                <Localize i18n_default_text='Market' />
                            </span>
                            <select
                                className='aviator-select'
                                value={selectedSymbol}
                                disabled={isTrading}
                                onChange={event => setSelectedSymbol(event.target.value)}
                            >
                                {ACCUMULATOR_MARKETS.map(market => (
                                    <option key={market.symbol} value={market.symbol}>
                                        {market.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className='aviator-field'>
                            <span>
                                <Localize i18n_default_text='Growth Rate' />
                            </span>
                            <select
                                className='aviator-select'
                                value={growthRate}
                                disabled={isTrading}
                                onChange={event => setGrowthRate(event.target.value)}
                            >
                                {GROWTH_RATES.map(rate => (
                                    <option key={rate.value} value={rate.value}>
                                        {rate.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <div className='aviator-divider' />

                    <div className='aviator-panel__section'>
                        <label className='aviator-field'>
                            <span>
                                <Localize i18n_default_text='Stake' />
                            </span>
                            <input
                                inputMode='decimal'
                                value={stakeInput}
                                disabled={isTrading}
                                onChange={event => setStakeInput(cleanMoneyInput(event.target.value))}
                            />
                        </label>
                        <label className='aviator-field'>
                            <span>
                                <Localize i18n_default_text='Take Profit (% of stake)' />
                            </span>
                            <input
                                inputMode='decimal'
                                value={takeProfitPercentInput}
                                disabled={isTrading}
                                onChange={event => setTakeProfitPercentInput(cleanMoneyInput(event.target.value))}
                            />
                        </label>
                    </div>

                    <div className='aviator-panel__section'>
                        <label className='aviator-field'>
                            <span>
                                <Localize i18n_default_text='Session Stop Loss' />
                            </span>
                            <input
                                inputMode='decimal'
                                value={stopLossInput}
                                disabled={isTrading}
                                onChange={event => setStopLossInput(cleanMoneyInput(event.target.value))}
                            />
                        </label>
                        <label className='aviator-field'>
                            <span>
                                <Localize i18n_default_text='Session Take Profit (0 = off)' />
                            </span>
                            <input
                                inputMode='decimal'
                                value={sessionTakeProfitInput}
                                disabled={isTrading}
                                onChange={event => setSessionTakeProfitInput(cleanMoneyInput(event.target.value))}
                            />
                        </label>
                    </div>

                    <div className='aviator-divider' />

                    <label className='aviator-toggle-row'>
                        <span>
                            <Localize i18n_default_text='Use Martingale on Early Breaks' />
                        </span>
                        <span className={`aviator-switch ${useMartingale ? 'aviator-switch--on' : ''}`}>
                            <input
                                type='checkbox'
                                checked={useMartingale}
                                disabled={isTrading}
                                onChange={event => setUseMartingale(event.target.checked)}
                            />
                            <span className='aviator-switch__knob' />
                        </span>
                    </label>
                    <p className='aviator-hint'>
                        <Localize i18n_default_text='If a round breaks below the trigger multiplier, the next stake is multiplied by the Martingale Factor. Breaks above the trigger reset to base stake.' />
                    </p>

                    <div className='aviator-panel__section'>
                        <label className='aviator-field'>
                            <span>
                                <Localize i18n_default_text='Martingale Trigger (x)' />
                            </span>
                            <input
                                inputMode='decimal'
                                value={martingaleTriggerInput}
                                disabled={isTrading || !useMartingale}
                                onChange={event => setMartingaleTriggerInput(cleanMoneyInput(event.target.value))}
                            />
                        </label>
                        <label className='aviator-field'>
                            <span>
                                <Localize i18n_default_text='Martingale Factor' />
                            </span>
                            <input
                                inputMode='decimal'
                                value={martingaleFactorInput}
                                disabled={isTrading || !useMartingale}
                                onChange={event => setMartingaleFactorInput(cleanMoneyInput(event.target.value))}
                            />
                        </label>
                    </div>

                    <label className='aviator-field'>
                        <span>
                            <Localize i18n_default_text='Max Consecutive Martingale Steps' />
                        </span>
                        <input
                            inputMode='numeric'
                            value={maxMartingaleStepsInput}
                            disabled={isTrading || !useMartingale}
                            onChange={event => setMaxMartingaleStepsInput(cleanIntegerInput(event.target.value))}
                        />
                    </label>

                    <div className='aviator-divider' />

                    <label className='aviator-field'>
                        <span>
                            <Localize i18n_default_text='Winning Strategy' />
                        </span>
                        <select
                            className='aviator-select'
                            value={winStrategy}
                            disabled={isTrading}
                            onChange={event => setWinStrategy(event.target.value as TWinStrategy)}
                        >
                            <option value='reset'>Reset to base stake after a win</option>
                            <option value='compound'>Compound — grow stake after a win</option>
                        </select>
                    </label>

                    {winStrategy === 'compound' && (
                        <label className='aviator-field'>
                            <span>
                                <Localize i18n_default_text='Compound Growth (% of stake)' />
                            </span>
                            <input
                                inputMode='decimal'
                                value={compoundPercentInput}
                                disabled={isTrading}
                                onChange={event => setCompoundPercentInput(cleanMoneyInput(event.target.value))}
                            />
                        </label>
                    )}

                    <div className='aviator-divider' />

                    <button
                        type='button'
                        className={`aviator-button ${isTrading ? 'aviator-button--stop' : 'aviator-button--start'}`}
                        disabled={isTradeInFlight && !isTrading}
                        onClick={handleStartTrading}
                    >
                        <Localize i18n_default_text={isTrading ? 'Stop Trading' : 'Start Trading'} />
                    </button>

                    <p className='aviator-tp-sl-hint'>
                        <Localize i18n_default_text='Each round buys an Accumulator with the selected Growth Rate. The contract auto-settles when it knocks out (break) or hits the Take Profit %.' />
                    </p>
                </div>
            </div>
        </div>
    );
});

export default AviatorAccumulator;
