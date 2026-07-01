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

type TContractType = 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITMATCH' | 'DIGITDIFF' | 'CALL' | 'PUT';

type TSignalMode = 'streak' | 'pattern' | 'digit';

type TDigitOp = '==' | '!=' | '>' | '>=' | '<' | '<=';

type TSignal = { barrier?: string; contractType: TContractType; label: string };

type TMarket = { label: string; symbol: string };

type TLogEntry = { at: number; kind: 'info' | 'win' | 'loss' | 'error' | 'signal'; text: string };

type TMarketMode = 'fixed' | 'auto';

type TSlotId = 'm1' | 'm2';

type TSlotConfig = {
    barrier: string;
    contractType: TContractType;
    digitCompare: number;
    digitOp: TDigitOp;
    digitWindow: number;
    marketMode: TMarketMode;
    pattern: string;
    signalMode: TSignalMode;
    streak: number;
    symbol: string;
};

type TScanResult = { confidence: number; lines: string[]; signal: TSignal; symbol: string };

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

/** Manual contract type list — exactly what gets traded. Nothing here is auto-picked. */
const CONTRACT_TYPES: { id: TContractType; isDigit: boolean; label: string; needsBarrier: boolean }[] = [
    { id: 'DIGITEVEN', isDigit: true, label: 'Even', needsBarrier: false },
    { id: 'DIGITODD', isDigit: true, label: 'Odd', needsBarrier: false },
    { id: 'DIGITOVER', isDigit: true, label: 'Over', needsBarrier: true },
    { id: 'DIGITUNDER', isDigit: true, label: 'Under', needsBarrier: true },
    { id: 'DIGITMATCH', isDigit: true, label: 'Matches', needsBarrier: true },
    { id: 'DIGITDIFF', isDigit: true, label: 'Differs', needsBarrier: true },
    { id: 'CALL', isDigit: false, label: 'Rise', needsBarrier: false },
    { id: 'PUT', isDigit: false, label: 'Fall', needsBarrier: false },
];

/** Signal Mode decides WHEN to fire the manually chosen contract — it never changes what gets traded. */
const SIGNAL_MODES: { id: TSignalMode; label: string }[] = [
    { id: 'streak', label: 'Consecutive streak' },
    { id: 'pattern', label: 'Pattern (E/O sequence)' },
    { id: 'digit', label: 'Digit condition' },
];

const DIGIT_OPS: { id: TDigitOp; label: string }[] = [
    { id: '==', label: '= (equals)' },
    { id: '!=', label: '≠ (not equal)' },
    { id: '>', label: '> (greater than)' },
    { id: '>=', label: '≥ (greater or equal)' },
    { id: '<', label: '< (less than)' },
    { id: '<=', label: '≤ (less or equal)' },
];

const MAX_TICKS = 1000;
const SCAN_HISTORY_COUNT = 300;
const SCAN_RETRY_DELAY_MS = 1200;
const DEFAULT_STAKE = '0.5';
const DEFAULT_STOP_LOSS = '20';
const DEFAULT_TAKE_PROFIT = '5';
const DEFAULT_MARTINGALE = 2;
const DEFAULT_RUNS = '5';
const MARTINGALE_STEPS = [1, 1.2, 1.5, 1.8, 2, 2.2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10];
const MAX_LOG_ENTRIES = 120;

const DEFAULT_M1_CONFIG: TSlotConfig = {
    barrier: '1',
    contractType: 'DIGITOVER',
    digitCompare: 5,
    digitOp: '==',
    digitWindow: 3,
    marketMode: 'fixed',
    pattern: 'EOE',
    signalMode: 'streak',
    streak: 4,
    symbol: 'R_10',
};

const DEFAULT_M2_CONFIG: TSlotConfig = {
    barrier: '8',
    contractType: 'DIGITUNDER',
    digitCompare: 5,
    digitOp: '==',
    digitWindow: 3,
    marketMode: 'fixed',
    pattern: 'OEO',
    signalMode: 'streak',
    streak: 4,
    symbol: 'R_25',
};

// ============================================================================
// Pure helpers
// ============================================================================

