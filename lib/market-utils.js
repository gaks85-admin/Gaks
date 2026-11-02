export const toCanonicalSymbol = (symbol) => {
    if (!symbol)
        return '';
    return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
};
export const normalizeSymbol = (symbol) => {
    if (!symbol)
        return '';
    let s = symbol.trim().toUpperCase();
    if (s === 'GC=F' || s === 'XAU/USD' || s === 'XAUUSD')
        return 'XAUUSD';
    if (s === 'SI=F' || s === 'XAG/USD' || s === 'XAGUSD')
        return 'XAGUSD';
    if (s === 'NQ=F' || s === 'NAS100')
        return 'NAS100';
    if (s === 'YM=F' || s === 'US30')
        return 'US30';
    if (s === 'ES=F' || s === 'SPX500')
        return 'SPX500';
    if (s === 'DAX=F' || s === 'GER30')
        return 'GER30';
    if (s === 'Z=F' || s === 'UK100')
        return 'UK100';
    s = s.replace('=X', '').replace('-USD', '').replace('=F', '');
    return s.replace(/[^A-Z0-9]/g, '');
};
export const toDisplaySymbol = (symbol) => {
    const canonical = toCanonicalSymbol(symbol);
    const mappings = {
        'EURUSD': 'EUR/USD',
        'GBPUSD': 'GBP/USD',
        'USDJPY': 'USD/JPY',
        'AUDUSD': 'AUD/USD',
        'USDCAD': 'USD/CAD',
        'USDCHF': 'USD/CHF',
        'NZDUSD': 'NZD/USD',
        'BTCUSD': 'BTC/USD',
        'ETHUSD': 'ETH/USD',
        'XAUUSD': 'XAU/USD',
        'XAGUSD': 'XAG/USD',
        'NAS100': 'NAS100',
        'US30': 'US30',
        'SPX500': 'SPX500',
        'GER30': 'GER30',
        'UK100': 'UK100'
    };
    if (mappings[canonical])
        return mappings[canonical];
    if (canonical.length === 6 && /^[A-Z]{6}$/.test(canonical)) {
        return `${canonical.slice(0, 3)}/${canonical.slice(3)}`;
    }
    return canonical;
};
export const convertSymbol = toDisplaySymbol;
export const mapTimeframeToInterval = (tf) => {
    if (!tf)
        return '1h';
    const u = tf.toUpperCase();
    if (u === 'M1' || u === '1M')
        return '1min';
    if (u === 'M5' || u === '5M')
        return '5min';
    if (u === 'M15' || u === '15M')
        return '15min';
    if (u === 'M30' || u === '30M')
        return '30min';
    if (u === 'H1' || u === '1H')
        return '1h';
    if (u === 'H2' || u === '2H')
        return '2h';
    if (u === 'H4' || u === '4H')
        return '4h';
    if (u === 'D1' || u === 'D' || u === 'DAILY')
        return '1day';
    if (u === 'W1' || u === 'W' || u === 'WEEKLY')
        return '1week';
    return '1h';
};
