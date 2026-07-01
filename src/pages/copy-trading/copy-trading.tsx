import { useCallback, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import {
    fetchAccountInfoForToken,
    fetchCopyTradingStatistics,
    setAllowCopiers,
    startCopyTrading,
    stopCopyTrading,
    TCopyTradingStats,
    TTokenAccountInfo,
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

type TFollower = {
    added_at: number;
    id: string;
    label: string;
    token: string;
};

type TFollowerBalanceState = {
    error?: string;
    info?: TTokenAccountInfo;
    loading: boolean;
};

const STORAGE_KEY = 'copy_trading_active_relationships';
const FOLLOWERS_STORAGE_KEY = 'copy_trading_followers_list';
const MAX_FOLLOWERS = 50;
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

const loadStoredFollowers = (): TFollower[] => {
    try {
        const raw = localStorage.getItem(FOLLOWERS_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.slice(0, MAX_FOLLOWERS) : [];
    } catch {
        return [];
    }
};

const persistFollowers = (followers: TFollower[]) => {
    try {
        localStorage.setItem(FOLLOWERS_STORAGE_KEY, JSON.stringify(followers));
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

    const [masterAccountInfo, setMasterAccountInfo] = useState<TTokenAccountInfo | null>(null);
    const [isLoadingMasterBalance, setIsLoadingMasterBalance] = useState(false);
    const [masterBalanceError, setMasterBalanceError] = useState('');

    const [myAccountInfo, setMyAccountInfo] = useState<TTokenAccountInfo | null>(null);
    const [isLoadingMyBalance, setIsLoadingMyBalance] = useState(false);
    const [myBalanceError, setMyBalanceError] = useState('');

    const [activeRelationships, setActiveRelationships] = useState<TActiveCopy[]>([]);
    const [isStarting, setIsStarting] = useState(false);
    const [stoppingId, setStoppingId] = useState<string | null>(null);

    const [statusMessage, setStatusMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    // ==================== Followers section (people copying you) ====================
    const [followers, setFollowers] = useState<TFollower[]>([]);
    const [followerBalances, setFollowerBalances] = useState<Record<string, TFollowerBalanceState>>({});
    const [newFollowerLabel, setNewFollowerLabel] = useState('');
    const [newFollowerToken, setNewFollowerToken] = useState('');
    const [newFollowerPreview, setNewFollowerPreview] = useState<TTokenAccountInfo | null>(null);
    const [isVerifyingNewFollower, setIsVerifyingNewFollower] = useState(false);
    const [newFollowerError, setNewFollowerError] = useState('');
    const [isAddingFollower, setIsAddingFollower] = useState(false);
    const [isRefreshingAllFollowers, setIsRefreshingAllFollowers] = useState(false);

    useEffect(() => {
        setActiveRelationships(loadStoredRelationships());
        setFollowers(loadStoredFollowers());
    }, []);

    // Verify + preview the balance of a follower before adding them.
    useEffect(() => {
        const token = newFollowerToken.trim();
        setNewFollowerPreview(null);
        setNewFollowerError('');
        if (!token) return undefined;

        setIsVerifyingNewFollower(true);
        const handle = setTimeout(() => {
            fetchAccountInfoForToken(token)
                .then(info => setNewFollowerPreview(info))
                .catch(error =>
                    setNewFollowerError(error instanceof Error ? error.message : 'Could not verify this token.')
                )
                .finally(() => setIsVerifyingNewFollower(false));
        }, 600);

        return () => {
            clearTimeout(handle);
            setIsVerifyingNewFollower(false);
        };
    }, [newFollowerToken]);

    // Fetch each follower's live balance whenever the followers list changes (e.g. on load).
    useEffect(() => {
        followers.forEach(follower => {
            setFollowerBalances(prev => ({
                ...prev,
                [follower.id]: { ...(prev[follower.id] ?? { loading: false }), loading: true, error: undefined },
            }));
            fetchAccountInfoForToken(follower.token)
                .then(info => {
                    setFollowerBalances(prev => ({ ...prev, [follower.id]: { info, loading: false } }));
                })
                .catch(error => {
                    setFollowerBalances(prev => ({
                        ...prev,
                        [follower.id]: {
                            info: prev[follower.id]?.info,
                            loading: false,
                            error: error instanceof Error ? error.message : 'Could not refresh balance.',
                        },
                    }));
                });
        });
        // Only re-run when the number/identity of followers changes, not on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [followers.map(item => item.id).join(',')]);

    // ==================== Auto-fetch balance when a token is pasted ====================

    useEffect(() => {
        const token = masterTokenInput.trim();
        setMasterAccountInfo(null);
        setMasterBalanceError('');
        if (!token) return undefined;

        setIsLoadingMasterBalance(true);
        const handle = setTimeout(() => {
            fetchAccountInfoForToken(token)
                .then(info => setMasterAccountInfo(info))
                .catch(error => setMasterBalanceError(error instanceof Error ? error.message : 'Could not verify this token.'))
                .finally(() => setIsLoadingMasterBalance(false));
        }, 600);

        return () => {
            clearTimeout(handle);
            setIsLoadingMasterBalance(false);
        };
    }, [masterTokenInput]);

    useEffect(() => {
        const token = myApiToken.trim();
        setMyAccountInfo(null);
        setMyBalanceError('');
        if (!token) return undefined;

        setIsLoadingMyBalance(true);
        const handle = setTimeout(() => {
            fetchAccountInfoForToken(token)
                .then(info => setMyAccountInfo(info))
                .catch(error => setMyBalanceError(error instanceof Error ? error.message : 'Could not verify this token.'))
                .finally(() => setIsLoadingMyBalance(false));
        }, 600);

        return () => {
            clearTimeout(handle);
            setIsLoadingMyBalance(false);
        };
    }, [myApiToken]);

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

    const refreshFollowerBalance = useCallback((follower: TFollower) => {
        setFollowerBalances(prev => ({
            ...prev,
            [follower.id]: { ...(prev[follower.id] ?? { loading: false }), loading: true, error: undefined },
        }));
        fetchAccountInfoForToken(follower.token)
            .then(info => {
                setFollowerBalances(prev => ({ ...prev, [follower.id]: { info, loading: false } }));
            })
            .catch(error => {
                setFollowerBalances(prev => ({
                    ...prev,
                    [follower.id]: {
                        info: prev[follower.id]?.info,
                        loading: false,
                        error: error instanceof Error ? error.message : 'Could not refresh balance.',
                    },
                }));
            });
    }, []);

    const handleAddFollower = useCallback(async () => {
        const token = newFollowerToken.trim();
        if (!token) {
            setNewFollowerError('Enter the follower\u2019s API token first.');
            return;
        }
        if (followers.length >= MAX_FOLLOWERS) {
            setNewFollowerError(`You\u2019ve reached the maximum of ${MAX_FOLLOWERS} followers.`);
            return;
        }
        if (followers.some(item => item.token === token)) {
            setNewFollowerError('This follower has already been added.');
            return;
        }

        setNewFollowerError('');
        setIsAddingFollower(true);
        try {
            const info = newFollowerPreview ?? (await fetchAccountInfoForToken(token));
            const follower: TFollower = {
                id: `${Date.now()}`,
                label: newFollowerLabel.trim() || info.loginid || `Follower ${maskToken(token)}`,
                token,
                added_at: Date.now(),
            };
            const updated = [follower, ...followers];
            setFollowers(updated);
            persistFollowers(updated);
            setFollowerBalances(prev => ({ ...prev, [follower.id]: { info, loading: false } }));

            setStatusMessage(`\u2705 Added ${follower.label} as a follower (${updated.length}/${MAX_FOLLOWERS}).`);
            setNewFollowerLabel('');
            setNewFollowerToken('');
            setNewFollowerPreview(null);
        } catch (error) {
            setNewFollowerError(error instanceof Error ? error.message : 'Could not verify or add this follower.');
        } finally {
            setIsAddingFollower(false);
        }
    }, [followers, newFollowerLabel, newFollowerPreview, newFollowerToken]);

    const handleRemoveFollower = useCallback(
        (follower: TFollower) => {
            const updated = followers.filter(item => item.id !== follower.id);
            setFollowers(updated);
            persistFollowers(updated);
            setFollowerBalances(prev => {
                const next = { ...prev };
                delete next[follower.id];
                return next;
            });
            setStatusMessage(`Removed ${follower.label} from your followers.`);
        },
        [followers]
    );

    const handleRefreshAllFollowers = useCallback(async () => {
        setIsRefreshingAllFollowers(true);
        try {
            await Promise.allSettled(followers.map(follower => fetchAccountInfoForToken(follower.token)
                .then(info => {
                    setFollowerBalances(prev => ({ ...prev, [follower.id]: { info, loading: false } }));
                })
                .catch(error => {
                    setFollowerBalances(prev => ({
                        ...prev,
                        [follower.id]: {
                            info: prev[follower.id]?.info,
                            loading: false,
                            error: error instanceof Error ? error.message : 'Could not refresh balance.',
                        },
                    }));
                })));
        } finally {
            setIsRefreshingAllFollowers(false);
        }
    }, [followers]);

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

                    {isLoadingMasterBalance && <p className='copy-balance-loading'>Verifying token...</p>}
                    {masterBalanceError && <p className='copy-balance-error'>{masterBalanceError}</p>}
                    {masterAccountInfo && (
                        <div className={`copy-balance-card ${masterAccountInfo.is_virtual ? 'copy-balance-card--demo' : ''}`}>
                            <div>
                                <span className='copy-balance-card__label'>
                                    <Localize i18n_default_text='Account' />
                                </span>
                                <span className='copy-balance-card__value'>
                                    {masterAccountInfo.loginid}
                                    {masterAccountInfo.is_virtual ? ' (Demo)' : ' (Real)'}
                                </span>
                            </div>
                            <div>
                                <span className='copy-balance-card__label'>
                                    <Localize i18n_default_text='Balance' />
                                </span>
                                <span className='copy-balance-card__value'>
                                    {masterAccountInfo.balance.toFixed(2)} {masterAccountInfo.currency}
                                </span>
                            </div>
                        </div>
                    )}

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
                    {isLoadingMyBalance && <p className='copy-balance-loading'>Verifying token...</p>}
                    {myBalanceError && <p className='copy-balance-error'>{myBalanceError}</p>}
                    {myAccountInfo && (
                        <div className={`copy-balance-card ${myAccountInfo.is_virtual ? 'copy-balance-card--demo' : ''}`}>
                            <div>
                                <span className='copy-balance-card__label'>
                                    <Localize i18n_default_text='Account' />
                                </span>
                                <span className='copy-balance-card__value'>
                                    {myAccountInfo.loginid}
                                    {myAccountInfo.is_virtual ? ' (Demo)' : ' (Real)'}
                                </span>
                            </div>
                            <div>
                                <span className='copy-balance-card__label'>
                                    <Localize i18n_default_text='Balance' />
                                </span>
                                <span className='copy-balance-card__value'>
                                    {myAccountInfo.balance.toFixed(2)} {myAccountInfo.currency}
                                </span>
                            </div>
                        </div>
                    )}
                    {myAccountInfo?.is_virtual && (
                        <p className='copy-warning'>
                            <Localize i18n_default_text='This is a demo account \u2014 Allow Copiers only works on real-money accounts.' />
                        </p>
                    )}
                    <p className='copy-hint'>
                        <Localize i18n_default_text='This token is only stored in your browser for your own reference \u2014 it is never sent anywhere by this page except when you personally copy it to share.' />
                    </p>
                </div>
            </div>

            {/* ==================== My Followers ==================== */}
            <div className='copy-card copy-card--full'>
                <div className='copy-followers-header'>
                    <div>
                        <h3 className='copy-card__title'>
                            <Localize i18n_default_text='My Followers' />
                        </h3>
                        <p className='copy-card__subtitle'>
                            <Localize i18n_default_text='People copying your trades. Add up to 50 followers using their read-only API tokens \u2014 each row shows their live account balance, and whether it\u2019s a Demo or Real account.' />
                        </p>
                    </div>
                    <span className='copy-followers-count'>
                        {followers.length}/{MAX_FOLLOWERS}
                    </span>
                </div>

                <div className='copy-followers-form'>
                    <label className='copy-field'>
                        <span>
                            <Localize i18n_default_text='Follower Name (optional)' />
                        </span>
                        <input
                            type='text'
                            placeholder='e.g. Sarah K.'
                            value={newFollowerLabel}
                            onChange={event => setNewFollowerLabel(event.target.value)}
                            disabled={followers.length >= MAX_FOLLOWERS}
                        />
                    </label>
                    <label className='copy-field'>
                        <span>
                            <Localize i18n_default_text="Follower's Read-Only API Token" />
                        </span>
                        <input
                            type='text'
                            placeholder='e.g. a1b2c3d4e5f6g7h8'
                            value={newFollowerToken}
                            onChange={event => setNewFollowerToken(event.target.value)}
                            disabled={followers.length >= MAX_FOLLOWERS}
                        />
                    </label>

                    {isVerifyingNewFollower && <p className='copy-balance-loading'>Verifying token...</p>}
                    {newFollowerError && <p className='copy-balance-error'>{newFollowerError}</p>}
                    {newFollowerPreview && (
                        <div
                            className={`copy-balance-card ${newFollowerPreview.is_virtual ? 'copy-balance-card--demo' : ''}`}
                        >
                            <div>
                                <span className='copy-balance-card__label'>
                                    <Localize i18n_default_text='Account' />
                                </span>
                                <span className='copy-balance-card__value'>
                                    {newFollowerPreview.loginid}
                                    {newFollowerPreview.is_virtual ? ' (Demo)' : ' (Real)'}
                                </span>
                            </div>
                            <div>
                                <span className='copy-balance-card__label'>
                                    <Localize i18n_default_text='Balance' />
                                </span>
                                <span className='copy-balance-card__value'>
                                    {newFollowerPreview.balance.toFixed(2)} {newFollowerPreview.currency}
                                </span>
                            </div>
                        </div>
                    )}

                    <div className='copy-card__actions'>
                        <button
                            type='button'
                            className='copy-button copy-button--primary'
                            disabled={isAddingFollower || followers.length >= MAX_FOLLOWERS}
                            onClick={handleAddFollower}
                        >
                            <Localize
                                i18n_default_text={
                                    followers.length >= MAX_FOLLOWERS
                                        ? 'Follower Limit Reached'
                                        : isAddingFollower
                                          ? 'Adding...'
                                          : 'Add Follower'
                                }
                            />
                        </button>
                        {followers.length > 0 && (
                            <button
                                type='button'
                                className='copy-button copy-button--secondary'
                                disabled={isRefreshingAllFollowers}
                                onClick={handleRefreshAllFollowers}
                            >
                                <Localize
                                    i18n_default_text={isRefreshingAllFollowers ? 'Refreshing...' : 'Refresh All Balances'}
                                />
                            </button>
                        )}
                    </div>
                </div>

                {followers.length === 0 ? (
                    <p className='copy-empty'>
                        <Localize i18n_default_text='You have no followers yet. Add their read-only API tokens above to track them here.' />
                    </p>
                ) : (
                    <div className='copy-followers-list'>
                        {followers.map(follower => {
                            const balance_state = followerBalances[follower.id];
                            return (
                                <div key={follower.id} className='copy-follower'>
                                    <div className='copy-follower__info'>
                                        <span className='copy-follower__label'>{follower.label}</span>
                                        <span className='copy-follower__token'>{maskToken(follower.token)}</span>
                                    </div>

                                    <div className='copy-follower__balance'>
                                        {balance_state?.loading && (
                                            <span className='copy-balance-loading'>Updating...</span>
                                        )}
                                        {!balance_state?.loading && balance_state?.error && (
                                            <span className='copy-balance-error'>{balance_state.error}</span>
                                        )}
                                        {!balance_state?.loading && balance_state?.info && (
                                            <>
                                                <span
                                                    className={`copy-follower__badge ${
                                                        balance_state.info.is_virtual
                                                            ? 'copy-follower__badge--demo'
                                                            : 'copy-follower__badge--real'
                                                    }`}
                                                >
                                                    <Localize
                                                        i18n_default_text={
                                                            balance_state.info.is_virtual ? 'Demo' : 'Real'
                                                        }
                                                    />
                                                </span>
                                                <span className='copy-follower__amount'>
                                                    {balance_state.info.balance.toFixed(2)}{' '}
                                                    {balance_state.info.currency}
                                                </span>
                                            </>
                                        )}
                                    </div>

                                    <div className='copy-follower__actions'>
                                        <button
                                            type='button'
                                            className='copy-icon-button'
                                            title='Refresh balance'
                                            disabled={balance_state?.loading}
                                            onClick={() => refreshFollowerBalance(follower)}
                                        >
                                            &#8635;
                                        </button>
                                        <button
                                            type='button'
                                            className='copy-button copy-button--stop'
                                            onClick={() => handleRemoveFollower(follower)}
                                        >
                                            <Localize i18n_default_text='Remove' />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
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