const cleanMoney = (value: string) => value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
const cleanInt = (value: string) => value.replace(/[^\d]/g, '');
const labelForSymbol = (symbol: string) => MARKETS.find(m => m.symbol === symbol)?.label ?? symbol;
const labelForContract = (contractType: TContractType) => CONTRACT_TYPES.find(c => c.id === contractType)?.label ?? contractType;
const isDirectionContract = (contractType: TContractType) => contractType === 'CALL' || contractType === 'PUT';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const digitsFromTicks = (ticks: TTick[], symbol: string) => ticks.map(tick => getLastDigitFromQuote(tick.quote, symbol));

const digitStatsFrom = (digits: number[]) => {
    const counts = new Array(10).fill(0);
    digits.forEach(digit => {
        if (digit >= 0 && digit <= 9) counts[digit] += 1;
    });
    const total = Math.max(digits.length, 1);
    return counts.map(count => Number(((count / total) * 100).toFixed(1)));
};

const compareDigit = (digit: number, op: TDigitOp, compare: number): boolean => {
    switch (op) {
        case '==':
            return digit === compare;
        case '!=':
            return digit !== compare;
        case '>':
            return digit > compare;
        case '>=':
            return digit >= compare;
        case '<':
            return digit < compare;
        case '<=':
            return digit <= compare;
        default:
            return false;
    }
};

/** Whether a single digit satisfies the manually selected contract's own condition (used by streak mode). */
const digitMatchesContract = (digit: number, contractType: TContractType, barrier: number): boolean => {
    switch (contractType) {
        case 'DIGITEVEN':
            return digit % 2 === 0;
        case 'DIGITODD':
            return digit % 2 === 1;
        case 'DIGITOVER':
            return digit > barrier;
        case 'DIGITUNDER':
            return digit < barrier;
        case 'DIGITMATCH':
            return digit === barrier;
        case 'DIGITDIFF':
            return digit !== barrier;
        default:
            return false;
    }
};

const buildManualSignal = (config: TSlotConfig): TSignal => {
    const meta = CONTRACT_TYPES.find(c => c.id === config.contractType) ?? CONTRACT_TYPES[0];
    if (!meta.needsBarrier) return { contractType: meta.id, label: meta.label };
    return { barrier: config.barrier, contractType: meta.id, label: `${meta.label} ${config.barrier}` };
};

/**
 * Evaluates a slot: the contract to trade is always whatever the user picked manually
 * (config.contractType / config.barrier). The Signal Mode only decides WHEN to fire it.
 * Returns null while there is no trade signal yet.
 */
const evaluateStrategy = (config: TSlotConfig, ticks: TTick[], symbol: string): { confidence: number; lines: string[]; signal: TSignal } | null => {
    const barrierNum = Number(config.barrier) || 0;
    const digits = digitsFromTicks(ticks, symbol);

    if (config.signalMode === 'pattern') {
        if (isDirectionContract(config.contractType)) return null; // pattern only applies to digit contracts
        const clean = config.pattern.toUpperCase().replace(/[^EO]/g, '');
        if (clean.length < 2 || digits.length < clean.length) return null;
        const recent = digits.slice(-clean.length);
        const matched = recent.every((digit, index) => (digit % 2 === 0 ? 'E' : 'O') === clean[index]);
        if (!matched) return null;
        return {
            confidence: 1,
            lines: [`Pattern ${clean} matched on the last ${clean.length} digits.`],
            signal: buildManualSignal(config),
        };
    }

    if (config.signalMode === 'digit') {
        if (isDirectionContract(config.contractType)) return null; // digit condition only applies to digit contracts
        const window = Math.max(1, config.digitWindow);
        if (digits.length < window) return null;
        const recent = digits.slice(-window);
        const matchCount = recent.filter(digit => compareDigit(digit, config.digitOp, config.digitCompare)).length;
        if (matchCount !== window) return null;
        return {
            confidence: 1,
            lines: [`Last ${window} digits all satisfy "digit ${config.digitOp} ${config.digitCompare}".`],
            signal: buildManualSignal(config),
        };
    }

    // signalMode === 'streak' — fires once N consecutive ticks already satisfy the chosen contract
    const streak = Math.max(1, config.streak);

    if (isDirectionContract(config.contractType)) {
        let count = 0;
        for (let i = ticks.length - 1; i > 0; i -= 1) {
            const matches = config.contractType === 'CALL' ? ticks[i].quote > ticks[i - 1].quote : ticks[i].quote < ticks[i - 1].quote;
            if (!matches) break;
            count += 1;
        }
        if (count < streak) return null;
        return {
            confidence: count - streak + 1,
            lines: [`${count} consecutive ${config.contractType === 'CALL' ? 'rises' : 'falls'} detected (needed ${streak}).`],
            signal: buildManualSignal(config),
        };
    }

    let count = 0;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
        if (!digitMatchesContract(digits[i], config.contractType, barrierNum)) break;
        count += 1;
    }
    if (count < streak) return null;
    return {
        confidence: count - streak + 1,
        lines: [`${count} consecutive digits match "${labelForContract(config.contractType)}" (needed ${streak}).`],
        signal: buildManualSignal(config),
    };
};

