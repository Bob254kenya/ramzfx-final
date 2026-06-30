import { useCallback, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { DBOT_TABS } from '@/constants/bot-contents';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { SUPPORTED_VOLATILITY_MARKETS } from '@/utils/digit-strategy';
import { getLastDigitFromQuote, isExpectedStreamInterruption } from '@/utils/market-data';
import { buyContractForUi, streamContractUntilSettled } from '@/utils/trade-purchase';
import { safeSubscribe } from '@/utils/websocket-handler';
import { Localize } from '@deriv-com/translations';
import './speed-bot.scss';

type TTickPoint = {
    epoch: number;
    quote: number;
};

type TEvenOdd = 'Even' | 'Odd';

const PATTERN_LENGTH = 20;
const STATS_WINDOW = 100;
const DEFAULT_TICKS = '1';
const DEFAULT_STAKE = '0.5';
const DEFAULT_MARTINGALE_MULTIPLIER = '1.15';
const DEFAULT_SYMBOL = 'R_100';

const getQuoteFromTick = (data: any): TTickPoint | null => {
    const quote = Number(data?.tick?.quote);
    if (!Number.isFinite(quote)) return null;

    return {
        epoch: Number(data?.tick?.epoch) || Math.floor(Date.now() / 1000),
        quote,
    };
};

const classifyDigit = (digit: number): TEvenOdd => (digit % 2 === 0 ? 'Even' : 'Odd');

const cleanMoneyInput = (value: string) => value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
const cleanIntegerInput = (value: string) => value.replace(/[^\d]/g, '');

const SpeedBot = observer(() => {
    const { client, dashboard, run_panel } = useStore();
    const { active_tab } = dashboard;
    const showSpeedBot = active_tab === DBOT_TABS.SPEED_BOT;

    const [selectedSymbol, setSelectedSymbol] = useState(DEFAULT_SYMBOL);
    const [tradeType, setTradeType] = useState<TEvenOdd>('Even');
    const [ticks, setTicks] = useState<TTickPoint[]>([]);
    const [ticksInput, setTicksInput] = useState(DEFAULT_TICKS);
    const [stakeInput, setStakeInput] = useState(DEFAULT_STAKE);
    const [isTrading, setIsTrading] = useState(false);
    const [isTradeInFlight, setIsTradeInFlight] = useState(false);
    const [alternateEvenOdd, setAlternateEvenOdd] = useState(false);
    const [alternateOnLoss, setAlternateOnLoss] = useState(false);
    const [useMartingale, setUseMartingale] = useState(false);
    const [martingaleMultiplierInput, setMartingaleMultiplierInput] = useState(DEFAULT_MARTINGALE_MULTIPLIER);
    const [recoveryMode, setRecoveryMode] = useState(false);
    const [ticksProcessed, setTicksProcessed] = useState(0);
    const [statusMessage, setStatusMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    const subscriptionRef = useRef<{ unsubscribe?: () => void } | null>(null);
    const requestVersionRef = useRef(0);
    const ticksRef = useRef<TTickPoint[]>([]);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const shouldStopRef = useRef(true);

    const tradeTypeRef = useRef<TEvenOdd>(tradeType);
    const alternateEvenOddRef = useRef(alternateEvenOdd);
    const alternateOnLossRef = useRef(alternateOnLoss);
    const useMartingaleRef = useRef(useMartingale);
    const martingaleMultiplierRef = useRef(1.15);
    const recoveryModeRef = useRef(recoveryMode);
    const selectedSymbolRef = useRef(selectedSymbol);

    const baseStakeRef = useRef(0);
    const currentStakeRef = useRef(0);
    const consecutiveLossesRef = useRef(0);
    const isRecoveringRef = useRef(false);

    useEffect(() => {
        tradeTypeRef.current = tradeType;
    }, [tradeType]);
    useEffect(() => {
        alternateEvenOddRef.current = alternateEvenOdd;
    }, [alternateEvenOdd]);
    useEffect(() => {
        alternateOnLossRef.current = alternateOnLoss;
    }, [alternateOnLoss]);
    useEffect(() => {
        useMartingaleRef.current = useMartingale;
    }, [useMartingale]);
    useEffect(() => {
        recoveryModeRef.current = recoveryMode;
    }, [recoveryMode]);
    useEffect(() => {
        selectedSymbolRef.current = selectedSymbol;
    }, [selectedSymbol]);
    useEffect(() => {
        const parsed = parseFloat(martingaleMultiplierInput);
        martingaleMultiplierRef.current = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    }, [martingaleMultiplierInput]);

    const currency = client?.currency || 'USD';
    const selectedMarket =
        SUPPORTED_VOLATILITY_MARKETS.find(market => market.symbol === selectedSymbol) ?? SUPPORTED_VOLATILITY_MARKETS[0];

    const latestTick = ticks[ticks.length - 1];
    const latestDigit = latestTick ? getLastDigitFromQuote(latestTick.quote, selectedSymbol) : null;

    const digitsWindow = ticks.slice(-STATS_WINDOW).map(tick => getLastDigitFromQuote(tick.quote, selectedSymbol));
    const patternDigits = digitsWindow.slice(-PATTERN_LENGTH);
    const totalCount = digitsWindow.length;
    const evenCount = digitsWindow.filter(digit => digit % 2 === 0).length;
    const evenPercent = totalCount ? (evenCount / totalCount) * 100 : 0;
    const oddPercent = totalCount ? 100 - evenPercent : 0;

    // ==================== Tick stream ====================

    const unsubscribe = useCallback(() => {
        try {
            subscriptionRef.current?.unsubscribe?.();
        } catch {
            // Stream may already be closed; nothing to do.
        }
        subscriptionRef.current = null;
    }, []);

    const applyLiveTick = useCallback((tick: TTickPoint) => {
        const next = [...ticksRef.current, tick].slice(-Math.max(STATS_WINDOW, PATTERN_LENGTH));
        ticksRef.current = next;
        setTicks(next);
        setTicksProcessed(prev => prev + 1);
    }, []);

    const loadMarketData = useCallback(async () => {
        unsubscribe();
        if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
        }

        if (!showSpeedBot) return;

        const requestVersion = requestVersionRef.current + 1;
        requestVersionRef.current = requestVersion;

        if (!api_base.api) {
            retryTimerRef.current = setTimeout(() => {
                void loadMarketData();
            }, 1000);
            return;
        }

        setTicks([]);
        ticksRef.current = [];
        setTicksProcessed(0);

        try {
            const history = await (api_base.api as any).send({
                adjust_start_time: 1,
                count: STATS_WINDOW,
                end: 'latest',
                start: 1,
                style: 'ticks',
                ticks_history: selectedSymbol,
            });

            if (requestVersionRef.current !== requestVersion) return;

            const prices = Array.isArray(history?.history?.prices) ? history.history.prices : [];
            const times = Array.isArray(history?.history?.times) ? history.history.times : [];
            const historyTicks = prices
                .map((price: number | string, index: number) => ({
                    epoch: Number(times[index]) || Math.floor(Date.now() / 1000),
                    quote: Number(price),
                }))
                .filter((tick: TTickPoint) => Number.isFinite(tick.quote))
                .slice(-STATS_WINDOW);

            ticksRef.current = historyTicks;
            setTicks(historyTicks);

            const observable = (api_base.api as any).subscribe({ ticks: selectedSymbol });
            subscriptionRef.current = safeSubscribe(observable, (data: any) => {
                if (requestVersionRef.current !== requestVersion) return;

                if (data?.error) {
                    if (!isExpectedStreamInterruption(data.error)) {
                        setErrorMessage(data.error.message || 'Deriv tick stream error.');
                    }
                    return;
                }

                const tick = getQuoteFromTick(data);
                if (tick) applyLiveTick(tick);
            });

            setErrorMessage('');
        } catch (error) {
            if (requestVersionRef.current !== requestVersion) return;
            setErrorMessage(error instanceof Error ? error.message : 'Unable to load market data.');
        }
    }, [applyLiveTick, selectedSymbol, showSpeedBot, unsubscribe]);

    useEffect(() => {
        void loadMarketData();
        return () => {
            requestVersionRef.current += 1;
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
            unsubscribe();
        };
    }, [loadMarketData, unsubscribe]);

    // ==================== Trading ====================

    const buildTradeParameters = useCallback(
        (type: TEvenOdd, stake: number, durationTicks: number) => ({
            amount: stake,
            basis: 'stake',
            contract_type: type === 'Even' ? 'DIGITEVEN' : 'DIGITODD',
            currency,
            duration: durationTicks,
            duration_unit: 't',
            symbol: selectedSymbolRef.current,
        }),
        [currency]
    );

    const runSingleTrade = useCallback(
        async (type: TEvenOdd, stake: number, durationTicks: number): Promise<number> => {
            const buy = await buyContractForUi({
                parameters: buildTradeParameters(type, stake, durationTicks),
                price: stake,
                source: 'Speed Bot',
            });

            const fallback = {
                buy_price: buy.buy_price,
                contract_id: buy.contract_id,
                contract_type: type === 'Even' ? 'DIGITEVEN' : 'DIGITODD',
                currency,
                underlying_symbol: selectedSymbolRef.current,
            };

            const settled = await streamContractUntilSettled({
                contractId: buy.contract_id,
                fallback,
                source: 'Speed Bot',
            });

            return Number(settled.profit ?? 0);
        },
        [buildTradeParameters, currency]
    );

    const stopTrading = useCallback(() => {
        shouldStopRef.current = true;
        setIsTrading(false);
        consecutiveLossesRef.current = 0;
        isRecoveringRef.current = false;

        try {
            run_panel?.setIsRunning?.(false);
        } catch {
            // Run panel can be unavailable while the app is still initializing.
        }

        try {
            dashboard.unregisterTradingStopHandler('speed_bot');
        } catch {
            // Handler may not be registered yet.
        }
        dashboard.setActiveTradingModule(null);
    }, [dashboard, run_panel]);

    const tradingLoop = useCallback(async () => {
        const stake = parseFloat(stakeInput);
        const durationTicks = parseInt(ticksInput, 10);

        if (!Number.isFinite(stake) || stake <= 0) {
            setErrorMessage('Enter a valid stake amount.');
            setIsTrading(false);
            return;
        }
        if (!Number.isFinite(durationTicks) || durationTicks <= 0) {
            setErrorMessage('Enter a valid number of ticks.');
            setIsTrading(false);
            return;
        }

        baseStakeRef.current = stake;
        currentStakeRef.current = stake;
        consecutiveLossesRef.current = 0;
        isRecoveringRef.current = false;
        shouldStopRef.current = false;

        let currentType: TEvenOdd = tradeTypeRef.current;

        while (!shouldStopRef.current) {
            setIsTradeInFlight(true);
            const tradeStake = currentStakeRef.current;
            setStatusMessage(`Trading ${currentType} with ${tradeStake.toFixed(2)} ${currency}...`);

            try {
                const profit = await runSingleTrade(currentType, tradeStake, durationTicks);
                if (shouldStopRef.current) break;

                const won = profit > 0;

                if (won) {
                    setStatusMessage(`✅ Won ${profit.toFixed(2)} ${currency}`);
                    consecutiveLossesRef.current = 0;
                    currentStakeRef.current = baseStakeRef.current;
                    isRecoveringRef.current = false;
                } else {
                    setStatusMessage(`❌ Lost ${Math.abs(profit).toFixed(2)} ${currency}`);
                    consecutiveLossesRef.current += 1;

                    // Martingale: increase the next stake after every loss.
                    if (useMartingaleRef.current) {
                        currentStakeRef.current =
                            baseStakeRef.current * Math.pow(martingaleMultiplierRef.current, consecutiveLossesRef.current);
                    }

                    // Recovery Mode: keep escalating the stake to recover losses, independent of
                    // the Martingale toggle, until a winning trade resets the cycle.
                    if (recoveryModeRef.current) {
                        isRecoveringRef.current = true;
                        if (!useMartingaleRef.current) {
                            currentStakeRef.current =
                                baseStakeRef.current * Math.pow(martingaleMultiplierRef.current, consecutiveLossesRef.current);
                        }
                    }

                    if (alternateOnLossRef.current) {
                        currentType = currentType === 'Even' ? 'Odd' : 'Even';
                    }
                }

                // Alternate Even/Odd on every trade regardless of outcome.
                if (alternateEvenOddRef.current) {
                    currentType = currentType === 'Even' ? 'Odd' : 'Even';
                }

                setTradeType(currentType);
            } catch (error) {
                setErrorMessage(error instanceof Error ? error.message : 'Trade failed.');
                break;
            } finally {
                setIsTradeInFlight(false);
            }
        }

        shouldStopRef.current = true;
        setIsTrading(false);
    }, [currency, runSingleTrade, stakeInput, ticksInput]);

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
            dashboard.setActiveTradingModule('speed_bot');
            dashboard.registerTradingStopHandler('speed_bot', stopTrading);
            run_panel?.setIsRunning?.(true);
        } catch {
            // Non-fatal: dashboard/run panel may not be ready yet.
        }

        void tradingLoop();
    }, [dashboard, isTrading, run_panel, stopTrading, tradingLoop]);

    const handleTradeOnce = useCallback(async () => {
        if (isTradeInFlight || isTrading) return;

        setErrorMessage('');
        setStatusMessage('');

        const stake = parseFloat(stakeInput);
        const durationTicks = parseInt(ticksInput, 10);

        if (!Number.isFinite(stake) || stake <= 0) {
            setErrorMessage('Enter a valid stake amount.');
            return;
        }
        if (!Number.isFinite(durationTicks) || durationTicks <= 0) {
            setErrorMessage('Enter a valid number of ticks.');
            return;
        }

        setIsTradeInFlight(true);
        try {
            const profit = await runSingleTrade(tradeType, stake, durationTicks);
            setStatusMessage(
                profit > 0 ? `✅ Won ${profit.toFixed(2)} ${currency}` : `❌ Lost ${Math.abs(profit).toFixed(2)} ${currency}`
            );
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Trade failed.');
        } finally {
            setIsTradeInFlight(false);
        }
    }, [currency, isTradeInFlight, isTrading, runSingleTrade, stakeInput, ticksInput, tradeType]);

    useEffect(() => {
        if (!showSpeedBot) return undefined;
        dashboard.registerTradingStopHandler('speed_bot', stopTrading);
        return () => {
            dashboard.unregisterTradingStopHandler('speed_bot');
        };
    }, [dashboard, showSpeedBot, stopTrading]);

    useEffect(
        () => () => {
            shouldStopRef.current = true;
        },
        []
    );

    if (!showSpeedBot) return null;

    return (
        <div className='speed-bot-page'>
            <div className='speed-bot-card'>
                <div className='speed-bot-row'>
                    <select
                        className='speed-bot-select speed-bot-select--symbol'
                        value={selectedSymbol}
                        disabled={isTrading}
                        onChange={event => setSelectedSymbol(event.target.value)}
                    >
                        {SUPPORTED_VOLATILITY_MARKETS.map(market => (
                            <option key={market.symbol} value={market.symbol}>
                                {market.label}
                            </option>
                        ))}
                    </select>
                    <div className='speed-bot-price'>{latestTick ? latestTick.quote.toFixed(selectedMarket.pip ?? 2) : '—'}</div>
                </div>

                <select
                    className='speed-bot-select speed-bot-select--type'
                    value={tradeType}
                    disabled={isTrading}
                    onChange={event => setTradeType(event.target.value as TEvenOdd)}
                >
                    <option value='Even'>Even</option>
                    <option value='Odd'>Odd</option>
                </select>

                <div className='speed-bot-pattern'>
                    <div className='speed-bot-pattern__title'>
                        <Localize i18n_default_text='Even/Odd pattern (last 20)' />
                    </div>
                    <div className='speed-bot-pattern__grid'>
                        {Array.from({ length: PATTERN_LENGTH }).map((_, index) => {
                            const digit = patternDigits[index];
                            const isEmpty = digit === undefined;
                            const isEven = !isEmpty && digit % 2 === 0;
                            return (
                                <span
                                    key={index}
                                    className={
                                        isEmpty
                                            ? 'speed-bot-chip speed-bot-chip--empty'
                                            : isEven
                                              ? 'speed-bot-chip speed-bot-chip--even'
                                              : 'speed-bot-chip speed-bot-chip--odd'
                                    }
                                >
                                    {isEmpty ? '' : isEven ? 'E' : 'O'}
                                </span>
                            );
                        })}
                    </div>
                    <div className='speed-bot-stats'>
                        <div className='speed-bot-stat'>
                            <Localize i18n_default_text='Even:' /> <strong>{evenPercent.toFixed(1)}%</strong>
                        </div>
                        <div className='speed-bot-stat'>
                            <Localize i18n_default_text='Odd:' /> <strong>{oddPercent.toFixed(1)}%</strong>
                        </div>
                        <div className='speed-bot-stat'>
                            <Localize i18n_default_text='Total:' /> <strong>{totalCount}</strong>
                        </div>
                    </div>
                </div>

                <div className='speed-bot-inputs'>
                    <label className='speed-bot-field'>
                        <span>
                            <Localize i18n_default_text='Ticks' />
                        </span>
                        <input
                            inputMode='numeric'
                            value={ticksInput}
                            disabled={isTrading}
                            onChange={event => setTicksInput(cleanIntegerInput(event.target.value))}
                        />
                    </label>
                    <label className='speed-bot-field'>
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
                </div>

                <div className='speed-bot-actions'>
                    <button
                        type='button'
                        className='speed-bot-button speed-bot-button--once'
                        disabled={isTradeInFlight || isTrading}
                        onClick={handleTradeOnce}
                    >
                        <Localize i18n_default_text='Trade Once' />
                    </button>
                    <button type='button' className='speed-bot-button speed-bot-button--start' onClick={handleStartTrading}>
                        <Localize i18n_default_text={isTrading ? 'Stop Trading' : 'Start Trading'} />
                    </button>
                </div>

                <div className='speed-bot-toggles'>
                    <label className='speed-bot-toggle-card'>
                        <span>
                            <Localize i18n_default_text='Alternate Even and Odd' />
                        </span>
                        <span className={`speed-bot-switch ${alternateEvenOdd ? 'speed-bot-switch--on' : ''}`}>
                            <input
                                type='checkbox'
                                checked={alternateEvenOdd}
                                onChange={event => setAlternateEvenOdd(event.target.checked)}
                            />
                            <span className='speed-bot-switch__knob' />
                        </span>
                    </label>
                    <label className='speed-bot-toggle-card'>
                        <span>
                            <Localize i18n_default_text='Alternate on Loss' />
                        </span>
                        <span className={`speed-bot-switch ${alternateOnLoss ? 'speed-bot-switch--on' : ''}`}>
                            <input
                                type='checkbox'
                                checked={alternateOnLoss}
                                onChange={event => setAlternateOnLoss(event.target.checked)}
                            />
                            <span className='speed-bot-switch__knob' />
                        </span>
                    </label>
                </div>

                <div className='speed-bot-divider' />

                <label className='speed-bot-toggle-row'>
                    <span>
                        <Localize i18n_default_text='Use Martingale (Digit trades only)' />
                    </span>
                    <span className={`speed-bot-switch ${useMartingale ? 'speed-bot-switch--on' : ''}`}>
                        <input type='checkbox' checked={useMartingale} onChange={event => setUseMartingale(event.target.checked)} />
                        <span className='speed-bot-switch__knob' />
                    </span>
                </label>

                <div className='speed-bot-divider' />

                <label className='speed-bot-field speed-bot-field--row'>
                    <span>
                        <Localize i18n_default_text='Martingale Multiplier' />
                    </span>
                    <input
                        inputMode='decimal'
                        value={martingaleMultiplierInput}
                        onChange={event => setMartingaleMultiplierInput(cleanMoneyInput(event.target.value))}
                    />
                </label>

                <div className='speed-bot-divider' />

                <label className='speed-bot-toggle-row'>
                    <span>
                        <Localize i18n_default_text='Recovery Mode' />
                    </span>
                    <span className={`speed-bot-switch ${recoveryMode ? 'speed-bot-switch--on' : ''}`}>
                        <input type='checkbox' checked={recoveryMode} onChange={event => setRecoveryMode(event.target.checked)} />
                        <span className='speed-bot-switch__knob' />
                    </span>
                </label>

                <div className='speed-bot-divider' />

                <div className='speed-bot-footer'>
                    <div>
                        <Localize i18n_default_text='Ticks Processed:' /> <strong>{ticksProcessed}</strong>
                    </div>
                    <div>
                        <Localize i18n_default_text='Last Digit:' /> <strong>{latestDigit ?? '—'}</strong>
                    </div>
                </div>

                {statusMessage && <p className='speed-bot-status'>{statusMessage}</p>}
                {errorMessage && <p className='speed-bot-error'>{errorMessage}</p>}
            </div>
        </div>
    );
});

export default SpeedBot;
