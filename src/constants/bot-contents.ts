type TTabsTitle = {
    [key: string]: string | number;
};

type TDashboardTabIndex = {
    [key: string]: number;
};

export const tabs_title: TTabsTitle = Object.freeze({
    WORKSPACE: 'Workspace',
    CHART: 'Chart',
});

export const DBOT_TABS: TDashboardTabIndex = Object.freeze({
    BOT_IDEAS: 0,
    BEST_BOTS: 1,
    DASHBOARD: 2,
    BOT_BUILDER: 3,
    AUTO_TRADES: 4,
    MANUAL_TRADING: 5,
    SCANNER: 6,
    ANALYSIS_TOOL: 7,
    SPEED_BOT: 8,
    AVIATOR_ACCUMULATOR: 9,
    COPY_TRADING: 10,
    PRO_SCANNER: 11,
    AUTO_BOTS: 12,
});

export const MAX_STRATEGIES = 10;

export const TAB_IDS = [
    'id-bot-ideas',
    'id-best-bots',
    'id-dbot-dashboard',
    'id-bot-builder',
    'id-auto-trades',
    'id-manual-trading',
    'id-scanner',
    'id-analysistool',
    'id-speed-bot',
    'id-aviator-accumulator',
    'id-copy-trading',
    'id-pro-scanner',
    'id-auto-bots',
];

export const DEBOUNCE_INTERVAL_TIME = 500;
