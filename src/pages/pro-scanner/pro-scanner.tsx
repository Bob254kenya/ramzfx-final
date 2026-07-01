import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { useDevice } from '@deriv-com/ui';
import { contract_stages } from '@/constants/contract-stage';
import { DBOT_TABS } from '@/constants/bot-contents';
import { api_base, observer as globalObserver } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { getLastDigitFromQuote, getMarketPipSize, isExpectedStreamInterruption } from '@/utils/market-data';
import { buyContractForUi, streamContractUntilSettled } from '@/utils/trade-purchase';
import { safeSubscribe } from '@/utils/websocket-handler';
import './pro-scanner.scss';

// ============================================================================
// Types
// ============================================================================

type TTick = { epoch: number; quote: number };

type TStrategyId = 'over_under' | 'even_odd' | 'matches_differs' | 'rise_fall';

type TContractType = 'DIGITOVER' | 'DIGITUNDER' | 'DIGITEVEN' | 'DIGITODD' | 'DIGITMATCH' | 'DIGITDIFF' | 'CALL' | 'PUT';

type TSignal = {
    barrier?: string;
    contractType: TContractType;
    label: string;
    recoveryBarrier?: string;
    recoveryContractType?: TContractType;
    recoveryLabel?: string;
};

type TMarket = { label: string; symbol: string };

type TLogEntry = { at: number; kind: 'info' | 'win' | 'loss' | 'error' | 'signal'; text: string };

// ============================================================================
// Constants
// ============================================================================

const MARKETS: TMarket[] = [
    { label: 'Volatility 10 (1s) Index', symbol: '1HZ10V' },
    { label: 'Volatility 15 (1s) Index', symbol: '1HZ15V' },
    { label: 'Volatility 25 (1s) Index', symbol: '1HZ25V' },
    { label: 'Volatility 30 (1s) Index', symbol: '1HZ30V' },
    { label: 'Volatility 50 (1s) Index', symbol: '1HZ50V' },
    { label: 'Volatility 75 (1s) Index', symbol: '1HZ75V' },
    { label: 'Volatility 90 (1s) Index', symbol: '1HZ90V' },
    { label: 'Volatility 100 (1s) Index', symbol: '1HZ100V' },
    { label: 'Volatility 10 Index', symbol: 'R_10' },
    { label: 'Volatility 25 Index', symbol: 'R_25' },
    { label: 'Volatility 50 Index', symbol: 'R_50' },
    { label: 'Volatility 75 Index', symbol: 'R_75' },
    { label: 'Volatility 100 Index', symbol: 'R_100' },
];

const STRATEGIES: { id: TStrategyId; label: string }[] = [
    { id: 'over_under', label: 'Over & Under' },
    { id: 'even_odd', label: 'Even & Odd' },
    { id: 'matches_differs', label: 'Matches & Differs' },
    { id: 'rise_fall', label: 'Rise & Fall' },
];

const MAX_TICKS = 1000;
const MIN_SAMPLE_FOR_SIGNAL = 200;
const DEFAULT_STAKE = '0.5';
const DEFAULT_STOP_LOSS = '20';
const DEFAULT_TAKE_PROFIT = '5';
const DEFAULT_MARTINGALE = 2;
const DEFAULT_RUNS = '5';
const MARTINGALE_STEPS = [1, 1.2, 1.5, 1.8, 2, 2.2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10];
const MAX_LOG_ENTRIES = 120;

// ============================================================================
// Pure helpers
// ============================================================================

const cleanMoney = (value: string) => value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
const cleanInt = (value: string) => value.replace(/[^\d]/g, '');

const digitsFromTicks = (ticks: TTick[], symbol: string) => ticks.map(tick => getLastDigitFromQuote(tick.quote, symbol));

const digitStatsFrom = (digits: number[]) => {
    const counts = new Array(10).fill(0);
    digits.forEach(digit => {
        if (digit >= 0 && digit <= 9) counts[digit] += 1;
    });
    const total = Math.max(digits.length, 1);
    return counts.map(count => Number(((count / total) * 100).toFixed(1)));
};

