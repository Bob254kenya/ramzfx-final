import { useCallback, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import {
    fetchCopyTradingStatistics,
    setAllowCopiers,
    startCopyTrading,
    stopCopyTrading,
    TCopyTradingStats,
} from '@/utils/copy-trading';
import { Localize } from '@deriv-com/translations';
import './copy-trading.scss';

type TActiveCopy = {
    id: string;
    label: string;
    max_trade_stake: string;
    min_trade_stake: string;
    started_at: number;
    token: string;
};

const STORAGE_KEY = 'copy_trading_active_relationships';
const TRADE_TYPE_OPTIONS = ['CALL', 'PUT', 'ACCU', 'MULTUP', 'MULTDOWN', 'DIGITMATCH', 'DIGITDIFF'];

const maskToken = (token: string) => {
    if (token.length <= 8) return `${token.slice(0, 2)}••••`;
    return `${token.slice(0, 4)}••••${token.slice(-4)}`;
};

const loadStoredRelationships = (): TActiveCopy[] => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const persistRelationships = (relationships: TActiveCopy[]) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(relationships));
    } catch {
        // Storage may be unavailable (private browsing); non-fatal.
    }
};

const CopyTrading = observer(() => {
    const { client, dashboard } = useStore();
    const { active_tab } = dashboard;
    const showCopyTrading = active_tab === DBOT_TABS.COPY_TRADING;

    // ==================== Become-a-master section ====================
    const [allowCopiersEnabled, setAllowCopiersEnabled] = useState(false);
    const [isSavingAllowCopiers, setIsSavingAllowCopiers] = useState(false);
    const [myApiToken, setMyApiToken] = useState('');

    // ==================== Follow-a-trader section ====================
    const [masterTokenInput, setMasterTokenInput] = useState('');
    const [maxTradeStakeInput, setMaxTradeStakeInput] = useState('');
    const [minTradeStakeInput, setMinTradeStakeInput] = useState('');
    const [selectedTradeTypes, setSelectedTradeTypes] = useState<string[]>([]);
    const [labelInput, setLabelInput] = useState('');

    const [stats, setStats] = useState<TCopyTradingStats | null>(null);
    const [isLoadingStats, setIsLoadingStats] = useState(false);

    const [activeRelationships, setActiveRelationships] = useState<TActiveCopy[]>([]);
    const [isStarting, setIsStarting] = useState(false);
    const [stoppingId, setStoppingId] = useState<string | null>(null);

    const [statusMessage, setStatusMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    useEffect(() => {
        setActiveRelationships(loadStoredRelationships());
    }, []);

    const currency = client?.currency || 'USD';
    const isLoggedIn = Boolean(client?.is_logged_in);

    // ==================== Handlers ====================

    const handleToggleAllowCopiers = useCallback(async () => {
        setErrorMessage('');
        setIsSavingAllowCopiers(true);
        try {
            const next = !allowCopiersEnabled;
            await setAllowCopiers(next);
            setAllowCopiersEnabled(next);
            setStatusMessage(
                next
                    ? 'Copying enabled — share your read-only API token below with people who want to copy you.'
                    : 'Copying disabled. Existing copiers will stop receiving your trades.'
            );
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Could not update copy trading permission.');
        } finally {
            setIsSavingAllowCopiers(false);
        }
    }, [allowCopiersEnabled]);

    const handleCheckStats = useCallback(async () => {
        if (!masterTokenInput.trim()) {
            setErrorMessage('Enter the trader\u2019s API token first.');
            return;
        }
        setErrorMessage('');
        setIsLoadingStats(true);
        setStats(null);
        try {
            const result = await fetchCopyTradingStatistics(masterTokenInput.trim());
            setStats(result);
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Could not fetch trader statistics.');
        } finally {
            setIsLoadingStats(false);
        }
    }, [masterTokenInput]);

    const handleStartCopying = useCallback(async () => {
        const token = masterTokenInput.trim();
        if (!token) {
            setErrorMessage('Enter the trader\u2019s API token first.');
            return;
        }
        if (activeRelationships.some(item => item.token === token)) {
            setErrorMessage('You are already copying this trader.');
            return;
        }

        setErrorMessage('');
        setIsStarting(true);
        try {
            await startCopyTrading(token, {
                max_trade_stake: maxTradeStakeInput ? Number(maxTradeStakeInput) : undefined,
                min_trade_stake: minTradeStakeInput ? Number(minTradeStakeInput) : undefined,
                trade_types: selectedTradeTypes.length ? selectedTradeTypes : undefined,
            });

            const relationship: TActiveCopy = {
                id: `${Date.now()}`,
                label: labelInput.trim() || `Trader ${maskToken(token)}`,
                max_trade_stake: maxTradeStakeInput,
                min_trade_stake: minTradeStakeInput,
                started_at: Date.now(),
                token,
            };
            const updated = [relationship, ...activeRelationships];
            setActiveRelationships(updated);
            persistRelationships(updated);

            setStatusMessage(`\u2705 Now copying ${relationship.label}.`);
            setMasterTokenInput('');
            setLabelInput('');
            setMaxTradeStakeInput('');
            setMinTradeStakeInput('');
            setSelectedTradeTypes([]);
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Could not start copy trading.');
        } finally {
            setIsStarting(false);
        }
    }, [activeRelationships, labelInput, masterTokenInput, maxTradeStakeInput, minTradeStakeInput, selectedTradeTypes]);

    const handleStopCopying = useCallback(
        async (relationship: TActiveCopy) => {
            setErrorMessage('');
            setStoppingId(relationship.id);
            try {
                await stopCopyTrading(relationship.token);
                const updated = activeRelationships.filter(item => item.id !== relationship.id);
                setActiveRelationships(updated);
                persistRelationships(updated);
                setStatusMessage(`Stopped copying ${relationship.label}.`);
            } catch (error) {
                setErrorMessage(error instanceof Error ? error.message : 'Could not stop copy trading.');
            } finally {
                setStoppingId(null);
            }
        },
        [activeRelationships]
    );

    const toggleTradeType = (type: string) => {
        setSelectedTradeTypes(prev => (prev.includes(type) ? prev.filter(item => item !== type) : [...prev, type]));
    };

    if (!showCopyTrading) return null;

    return (
        <div className='copy-trading-page'>
            <div className='copy-trading-layout'>
                {/* ==================== Follow a trader ==================== */}
                <div className='copy-card'>
                    <h3 className='copy-card__title'>
                        <Localize i18n_default_text='Copy a Trader' />
                    </h3>
                    <p className='copy-card__subtitle'>
                        <Localize i18n_default_text='Paste the read-only API token shared by the trader you want to copy. Their real-money trades will be mirrored into your currently logged-in account.' />
                    </p>

                    {!isLoggedIn && (
                        <p className='copy-warning'>
                            <Localize i18n_default_text='Log in to your Deriv account first — copy trading applies to your currently authorized account.' />
                        </p>
                    )}

                    <label className='copy-field'>
                        <span>
                            <Localize i18n_default_text="Trader's API Token" />
                        </span>
                        <input
                            type='text'
                            placeholder='e.g. a1b2c3d4e5f6g7h8'
                            value={masterTokenInput}
                            onChange={event => setMasterTokenInput(event.target.value)}
                        />
                    </label>

                    <label className='copy-field'>
                        <span>
                            <Localize i18n_default_text='Label (optional, for your reference)' />
                        </span>
                        <input
                            type='text'
                            placeholder='e.g. John — Volatility scalper'
                            value={labelInput}
                            onChange={event => setLabelInput(event.target.value)}
                        />
                    </label>

                    <div className='copy-card__row'>
                        <label className='copy-field'>
                            <span>
                                <Localize i18n_default_text='Min Trade Stake (optional)' />
                            </span>
                            <input
                                inputMode='decimal'
                                placeholder='0.00'
                                value={minTradeStakeInput}
                                onChange={event => setMinTradeStakeInput(event.target.value.replace(/[^\d.]/g, ''))}
                            />
                        </label>
                        <label className='copy-field'>
                            <span>
                                <Localize i18n_default_text='Max Trade Stake (optional)' />
                            </span>
                            <input
                                inputMode='decimal'
                                placeholder='0.00'
                                value={maxTradeStakeInput}
                                onChange={event => setMaxTradeStakeInput(event.target.value.replace(/[^\d.]/g, ''))}
                            />
                        </label>
                    </div>

                    <div className='copy-field'>
                        <span>
                            <Localize i18n_default_text='Only copy these trade types (optional \u2014 leave blank to copy all)' />
                        </span>
                        <div className='copy-chip-select'>
                            {TRADE_TYPE_OPTIONS.map(type => (
                                <button
                                    key={type}
                                    type='button'
                                    className={`copy-chip ${selectedTradeTypes.includes(type) ? 'copy-chip--selected' : ''}`}
                                    onClick={() => toggleTradeType(type)}
                                >
                                    {type}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className='copy-card__actions'>
                        <button
                            type='button'
                            className='copy-button copy-button--secondary'
                            disabled={isLoadingStats}
                            onClick={handleCheckStats}
                        >
                            <Localize i18n_default_text={isLoadingStats ? 'Checking...' : 'Check Trader Stats'} />
                        </button>
                        <button
                            type='button'
                            className='copy-button copy-button--primary'
                            disabled={isStarting || !isLoggedIn}
                            onClick={handleStartCopying}
                        >
                            <Localize i18n_default_text={isStarting ? 'Starting...' : 'Start Copying'} />
                        </button>
                    </div>

                    {stats && (
                        <div className='copy-stats'>
                            <div className='copy-stats__grid'>
                                <div>
                                    <span className='copy-stats__label'>
                                        <Localize i18n_default_text='Copiers' />
                                    </span>
                                    <span className='copy-stats__value'>{stats.copiers ?? '\u2014'}</span>
                                </div>
                                <div>
                                    <span className='copy-stats__label'>
                                        <Localize i18n_default_text='Total Trades' />
                                    </span>
                                    <span className='copy-stats__value'>{stats.total_trades ?? '\u2014'}</span>
                                </div>
                                <div>
                                    <span className='copy-stats__label'>
                                        <Localize i18n_default_text='Profitable %' />
                                    </span>
                                    <span className='copy-stats__value'>
                                        {stats.profitable_trades_percentage != null
                                            ? `${stats.profitable_trades_percentage.toFixed(1)}%`
                                            : '\u2014'}
                                    </span>
                                </div>
                                <div>
                                    <span className='copy-stats__label'>
                                        <Localize i18n_default_text='Avg Profit' />
                                    </span>
                                    <span className='copy-stats__value'>
                                        {stats.avg_profit != null ? stats.avg_profit.toFixed(2) : '\u2014'}
                                    </span>
                                </div>
                                <div>
                                    <span className='copy-stats__label'>
                                        <Localize i18n_default_text='Avg Loss' />
                                    </span>
                                    <span className='copy-stats__value'>
                                        {stats.avg_loss != null ? stats.avg_loss.toFixed(2) : '\u2014'}
                                    </span>
                                </div>
                                <div>
                                    <span className='copy-stats__label'>
                                        <Localize i18n_default_text='Avg Stake' />
                                    </span>
                                    <span className='copy-stats__value'>
                                        {stats.avg_stake != null ? stats.avg_stake.toFixed(2) : '\u2014'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* ==================== Become a master ==================== */}
                <div className='copy-card'>
                    <h3 className='copy-card__title'>
                        <Localize i18n_default_text='Let Others Copy You' />
                    </h3>
                    <p className='copy-card__subtitle'>
                        <Localize i18n_default_text='Enable this on your real-money account, then generate a read-only API token in your Deriv account settings and share it with people who want to copy your trades. Real money account only \u2014 not available on demo.' />
                    </p>

                    <label className='copy-toggle-row'>
                        <span>
                            <Localize i18n_default_text='Allow Copiers' />
                        </span>
                        <span className={`copy-switch ${allowCopiersEnabled ? 'copy-switch--on' : ''}`}>
                            <input
                                type='checkbox'
                                checked={allowCopiersEnabled}
                                disabled={isSavingAllowCopiers || !isLoggedIn}
                                onChange={handleToggleAllowCopiers}
                            />
                            <span className='copy-switch__knob' />
                        </span>
                    </label>

                    <label className='copy-field'>
                        <span>
                            <Localize i18n_default_text='Your Read-Only API Token (generate this in Deriv account settings \u2192 API Token, with only the "Read" scope checked)' />
                        </span>
                        <input
                            type='text'
                            placeholder='Paste your read-only token here to keep it handy for sharing'
                            value={myApiToken}
                            onChange={event => setMyApiToken(event.target.value)}
                        />
                    </label>
                    <p className='copy-hint'>
                        <Localize i18n_default_text='This token is only stored in your browser for your own reference \u2014 it is never sent anywhere by this page except when you personally copy it to share.' />
                    </p>
                </div>
            </div>

            {/* ==================== Active copy relationships ==================== */}
            <div className='copy-card copy-card--full'>
                <h3 className='copy-card__title'>
                    <Localize i18n_default_text='Traders You Are Copying' />
                </h3>
                {activeRelationships.length === 0 ? (
                    <p className='copy-empty'>
                        <Localize i18n_default_text='You are not copying anyone yet.' />
                    </p>
                ) : (
                    <div className='copy-relationships'>
                        {activeRelationships.map(relationship => (
                            <div key={relationship.id} className='copy-relationship'>
                                <div className='copy-relationship__info'>
                                    <span className='copy-relationship__label'>{relationship.label}</span>
                                    <span className='copy-relationship__token'>{maskToken(relationship.token)}</span>
                                    {(relationship.min_trade_stake || relationship.max_trade_stake) && (
                                        <span className='copy-relationship__limits'>
                                            {relationship.min_trade_stake && `min ${relationship.min_trade_stake} `}
                                            {relationship.max_trade_stake && `max ${relationship.max_trade_stake}`}{' '}
                                            {currency}
                                        </span>
                                    )}
                                </div>
                                <button
                                    type='button'
                                    className='copy-button copy-button--stop'
                                    disabled={stoppingId === relationship.id}
                                    onClick={() => handleStopCopying(relationship)}
                                >
                                    <Localize i18n_default_text={stoppingId === relationship.id ? 'Stopping...' : 'Stop'} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {statusMessage && <p className='copy-status'>{statusMessage}</p>}
            {errorMessage && <p className='copy-error'>{errorMessage}</p>}
        </div>
    );
});

export default CopyTrading;
