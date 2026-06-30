import { useCallback, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { DBOT_TABS } from '@/constants/bot-contents';
import { api_base, MessageTypes } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import {
    buildMarketRecommendation,
    calculateDigitPercentagesFromDigits,
    compareOwnStrategy,
    DIGIT_STRATEGIES,
    evaluateDigitStrategy,
    SUPPORTED_VOLATILITY_MARKETS,
    TDigitContractType,
    TOwnStrategy,
} from '@/utils/digit-strategy';
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
// All tradeable contract types on the speed bot: digit contracts plus Rise/Fall.
type TTradeType = TDigitContractType | 'Rise' | 'Fall';

const BARRIER_CONTRACT_TYPES: TTradeType[] = ['Over', 'Under', 'Matches', 'Differs'];

const CONTRACT_TYPE_CODE: Record<TTradeType, string> = {
    Differs: 'DIGITDIFF',
    Even: 'DIGITEVEN',
    Fall: 'PUT',
    Matches: 'DIGITMATCH',
    Odd: 'DIGITODD',
    Over: 'DIGITOVER',
    Rise: 'CALL',
    Under: 'DIGITUNDER',
};

const PATTERN_LENGTH = 20;
const STATS_WINDOW = 100;
const DEFAULT_TICKS = '1';
const DEFAULT_STAKE = '0.5';
const DEFAULT_MARTINGALE_MULTIPLIER = '1.15';
const DEFAULT_SYMBOL = 'R_100';
const DEFAULT_TAKE_PROFIT = '10';
const DEFAULT_STOP_LOSS = '10';

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
    const { client, dashboard, run_panel, journal, transactions, summary_card } = useStore();
    const { active_tab } = dashboard;
    const showSpeedBot = active_tab === DBOT_TABS.SPEED_BOT;

    const [selectedSymbol, setSelectedSymbol] = useState(DEFAULT_SYMBOL);
    const [tradeType, setTradeType] = useState<TTradeType>('Even');
    const [barrierInput, setBarrierInput] = useState('5');
    const [ownStrategyType, setOwnStrategyType] = useState<TDigitContractType>('Over');
    const [ownStrategyBarrierInput, setOwnStrategyBarrierInput] = useState('2');
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
    const [recoveryMarket, setRecoveryMarket] = useState(DEFAULT_SYMBOL);
    const [recoveryTradeType, setRecoveryTradeType] = useState<TTradeType>('Over');
    const [recoveryBarrierInput, setRecoveryBarrierInput] = useState('5');
    const [autoAnalyze, setAutoAnalyze] = useState(false);
    const [takeProfitInput, setTakeProfitInput] = useState(DEFAULT_TAKE_PROFIT);
    const [stopLossInput, setStopLossInput] = useState(DEFAULT_STOP_LOSS);
    const [sessionPnl, setSessionPnl] = useState(0);
    const [ticksProcessed, setTicksProcessed] = useState(0);
    const [statusMessage, setStatusMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    const subscriptionRef = useRef<{ unsubscribe?: () => void } | null>(null);
    const requestVersionRef = useRef(0);
    const ticksRef = useRef<TTickPoint[]>([]);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const shouldStopRef = useRef(true);

    const tradeTypeRef = useRef<TTradeType>(tradeType);
    const barrierRef = useRef(barrierInput);
    const alternateEvenOddRef = useRef(alternateEvenOdd);
    const alternateOnLossRef = useRef(alternateOnLoss);
    const useMartingaleRef = useRef(useMartingale);
    const martingaleMultiplierRef = useRef(1.15);
    const recoveryModeRef = useRef(recoveryMode);
    const recoveryMarketRef = useRef(recoveryMarket);
    const recoveryTradeTypeRef = useRef<TTradeType>(recoveryTradeType);
    const recoveryBarrierRef = useRef(recoveryBarrierInput);
    const selectedSymbolRef = useRef(selectedSymbol);
    const autoAnalyzeRef = useRef(autoAnalyze);
    const takeProfitRef = useRef(parseFloat(DEFAULT_TAKE_PROFIT));
    const stopLossRef = useRef(parseFloat(DEFAULT_STOP_LOSS));
    const sessionPnlRef = useRef(0);

    const baseStakeRef = useRef(0);
    const currentStakeRef = useRef(0);
    const consecutiveLossesRef = useRef(0);
    const isRecoveringRef = useRef(false);

    useEffect(() => {
        tradeTypeRef.current = tradeType;
    }, [tradeType]);
    useEffect(() => {
        barrierRef.current = barrierInput;
    }, [barrierInput]);
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
        recoveryMarketRef.current = recoveryMarket;
    }, [recoveryMarket]);
    useEffect(() => {
        recoveryTradeTypeRef.current = recoveryTradeType;
    }, [recoveryTradeType]);
    useEffect(() => {
        recoveryBarrierRef.current = recoveryBarrierInput;
    }, [recoveryBarrierInput]);
    useEffect(() => {
        selectedSymbolRef.current = selectedSymbol;
    }, [selectedSymbol]);
    useEffect(() => {
        autoAnalyzeRef.current = autoAnalyze;
    }, [autoAnalyze]);
    useEffect(() => {
        const parsed = parseFloat(takeProfitInput);
        takeProfitRef.current = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }, [takeProfitInput]);
    useEffect(() => {
        const parsed = parseFloat(stopLossInput);
        stopLossRef.current = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }, [stopLossInput]);
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

    // ==================== Research: all contract types ====================
    // Builds a live recommendation across every digit-contract family (Even/Odd,
    // Over/Under, Matches/Differs) from the same tick window, instead of only Even/Odd.
    const digitPercentages = calculateDigitPercentagesFromDigits(digitsWindow);
    const ownStrategyBarrierDigit = parseInt(ownStrategyBarrierInput, 10);
    const marketRecommendation = buildMarketRecommendation(
        digitPercentages,
        Number.isFinite(parseInt(barrierInput, 10)) ? parseInt(barrierInput, 10) : 5
    );
    const researchSignals = (Object.keys(DIGIT_STRATEGIES) as Array<keyof typeof DIGIT_STRATEGIES>).map(strategyId => ({
        strategyId,
        ...evaluateDigitStrategy(strategyId, digitPercentages, digitsWindow),
    }));
    const ownStrategy: TOwnStrategy = {
        barrier: Number.isFinite(ownStrategyBarrierDigit) ? ownStrategyBarrierDigit : undefined,
        contractType: ownStrategyType,
    };
    const ownStrategyComparison = compareOwnStrategy(ownStrategy, marketRecommendation);

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

    // Analyses the most recent ticks and returns the statistically dominant
    // Even/Odd side, logging the analysis snapshot to the Journal.
    const analyzeAndPickTradeType = useCallback((): TEvenOdd => {
        const symbol = selectedSymbolRef.current;
        const digits = ticksRef.current.slice(-STATS_WINDOW).map(tick => getLastDigitFromQuote(tick.quote, symbol));
        const total = digits.length;
        const evenCount = digits.filter(digit => digit % 2 === 0).length;
        const evenPct = total ? (evenCount / total) * 100 : 50;
        const oddPct = total ? 100 - evenPct : 50;
        const lastDigit = digits[digits.length - 1];
        const chosen: TEvenOdd = evenPct >= oddPct ? 'Even' : 'Odd';

        logJournal(
            `📊 Last tick analysis (${total} ticks on ${symbol}): Even ${evenPct.toFixed(1)}% / Odd ${oddPct.toFixed(1)}%, last digit ${
                lastDigit ?? '—'
            } → Auto-trading ${chosen}`,
            MessageTypes.NOTIFY
        );

        return chosen;
    }, [logJournal]);

    // ==================== Trading ====================

    const buildTradeParameters = useCallback(
        (type: TTradeType, stake: number, durationTicks: number, barrier: string, symbol?: string) => {
            const parameters: Record<string, any> = {
                amount: stake,
                basis: 'stake',
                contract_type: CONTRACT_TYPE_CODE[type],
                currency,
                duration: durationTicks,
                duration_unit: 't',
                symbol: symbol ?? selectedSymbolRef.current,
            };
            if (BARRIER_CONTRACT_TYPES.includes(type)) {
                parameters.barrier = barrier;
            }
            return parameters;
        },
        [currency]
    );

    const runSingleTrade = useCallback(
        async (type: TTradeType, stake: number, durationTicks: number, barrier: string, symbol?: string): Promise<number> => {
            const activeSymbol = symbol ?? selectedSymbolRef.current;
            const contractTypeCode = CONTRACT_TYPE_CODE[type];
            const tradeStartTime = Math.floor(Date.now() / 1000);

            const buy = await buyContractForUi({
                parameters: buildTradeParameters(type, stake, durationTicks, barrier, activeSymbol),
                price: stake,
                source: 'Speed Bot',
            });

            const fallback = {
                buy_price: buy.buy_price,
                contract_id: buy.contract_id,
                transaction_ids: { buy: buy.transaction_id },
                date_start: tradeStartTime,
                display_name: activeSymbol,
                underlying_symbol: activeSymbol,
                shortcode: `SPEEDBOT_${contractTypeCode}_${activeSymbol}`,
                contract_type: contractTypeCode,
                currency,
            };

            // Show the open transaction immediately in the Transactions table.
            pushContract(fallback);
            logJournal(
                `🛒 Speed Bot bought ${type} on ${activeSymbol} — stake ${stake.toFixed(2)} ${currency}`,
                MessageTypes.SUCCESS
            );

            const settled = await streamContractUntilSettled({
                contractId: buy.contract_id,
                fallback,
                onUpdate: snapshot => pushContract(snapshot),
                source: 'Speed Bot',
            });

            const profit = Number(settled.profit ?? 0);
            const won = profit > 0;

            logJournal(
                won
                    ? `✅ Speed Bot won ${profit.toFixed(2)} ${currency} (${type} on ${activeSymbol})`
                    : `❌ Speed Bot lost ${Math.abs(profit).toFixed(2)} ${currency} (${type} on ${activeSymbol})`,
                won ? MessageTypes.SUCCESS : MessageTypes.ERROR
            );

            return profit;
        },
        [buildTradeParameters, currency, logJournal, pushContract]
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
        sessionPnlRef.current = 0;
        setSessionPnl(0);

        let currentType: TTradeType = autoAnalyzeRef.current ? analyzeAndPickTradeType() : tradeTypeRef.current;

        while (!shouldStopRef.current) {
            const inRecovery = recoveryModeRef.current && isRecoveringRef.current;

            // When auto-analysis is enabled, re-evaluate the last-tick analysis
            // before every trade so direction always follows the latest data.
            // Skipped while recovering — the recovery market/trade-type takes over.
            if (autoAnalyzeRef.current && !inRecovery) {
                currentType = analyzeAndPickTradeType();
            }

            // Recovery Mode: once a loss puts us in recovery, switch to the dedicated
            // recovery market and trade type until a win clears the cycle.
            const activeSymbol = inRecovery ? recoveryMarketRef.current : selectedSymbolRef.current;
            const activeType: TTradeType = inRecovery ? recoveryTradeTypeRef.current : currentType;
            const activeBarrier = inRecovery ? recoveryBarrierRef.current : barrierRef.current;

            setIsTradeInFlight(true);
            const tradeStake = currentStakeRef.current;
            setStatusMessage(
                inRecovery
                    ? `🔁 Recovery: Trading ${activeType} on ${activeSymbol} with ${tradeStake.toFixed(2)} ${currency}...`
                    : `Trading ${activeType} with ${tradeStake.toFixed(2)} ${currency}...`
            );

            try {
                const profit = await runSingleTrade(activeType, tradeStake, durationTicks, activeBarrier, activeSymbol);
                if (shouldStopRef.current) break;

                const won = profit > 0;
                sessionPnlRef.current = parseFloat((sessionPnlRef.current + profit).toFixed(8));
                setSessionPnl(sessionPnlRef.current);

                if (won) {
                    setStatusMessage(`✅ Won ${profit.toFixed(2)} ${currency}`);
                    consecutiveLossesRef.current = 0;
                    currentStakeRef.current = baseStakeRef.current;
                    if (inRecovery) {
                        logJournal(
                            `✅ Recovery cleared — switching back to ${selectedSymbolRef.current}`,
                            MessageTypes.SUCCESS
                        );
                    }
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
                        if (!isRecoveringRef.current) {
                            logJournal(
                                `🔁 Recovery Mode triggered — switching to ${recoveryTradeTypeRef.current} on ${recoveryMarketRef.current}`,
                                MessageTypes.NOTIFY
                            );
                        }
                        isRecoveringRef.current = true;
                        if (!useMartingaleRef.current) {
                            currentStakeRef.current =
                                baseStakeRef.current * Math.pow(martingaleMultiplierRef.current, consecutiveLossesRef.current);
                        }
                    }

                    // Alternating only makes sense for the Even/Odd pair; other contract types keep their selection.
                    // Skipped while recovering — the primary direction resumes once recovery clears.
                    if (
                        !inRecovery &&
                        !autoAnalyzeRef.current &&
                        alternateOnLossRef.current &&
                        (currentType === 'Even' || currentType === 'Odd')
                    ) {
                        currentType = currentType === 'Even' ? 'Odd' : 'Even';
                    }
                }

                // Alternate Even/Odd on every trade regardless of outcome (manual mode only;
                // auto-analysis picks its own direction every iteration). Skipped while recovering.
                if (
                    !inRecovery &&
                    !autoAnalyzeRef.current &&
                    alternateEvenOddRef.current &&
                    (currentType === 'Even' || currentType === 'Odd')
                ) {
                    currentType = currentType === 'Even' ? 'Odd' : 'Even';
                }

                if (!inRecovery) setTradeType(currentType);

                // Stop Loss / Take Profit: end the session once either threshold is reached.
                const takeProfit = takeProfitRef.current;
                const stopLoss = stopLossRef.current;
                if (takeProfit > 0 && sessionPnlRef.current >= takeProfit) {
                    setStatusMessage(`🎯 Take Profit reached: +${sessionPnlRef.current.toFixed(2)} ${currency}`);
                    logJournal(
                        `🎯 Speed Bot stopped — Take Profit of ${takeProfit.toFixed(2)} ${currency} reached (session P/L: ${sessionPnlRef.current.toFixed(2)} ${currency})`,
                        MessageTypes.SUCCESS
                    );
                    break;
                }
                if (stopLoss > 0 && sessionPnlRef.current <= -stopLoss) {
                    setStatusMessage(`🛑 Stop Loss reached: ${sessionPnlRef.current.toFixed(2)} ${currency}`);
                    logJournal(
                        `🛑 Speed Bot stopped — Stop Loss of ${stopLoss.toFixed(2)} ${currency} reached (session P/L: ${sessionPnlRef.current.toFixed(2)} ${currency})`,
                        MessageTypes.ERROR
                    );
                    break;
                }
            } catch (error) {
                setErrorMessage(error instanceof Error ? error.message : 'Trade failed.');
                break;
            } finally {
                setIsTradeInFlight(false);
            }
        }

        shouldStopRef.current = true;
        setIsTrading(false);
    }, [analyzeAndPickTradeType, currency, logJournal, runSingleTrade, stakeInput, ticksInput]);

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

        const type = autoAnalyzeRef.current ? analyzeAndPickTradeType() : tradeType;

        setIsTradeInFlight(true);
        try {
            const profit = await runSingleTrade(type, stake, durationTicks, barrierInput);
            sessionPnlRef.current = parseFloat((sessionPnlRef.current + profit).toFixed(8));
            setSessionPnl(sessionPnlRef.current);
            setTradeType(type);
            setStatusMessage(
                profit > 0 ? `✅ Won ${profit.toFixed(2)} ${currency}` : `❌ Lost ${Math.abs(profit).toFixed(2)} ${currency}`
            );
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Trade failed.');
        } finally {
            setIsTradeInFlight(false);
        }
    }, [analyzeAndPickTradeType, barrierInput, currency, isTradeInFlight, isTrading, runSingleTrade, stakeInput, ticksInput, tradeType]);

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
                    disabled={isTrading || autoAnalyze}
                    onChange={event => setTradeType(event.target.value as TTradeType)}
                >
                    <optgroup label='Even / Odd'>
                        <option value='Even'>Even</option>
                        <option value='Odd'>Odd</option>
                    </optgroup>
                    <optgroup label='Over / Under'>
                        <option value='Over'>Over</option>
                        <option value='Under'>Under</option>
                    </optgroup>
                    <optgroup label='Matches / Differs'>
                        <option value='Matches'>Matches</option>
                        <option value='Differs'>Differs</option>
                    </optgroup>
                    <optgroup label='Rise / Fall'>
                        <option value='Rise'>Rise</option>
                        <option value='Fall'>Fall</option>
                    </optgroup>
                </select>

                {BARRIER_CONTRACT_TYPES.includes(tradeType) && (
                    <label className='speed-bot-field'>
                        <span>
                            <Localize i18n_default_text='Barrier Digit (0-9)' />
                        </span>
                        <input
                            inputMode='numeric'
                            value={barrierInput}
                            disabled={isTrading}
                            onChange={event => setBarrierInput(cleanIntegerInput(event.target.value).slice(0, 1))}
                        />
                    </label>
                )}

                <label className='speed-bot-toggle-row'>
                    <span>
                        <Localize i18n_default_text='Auto Trade (Use Last Tick Analysis)' />
                    </span>
                    <span className={`speed-bot-switch ${autoAnalyze ? 'speed-bot-switch--on' : ''}`}>
                        <input
                            type='checkbox'
                            checked={autoAnalyze}
                            disabled={isTrading}
                            onChange={event => setAutoAnalyze(event.target.checked)}
                        />
                        <span className='speed-bot-switch__knob' />
                    </span>
                </label>

                <div className='speed-bot-divider' />

                {/* ==================== Research: all contract types ==================== */}
                <div className='speed-bot-research'>
                    <div className='speed-bot-research__title'>
                        <Localize i18n_default_text='Research — All Contract Types' />
                    </div>
                    <div className='speed-bot-research__grid'>
                        <div className='speed-bot-research__item'>
                            <span>Even</span>
                            <strong>{marketRecommendation.evenOdd.evenPercent.toFixed(1)}%</strong>
                        </div>
                        <div className='speed-bot-research__item'>
                            <span>Odd</span>
                            <strong>{marketRecommendation.evenOdd.oddPercent.toFixed(1)}%</strong>
                        </div>
                        <div className='speed-bot-research__item'>
                            <span>Over {marketRecommendation.overUnder.barrier}</span>
                            <strong>{marketRecommendation.overUnder.overPercent.toFixed(1)}%</strong>
                        </div>
                        <div className='speed-bot-research__item'>
                            <span>Under {marketRecommendation.overUnder.barrier}</span>
                            <strong>{marketRecommendation.overUnder.underPercent.toFixed(1)}%</strong>
                        </div>
                        <div className='speed-bot-research__item'>
                            <span>
                                <Localize i18n_default_text='Most likely digit' />
                            </span>
                            <strong>{marketRecommendation.matchesDiffers.mostLikelyDigit}</strong>
                        </div>
                        <div className='speed-bot-research__item'>
                            <span>
                                <Localize i18n_default_text='Least likely digit' />
                            </span>
                            <strong>{marketRecommendation.matchesDiffers.leastLikelyDigit}</strong>
                        </div>
                    </div>
                    <div className='speed-bot-research__signals'>
                        {researchSignals.map(signal => (
                            <div
                                key={signal.strategyId}
                                className={`speed-bot-signal ${signal.entryReady ? 'speed-bot-signal--ready' : signal.isQualified ? 'speed-bot-signal--qualified' : ''}`}
                            >
                                <span>{signal.alertLabel}</span>
                                <strong>
                                    {signal.entryReady ? (
                                        <Localize i18n_default_text='Entry Ready' />
                                    ) : signal.isQualified ? (
                                        <Localize i18n_default_text='Qualified' />
                                    ) : (
                                        <Localize i18n_default_text='Watching' />
                                    )}
                                </strong>
                            </div>
                        ))}
                    </div>
                </div>

                <div className='speed-bot-divider' />

                {/* ==================== Own strategy: match / differs ==================== */}
                <div className='speed-bot-own-strategy'>
                    <div className='speed-bot-own-strategy__title'>
                        <Localize i18n_default_text='My Own Strategy' />
                    </div>
                    <div className='speed-bot-own-strategy__row'>
                        <select
                            className='speed-bot-select'
                            value={ownStrategyType}
                            onChange={event => setOwnStrategyType(event.target.value as TDigitContractType)}
                        >
                            <option value='Even'>Even</option>
                            <option value='Odd'>Odd</option>
                            <option value='Over'>Over</option>
                            <option value='Under'>Under</option>
                            <option value='Matches'>Matches</option>
                            <option value='Differs'>Differs</option>
                        </select>
                        {(ownStrategyType === 'Over' ||
                            ownStrategyType === 'Under' ||
                            ownStrategyType === 'Matches' ||
                            ownStrategyType === 'Differs') && (
                            <input
                                className='speed-bot-own-strategy__barrier'
                                inputMode='numeric'
                                value={ownStrategyBarrierInput}
                                onChange={event => setOwnStrategyBarrierInput(cleanIntegerInput(event.target.value).slice(0, 1))}
                            />
                        )}
                    </div>
                    <div
                        className={`speed-bot-own-strategy__badge ${
                            ownStrategyComparison.matches ? 'speed-bot-own-strategy__badge--match' : 'speed-bot-own-strategy__badge--differ'
                        }`}
                    >
                        {ownStrategyComparison.matches ? (
                            <Localize i18n_default_text='Matches current market read' />
                        ) : (
                            <Localize i18n_default_text='Differs from current market read' />
                        )}
                        {' — '}
                        <Localize i18n_default_text='Live read:' /> {ownStrategyComparison.recommendedPick}
                    </div>
                </div>

                <div className='speed-bot-divider' />

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

                <div className='speed-bot-inputs'>
                    <label className='speed-bot-field'>
                        <span>
                            <Localize i18n_default_text='Take Profit' />
                        </span>
                        <input
                            inputMode='decimal'
                            value={takeProfitInput}
                            disabled={isTrading}
                            onChange={event => setTakeProfitInput(cleanMoneyInput(event.target.value))}
                        />
                    </label>
                    <label className='speed-bot-field'>
                        <span>
                            <Localize i18n_default_text='Stop Loss' />
                        </span>
                        <input
                            inputMode='decimal'
                            value={stopLossInput}
                            disabled={isTrading}
                            onChange={event => setStopLossInput(cleanMoneyInput(event.target.value))}
                        />
                    </label>
                </div>
                <p className='speed-bot-tp-sl-hint'>
                    <Localize i18n_default_text='Start Trading runs continuously until Take Profit or Stop Loss is reached. Trade Once always places a single trade.' />
                </p>

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

                {recoveryMode && (
                    <div className='speed-bot-recovery'>
                        <p className='speed-bot-hint'>
                            <Localize i18n_default_text='After a loss, the bot switches to this market and trade type — with the escalated stake — until a win clears the recovery cycle.' />
                        </p>

                        <label className='speed-bot-field'>
                            <span>
                                <Localize i18n_default_text='Recovery Market' />
                            </span>
                            <select
                                className='speed-bot-select'
                                value={recoveryMarket}
                                disabled={isTrading}
                                onChange={event => setRecoveryMarket(event.target.value)}
                            >
                                {SUPPORTED_VOLATILITY_MARKETS.map(market => (
                                    <option key={market.symbol} value={market.symbol}>
                                        {market.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className='speed-bot-field'>
                            <span>
                                <Localize i18n_default_text='Recovery Trade Type' />
                            </span>
                            <select
                                className='speed-bot-select'
                                value={recoveryTradeType}
                                disabled={isTrading}
                                onChange={event => setRecoveryTradeType(event.target.value as TTradeType)}
                            >
                                <optgroup label='Even / Odd'>
                                    <option value='Even'>Even</option>
                                    <option value='Odd'>Odd</option>
                                </optgroup>
                                <optgroup label='Over / Under'>
                                    <option value='Over'>Over</option>
                                    <option value='Under'>Under</option>
                                </optgroup>
                                <optgroup label='Matches / Differs'>
                                    <option value='Matches'>Matches</option>
                                    <option value='Differs'>Differs</option>
                                </optgroup>
                                <optgroup label='Rise / Fall'>
                                    <option value='Rise'>Rise</option>
                                    <option value='Fall'>Fall</option>
                                </optgroup>
                            </select>
                        </label>

                        {BARRIER_CONTRACT_TYPES.includes(recoveryTradeType) && (
                            <label className='speed-bot-field'>
                                <span>
                                    <Localize i18n_default_text='Recovery Barrier Digit (0-9)' />
                                </span>
                                <input
                                    inputMode='numeric'
                                    value={recoveryBarrierInput}
                                    disabled={isTrading}
                                    onChange={event =>
                                        setRecoveryBarrierInput(cleanIntegerInput(event.target.value).slice(0, 1))
                                    }
                                />
                            </label>
                        )}
                    </div>
                )}

                <div className='speed-bot-divider' />

                <div className='speed-bot-footer'>
                    <div>
                        <Localize i18n_default_text='Ticks Processed:' /> <strong>{ticksProcessed}</strong>
                    </div>
                    <div>
                        <Localize i18n_default_text='Session P/L:' />{' '}
                        <strong className={sessionPnl > 0 ? 'speed-bot-pnl--positive' : sessionPnl < 0 ? 'speed-bot-pnl--negative' : ''}>
                            {sessionPnl >= 0 ? '+' : ''}
                            {sessionPnl.toFixed(2)} {currency}
                        </strong>
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