/** Builds a trade signal for the selected strategy from the current tick window. */
const buildSignal = (strategyId: TStrategyId, ticks: TTick[], symbol: string): { lines: string[]; signal: TSignal } => {
    const digits = digitsFromTicks(ticks, symbol);
    const sample = Math.max(digits.length, 1);
    const lines: string[] = [];

    if (strategyId === 'over_under') {
        let lowCount = 0; // 0-4
        let highCount = 0; // 5-9
        digits.forEach(d => (d <= 4 ? lowCount++ : highCount++));
        const lowPct = ((lowCount / sample) * 100).toFixed(1);
        const highPct = ((highCount / sample) * 100).toFixed(1);

        if (lowCount <= highCount) {
            lines.push(`Digits 0-4 are less frequent (${lowPct}%) — trading OVER.`);
            lines.push('Primary: Over 1 · Recovery: Over 3');
            return {
                lines,
                signal: {
                    barrier: '1',
                    contractType: 'DIGITOVER',
                    label: 'Over 1',
                    recoveryBarrier: '3',
                    recoveryContractType: 'DIGITOVER',
                    recoveryLabel: 'Over 3',
                },
            };
        }
        lines.push(`Digits 5-9 are less frequent (${highPct}%) — trading UNDER.`);
        lines.push('Primary: Under 8 · Recovery: Under 6');
        return {
            lines,
            signal: {
                barrier: '8',
                contractType: 'DIGITUNDER',
                label: 'Under 8',
                recoveryBarrier: '6',
                recoveryContractType: 'DIGITUNDER',
                recoveryLabel: 'Under 6',
            },
        };
    }

    if (strategyId === 'even_odd') {
        const evenCount = digits.filter(d => d % 2 === 0).length;
        const oddCount = sample - evenCount;
        const evenPct = ((evenCount / sample) * 100).toFixed(1);
        const oddPct = ((oddCount / sample) * 100).toFixed(1);
        if (evenCount >= oddCount) {
            lines.push(`EVEN dominates the last ${sample} ticks (${evenPct}%).`);
            return { lines, signal: { contractType: 'DIGITEVEN', label: 'Even' } };
        }
        lines.push(`ODD dominates the last ${sample} ticks (${oddPct}%).`);
        return { lines, signal: { contractType: 'DIGITODD', label: 'Odd' } };
    }

    if (strategyId === 'matches_differs') {
        const stats = digitStatsFrom(digits);
        let mostCommon = 0;
        let leastCommon = 0;
        stats.forEach((pct, digit) => {
            if (pct > stats[mostCommon]) mostCommon = digit;
            if (pct < stats[leastCommon]) leastCommon = digit;
        });
        lines.push(`Digit ${mostCommon} is the most common (${stats[mostCommon]}%).`);
        lines.push(`Digit ${leastCommon} is the least common (${stats[leastCommon]}%) — trading DIFFERS.`);
        return { lines, signal: { barrier: String(leastCommon), contractType: 'DIGITDIFF', label: `Differs ${leastCommon}` } };
    }

    // rise_fall
    let ups = 0;
    let downs = 0;
    for (let i = 1; i < ticks.length; i += 1) {
        if (ticks[i].quote > ticks[i - 1].quote) ups += 1;
        else if (ticks[i].quote < ticks[i - 1].quote) downs += 1;
    }
    const rising = ups >= downs;
    lines.push(`Price moved up ${ups} times and down ${downs} times in this window.`);
    lines.push(rising ? 'Momentum favors RISE.' : 'Momentum favors FALL.');
    return { lines, signal: rising ? { contractType: 'CALL', label: 'Rise' } : { contractType: 'PUT', label: 'Fall' } };
};

const getTickFromWsPayload = (data: any): TTick | null => {
    const quote = Number(data?.tick?.quote);
    if (!Number.isFinite(quote)) return null;
    return { epoch: Number(data?.tick?.epoch) || Math.floor(Date.now() / 1000), quote };
};

// ============================================================================
// TP/SL Notification
// ============================================================================