const getTickFromWsPayload = (data: any): TTick | null => {
    const quote = Number(data?.tick?.quote);
    if (!Number.isFinite(quote)) return null;
    return { epoch: Number(data?.tick?.epoch) || Math.floor(Date.now() / 1000), quote };
};

/** One-shot tick history fetch, used by the all-markets scanner (and by the fixed-market evaluator). */
const fetchHistorySnapshot = async (symbol: string): Promise<TTick[]> => {
    const history = await api_base.api.send({
        adjust_start_time: 1,
        count: SCAN_HISTORY_COUNT,
        end: 'latest',
        start: 1,
        style: 'ticks',
        ticks_history: symbol,
    });
    const prices: Array<number | string> = Array.isArray(history?.history?.prices) ? history.history.prices : [];
    const times: Array<number | string> = Array.isArray(history?.history?.times) ? history.history.times : [];
    return prices
        .map((price, index) => ({ epoch: Number(times[index]) || Math.floor(Date.now() / 1000), quote: Number(price) }))
        .filter((tick): tick is TTick => Number.isFinite(tick.quote));
};

/** Scans either the slot's fixed market, or every market when marketMode is 'auto', and returns the strongest signal. */
const evaluateSlot = async (config: TSlotConfig): Promise<TScanResult | null> => {
    const symbols = config.marketMode === 'auto' ? MARKETS.map(m => m.symbol) : [config.symbol];
    const results = await Promise.all(
        symbols.map(async symbol => {
            try {
                const ticks = await fetchHistorySnapshot(symbol);
                const evaluated = evaluateStrategy(config, ticks, symbol);
                return evaluated ? { symbol, ...evaluated } : null;
            } catch {
                return null;
            }
        })
    );
    const valid = results.filter((r): r is TScanResult => !!r);
    if (!valid.length) return null;
    valid.sort((a, b) => b.confidence - a.confidence);
    return valid[0];
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
// Slot configuration panel (shared markup for M1 and M2)
// ============================================================================

const SlotFields: React.FC<{
    config: TSlotConfig;
    disabled: boolean;
    onChange: (patch: Partial<TSlotConfig>) => void;
}> = ({ config, disabled, onChange }) => {
    const contractMeta = CONTRACT_TYPES.find(c => c.id === config.contractType) ?? CONTRACT_TYPES[0];
    const availableSignalModes = SIGNAL_MODES.filter(mode => (mode.id === 'pattern' || mode.id === 'digit' ? contractMeta.isDigit : true));

    return (
        <>
            <label className='scanner2-field'>
                <span>Market mode</span>
                <select value={config.marketMode} disabled={disabled} onChange={e => onChange({ marketMode: e.target.value as TMarketMode })}>
                    <option value='fixed'>Fixed market</option>
                    <option value='auto'>Auto — scan all markets</option>
                </select>
            </label>

            {config.marketMode === 'fixed' && (
                <label className='scanner2-field'>
                    <span>Market</span>
                    <select value={config.symbol} disabled={disabled} onChange={e => onChange({ symbol: e.target.value })}>
                        {MARKETS.map(market => (
                            <option key={market.symbol} value={market.symbol}>
                                {market.label}
                            </option>
                        ))}
                    </select>
                </label>
            )}

            <div className='scanner2-field-row'>
                <label className='scanner2-field'>
                    <span>Contract Type</span>
                    <select
                        value={config.contractType}
                        disabled={disabled}
                        onChange={e => {
                            const nextType = e.target.value as TContractType;
                            const nextMeta = CONTRACT_TYPES.find(c => c.id === nextType);
                            const patch: Partial<TSlotConfig> = { contractType: nextType };
                            if (!nextMeta?.isDigit && (config.signalMode === 'pattern' || config.signalMode === 'digit')) {
                                patch.signalMode = 'streak';
                            }
                            onChange(patch);
                        }}
                    >
                        {CONTRACT_TYPES.map(c => (
                            <option key={c.id} value={c.id}>
                                {c.label}
                            </option>
                        ))}
                    </select>
                </label>
                {contractMeta.needsBarrier && (
                    <label className='scanner2-field'>
                        <span>Barrier</span>
                        <select value={config.barrier} disabled={disabled} onChange={e => onChange({ barrier: e.target.value })}>
                            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
                                <option key={d} value={String(d)}>
                                    {d}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
            </div>

            <label className='scanner2-field'>
                <span>Signal mode (when to trade it)</span>
                <select value={config.signalMode} disabled={disabled} onChange={e => onChange({ signalMode: e.target.value as TSignalMode })}>
                    {availableSignalModes.map(mode => (
                        <option key={mode.id} value={mode.id}>
                            {mode.label}
                        </option>
                    ))}
                </select>
            </label>

            {config.signalMode === 'streak' && (
                <label className='scanner2-field'>
                    <span>Consecutive ticks required</span>
                    <input
                        inputMode='numeric'
                        disabled={disabled}
                        value={String(config.streak)}
                        onChange={e => onChange({ streak: Math.max(1, Number(cleanInt(e.target.value)) || 1) })}
                    />
                </label>
            )}

            {config.signalMode === 'pattern' && (
                <label className='scanner2-field'>
                    <span>Pattern (E = even digit, O = odd digit)</span>
                    <input
                        value={config.pattern}
                        disabled={disabled}
                        maxLength={8}
                        placeholder='e.g. EOE'
                        onChange={e => onChange({ pattern: e.target.value.toUpperCase().replace(/[^EO]/g, '') })}
                    />
                </label>
            )}

            {config.signalMode === 'digit' && (
                <>
                    <div className='scanner2-field-row'>
                        <label className='scanner2-field'>
                            <span>Condition</span>
                            <select value={config.digitOp} disabled={disabled} onChange={e => onChange({ digitOp: e.target.value as TDigitOp })}>
                                {DIGIT_OPS.map(op => (
                                    <option key={op.id} value={op.id}>
                                        {op.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className='scanner2-field'>
                            <span>Compare digit</span>
                            <select value={config.digitCompare} disabled={disabled} onChange={e => onChange({ digitCompare: Number(e.target.value) })}>
                                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
                                    <option key={d} value={d}>
                                        {d}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                    <label className='scanner2-field'>
                        <span>Confirm over last N ticks</span>
                        <input
                            inputMode='numeric'
                            disabled={disabled}
                            value={String(config.digitWindow)}
                            onChange={e => onChange({ digitWindow: Math.max(1, Number(cleanInt(e.target.value)) || 1) })}
                        />
                    </label>
                </>
            )}
        </>
    );
};

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
    const [m1, setM1State] = useState<TSlotConfig>(DEFAULT_M1_CONFIG);
    const [m2, setM2State] = useState<TSlotConfig>(DEFAULT_M2_CONFIG);
    const [m2Enabled, setM2Enabled] = useState(true);
    const [stakeInput, setStakeInput] = useState(DEFAULT_STAKE);
    const [stopLossInput, setStopLossInput] = useState(DEFAULT_STOP_LOSS);
    const [takeProfitInput, setTakeProfitInput] = useState(DEFAULT_TAKE_PROFIT);
    const [martingale, setMartingale] = useState(DEFAULT_MARTINGALE);
    const [runsInput, setRunsInput] = useState(DEFAULT_RUNS);

    const setM1 = useCallback((patch: Partial<TSlotConfig>) => setM1State(prev => ({ ...prev, ...patch })), []);
    const setM2 = useCallback((patch: Partial<TSlotConfig>) => setM2State(prev => ({ ...prev, ...patch })), []);

    // Live data (preview panel only — the trading loop performs its own history scans)
    const [ticks, setTicks] = useState<TTick[]>([]);
    const [isConnected, setIsConnected] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [log, setLog] = useState<TLogEntry[]>([]);
    const [sessionPnl, setSessionPnl] = useState(0);
    const [completedRuns, setCompletedRuns] = useState(0);
    const [consecutiveLosses, setConsecutiveLosses] = useState(0);
    const [currentStakeDisplay, setCurrentStakeDisplay] = useState(0);
    const [isRecoveryMode, setIsRecoveryMode] = useState(false);
    const [activeSlotDisplay, setActiveSlotDisplay] = useState<TSlotId>('m1');
    const [focusSymbol, setFocusSymbol] = useState<string | null>(null);
    const [notification, setNotification] = useState<{ isTakeProfit: boolean; runs: number; totalPnl: number } | null>(null);

    // Refs mirroring the state used by the async trading loop
    const ticksRef = useRef<TTick[]>([]);
    const shouldStopRef = useRef(true);
    const tradeInFlightRef = useRef(false);
    const subscriptionRef = useRef<{ unsubscribe?: () => void } | null>(null);
    const requestVersionRef = useRef(0);

    const m1ConfigRef = useRef<TSlotConfig>(DEFAULT_M1_CONFIG);
    const m2ConfigRef = useRef<TSlotConfig>(DEFAULT_M2_CONFIG);
    const m2EnabledRef = useRef(true);
    const activeSlotRef = useRef<TSlotId>('m1');
    const baseStakeRef = useRef(0);
    const currentStakeRef = useRef(0);
    const martingaleRef = useRef(DEFAULT_MARTINGALE);
    const consecutiveLossesRef = useRef(0);
    const recoveryLossesRef = useRef(0);
    const stopLossRef = useRef(0);
    const takeProfitRef = useRef(0);
    const runsToCheckRef = useRef(5);
    const completedRunsRef = useRef(0);
    const sessionPnlRef = useRef(0);

    // The market shown in the middle "live view" panel: the slot's fixed market while idle,
    // or whichever market the trading loop most recently picked while running.
    const displaySymbol = isRunning ? focusSymbol ?? (m1.marketMode === 'fixed' ? m1.symbol : MARKETS[0].symbol) : m1.marketMode === 'fixed' ? m1.symbol : MARKETS[0].symbol;

    const digits = useMemo(() => digitsFromTicks(ticks, displaySymbol), [ticks, displaySymbol]);
    const digitStats = useMemo(() => digitStatsFrom(digits), [digits]);
    const latestTick = ticks[ticks.length - 1];
    const latestDigit = latestTick ? getLastDigitFromQuote(latestTick.quote, displaySymbol) : null;
    const preview = useMemo(
        () => (!isRunning && m1.marketMode === 'fixed' && ticks.length > 0 ? evaluateStrategy(m1, ticks, displaySymbol) : null),
        [displaySymbol, isRunning, m1, ticks]
    );
    const isCoveredByMobileRunPanel = !isDesktop && run_panel.is_drawer_open;

    const pushLog = useCallback((kind: TLogEntry['kind'], text: string) => {
        setLog(previous => [...previous.slice(-(MAX_LOG_ENTRIES - 1)), { at: Date.now(), kind, text }]);
    }, []);

    // --- Preview ticks stream (idle / display only) --------------------------

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
                ticks_history: displaySymbol,
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

            const observable = (api_base.api as any).subscribe({ ticks: displaySymbol });
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
    }, [applyLiveTick, displaySymbol, pushLog, showScanner, unsubscribe]);

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
        setIsRunning(false);
        setIsScanning(false);
        consecutiveLossesRef.current = 0;
        recoveryLossesRef.current = 0;
        currentStakeRef.current = baseStakeRef.current;
        activeSlotRef.current = 'm1';
        setConsecutiveLosses(0);
        setIsRecoveryMode(false);
        setActiveSlotDisplay('m1');
        setFocusSymbol(null);

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
        async (signal: TSignal, symbol: string, stake: number): Promise<number> => {
            const parameters: Record<string, number | string> = {
                amount: stake,
                basis: 'stake',
                contract_type: signal.contractType,
                currency,
                duration: 1,
                duration_unit: 't',
                symbol,
            };
            if (signal.barrier) parameters.barrier = signal.barrier;

            pushLog('signal', `Buying ${signal.label} on ${labelForSymbol(symbol)} · stake ${stake.toFixed(2)} ${currency}`);
            const buy = await buyContractForUi({ parameters, price: stake, source: 'Scanner' });
            const buySnapshot = {
                buy_price: buy.buy_price,
                contract_id: buy.contract_id,
                contract_type: signal.contractType,
                currency,
                date_start: Math.floor(Date.now() / 1000),
                display_name: labelForSymbol(symbol),
                shortcode: `SCANNER_${signal.contractType}_${symbol}`,
                transaction_ids: { buy: buy.transaction_id },
                underlying_symbol: symbol,
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
        [currency, pushContract, pushLog]
    );

    // --- M1/M2 recovery trading loop ------------------------------------------
    //
    // Flow: trade on M1. A win keeps trading M1 at base stake. A loss switches to
    // M2 (if enabled) with a martingale stake — M1 stays blocked until M2 wins,
    // at which point the cycle resets back to M1. If M2 is disabled, losses simply
    // martingale on M1 itself. Each slot can independently be a fixed market or
    // set to "auto", which scans every market and trades the strongest signal.
    // In every case the contract that gets traded is exactly what was picked
    // manually in the Contract Type field — Signal Mode only decides the timing.

    const runLoop = useCallback(async () => {
        while (!shouldStopRef.current) {
            if (sessionPnlRef.current <= -stopLossRef.current) {
                setNotification({ isTakeProfit: false, runs: completedRunsRef.current, totalPnl: sessionPnlRef.current });
                break;
            }
            if (sessionPnlRef.current >= takeProfitRef.current) {
                setNotification({ isTakeProfit: true, runs: completedRunsRef.current, totalPnl: sessionPnlRef.current });
                break;
            }
            if (completedRunsRef.current >= runsToCheckRef.current && sessionPnlRef.current > 0.1) {
                setNotification({ isTakeProfit: true, runs: completedRunsRef.current, totalPnl: sessionPnlRef.current });
                break;
            }

            const slot = activeSlotRef.current;
            const config = slot === 'm1' ? m1ConfigRef.current : m2ConfigRef.current;

            setIsScanning(true);
            pushLog(
                'info',
                `${slot.toUpperCase()}: scanning ${config.marketMode === 'auto' ? 'all markets' : labelForSymbol(config.symbol)} for ${labelForContract(config.contractType)} via ${
                    SIGNAL_MODES.find(m => m.id === config.signalMode)?.label
                }…`
            );

            let found: TScanResult | null = null;
            try {
                found = await evaluateSlot(config);
            } catch (error) {
                pushLog('error', error instanceof Error ? error.message : 'Market scan failed.');
            }

            if (shouldStopRef.current) break;
            setIsScanning(false);

            if (!found) {
                await sleep(SCAN_RETRY_DELAY_MS);
                continue;
            }

            setFocusSymbol(found.symbol);
            pushLog('signal', `${slot.toUpperCase()} · ${labelForSymbol(found.symbol)}: ${found.signal.label}${config.marketMode === 'auto' ? ' (auto-picked)' : ''}`);

            const stake = currentStakeRef.current;
            setCurrentStakeDisplay(stake);
            tradeInFlightRef.current = true;

            try {
                const profit = await runSingleTrade(found.signal, found.symbol, stake);
                if (shouldStopRef.current) break;
                const isWin = profit > 0;

                if (isWin) {
                    pushLog('win', `Win! +${profit.toFixed(2)} ${currency}.`);
                    currentStakeRef.current = baseStakeRef.current;
                    consecutiveLossesRef.current = 0;
                    if (slot === 'm2') {
                        pushLog('info', '✅ Recovery complete — back to M1.');
                        activeSlotRef.current = 'm1';
                        recoveryLossesRef.current = 0;
                    }
                } else if (slot === 'm1') {
                    if (m2EnabledRef.current) {
                        activeSlotRef.current = 'm2';
                        recoveryLossesRef.current = 1;
                        currentStakeRef.current = baseStakeRef.current * martingaleRef.current;
                        pushLog('loss', `Loss on M1 (${profit.toFixed(2)} ${currency}) — switching to M2 recovery. Next stake ${currentStakeRef.current.toFixed(2)} ${currency}.`);
                    } else {
                        consecutiveLossesRef.current += 1;
                        currentStakeRef.current = baseStakeRef.current * Math.pow(martingaleRef.current, consecutiveLossesRef.current);
                        pushLog('loss', `Loss (${profit.toFixed(2)} ${currency}). Next stake ${currentStakeRef.current.toFixed(2)} ${currency}.`);
                    }
                } else {
                    recoveryLossesRef.current += 1;
                    currentStakeRef.current = baseStakeRef.current * Math.pow(martingaleRef.current, recoveryLossesRef.current);
                    pushLog(
                        'loss',
                        `Loss on M2 (${profit.toFixed(2)} ${currency}) — continuing recovery (attempt ${recoveryLossesRef.current}). Next stake ${currentStakeRef.current.toFixed(2)} ${currency}.`
                    );
                }

                setActiveSlotDisplay(activeSlotRef.current);
                setIsRecoveryMode(activeSlotRef.current === 'm2');
                setConsecutiveLosses(consecutiveLossesRef.current);

                const total = Number((sessionPnlRef.current + profit).toFixed(8));
                sessionPnlRef.current = total;
                completedRunsRef.current += 1;
                setSessionPnl(total);
                setCompletedRuns(completedRunsRef.current);
            } catch (error) {
                pushLog('error', `${error instanceof Error ? error.message : 'Trade failed.'} Retrying…`);
                tradeInFlightRef.current = false;
                await sleep(SCAN_RETRY_DELAY_MS);
                continue;
            } finally {
                tradeInFlightRef.current = false;
            }
        }
        stopTrading();
    }, [currency, pushLog, runSingleTrade, stopTrading]);

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
        if (m1.signalMode === 'pattern' && m1.pattern.replace(/[^EO]/g, '').length < 2) {
            pushLog('error', 'M1 pattern needs at least 2 E/O characters.');
            return;
        }
        if (m2Enabled && m2.signalMode === 'pattern' && m2.pattern.replace(/[^EO]/g, '').length < 2) {
            pushLog('error', 'M2 pattern needs at least 2 E/O characters.');
            return;
        }

        m1ConfigRef.current = { ...m1 };
        m2ConfigRef.current = { ...m2 };
        m2EnabledRef.current = m2Enabled;

        baseStakeRef.current = stake;
        currentStakeRef.current = stake;
        stopLossRef.current = stopLoss;
        takeProfitRef.current = takeProfit;
        runsToCheckRef.current = runs;
        consecutiveLossesRef.current = 0;
        recoveryLossesRef.current = 0;
        activeSlotRef.current = 'm1';
        completedRunsRef.current = 0;
        sessionPnlRef.current = 0;
        shouldStopRef.current = false;
        tradeInFlightRef.current = false;
        martingaleRef.current = martingale;

        setSessionPnl(0);
        setCompletedRuns(0);
        setConsecutiveLosses(0);
        setIsRecoveryMode(false);
        setActiveSlotDisplay('m1');
        setFocusSymbol(null);
        setCurrentStakeDisplay(stake);
        setIsRunning(true);
        setLog([]);
        pushLog(
            'info',
            `Started. M1: ${m1.marketMode === 'auto' ? 'auto-scan all markets' : labelForSymbol(m1.symbol)} · ${labelForContract(m1.contractType)} via ${
                SIGNAL_MODES.find(s => s.id === m1.signalMode)?.label
            }.`
        );
        if (m2Enabled) {
            pushLog(
                'info',
                `M2 recovery: ${m2.marketMode === 'auto' ? 'auto-scan all markets' : labelForSymbol(m2.symbol)} · ${labelForContract(m2.contractType)} via ${
                    SIGNAL_MODES.find(s => s.id === m2.signalMode)?.label
                }.`
            );
        } else {
            pushLog('info', 'M2 recovery disabled — losses will martingale on M1.');
        }
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
        void runLoop();
    }, [dashboard, m1, m2, m2Enabled, martingale, pushLog, runLoop, runsInput, run_panel, stakeInput, stopLossInput, takeProfitInput]);

    if (!showScanner) return null;

    return (
        <div className={classNames('scanner2-page', { 'scanner2-page--run-panel-open': isCoveredByMobileRunPanel })}>
            <div className='scanner2-scroll'>
                <div className='scanner2-header'>
                    <div>
                        <h1 className='scanner2-header__title'>Pro Scanner Bot</h1>
                        <p className='scanner2-header__subtitle'>Pick your contract manually, choose when it fires, let M1/M2 handle recovery</p>
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

                        <div className='scanner2-slot'>
                            <div className='scanner2-slot__header'>
                                <span>Market 1 · Primary</span>
                            </div>
                            <SlotFields config={m1} disabled={isRunning} onChange={setM1} />
                        </div>

                        <div className='scanner2-slot'>
                            <div className='scanner2-slot__header'>
                                <span>Market 2 · Recovery</span>
                                <button
                                    type='button'
                                    className={classNames('scanner2-toggle', { 'scanner2-toggle--on': m2Enabled })}
                                    disabled={isRunning}
                                    onClick={() => setM2Enabled(prev => !prev)}
                                >
                                    {m2Enabled ? 'ON' : 'OFF'}
                                </button>
                            </div>
                            {m2Enabled ? (
                                <SlotFields config={m2} disabled={isRunning} onChange={setM2} />
                            ) : (
                                <p className='scanner2-sample'>M2 is off — a loss on M1 will martingale on M1 itself instead of switching markets.</p>
                            )}
                        </div>

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
                        <div className='scanner2-panel__title-row'>
                            <h2 className='scanner2-panel__title'>{labelForSymbol(displaySymbol)}</h2>
                            {isRunning && (
                                <span className={classNames('scanner2-slot-badge', { 'scanner2-slot-badge--m2': activeSlotDisplay === 'm2' })}>
                                    {activeSlotDisplay === 'm2' ? 'M2 recovery' : 'M1 primary'}
                                </span>
                            )}
                        </div>

                        <div className='scanner2-price'>
                            <span className='scanner2-price__value'>{latestTick ? latestTick.quote.toFixed(getMarketPipSize(displaySymbol)) : '—'}</span>
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

                        {isRunning ? (
                            <p className='scanner2-sample'>{isScanning ? 'Scanning for a signal…' : `Trading on ${labelForSymbol(displaySymbol)}`}</p>
                        ) : (
                            <p className='scanner2-sample'>
                                {digits.length} ticks collected {preview ? '· signal ready' : '· waiting for condition'}
                                {m1.marketMode === 'auto' && ' · M1 is set to auto-scan all markets, so no single-market preview is shown until you start'}
                            </p>
                        )}

                        {preview && (
                            <div className='scanner2-signal'>
                                <p className='scanner2-signal__label'>
                                    M1 preview signal: <strong>{preview.signal.label}</strong>
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
                                {isRecoveryMode && <div className='scanner2-recovery-badge'>Recovery mode active — trading M2</div>}
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