const TpSlNotification: React.FC<{
    currency: string;
    isTakeProfit: boolean;
    onClose: () => void;
    runs: number;
    totalPnl: number;
}> = ({ currency, isTakeProfit, onClose, runs, totalPnl }) => (
    <div className='scanner2-notify-overlay' onClick={onClose}>
        <div className={classNames('scanner2-notify', isTakeProfit ? 'scanner2-notify--win' : 'scanner2-notify--loss')} onClick={e => e.stopPropagation()}>
            <div className='scanner2-notify__icon'>{isTakeProfit ? '🎯' : '🛑'}</div>
            <h3 className='scanner2-notify__title'>{isTakeProfit ? 'Take Profit Reached' : 'Stop Loss Reached'}</h3>
            <p className='scanner2-notify__pnl'>
                {totalPnl >= 0 ? '+' : ''}
                {totalPnl.toFixed(2)} {currency}
            </p>
            <p className='scanner2-notify__meta'>{runs} run{runs === 1 ? '' : 's'} completed this session</p>
            <button className='scanner2-notify__ok' onClick={onClose} type='button'>
                Close
            </button>
        </div>
    </div>
);

// ============================================================================
// Component
// ============================================================================

const ProScanner = observer(() => {
    const { client, dashboard, run_panel, summary_card, transactions } = useStore();
    const { isDesktop } = useDevice();
    const { active_tab } = dashboard;
    const showScanner = active_tab === DBOT_TABS.PRO_SCANNER;
    const currency = client.currency || 'USD';

    // Config
    const [symbol, setSymbol] = useState('R_10');
    const [strategyId, setStrategyId] = useState<TStrategyId>('over_under');
    const [stakeInput, setStakeInput] = useState(DEFAULT_STAKE);
    const [stopLossInput, setStopLossInput] = useState(DEFAULT_STOP_LOSS);
    const [takeProfitInput, setTakeProfitInput] = useState(DEFAULT_TAKE_PROFIT);
    const [martingale, setMartingale] = useState(DEFAULT_MARTINGALE);
    const [runsInput, setRunsInput] = useState(DEFAULT_RUNS);

    // Live data
    const [ticks, setTicks] = useState<TTick[]>([]);
    const [isConnected, setIsConnected] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const [log, setLog] = useState<TLogEntry[]>([]);
    const [sessionPnl, setSessionPnl] = useState(0);
    const [completedRuns, setCompletedRuns] = useState(0);
    const [consecutiveLosses, setConsecutiveLosses] = useState(0);
    const [currentStakeDisplay, setCurrentStakeDisplay] = useState(0);
    const [isRecoveryMode, setIsRecoveryMode] = useState(false);
    const [notification, setNotification] = useState<{ isTakeProfit: boolean; runs: number; totalPnl: number } | null>(null);

    // Refs mirroring the state used by the async trading loop
    const ticksRef = useRef<TTick[]>([]);
    const symbolRef = useRef(symbol);
    const strategyRef = useRef(strategyId);
    const shouldStopRef = useRef(true);
    const tradeActiveRef = useRef(false);
    const tradeInFlightRef = useRef(false);
    const subscriptionRef = useRef<{ unsubscribe?: () => void } | null>(null);
    const requestVersionRef = useRef(0);

    const baseStakeRef = useRef(0);
    const currentStakeRef = useRef(0);
    const martingaleRef = useRef(DEFAULT_MARTINGALE);
    const consecutiveLossesRef = useRef(0);
    const consecutiveRecoveryLossesRef = useRef(0);
    const isRecoveryRef = useRef(false);
    const primarySignalRef = useRef<TSignal | null>(null);
    const recoverySignalRef = useRef<TSignal | null>(null);
    const stopLossRef = useRef(0);
    const takeProfitRef = useRef(0);
    const runsToCheckRef = useRef(5);
    const completedRunsRef = useRef(0);
    const sessionPnlRef = useRef(0);
    const handleTradeTickRef = useRef<(ticks: TTick[]) => void>(() => undefined);

    const selectedMarket = useMemo(() => MARKETS.find(m => m.symbol === symbol) ?? MARKETS[0], [symbol]);
    const latestTick = ticks[ticks.length - 1];
    const latestDigit = latestTick ? getLastDigitFromQuote(latestTick.quote, symbol) : null;
    const digits = useMemo(() => digitsFromTicks(ticks, symbol), [ticks, symbol]);
    const digitStats = useMemo(() => digitStatsFrom(digits), [digits]);
    const hasEnoughSamples = digits.length >= MIN_SAMPLE_FOR_SIGNAL;
    const preview = useMemo(() => (hasEnoughSamples ? buildSignal(strategyId, ticks, symbol) : null), [hasEnoughSamples, strategyId, ticks, symbol]);
    const isCoveredByMobileRunPanel = !isDesktop && run_panel.is_drawer_open;

    const pushLog = useCallback((kind: TLogEntry['kind'], text: string) => {
        setLog(previous => [...previous.slice(-(MAX_LOG_ENTRIES - 1)), { at: Date.now(), kind, text }]);
    }, []);

    // Keep refs in sync with state used inside the async loop.
    useEffect(() => {
        ticksRef.current = ticks;
    }, [ticks]);
    useEffect(() => {
        symbolRef.current = symbol;
    }, [symbol]);
    useEffect(() => {
        strategyRef.current = strategyId;
    }, [strategyId]);
    useEffect(() => {
        martingaleRef.current = martingale;
    }, [martingale]);

    // --- Ticks stream -------------------------------------------------------

    const unsubscribe = useCallback(() => {
        try {
            subscriptionRef.current?.unsubscribe?.();
        } catch {
            // stream may already be closed
        }
        subscriptionRef.current = null;
    }, []);

    const applyLiveTick = useCallback((tick: TTick) => {
        const next = [...ticksRef.current, tick].slice(-MAX_TICKS);
        ticksRef.current = next;
        setTicks(next);
        handleTradeTickRef.current(next);
    }, []);

    const loadMarketData = useCallback(async () => {
        unsubscribe();
        if (!showScanner || !api_base.api) return;

        const requestVersion = requestVersionRef.current + 1;
        requestVersionRef.current = requestVersion;
        setIsConnected(false);
        setTicks([]);
        ticksRef.current = [];

        try {
            const history = await api_base.api.send({
                adjust_start_time: 1,
                count: MAX_TICKS,
                end: 'latest',
                start: 1,
                style: 'ticks',
                ticks_history: symbol,
            });
            if (requestVersionRef.current !== requestVersion) return;

            const prices: Array<number | string> = Array.isArray(history?.history?.prices) ? history.history.prices : [];
            const times: Array<number | string> = Array.isArray(history?.history?.times) ? history.history.times : [];
            const historyTicks = prices
                .map((price, index) => ({ epoch: Number(times[index]) || Math.floor(Date.now() / 1000), quote: Number(price) }))
                .filter((tick): tick is TTick => Number.isFinite(tick.quote))
                .slice(-MAX_TICKS);

            ticksRef.current = historyTicks;
            setTicks(historyTicks);
            setIsConnected(true);

            const observable = (api_base.api as any).subscribe({ ticks: symbol });
            subscriptionRef.current = safeSubscribe(
                observable,
                (data: any) => {
                    if (requestVersionRef.current !== requestVersion) return;
                    const tick = getTickFromWsPayload(data);
                    if (tick) applyLiveTick(tick);
                },
                error => {
                    if (isExpectedStreamInterruption(error)) return;
                    setIsConnected(false);
                    pushLog('error', 'Tick stream interrupted — reconnecting…');
                }
            );
        } catch (error) {
            setIsConnected(false);
            const message = error instanceof Error ? error.message : 'Unable to load market data.';
            pushLog('error', message);
        }
    }, [applyLiveTick, pushLog, showScanner, symbol, unsubscribe]);

    useEffect(() => {
        void loadMarketData();
        return () => {
            requestVersionRef.current += 1;
            unsubscribe();
        };
    }, [loadMarketData, unsubscribe]);

    // --- Store wiring (run panel / stop handler) -----------------------------

    const stopTrading = useCallback(() => {
        shouldStopRef.current = true;
        tradeActiveRef.current = false;
        setIsRunning(false);
        consecutiveLossesRef.current = 0;
        consecutiveRecoveryLossesRef.current = 0;
        currentStakeRef.current = baseStakeRef.current;
        isRecoveryRef.current = false;
        primarySignalRef.current = null;
        recoverySignalRef.current = null;
        setConsecutiveLosses(0);
        setIsRecoveryMode(false);

        try {
            run_panel.setIsRunning(false);
            run_panel.setContractStage?.(contract_stages.NOT_RUNNING);
        } catch {
            // run panel may not be mounted yet
        }
        dashboard.setActiveTradingModule(null);
    }, [dashboard, run_panel]);

    useEffect(() => {
        if (!showScanner) return undefined;
        dashboard.registerTradingStopHandler('pro_scanner', stopTrading);
        globalObserver.register('bot.manual_stop', stopTrading);
        return () => {
            dashboard.unregisterTradingStopHandler('pro_scanner');
            if (globalObserver.isRegistered('bot.manual_stop')) {
                globalObserver.unregister('bot.manual_stop', stopTrading);
            }
            shouldStopRef.current = true;
            tradeActiveRef.current = false;
        };
    }, [dashboard, showScanner, stopTrading]);

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

    // --- Trade execution ------------------------------------------------------

    const runSingleTrade = useCallback(
        async (signal: TSignal, stake: number): Promise<number> => {
            const parameters: Record<string, number | string> = {
                amount: stake,
                basis: 'stake',
                contract_type: signal.contractType,
                currency,
                duration: 1,
                duration_unit: 't',
                symbol: symbolRef.current,
            };
            if (signal.barrier) parameters.barrier = signal.barrier;

            pushLog('signal', `Buying ${signal.label} · stake ${stake.toFixed(2)} ${currency}`);
            const buy = await buyContractForUi({ parameters, price: stake, source: 'Scanner' });
            const buySnapshot = {
                buy_price: buy.buy_price,
                contract_id: buy.contract_id,
                contract_type: signal.contractType,
                currency,
                date_start: Math.floor(Date.now() / 1000),
                display_name: selectedMarket.label,
                shortcode: `SCANNER_${signal.contractType}_${symbolRef.current}`,
                transaction_ids: { buy: buy.transaction_id },
                underlying_symbol: symbolRef.current,
            };
            pushContract(buySnapshot);

            const settled = await streamContractUntilSettled({
                contractId: buy.contract_id,
                fallback: buySnapshot,
                onUpdate: snapshot => pushContract(snapshot),
                source: 'Scanner',
            });
            return Number(settled.profit ?? 0);
        },
        [currency, pushContract, pushLog, selectedMarket.label]
    );

    const executeTradeFromTick = useCallback(
        async (currentTicks: TTick[]) => {
            if (!tradeActiveRef.current || tradeInFlightRef.current || shouldStopRef.current || currentTicks.length < MIN_SAMPLE_FOR_SIGNAL) {
                return;
            }

            if (sessionPnlRef.current <= -stopLossRef.current) {
                setNotification({ isTakeProfit: false, runs: completedRunsRef.current, totalPnl: sessionPnlRef.current });
                stopTrading();
                return;
            }
            if (sessionPnlRef.current >= takeProfitRef.current) {
                setNotification({ isTakeProfit: true, runs: completedRunsRef.current, totalPnl: sessionPnlRef.current });
                stopTrading();
                return;
            }
            if (completedRunsRef.current >= runsToCheckRef.current && sessionPnlRef.current > 0.1) {
                setNotification({ isTakeProfit: true, runs: completedRunsRef.current, totalPnl: sessionPnlRef.current });
                stopTrading();
                return;
            }

            const usesRecovery = strategyRef.current === 'over_under' && primarySignalRef.current && recoverySignalRef.current;
            const currentSignal = usesRecovery
                ? isRecoveryRef.current
                    ? (recoverySignalRef.current as TSignal)
                    : (primarySignalRef.current as TSignal)
                : buildSignal(strategyRef.current, currentTicks, symbolRef.current).signal;

            tradeInFlightRef.current = true;
            const stake = currentStakeRef.current;
            setCurrentStakeDisplay(stake);

            try {
                const profit = await runSingleTrade(currentSignal, stake);
                const isWin = profit > 0;

                if (isWin) {
                    consecutiveLossesRef.current = 0;
                    consecutiveRecoveryLossesRef.current = 0;
                    currentStakeRef.current = baseStakeRef.current;
                    isRecoveryRef.current = false;
                    pushLog('win', `Win! +${profit.toFixed(2)} ${currency}. Stake reset to ${baseStakeRef.current.toFixed(2)}.`);
                } else {
                    consecutiveLossesRef.current += 1;
                    if (usesRecovery) {
                        if (isRecoveryRef.current) {
                            consecutiveRecoveryLossesRef.current += 1;
                            currentStakeRef.current = baseStakeRef.current * Math.pow(martingaleRef.current, consecutiveRecoveryLossesRef.current);
                            pushLog('loss', `Recovery loss (${consecutiveRecoveryLossesRef.current}). Next stake ${currentStakeRef.current.toFixed(2)} ${currency}.`);
                        } else {
                            isRecoveryRef.current = true;
                            consecutiveRecoveryLossesRef.current = 1;
                            currentStakeRef.current = baseStakeRef.current * martingaleRef.current;
                            pushLog('loss', `Primary loss. Switching to recovery signal (${recoverySignalRef.current?.label}). Next stake ${currentStakeRef.current.toFixed(2)} ${currency}.`);
                        }
                    } else {
                        currentStakeRef.current = baseStakeRef.current * Math.pow(martingaleRef.current, consecutiveLossesRef.current);
                        pushLog('loss', `Loss (${profit.toFixed(2)} ${currency}). Next stake ${currentStakeRef.current.toFixed(2)} ${currency}.`);
                    }
                }

                setConsecutiveLosses(consecutiveLossesRef.current);
                setIsRecoveryMode(isRecoveryRef.current);

                const total = Number((sessionPnlRef.current + profit).toFixed(8));
                sessionPnlRef.current = total;
                completedRunsRef.current += 1;
                setSessionPnl(total);
                setCompletedRuns(completedRunsRef.current);

                if (total <= -stopLossRef.current) {
                    setNotification({ isTakeProfit: false, runs: completedRunsRef.current, totalPnl: total });
                    stopTrading();
                } else if (total >= takeProfitRef.current) {
                    setNotification({ isTakeProfit: true, runs: completedRunsRef.current, totalPnl: total });
                    stopTrading();
                } else if (completedRunsRef.current >= runsToCheckRef.current && total > 0.1) {
                    setNotification({ isTakeProfit: true, runs: completedRunsRef.current, totalPnl: total });
                    stopTrading();
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Trade failed.';
                pushLog('error', message);
                stopTrading();
            } finally {
                tradeInFlightRef.current = false;
                if (tradeActiveRef.current && !shouldStopRef.current) {
                    setTimeout(() => handleTradeTickRef.current(ticksRef.current), 0);
                }
            }
        },
        [currency, pushLog, runSingleTrade, stopTrading]
    );

    useEffect(() => {
        handleTradeTickRef.current = currentTicks => {
            void executeTradeFromTick(currentTicks);
        };
    }, [executeTradeFromTick]);

    const startTrading = useCallback(() => {
        const stake = Number(stakeInput);
        const stopLoss = Number(stopLossInput);
        const takeProfit = Number(takeProfitInput);
        const runs = Number.parseInt(runsInput, 10) || 5;

        if (!Number.isFinite(stake) || stake <= 0) {
            pushLog('error', 'Enter a valid stake amount.');
            return;
        }
        if (!Number.isFinite(stopLoss) || stopLoss <= 0 || !Number.isFinite(takeProfit) || takeProfit <= 0) {
            pushLog('error', 'Enter valid Stop Loss and Take Profit amounts.');
            return;
        }
        if (!hasEnoughSamples || !preview) {
            pushLog('error', `Collecting ticks (${digits.length}/${MIN_SAMPLE_FOR_SIGNAL}) — wait a moment before starting.`);
            return;
        }

        baseStakeRef.current = stake;
        currentStakeRef.current = stake;
        stopLossRef.current = stopLoss;
        takeProfitRef.current = takeProfit;
        runsToCheckRef.current = runs;
        consecutiveLossesRef.current = 0;
        consecutiveRecoveryLossesRef.current = 0;
        isRecoveryRef.current = false;
        completedRunsRef.current = 0;
        sessionPnlRef.current = 0;
        shouldStopRef.current = false;
        tradeActiveRef.current = true;
        tradeInFlightRef.current = false;

        const { signal } = preview;
        if (strategyId === 'over_under' && signal.recoveryContractType && signal.recoveryLabel) {
            primarySignalRef.current = { barrier: signal.barrier, contractType: signal.contractType, label: signal.label };
            recoverySignalRef.current = {
                barrier: signal.recoveryBarrier,
                contractType: signal.recoveryContractType,
                label: signal.recoveryLabel,
            };
        } else {
            primarySignalRef.current = null;
            recoverySignalRef.current = null;
        }

        setSessionPnl(0);
        setCompletedRuns(0);
        setConsecutiveLosses(0);
        setIsRecoveryMode(false);
        setCurrentStakeDisplay(stake);
        setIsRunning(true);
        setLog([]);
        pushLog('info', `Started ${STRATEGIES.find(s => s.id === strategyId)?.label} on ${selectedMarket.label}.`);
        pushLog('info', `Stake ${stake} ${currency} · Martingale x${martingale} · SL ${stopLoss} · TP ${takeProfit} · Runs ${runs}`);

        try {
            run_panel.setRunId(`scanner-${Date.now()}`);
            run_panel.setIsRunning(true);
            run_panel.setContractStage?.(contract_stages.RUNNING);
            run_panel.toggleDrawer(true);
        } catch {
            // run panel may not be mounted yet
        }
        dashboard.setActiveTradingModule('pro_scanner');
        void executeTradeFromTick(ticksRef.current);
    }, [
        currency,
        dashboard,
        digits.length,
        executeTradeFromTick,
        hasEnoughSamples,
        martingale,
        preview,
        pushLog,
        runsInput,
        run_panel,
        selectedMarket.label,
        stakeInput,
        stopLossInput,
        strategyId,
        takeProfitInput,
    ]);

    const handleMarketChange = (nextSymbol: string) => {
        stopTrading();
        setSymbol(nextSymbol);
    };
    const handleStrategyChange = (next: TStrategyId) => {
        stopTrading();
        setStrategyId(next);
    };

    if (!showScanner) return null;

    return (
        <div className={classNames('scanner2-page', { 'scanner2-page--run-panel-open': isCoveredByMobileRunPanel })}>
            <div className='scanner2-scroll'>
                <div className='scanner2-header'>
                    <div>
                        <h1 className='scanner2-header__title'>Pro Scanner Bot</h1>
                        <p className='scanner2-header__subtitle'>Live digit analysis with martingale &amp; loss-recovery signals</p>
                    </div>
                    <div className={classNames('scanner2-status', { 'scanner2-status--live': isConnected })}>
                        <span className='scanner2-status__dot' />
                        {isConnected ? 'Connected' : 'Connecting…'}
                    </div>
                </div>

                <div className='scanner2-grid'>
                    {/* Left: configuration */}
                    <div className='scanner2-panel'>
                        <h2 className='scanner2-panel__title'>Configuration</h2>

                        <label className='scanner2-field'>
                            <span>Market</span>
                            <select value={symbol} disabled={isRunning} onChange={e => handleMarketChange(e.target.value)}>
                                {MARKETS.map(market => (
                                    <option key={market.symbol} value={market.symbol}>
                                        {market.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className='scanner2-field'>
                            <span>Strategy</span>
                            <select value={strategyId} disabled={isRunning} onChange={e => handleStrategyChange(e.target.value as TStrategyId)}>
                                {STRATEGIES.map(strat => (
                                    <option key={strat.id} value={strat.id}>
                                        {strat.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <div className='scanner2-field-row'>
                            <label className='scanner2-field'>
                                <span>Stake</span>
                                <input inputMode='decimal' disabled={isRunning} value={stakeInput} onChange={e => setStakeInput(cleanMoney(e.target.value))} />
                            </label>
                            <label className='scanner2-field'>
                                <span>Martingale ×</span>
                                <select value={martingale} disabled={isRunning} onChange={e => setMartingale(Number(e.target.value))}>
                                    {MARTINGALE_STEPS.map(step => (
                                        <option key={step} value={step}>
                                            {step.toFixed(1)}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>

                        <div className='scanner2-field-row'>
                            <label className='scanner2-field'>
                                <span>Stop Loss</span>
                                <input inputMode='decimal' disabled={isRunning} value={stopLossInput} onChange={e => setStopLossInput(cleanMoney(e.target.value))} />
                            </label>
                            <label className='scanner2-field'>
                                <span>Take Profit</span>
                                <input inputMode='decimal' disabled={isRunning} value={takeProfitInput} onChange={e => setTakeProfitInput(cleanMoney(e.target.value))} />
                            </label>
                        </div>

                        <label className='scanner2-field'>
                            <span>Minimum runs before checking profit</span>
                            <input inputMode='numeric' disabled={isRunning} value={runsInput} onChange={e => setRunsInput(cleanInt(e.target.value))} />
                        </label>

                        {!isRunning ? (
                            <button className='scanner2-btn scanner2-btn--start' type='button' onClick={startTrading}>
                                ▶ Start Trading
                            </button>
                        ) : (
                            <button className='scanner2-btn scanner2-btn--stop' type='button' onClick={stopTrading}>
                                ■ Stop
                            </button>
                        )}
                    </div>

                    {/* Middle: live market view */}
                    <div className='scanner2-panel'>
                        <h2 className='scanner2-panel__title'>{selectedMarket.label}</h2>

                        <div className='scanner2-price'>
                            <span className='scanner2-price__value'>{latestTick ? latestTick.quote.toFixed(getMarketPipSize(symbol)) : '—'}</span>
                            <span className='scanner2-price__digit'>{latestDigit ?? '–'}</span>
                        </div>

                        <div className='scanner2-histogram'>
                            {digitStats.map((pct, digit) => (
                                <div key={digit} className='scanner2-histogram__col'>
                                    <div className='scanner2-histogram__bar-track'>
                                        <div className='scanner2-histogram__bar' style={{ height: `${Math.max(pct, 2)}%` }} />
                                    </div>
                                    <span className='scanner2-histogram__pct'>{pct}%</span>
                                    <span className='scanner2-histogram__digit'>{digit}</span>
                                </div>
                            ))}
                        </div>
                        <p className='scanner2-sample'>
                            {digits.length}/{MIN_SAMPLE_FOR_SIGNAL} ticks collected {hasEnoughSamples ? '· ready' : '· warming up'}
                        </p>

                        {preview && (
                            <div className='scanner2-signal'>
                                <p className='scanner2-signal__label'>
                                    Suggested signal: <strong>{preview.signal.label}</strong>
                                    {preview.signal.recoveryLabel && <> · recovery <strong>{preview.signal.recoveryLabel}</strong></>}
                                </p>
                                {preview.lines.map((line, idx) => (
                                    <p key={idx} className='scanner2-signal__line'>
                                        {line}
                                    </p>
                                ))}
                            </div>
                        )}

                        {isRunning && (
                            <div className='scanner2-stats'>
                                <div className='scanner2-stats__item'>
                                    <span>Session P/L</span>
                                    <strong className={sessionPnl >= 0 ? 'scanner2-pnl--pos' : 'scanner2-pnl--neg'}>
                                        {sessionPnl >= 0 ? '+' : ''}
                                        {sessionPnl.toFixed(2)} {currency}
                                    </strong>
                                </div>
                                <div className='scanner2-stats__item'>
                                    <span>Runs</span>
                                    <strong>
                                        {completedRuns}/{runsInput}
                                    </strong>
                                </div>
                                <div className='scanner2-stats__item'>
                                    <span>Current stake</span>
                                    <strong>
                                        {currentStakeDisplay.toFixed(2)} {currency}
                                    </strong>
                                </div>
                                <div className='scanner2-stats__item'>
                                    <span>Losses in a row</span>
                                    <strong>{consecutiveLosses}</strong>
                                </div>
                                {isRecoveryMode && <div className='scanner2-recovery-badge'>Recovery mode active</div>}
                            </div>
                        )}
                    </div>

                    {/* Right: activity log */}
                    <div className='scanner2-panel scanner2-panel--log'>
                        <h2 className='scanner2-panel__title'>Activity Log</h2>
                        <div className='scanner2-log'>
                            {log.length === 0 && <p className='scanner2-log__empty'>No activity yet. Start trading to see live updates here.</p>}
                            {log
                                .slice()
                                .reverse()
                                .map((entry, idx) => (
                                    <div key={`${entry.at}-${idx}`} className={classNames('scanner2-log__row', `scanner2-log__row--${entry.kind}`)}>
                                        <span className='scanner2-log__time'>{new Date(entry.at).toLocaleTimeString()}</span>
                                        <span className='scanner2-log__text'>{entry.text}</span>
                                    </div>
                                ))}
                        </div>
                    </div>
                </div>
            </div>

            {notification && (
                <TpSlNotification
                    currency={currency}
                    isTakeProfit={notification.isTakeProfit}
                    onClose={() => setNotification(null)}
                    runs={notification.runs}
                    totalPnl={notification.totalPnl}
                />
            )}
        </div>
    );
});

export default ProScanner;
