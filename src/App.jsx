import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from 'react-router-dom';
import "./App.css";
import { Line } from 'react-chartjs-2';
import 'chart.js/auto';
import NQPriceChart from './components/NQPriceChart';
import NQPriceChartWithVolume from './components/NQPriceChartWithVolume';
import VolumeProfile from './components/VolumeProfile';

// Error Boundary Component
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    this.setState({
      error: error,
      errorInfo: errorInfo
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          backgroundColor: '#ff0000',
          color: 'white',
          padding: '20px',
          margin: '20px'
        }}>
          <h2>Component Error</h2>
          <details style={{ whiteSpace: 'pre-wrap' }}>
            {this.state.error && this.state.error.toString()}
            <br />
            {this.state.errorInfo && this.state.errorInfo.componentStack}
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";
const COLOR_PALETTE = [
  "#1F77B4", // blue
  "#FF7F0E", // orange
  "#9467BD", // purple
  "#8C564B", // brown
  "#E377C2", // pink
  "#7F7F7F", // gray
  "#BCBD22", // olive
  "#17BECF", // cyan
  "#F4B400", // amber
  "#FF006E", // magenta
  "#5C6BC0", // indigo
  "#42A5F5", // light blue
  "#26A69A", // teal
  "#BA68C8", // light purple
  "#FFD54F", // yellow
  "#FF7043", // orange-red
];
const DEFAULT_MARKET_TZ = "America/Chicago";
const MARKET_OPEN_HOUR = 8; // 8:30am CT approx (we'll subtract 1 hour)

// Logging utility function to add timestamps to console logs
function logWithTimestamp(...args) {
  const timestamp = new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3
  });
  console.log(`[${timestamp}]`, ...args);
}

async function fetchWithRetry(url, { retries = 3, backoff = 500 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res;
    if (attempt < retries && (res.status >= 500 || res.status === 429)) {
      logWithTimestamp(`[RETRY] ${url} returned ${res.status}, retrying in ${backoff}ms (attempt ${attempt + 1}/${retries})`);
      await new Promise(r => setTimeout(r, backoff * (attempt + 1)));
      continue;
    }
    throw new Error(`${res.status}: ${await res.text()}`);
  }
}

function getDefaultStartTime() {
  try {
    const now = new Date();
    const open = new Date(now);
    open.setHours(7, 30, 0, 0); // 1 hour before 8:30am CT
    const tzOffset = open.getTimezoneOffset();
    const localISO = new Date(open.getTime() - tzOffset * 60000).toISOString().slice(0, 16);
    return localISO;
  } catch {
    return "";
  }
}

function formatExpirationDate(dateStr) {
  try {
    const date = new Date(dateStr + 'T00:00:00');
    const options = { month: 'short', day: 'numeric', year: 'numeric' };
    return date.toLocaleDateString('en-US', options);
  } catch {
    return dateStr;
  }
}

function getChainExpiration(chainSymbol, chains) {
  const chainObj = chains.find(c => c.chain === chainSymbol);
  return chainObj ? chainObj.expiration : null;
}

function generateBarchartUrl(symbol, strike, optionType) {
  if (!symbol || !strike || !optionType) return null;
  
  // Clean the symbol (remove any pipe and trailing characters)
  const cleanSymbol = symbol.split('|')[0];
  
  // Build the full option contract symbol: SYMBOL|STRIKETYPE
  // e.g., MC1Z5|25650C or MM6Z25|25700P
  const typeCode = optionType.toUpperCase().charAt(0); // 'C' for Call, 'P' for Put
  const fullSymbol = `${cleanSymbol}|${strike}${typeCode}`;
  
  // URL format: https://www.barchart.com/futures/quotes/{FULL_SYMBOL}/interactive-chart
  // The symbol needs to be URL encoded for the pipe character
  const encodedSymbol = encodeURIComponent(fullSymbol);
  
  return `https://www.barchart.com/futures/quotes/${encodedSymbol}/interactive-chart`;
}

function getLatestChange(layer) {
  // Get the latest price_change from the database
  if (!layer.points || layer.points.length === 0) return null;
  
  // Find the last non-null price_change value
  const lastPoint = layer.points
    .slice()
    .reverse()
    .find(pt => pt.price_change !== null && pt.price_change !== undefined);
  
  if (!lastPoint) return null;
  
  // Also get the current value for display
  const lastValue = layer.points
    .slice()
    .reverse()
    .find(pt => pt.value !== null && pt.value !== undefined);
  
  const currentPrice = lastValue?.value || 0;
  const priceChange = lastPoint.price_change;
  
  // Calculate percentage change using the formula:
  // percentage = (price_change / (last_price - price_change)) * 100
  let percentage = null;
  if (currentPrice !== 0 && priceChange !== null && priceChange !== undefined) {
    const previousPrice = currentPrice - priceChange;
    if (previousPrice !== 0) {
      percentage = (priceChange / previousPrice) * 100;
    }
  }
  
  return {
    absolute: priceChange,
    percentage: percentage,
    current: currentPrice,
    price_change: priceChange
  };
}

function getPercentageChange(currentValue, previousValue) {
  // Helper for calculating % change in tooltips
  if (currentValue === null || currentValue === undefined || 
      previousValue === null || previousValue === undefined) {
    return null;
  }
  
  if (previousValue === 0) {
    return currentValue > 0 ? 100 : currentValue < 0 ? -100 : 0;
  }
  
  return ((currentValue - previousValue) / previousValue) * 100;
}

function App() {
  const [chains, setChains] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [selectedChain, setSelectedChain] = useState("");
  const [optionType, setOptionType] = useState("Call");
  const [strikeInput, setStrikeInput] = useState("");
  const [availableStrikes, setAvailableStrikes] = useState([]);
  const [selectedMetric, setSelectedMetric] = useState("volume");
  const [layers, setLayers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState("");
  const [defaultsLoaded, setDefaultsLoaded] = useState(false);
  
  // Chart refs for synchronized tooltips
  const optionChartRef = useRef(null);
  const nqChartRef = useRef(null);
  const volumeProfileChartRef = useRef(null);
  const [presets, setPresets] = useState([]);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [rocWindow, setRocWindow] = useState(3);
  
  // Request deduplication cache to prevent duplicate API calls
  const requestCache = useRef(new Map());
  
  const colorIndexRef = useRef(0);
  const [layerSortKey, setLayerSortKey] = useState("added");
  const [layerSortDir, setLayerSortDir] = useState("asc");
  const [layerFilters, setLayerFilters] = useState({
    instrument: "",
    optionType: "all",
    metric: "all",
    strikeMin: "",
    strikeMax: "",
  });
  const [chartStartTime, setChartStartTime] = useState("");  // Start with no filter to see all data
  const [showSVGChart, setShowSVGChart] = useState(false);
  const [nqPriceData, setNqPriceData] = useState([]);
  const [nqLoading, setNqLoading] = useState(false);
  const [nqError, setNqError] = useState("");
  const [nqHistoricalNote, setNqHistoricalNote] = useState("");

  // Volume Profile states
  const [volumeProfileData, setVolumeProfileData] = useState([]);
  const [volumeProfileLoading, setVolumeProfileLoading] = useState(false);
  const [volumeProfileError, setVolumeProfileError] = useState("");

  // Route detection
  const location = useLocation();
  const isV2Route = location.pathname === '/v2';
  const isV3Route = location.pathname === '/v3';

  // Enable NQ functionality with better error handling
  const nqDisabled = false;

  useEffect(() => {
    let cancelled = false;
    const loadInitial = async () => {
      try {
        logWithTimestamp('[APP] Loading initial data from:', API_BASE);
        const results = await Promise.allSettled([fetchChains(), fetchMetrics(), fetchPresets()]);
        if (cancelled) return;
        const failures = results.filter(r => r.status === 'rejected');
        if (failures.length) {
          const msgs = failures.map(f => f.reason?.message || String(f.reason));
          console.error('[APP] Some initial loads failed:', msgs);
          setError(`Failed to load: ${msgs.join('; ')}`);
        }
        setLastUpdated(new Date().toISOString());
      } catch (err) {
        if (cancelled) return;
        console.error('[APP] Failed to load initial data:', err);
        setError(`Failed to refresh data: ${err.message}`);
      }
    };
    loadInitial();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (selectedChain) {
      fetchStrikes(selectedChain, optionType);
      fetchVolumeProfileData(selectedChain);
    }
  }, [selectedChain, optionType]);

  // Refresh volume profile when chart start time changes
  useEffect(() => {
    if (selectedChain) {
      fetchVolumeProfileData(selectedChain);
    }
  }, [chartStartTime, selectedChain]);

  // Auto-load preset when all data is ready
  useEffect(() => {
    if (!defaultsLoaded && chains.length && metrics.length && presets.length && window.__autoLoadPreset) {
      logWithTimestamp('[APP] Auto-loading top 3 volume preset...');
      const hasTop3Volume = presets.some((preset) => preset.id === "top-3-volume-today");
      if (hasTop3Volume) {
        loadPreset("top-3-volume-today", true).finally(() => {
          setDefaultsLoaded(true);
          window.__autoLoadPreset = false;
        });
      } else {
        setDefaultsLoaded(true);
        window.__autoLoadPreset = false;
      }
    } else if (!defaultsLoaded && chains.length && metrics.length && presets.length) {
      setDefaultsLoaded(true);
    }
  }, [chains, metrics, presets, defaultsLoaded]);

  useEffect(() => {
    // Fetch NQ data when chart start time changes or when we have layers
    if (!nqDisabled && layers.length > 0) {
      fetchNQHistorical();
    }
  }, [chartStartTime, nqDisabled, layers.length]);


  // Removed automatic smart default - now handled by instrument selection

  const fetchChains = async () => {
    const res = await fetchWithRetry(`${API_BASE}/chains-detailed`);
    const data = await res.json();
    logWithTimestamp('[APP] Fetched chains with expiration:', data.slice(0, 3));
    setChains(data);
    if (data.length && !selectedChain) {
      // Find chain that expires today or yesterday
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      logWithTimestamp(`[APP] Looking for instrument expiring today: ${todayStr}`);
      
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      
      const todayChain = data.find(chain => chain.expiration === todayStr);
      const yesterdayChain = data.find(chain => chain.expiration === yesterdayStr);
      const chainToSelect = todayChain || yesterdayChain || data[0];
      
      if (todayChain) {
        logWithTimestamp(`[APP] Found instrument expiring today: ${todayChain.chain}`);
      } else if (yesterdayChain) {
        logWithTimestamp(`[APP] No instrument expires today, using yesterday's: ${yesterdayChain.chain}`);
      } else {
        logWithTimestamp(`[APP] No instrument for today/yesterday, using first one: ${data[0].chain}`);
      }
      
      setSelectedChain(chainToSelect.chain);
      
      // Set chart start time to 6 AM local on the selected chain's date
      if (chainToSelect && chainToSelect.expiration) {
        const expirationDate = new Date(chainToSelect.expiration + 'T06:00:00');
        const year = expirationDate.getFullYear();
        const month = String(expirationDate.getMonth() + 1).padStart(2, '0');
        const day = String(expirationDate.getDate()).padStart(2, '0');
        const formattedTime = `${year}-${month}-${day}T06:00`;
        logWithTimestamp(`[APP] Setting initial chart start to 6 AM local on ${chainToSelect.expiration}: ${formattedTime}`);
        setChartStartTime(formattedTime);
        
        // Store for auto-loading preset after all data is loaded
        window.__autoLoadPreset = true;
      }
    }
  };

  const fetchMetrics = async () => {
    const res = await fetchWithRetry(`${API_BASE}/metrics`);
    const data = await res.json();
    setMetrics(data);
    if (data.length && !data.includes(selectedMetric)) {
      setSelectedMetric(data[0]);
    }
  };

  const fetchPresets = async () => {
    const res = await fetchWithRetry(`${API_BASE}/presets`);
    const data = await res.json();
    setPresets(data);
    // Don't auto-select a preset - wait for user action or auto-load
  };

  const fetchStrikes = async (chain, type) => {
    try {
      const params = new URLSearchParams({ chain, option_type: type });
      const res = await fetch(`${API_BASE}/strikes?${params.toString()}`);
      const data = await res.json();
      setAvailableStrikes(data);
      if (!strikeInput && data.length) {
        setStrikeInput(String(data[0]));
      }
    } catch {
      setAvailableStrikes([]);
    }
  };

  const getNextColor = useCallback(() => {
    const color = COLOR_PALETTE[colorIndexRef.current % COLOR_PALETTE.length];
    colorIndexRef.current += 1;
    return color;
  }, []);

  const fetchLayerTimeseries = async ({
    chain,
    optionType: type,
    strike,
    metric,
    rocWindowOverride,
    afterTimestamp = null, // New parameter for incremental fetching
  }) => {
    // Generate cache key for request deduplication
    const cacheKey = `${chain}-${type}-${strike}-${metric}-${rocWindowOverride || 'default'}-${afterTimestamp || 'initial'}`;
    
    // Check if this request is already in flight
    if (requestCache.current.has(cacheKey)) {
      logWithTimestamp(`[FETCH] Reusing existing request for ${chain} ${type} ${strike} ${metric}`);
      return requestCache.current.get(cacheKey);
    }
    
    // Create and cache the fetch promise
    const fetchPromise = (async () => {
      logWithTimestamp(`[FETCH] Starting timeseries fetch for ${chain} ${type} ${strike} ${metric}${afterTimestamp ? ` (after ${afterTimestamp})` : ''}`);
      const fetchStart = performance.now();
      const params = new URLSearchParams({
        chain,
        option_type: type,
        strike,
        metric,
        limit: "5000",
        include_price_change: "true", // Always include price_change data
      });
      
      if (afterTimestamp) {
        // For incremental fetch, only get data after the last timestamp
        params.set("start", afterTimestamp);
        logWithTimestamp(`[FETCH] Incremental fetch - getting data after ${afterTimestamp}`);
      } else {
        logWithTimestamp(`[FETCH] Loading all historical data`);
      }
      
      if (metric === "volume_roc") {
        params.set("roc_window", String(Math.max(1, Number(rocWindowOverride) || 1)));
      }
      logWithTimestamp(`[FETCH] API URL: ${API_BASE}/timeseries?${params.toString()}`);
      const res = await fetch(`${API_BASE}/timeseries?${params.toString()}`);
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = await res.json();
      const fetchEnd = performance.now();
      logWithTimestamp(`[FETCH] Received ${data.points?.length || 0} points in ${(fetchEnd - fetchStart).toFixed(2)}ms`);
      
      const points = (data.points || []).map((pt) => ({
        fetched_at: pt.fetched_at,
        label: new Date(pt.fetched_at).toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit',
          hour12: true 
        }),
        value: pt.value ?? null,
        price_change: pt.price_change ?? null,
        last_price: pt.last_price ?? null,
      }));
      
      logWithTimestamp(`[DATA] Processed ${points.length} points for ${chain} ${type} ${strike}`);
      
      return {
        points,
        symbol: data.symbol ?? "",
        chainSymbol: data.symbol ? data.symbol.split("|")[0] : chain,
      };
    })();
    
    // Cache the promise
    requestCache.current.set(cacheKey, fetchPromise);
    
    // Clean up cache when request completes (success or failure)
    fetchPromise.finally(() => {
      requestCache.current.delete(cacheKey);
    });
    
    return fetchPromise;
  };

  const addLayer = async (overrides = {}) => {
    const chain = overrides.chain ?? selectedChain;
    const type = overrides.optionType ?? optionType;
    const strike = overrides.strike ?? strikeInput;
    const metric = overrides.metric ?? selectedMetric;
    const rocParam = overrides.rocWindow ?? rocWindow;
    const skipLoading = overrides.skipLoading ?? false;
    logWithTimestamp('[ADD_LAYER] Called with:', { chain, type, strike, metric, rocParam, skipLoading });
    if (!chain || !strike) {
      setError("Please select an instrument and enter a strike.");
      return;
    }
    if (!skipLoading) {
      setLoading(true);
    }
    setError("");
    try {
      const { points, symbol, chainSymbol } = await fetchLayerTimeseries({
        chain,
        optionType: type,
        strike,
        metric,
        rocWindowOverride: rocParam,
      });
      setLayers((prev) => {
        const exists = prev.some(
          (layer) =>
            layer.chain === chain &&
            layer.optionType === type &&
            Number(layer.strike) === Number(strike) &&
            layer.metric === metric
        );
        if (exists) {
          logWithTimestamp('[ADD_LAYER] Layer already exists, skipping:', { chain, type, strike, metric });
          return prev;
        }
        const layerColor = overrides.color || getNextColor();
        const timestamp = Date.now();
        const id = `layer_${timestamp}_${Math.random().toString(16).slice(2)}`;
        logWithTimestamp('[ADD_LAYER] Creating new layer:', { symbol, chain, type, strike, metric });
        return [
          ...prev,
          {
            id,
            createdAt: timestamp,
            chain,
            optionType: type,
            strike,
            metric,
            metricLabel: metric === "volume_roc" ? `volume_roc (${rocParam})` : 
                         metric === "price_change" ? "Price Change" :
                         metric === "open_interest" ? "Open Interest" :
                         metric === "last_price" ? "Last Price" :
                         metric,
            rocWindow: metric === "volume_roc" ? rocParam : undefined,
            symbol,
            chainSymbol,
            color: layerColor,
            points,
            visible: true,
          },
        ];
      });
    } catch (err) {
      setError(`Failed to load timeseries: ${err.message}`);
    } finally {
      if (!skipLoading) {
        setLoading(false);
      }
      setLastUpdated(new Date().toISOString());
    }
  };

  const fetchNQHistorical = async (isIncremental = false) => {
    if (nqDisabled) return;
    
    logWithTimestamp(`[NQ] Starting NQ historical data fetch${isIncremental ? ' (incremental)' : ''}...`);
    setNqLoading(true);
    setNqError("");
    setNqHistoricalNote("");
    try {
      const params = new URLSearchParams({
        symbol: "NQ=F",
        limit: "5000",
      });
      
      // For incremental refresh, get data after the last point
      if (isIncremental && nqPriceData.length > 0) {
        const lastPoint = nqPriceData[nqPriceData.length - 1];
        params.set("start_time", lastPoint.fetched_at);
        logWithTimestamp(`[NQ] Incremental fetch - getting data after ${lastPoint.fetched_at}`);
      } else if (chartStartTime) {
        params.set("start_time", new Date(chartStartTime).toISOString());
      }
      
      // If we have chart data, match the end time to the latest options data point
      if (chartData.length > 0) {
        const endTime = chartData[chartData.length - 1].fetched_at;
        params.set("end_time", endTime);
      }
      
      const url = `${API_BASE}/futures/historical?${params.toString()}`;
      logWithTimestamp('[NQ] Fetching from:', url);
      
      let res = await fetch(url);
      let data = null;
      
      // If no data found with date filters, try without date restrictions
      if (!res.ok && chartStartTime) {
        logWithTimestamp('[NQ] No data found with date filter, trying without restrictions...');
        const fallbackParams = new URLSearchParams({
          symbol: "NQ=F",
          limit: "5000",
        });
        const fallbackUrl = `${API_BASE}/futures/historical?${fallbackParams.toString()}`;
        logWithTimestamp('[NQ] Fallback fetch from:', fallbackUrl);
        res = await fetch(fallbackUrl);
      }
      
      if (!res.ok) {
        throw new Error(await res.text());
      }
      
      data = await res.json();
      logWithTimestamp('[NQ] Received', data.points?.length || 0, 'data points');
      
      if (data.points?.length > 0) {
        logWithTimestamp('[NQ] Data date range:', data.points[0].fetched_at, 'to', data.points[data.points.length - 1].fetched_at);
        // Add a note if showing historical data
        const latestDate = new Date(data.points[data.points.length - 1].fetched_at);
        const today = new Date();
        const daysDiff = Math.floor((today - latestDate) / (1000 * 60 * 60 * 24));
        if (daysDiff > 1) {
          const dateStr = latestDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          setNqHistoricalNote(`Note: Showing historical NQ data from ${dateStr} (${daysDiff} days ago)`);
          logWithTimestamp(`[NQ] Note: Showing historical NQ data from ${daysDiff} days ago`);
        } else {
          setNqHistoricalNote("");
        }
      } else {
        setNqHistoricalNote("");
      }
      
      // Handle data merging for incremental updates
      if (isIncremental && nqPriceData.length > 0 && data.points?.length > 0) {
        // Merge new data with existing data
        const mergedData = [...nqPriceData, ...data.points];
        logWithTimestamp(`[NQ] Incremental update - Appended ${data.points.length} new points to ${nqPriceData.length} existing points`);
        setNqPriceData(mergedData);
      } else {
        // Replace all data
        setNqPriceData(data.points || []);
      }
    } catch (err) {
      console.error("Failed to fetch NQ historical data:", err);
      setNqError(`Failed to load NQ data: ${err.message}`);
    } finally {
      setNqLoading(false);
    }
  };

  const fetchVolumeProfileData = async (chain) => {
    if (!chain) return;
    
    logWithTimestamp(`[VOLUME PROFILE] Fetching volume profile for chain: ${chain}`);
    setVolumeProfileLoading(true);
    setVolumeProfileError("");
    
    try {
      const params = new URLSearchParams({ chain });
      
      // Add start time filter if chartStartTime is set
      if (chartStartTime) {
        params.set('start_time', new Date(chartStartTime).toISOString());
        logWithTimestamp(`[VOLUME PROFILE] Adding start_time filter: ${new Date(chartStartTime).toISOString()}`);
      }
      
      const url = `${API_BASE}/volume-profile?${params.toString()}`;
      const res = await fetch(url);
      
      if (!res.ok) {
        throw new Error(await res.text());
      }
      
      const data = await res.json();
      logWithTimestamp('[VOLUME PROFILE] Raw API response:', data);
      logWithTimestamp('[VOLUME PROFILE] Levels object:', JSON.stringify(data.levels, null, 2));
      
      // Transform the levels object into an array format expected by the VolumeProfile component
      let transformedData = [];
      if (data.levels && typeof data.levels === 'object') {
        transformedData = Object.entries(data.levels).map(([strike, level]) => ({
          strike: parseFloat(strike),
          callVolume: level.calls || 0,
          putVolume: level.puts || 0,
          callOpenInterest: level.call_oi || 0,
          putOpenInterest: level.put_oi || 0,
        }));
        
        // Log details about each transformed level
        transformedData.forEach((level, index) => {
          if (index < 5 || level.callVolume > 0 || level.putVolume > 0) {
            logWithTimestamp(`[VOLUME PROFILE] Level ${index}: Strike=${level.strike}, CallVol=${level.callVolume}, PutVol=${level.putVolume}, CallOI=${level.callOpenInterest}, PutOI=${level.putOpenInterest}`);
          }
        });
      }
      
      logWithTimestamp('[VOLUME PROFILE] Transformed data:', transformedData.length, 'levels');
      logWithTimestamp('[VOLUME PROFILE] Levels with volume:', transformedData.filter(l => l.callVolume > 0 || l.putVolume > 0).length);
      setVolumeProfileData(transformedData);
    } catch (err) {
      console.error("Failed to fetch volume profile data:", err);
      setVolumeProfileError(err.message);
    } finally {
      setVolumeProfileLoading(false);
    }
  };

  const refreshLayers = useCallback(async () => {
    if (!layers.length) {
      return;
    }
    const snapshot = layers;
    const results = await Promise.all(
      snapshot.map(async (layer) => {
        try {
          // Get the latest timestamp from existing points
          const latestPoint = layer.points && layer.points.length > 0
            ? layer.points[layer.points.length - 1]
            : null;
          const afterTimestamp = latestPoint ? latestPoint.fetched_at : null;
          
          logWithTimestamp(`[REFRESH] Layer ${layer.id} - Latest timestamp: ${afterTimestamp}`);
          
          const { points: newPoints, symbol, chainSymbol } = await fetchLayerTimeseries({
            chain: layer.chain,
            optionType: layer.optionType,
            strike: layer.strike,
            metric: layer.metric,
            rocWindowOverride: layer.rocWindow,
            afterTimestamp: afterTimestamp, // Only fetch data after this timestamp
          });
          
          // If we got new points, merge them with existing points
          let mergedPoints = layer.points || [];
          if (newPoints.length > 0) {
            if (afterTimestamp) {
              // Append new points to existing ones
              mergedPoints = [...mergedPoints, ...newPoints];
              logWithTimestamp(`[REFRESH] Layer ${layer.id} - Appended ${newPoints.length} new points to ${layer.points.length} existing points`);
            } else {
              // First fetch or full refresh
              mergedPoints = newPoints;
              logWithTimestamp(`[REFRESH] Layer ${layer.id} - Replaced with ${newPoints.length} points`);
            }
          } else {
            logWithTimestamp(`[REFRESH] Layer ${layer.id} - No new data`);
          }
          
          return {
            id: layer.id,
            data: {
              ...layer,
              points: mergedPoints,
              symbol,
              chainSymbol,
            },
          };
        } catch (error) {
          console.error(`[REFRESH] Layer ${layer.id} error:`, error);
          return { id: layer.id, error };
        }
      })
    );

    const updatedMap = new Map(
      results
        .filter((result) => result.data)
        .map((result) => [result.id, result.data])
    );

    setLayers((prev) =>
      prev.map((layer) => updatedMap.get(layer.id) ?? layer)
    );

    const errors = results.filter((result) => result.error);
    if (errors.length) {
      throw new Error(
        `Failed to refresh ${errors.length} ${errors.length === 1 ? "layer" : "layers"}`
      );
    }
  }, [layers]);

  const loadPreset = async (presetId, silent = false) => {
    if (!presetId) {
      return;
    }
    logWithTimestamp('[PRESET] Loading preset:', presetId);
    
    // Set the selected preset to show in the dropdown
    setSelectedPreset(presetId);
    
    // Clear all existing layers when applying a preset
    setLayers([]);
    logWithTimestamp('[PRESET] Cleared all existing layers');
    
    let presetChain = selectedChain;
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      // Extract date from chartStartTime if available
      const params = new URLSearchParams();
      if (chartStartTime) {
        // Convert chartStartTime to YYYY-MM-DD format
        const date = new Date(chartStartTime);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        params.set('date', dateStr);
        logWithTimestamp(`[PRESET] Using chart start date: ${dateStr}`);
      }
      
      const url = `${API_BASE}/presets/${presetId}${params.toString() ? '?' + params.toString() : ''}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = await res.json();
      logWithTimestamp('[PRESET] Preset data:', data);
      if (data.chain) {
        setSelectedChain(data.chain);
        presetChain = data.chain;
        
        // Set chart start time to 6 AM local on the preset chain's date
        const chainObj = chains.find(c => c.chain === data.chain);
        if (chainObj && chainObj.expiration) {
          const expirationDate = new Date(chainObj.expiration + 'T06:00:00');
          const year = expirationDate.getFullYear();
          const month = String(expirationDate.getMonth() + 1).padStart(2, '0');
          const day = String(expirationDate.getDate()).padStart(2, '0');
          const formattedTime = `${year}-${month}-${day}T06:00`;
          logWithTimestamp(`[APP] Setting chart start to 6 AM local for preset chain ${data.chain}: ${formattedTime}`);
          setChartStartTime(formattedTime);
        }
      }
      logWithTimestamp('[PRESET] Adding', data.layers?.length || 0, 'layers');
      
      if (data.layers && data.layers.length > 0) {
        // Initialize progress tracking
        setLoadingProgress({ current: 0, total: data.layers.length });
        
        // Load all layers in parallel for faster performance
        logWithTimestamp('[PRESET] Loading layers in parallel...');
        let completedCount = 0;
        
        const layerPromises = data.layers.map(async (layer, index) => {
          logWithTimestamp('[PRESET] Starting parallel load for layer:', layer);
          
          try {
            const { points, symbol, chainSymbol } = await fetchLayerTimeseries({
              chain: layer.chain || presetChain,
              optionType: layer.optionType,
              strike: layer.strike,
              metric: layer.metric || "volume",
              rocWindowOverride: layer.rocWindow,
            });
            
            // Update progress
            completedCount++;
            setLoadingProgress({ current: completedCount, total: data.layers.length });
            
            // Create layer object (similar to addLayer logic)
            const layerColor = getNextColor();
            const timestamp = Date.now();
            const id = `layer_${timestamp}_${Math.random().toString(16).slice(2)}`;
            
            return {
              id,
              createdAt: timestamp,
              chain: layer.chain || presetChain,
              optionType: layer.optionType,
              strike: layer.strike,
              metric: layer.metric || "volume",
              metricLabel: layer.metric === "volume_roc" ? `volume_roc (${layer.rocWindow})` : 
                          layer.metric === "price_change" ? "Price Change" :
                          layer.metric || "volume",
              symbol: symbol,
              chainSymbol: chainSymbol,
              color: layerColor,
              visible: true,
              points: points,
              lastPrice: points.length > 0 ? points[points.length - 1].last_price : null,
            };
          } catch (error) {
            console.error(`[PRESET] Failed to load layer ${layer.optionType} ${layer.strike}:`, error);
            // Still update progress even for failed layers
            completedCount++;
            setLoadingProgress({ current: completedCount, total: data.layers.length });
            return null; // Filter out failed layers
          }
        });
        
        // Wait for all layers to load in parallel
        const layerResults = await Promise.all(layerPromises);
        
        // Filter out any failed layers and batch update state
        const validLayers = layerResults.filter(layer => layer !== null);
        logWithTimestamp(`[PRESET] Successfully loaded ${validLayers.length} of ${data.layers.length} layers`);
        
        // Batch update - set all layers at once instead of one by one
        setLayers(validLayers);
        
        // Reset progress when complete
        setLoadingProgress({ current: 0, total: 0 });
      }
    } catch (err) {
      if (!silent) {
        setError(`Failed to load preset: ${err.message}`);
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
      setLastUpdated(new Date().toISOString());
    }
  };

  const removeLayer = (id) => {
    setLayers((prev) => prev.filter((layer) => layer.id !== id));
  };

  const toggleLayerVisibility = (id) => {
    setLayers((prev) =>
      prev.map((layer) =>
        layer.id === id ? { ...layer, visible: !layer.visible } : layer
      )
    );
  };

  const filteredLayers = useMemo(() => {
    return layers.filter((layer) => {
      const instrumentMatch = layerFilters.instrument
        ? (layer.chainSymbol || layer.chain || "")
            .toLowerCase()
            .includes(layerFilters.instrument.toLowerCase())
        : true;
      const optionMatch =
        layerFilters.optionType === "all"
          ? true
          : layer.optionType?.toLowerCase() === layerFilters.optionType.toLowerCase();
      const metricMatch =
        layerFilters.metric === "all"
          ? true
          : layer.metric?.toLowerCase() === layerFilters.metric.toLowerCase();
      const strikeVal = Number(layer.strike);
      const minOk = layerFilters.strikeMin
        ? !Number.isNaN(strikeVal) && strikeVal >= Number(layerFilters.strikeMin)
        : true;
      const maxOk = layerFilters.strikeMax
        ? !Number.isNaN(strikeVal) && strikeVal <= Number(layerFilters.strikeMax)
        : true;
      return instrumentMatch && optionMatch && metricMatch && minOk && maxOk;
    });
  }, [layers, layerFilters]);

  const sortedLayers = useMemo(() => {
    const entries = [...filteredLayers];
    const compareStr = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" });
    const direction = layerSortDir === "desc" ? -1 : 1;
    entries.sort((a, b) => {
      switch (layerSortKey) {
        case "instrument": {
          const left = a.chainSymbol || a.chain || "";
          const right = b.chainSymbol || b.chain || "";
          return compareStr(left, right) * direction;
        }
        case "strike": {
          const left = Number(a.strike ?? (direction === 1 ? Infinity : -Infinity));
          const right = Number(b.strike ?? (direction === 1 ? Infinity : -Infinity));
          return (left - right) * direction;
        }
        case "optionType": {
          const rank = (type) =>
            type?.toLowerCase() === "call" ? 0 : type?.toLowerCase() === "put" ? 1 : 2;
          return (rank(a.optionType) - rank(b.optionType)) * direction;
        }
        case "metric": {
          return compareStr(a.metric || "", b.metric || "") * direction;
        }
        case "volume": {
          // Get the latest non-null value for each layer
          const getLastValue = (layer) => {
            const lastPoint = layer.points
              ?.slice()
              .reverse()
              .find(pt => pt.value !== null);
            return lastPoint?.value ?? (direction === 1 ? -Infinity : Infinity);
          };
          const leftValue = getLastValue(a);
          const rightValue = getLastValue(b);
          return (leftValue - rightValue) * direction;
        }
        case "change": {
          // Sort by percentage value if available, fallback to absolute change
          const leftChange = getLatestChange(a);
          const rightChange = getLatestChange(b);
          const leftValue = leftChange?.percentage ?? leftChange?.absolute ?? (direction === 1 ? -Infinity : Infinity);
          const rightValue = rightChange?.percentage ?? rightChange?.absolute ?? (direction === 1 ? -Infinity : Infinity);
          return (leftValue - rightValue) * direction;
        }
        case "added":
        default: {
          const left = a.createdAt ?? 0;
          const right = b.createdAt ?? 0;
          return (left - right) * direction;
        }
      }
    });
    return entries;
  }, [filteredLayers, layerSortKey, layerSortDir]);

  const chartData = useMemo(() => {
    logWithTimestamp(`[CHART DATA] Building chart data from ${sortedLayers.length} layers`);
    const buildStart = performance.now();
    let totalPoints = 0;
    
    const map = new Map();
    sortedLayers.forEach((layer) => {
      logWithTimestamp(`[CHART DATA] Processing layer ${layer.chain} ${layer.strike} with ${layer.points.length} points`);
      totalPoints += layer.points.length;
      layer.points.forEach((pt) => {
        if (!map.has(pt.fetched_at)) {
          map.set(pt.fetched_at, {
            fetched_at: pt.fetched_at,
            label: pt.label,
          });
        }
        const row = map.get(pt.fetched_at);
        row[layer.id] = pt.value;
        // Store price_change with a special key
        row[`${layer.id}_price_change`] = pt.price_change;
      });
    });
    
    logWithTimestamp(`[CHART DATA] Total points processed: ${totalPoints}`);
    logWithTimestamp(`[CHART DATA] Unique timestamps: ${map.size}`);
    
    let rows = Array.from(map.values()).sort(
      (a, b) => new Date(a.fetched_at) - new Date(b.fetched_at)
    );
    if (chartStartTime) {
      const start = new Date(chartStartTime);
      logWithTimestamp(`[CHART DATA] Chart start time filter: ${start}`);
      logWithTimestamp(`[CHART DATA] Chart start time ISO: ${start.toISOString()}`);
      logWithTimestamp(`[CHART DATA] Chart start time ms: ${start.getTime()}`);
      
      if (rows.length > 0) {
        const firstRowDate = new Date(rows[0].fetched_at);
        const lastRowDate = new Date(rows[rows.length-1].fetched_at);
        logWithTimestamp(`[CHART DATA] First row: ${rows[0].fetched_at} -> ${firstRowDate} (${firstRowDate.getTime()}ms)`);
        logWithTimestamp(`[CHART DATA] Last row: ${rows[rows.length-1].fetched_at} -> ${lastRowDate} (${lastRowDate.getTime()}ms)`);
      }
      
      if (!Number.isNaN(start.getTime())) {
        const beforeFilter = rows.length;
        rows = rows.filter((row) => {
          const rowDate = new Date(row.fetched_at);
          const isAfterStart = rowDate >= start;
          if (!isAfterStart && rows.length < 10) {
            logWithTimestamp(`[CHART DATA] Filtered out: ${row.fetched_at} (${rowDate.getTime()}) < ${start.getTime()}`);
          }
          return isAfterStart;
        });
        logWithTimestamp(`[CHART DATA] Filtered ${beforeFilter - rows.length} rows due to start time`);
        
        if (rows.length === 0 && beforeFilter > 0) {
          console.warn('[CHART DATA] All data filtered out! This suggests a timezone issue.');
        }
      }
    }
    
    const buildEnd = performance.now();
    logWithTimestamp(`[CHART DATA] Built ${rows.length} chart data rows in ${(buildEnd - buildStart).toFixed(2)}ms`);
    logWithTimestamp(`[CHART DATA] Data size: ${JSON.stringify(rows).length / 1024}KB`);
    
    return rows;
  }, [sortedLayers, chartStartTime]);

  // Extract labels and timestamps for NQ chart synchronization
  const chartAxisData = useMemo(() => {
    const labels = chartData.map(row => {
      const time = new Date(row.fetched_at);
      return time.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      });
    });
    
    const timestamps = chartData.map(row => row.fetched_at);
    
    return { labels, timestamps };
  }, [chartData]);

  // Calculate shared price range for Y-axis synchronization
  const sharedPriceRange = useMemo(() => {
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    
    // Get min/max from NQ price data
    if (nqPriceData && nqPriceData.length > 0) {
      nqPriceData.forEach(point => {
        const price = point.price || point.value || 0;
        if (price > 0) {
          minPrice = Math.min(minPrice, price);
          maxPrice = Math.max(maxPrice, price);
        }
      });
    }
    
    // Get min/max from volume profile data (strikes)
    if (volumeProfileData && volumeProfileData.length > 0) {
      volumeProfileData.forEach(level => {
        const strike = level.strike || level.price || 0;
        if (strike > 0) {
          minPrice = Math.min(minPrice, strike);
          maxPrice = Math.max(maxPrice, strike);
        }
      });
    }
    
    // Add some padding (5% on each side)
    if (minPrice !== Infinity && maxPrice !== -Infinity) {
      const padding = (maxPrice - minPrice) * 0.05;
      return {
        min: minPrice - padding,
        max: maxPrice + padding
      };
    }
    
    return null;
  }, [nqPriceData, volumeProfileData]);


  const toggleLayerSort = (key) => {
    if (layerSortKey === key) {
      setLayerSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setLayerSortKey(key);
      setLayerSortDir("asc");
    }
  };

  const updateLayerFilter = (field, value) => {
    setLayerFilters((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const formatLastUpdated = (value) => {
    if (!value) {
      return "—";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "—";
    }
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  // Helper function to find closest strike price for volume profile synchronization
  const findClosestStrike = (price, volumeData) => {
    if (!volumeData || volumeData.length === 0 || !price) return -1;
    
    let closest = 0;
    let minDiff = Math.abs(volumeData[0].strike - price);
    
    volumeData.forEach((level, index) => {
      const diff = Math.abs(level.strike - price);
      if (diff < minDiff) {
        minDiff = diff;
        closest = index;
      }
    });
    
    return closest;
  };

  // Synchronized tooltips between option, NQ, and volume profile charts
  const syncTooltips = (sourceChart, targetChart, activeElements) => {
    if (!targetChart) return;
    
    if (activeElements.length > 0) {
      const index = activeElements[0].index;
      // Set active elements on target chart
      targetChart.tooltip.setActiveElements([{
        datasetIndex: 0,
        index: index
      }], {x: 0, y: 0});
      targetChart.setActiveElements([{
        datasetIndex: 0,
        index: index
      }]);
    } else {
      // Clear tooltips
      targetChart.tooltip.setActiveElements([], {x: 0, y: 0});
      targetChart.setActiveElements([]);
    }
    targetChart.update('none');
  };

  // Sync volume profile with NQ price hover
  const syncVolumeProfileWithPrice = (sourceChart, volumeProfileChart, activeElements) => {
    if (!volumeProfileChart || !nqPriceData || !volumeProfileData) return;
    
    if (activeElements.length > 0) {
      const index = activeElements[0].index;
      const currentPrice = nqPriceData[index]?.price || nqPriceData[index]?.value;
      
      if (currentPrice) {
        // Find closest strike price in volume profile data
        const strikeIndex = findClosestStrike(currentPrice, volumeProfileData);
        if (strikeIndex >= 0) {
          // Highlight the corresponding bar in volume profile
          volumeProfileChart.tooltip.setActiveElements([{
            datasetIndex: 0, // Call volume dataset
            index: strikeIndex
          }, {
            datasetIndex: 1, // Put volume dataset
            index: strikeIndex
          }], {x: 0, y: 0});
          volumeProfileChart.setActiveElements([{
            datasetIndex: 0,
            index: strikeIndex
          }, {
            datasetIndex: 1,
            index: strikeIndex
          }]);
        }
      }
    } else {
      // Clear tooltips
      volumeProfileChart.tooltip.setActiveElements([], {x: 0, y: 0});
      volumeProfileChart.setActiveElements([]);
    }
    volumeProfileChart.update('none');
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setError("");
    try {
      // These are quick and should always be refreshed to catch new chains/strikes
      await Promise.all([fetchChains(), fetchMetrics(), fetchPresets()]);
      if (selectedChain) {
        await fetchStrikes(selectedChain, optionType);
      }
      
      // Refresh layers incrementally
      await refreshLayers();
      
      // Also refresh NQ data incrementally if we have chart data
      if (!nqDisabled && chartData.length > 0) {
        await fetchNQHistorical(true); // Pass true for incremental update
      }
      
      setLastUpdated(new Date().toISOString());
    } catch (err) {
      setError(`Failed to refresh data: ${err.message}`);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="app">
      <header>
        <div className="header-row">
          <div>
            <h1>Option History Explorer</h1>
            <p>Select instrument, side, and strike to visualize.</p>
          </div>
          <div className="refresh-controls">
            <button
              className="refresh-btn"
              onClick={handleRefresh}
              disabled={refreshing || loading}
              type="button"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            <span className="last-updated">Last update: {formatLastUpdated(lastUpdated)}</span>
          </div>
        </div>
      </header>

          {error && (
            <div className="error" style={{ margin: '10px 0', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{error}</span>
              <button
                type="button"
                onClick={() => { setError(''); window.location.reload(); }}
                style={{ marginLeft: '12px', padding: '4px 12px', cursor: 'pointer', background: '#ff7043', color: '#fff', border: 'none', borderRadius: '4px' }}
              >
                Retry
              </button>
            </div>
          )}

          <section className="controls">
            <label>
              Instrument
              <select
                value={selectedChain}
                onChange={(e) => {
                  const newChain = e.target.value;
                  setSelectedChain(newChain);
                  
                  // Find the selected chain object to get its expiration date
                  const chainObj = chains.find(c => c.chain === newChain);
                  if (chainObj && chainObj.expiration) {
                    // Parse the expiration date and set time to 6 AM local
                    const expirationDate = new Date(chainObj.expiration + 'T06:00:00');
                    
                    // Convert to datetime-local format (local time without timezone)
                    const year = expirationDate.getFullYear();
                    const month = String(expirationDate.getMonth() + 1).padStart(2, '0');
                    const day = String(expirationDate.getDate()).padStart(2, '0');
                    const formattedTime = `${year}-${month}-${day}T06:00`;
                    
                    logWithTimestamp(`[APP] Setting chart start to 6 AM local on ${chainObj.expiration}: ${formattedTime}`);
                    setChartStartTime(formattedTime);
                  }
                }}
              >
                {chains.map((chainObj) => (
                  <option key={chainObj.chain} value={chainObj.chain}>
                    {chainObj.chain} - {formatExpirationDate(chainObj.expiration)}
                  </option>
                ))}
              </select>
            </label>

            <label className="start-time-control">
              Chart Start
              <div className="start-time-row">
                <input
                  type="datetime-local"
                  value={chartStartTime}
                  onChange={(e) => setChartStartTime(e.target.value)}
                />
                {chartStartTime && (
                  <button
                    type="button"
                    className="clear-start-btn"
                    onClick={() => setChartStartTime("")}
                  >
                    Clear
                  </button>
                )}
              </div>
            </label>

            <label>
              Preset Layers
              <div className="preset-row">
                <select
                  value={selectedPreset}
                  onChange={(e) => setSelectedPreset(e.target.value)}
                >
                  <option value="">Select preset</option>
                  {presets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
                <button
                  className="preset-btn"
                  onClick={() => loadPreset(selectedPreset)}
                  disabled={!selectedPreset}
                >
                  Apply
                </button>
              </div>
            </label>
          </section>


          {!!layers.length && (
            <section className="layers">
              <table className="layer-table">
                <thead>
                  <tr>
                    <th>
                      <button
                        type="button"
                        className={`sort-btn ${
                          layerSortKey === "instrument" ? "active" : ""
                        }`}
                        onClick={() => toggleLayerSort("instrument")}
                      >
                        Instrument
                        {layerSortKey === "instrument" && (
                          <span>{layerSortDir === "asc" ? "↑" : "↓"}</span>
                        )}
                      </button>
                    </th>
                    <th>
                      <button
                        type="button"
                        className={`sort-btn ${layerSortKey === "strike" ? "active" : ""}`}
                        onClick={() => toggleLayerSort("strike")}
                      >
                        Strike
                        {layerSortKey === "strike" && (
                          <span>{layerSortDir === "asc" ? "↑" : "↓"}</span>
                        )}
                      </button>
                    </th>
                    <th>
                      <button
                        type="button"
                        className={`sort-btn ${
                          layerSortKey === "optionType" ? "active" : ""
                        }`}
                        onClick={() => toggleLayerSort("optionType")}
                      >
                        Call / Put
                        {layerSortKey === "optionType" && (
                          <span>{layerSortDir === "asc" ? "↑" : "↓"}</span>
                        )}
                      </button>
                    </th>
                    <th>
                      <button
                        type="button"
                        className={`sort-btn ${layerSortKey === "metric" ? "active" : ""}`}
                        onClick={() => toggleLayerSort("metric")}
                      >
                        Metric
                        {layerSortKey === "metric" && (
                          <span>{layerSortDir === "asc" ? "↑" : "↓"}</span>
                        )}
                      </button>
                    </th>
                    <th>
                      <button
                        type="button"
                        className={`sort-btn ${layerSortKey === "volume" ? "active" : ""}`}
                        onClick={() => toggleLayerSort("volume")}
                      >
                        Volume
                        {layerSortKey === "volume" && (
                          <span>{layerSortDir === "asc" ? "↑" : "↓"}</span>
                        )}
                      </button>
                    </th>
                    <th>
                      <button
                        type="button"
                        className={`sort-btn ${layerSortKey === "change" ? "active" : ""}`}
                        onClick={() => toggleLayerSort("change")}
                      >
                        Change
                        {layerSortKey === "change" && (
                          <span>{layerSortDir === "asc" ? "↑" : "↓"}</span>
                        )}
                      </button>
                    </th>
                    <th>
                      Actions
                      <button
                        className="icon-btn"
                        onClick={() => {
                          const hasVisibleLayers = layers.some(layer => layer.visible !== false);
                          setLayers(prev => prev.map(layer => ({ ...layer, visible: !hasVisibleLayers })));
                        }}
                        title={layers.some(layer => layer.visible !== false) ? "Hide All" : "Show All"}
                        style={{
                          marginLeft: '10px',
                          background: 'transparent',
                          border: '1px solid #ccc',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          padding: '2px 6px',
                          fontSize: '16px'
                        }}
                      >
                        {layers.some(layer => layer.visible !== false) ? '👁' : '👁️‍🗨️'}
                      </button>
                      <button
                        className="icon-btn"
                        onClick={() => setLayers([])}
                        title="Remove All"
                        style={{
                          marginLeft: '5px',
                          background: 'transparent',
                          border: '1px solid #ccc',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          padding: '2px 6px',
                          fontSize: '16px'
                        }}
                      >
                        ✕
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLayers.map((layer) => (
                    <tr key={layer.id}>
                      <td>
                        <span
                          className="layer-color-dot"
                          style={{ backgroundColor: layer.color }}
                        />
                        {(() => {
                          const symbol = layer.chainSymbol || layer.chain;
                          const barchartUrl = generateBarchartUrl(symbol, layer.strike, layer.optionType);
                          const expiration = getChainExpiration(layer.chain, chains);
                          const displayText = `${symbol || "—"}${expiration ? ` (${formatExpirationDate(expiration)})` : ''}`;
                          
                          if (barchartUrl) {
                            return (
                              <a 
                                href={barchartUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="symbol-link"
                                title={`View ${symbol} ${layer.strike} ${layer.optionType} on Barchart`}
                              >
                                {displayText}
                              </a>
                            );
                          }
                          return <span>{displayText}</span>;
                        })()}
                      </td>
                      <td>{layer.strike ?? "—"}</td>
                      <td>{layer.optionType ?? "—"}</td>
                      <td>{layer.metricLabel || layer.metric}</td>
                      <td>
                        {(() => {
                          // Get the latest non-null value from the layer's points
                          const lastValue = layer.points
                            ?.slice()
                            .reverse()
                            .find(pt => pt.value !== null)?.value;
                          return lastValue !== undefined ? lastValue.toLocaleString() : "—";
                        })()}
                      </td>
                      <td>
                        {(() => {
                          const change = getLatestChange(layer);
                          if (!change || change.price_change === null || change.price_change === undefined) {
                            return <span style={{ color: '#999' }}>—</span>;
                          }
                          
                          const priceChange = change.price_change;
                          const changeColor = '#cbd5f5'; // neutral color for all changes
                          const changeSign = priceChange > 0 ? '+' : '';
                          
                          // Show only percentage if available
                          if (change.percentage !== null && change.percentage !== undefined) {
                            const percentageSign = change.percentage > 0 ? '+' : '';
                            const tooltipText = `Price Change: ${changeSign}$${Math.abs(priceChange).toFixed(2)}\n` +
                                                `Current Price: $${change.current.toLocaleString()}\n` +
                                                `Previous Price: $${(change.current - priceChange).toLocaleString()}`;
                            
                            return (
                              <span style={{ color: changeColor, cursor: 'help' }} title={tooltipText}>
                                {percentageSign}{change.percentage.toFixed(2)}%
                              </span>
                            );
                          } else {
                            // Fallback to dollar amount if no percentage
                            return (
                              <span style={{ color: changeColor }}>
                                {changeSign}${priceChange.toFixed(2)}
                              </span>
                            );
                          }
                        })()}
                      </td>
                      <td>
                        <div className="layer-actions">
                          <button
                            className="toggle-btn"
                            onClick={() => toggleLayerVisibility(layer.id)}
                          >
                            {layer.visible ? "Hide" : "Show"}
                          </button>
                          <button className="remove-btn" onClick={() => removeLayer(layer.id)}>
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="chart">
            {loading ? (
              <div className="loading">
                {loadingProgress.total > 0 
                  ? `Loading layers ${loadingProgress.current}/${loadingProgress.total}...`
                  : "Loading…"
                }
              </div>
            ) : sortedLayers.length > 0 && chartData.length === 0 && chartStartTime ? (
              <div style={{
                backgroundColor: '#fef3c7',
                border: '1px solid #f59e0b',
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '20px',
                color: '#92400e'
              }}>
                <h4 style={{ margin: '0 0 8px 0' }}>No data visible</h4>
                <p style={{ margin: '0 0 12px 0' }}>
                  All data is filtered out. Chart start time ({new Date(chartStartTime).toLocaleString()}) 
                  is after the latest data point.
                </p>
                <button
                  onClick={() => setChartStartTime("")}
                  style={{
                    backgroundColor: '#f59e0b',
                    color: 'white',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Clear Time Filter
                </button>
              </div>
            ) : chartData.length > 0 && sortedLayers.length > 0 ? (
              <>
                {/* SVG Chart Implementation - Commented Out */}
                {/*
                <div style={{ marginBottom: '20px' }}>
                  <button
                    type="button"
                    onClick={() => setShowSVGChart(!showSVGChart)}
                    style={{
                      backgroundColor: '#334155',
                      color: '#cbd5f5',
                      border: '1px solid #475569',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '14px'
                    }}
                  >
                    {showSVGChart ? 'Hide' : 'Show'} SVG Chart
                  </button>
                </div>
                {showSVGChart && (
                  <div style={{ marginBottom: '40px' }}>
                    <h3 style={{ color: '#cbd5f5', marginBottom: '20px' }}>SVG Implementation</h3>
                    <SimpleChart chartData={chartData} sortedLayers={sortedLayers} />
                  </div>
                )}
                */}
                <div>
                  <h3 style={{ color: '#cbd5f5', marginBottom: '20px' }}>Chart.js Implementation</h3>
                  <ErrorBoundary>
                    <ChartJSChart 
                      chartData={chartData} 
                      sortedLayers={sortedLayers} 
                      optionChartRef={optionChartRef}
                      nqChartRef={nqChartRef}
                      syncTooltips={syncTooltips}
                    />
                  </ErrorBoundary>
                </div>
                {/* NQ Futures Price Chart */}
                {!nqDisabled && (
                  <div style={{ marginTop: '40px' }}>
                    <h3 style={{ color: '#cbd5f5', marginBottom: '20px' }}>NQ Futures Price</h3>
                    {nqLoading ? (
                      <div style={{ 
                        backgroundColor: '#1a1f2e', 
                        padding: '20px', 
                        borderRadius: '8px',
                        height: '300px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#cbd5f5'
                      }}>
                        Loading NQ data...
                      </div>
                    ) : nqError ? (
                      <div style={{ 
                        backgroundColor: '#1a1f2e', 
                        padding: '20px', 
                        borderRadius: '8px',
                        color: '#cbd5f5'
                      }}>
                        {nqError}
                      </div>
                    ) : (
                      <div>
                        {nqHistoricalNote && (
                          <div style={{
                            backgroundColor: '#fef3c7',
                            color: '#92400e',
                            padding: '8px 12px',
                            borderRadius: '4px',
                            marginBottom: '10px',
                            fontSize: '14px'
                          }}>
                            {nqHistoricalNote}
                          </div>
                        )}
                        <div className="nq-charts-container">
                          <div className={isV2Route || isV3Route ? "nq-chart-wrapper" : "nq-chart-wrapper-full"}>
                            {isV3Route ? (
                              <NQPriceChartWithVolume 
                                ref={nqChartRef}
                                data={nqPriceData} 
                                volumeData={volumeProfileData}
                                startTime={chartStartTime}
                                labels={chartAxisData.labels}
                                timestamps={chartAxisData.timestamps}
                                priceRange={sharedPriceRange}
                                volumeBarPosition="right"
                                onHoverSync={(chart, activeElements) => {
                                  // Sync with options chart
                                  if (optionChartRef.current) {
                                    syncTooltips(chart, optionChartRef.current, activeElements);
                                  }
                                }}
                              />
                            ) : (
                              <NQPriceChart 
                                ref={nqChartRef}
                                data={nqPriceData} 
                                startTime={chartStartTime}
                                labels={chartAxisData.labels}
                                timestamps={chartAxisData.timestamps}
                                priceRange={sharedPriceRange}
                                onHoverSync={(chart, activeElements) => {
                                  // Sync with options chart
                                  if (optionChartRef.current) {
                                    syncTooltips(chart, optionChartRef.current, activeElements);
                                  }
                                  // Sync with volume profile chart
                                  if (volumeProfileChartRef.current) {
                                    syncVolumeProfileWithPrice(chart, volumeProfileChartRef.current, activeElements);
                                  }
                                }}
                              />
                            )}
                          </div>
                          {isV2Route && (
                            <div className="volume-profile-wrapper">
                              <VolumeProfile
                                ref={volumeProfileChartRef}
                                data={volumeProfileData}
                                loading={volumeProfileLoading}
                                error={volumeProfileError}
                                priceRange={sharedPriceRange}
                                showPOC={true}
                                showValueArea={true}
                                onHoverSync={(chart, activeElements) => {
                                  // Optional: Add volume profile to NQ chart synchronization in the future
                                  // For now, just log the interaction
                                  if (activeElements.length > 0) {
                                    const strikeData = volumeProfileData[activeElements[0].index];
                                    console.log('[VOLUME PROFILE] Hovering over strike:', strikeData?.strike);
                                  }
                                }}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="empty">Add a layer to begin</div>
            )}
          </section>

    </div>
  );
}

// SVG SimpleChart Component - Removed to prevent Chart.js conflicts
// The SVG chart implementation has been removed to maintain clean UI
// and prevent potential conflicts with Chart.js rendering

// Chart.js Chart Component
function ChartJSChart({ chartData, sortedLayers, optionChartRef, nqChartRef, syncTooltips }) {
  try {
    const renderStart = performance.now();
    logWithTimestamp(`[CHART] Starting Chart.js render with ${chartData.length} data points and ${sortedLayers.length} layers`);
    
    logWithTimestamp(`[CHART] All layers:`, sortedLayers.map(l => ({ 
      id: l.id, 
      chain: l.chain, 
      strike: l.strike, 
      visible: l.visible,
      points: l.points.length 
    })));
    const visibleLayers = sortedLayers.filter(layer => layer.visible !== false);
    logWithTimestamp(`[CHART] ${visibleLayers.length} visible layers after filter`);
  
  // Prepare data for Chart.js
  const labels = chartData.map(row => {
    const time = new Date(row.fetched_at);
    return time.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
  });
  
  // Extract timestamps for NQ chart synchronization
  const timestamps = chartData.map(row => row.fetched_at);
  
  logWithTimestamp(`[CHART] Building datasets...`);
  const datasetStart = performance.now();
  
  const datasets = visibleLayers.map((layer, idx) => {
    logWithTimestamp(`[CHART] Processing layer ${idx + 1}/${visibleLayers.length}: ${layer.chain} ${layer.strike}`);
    const priceChangeKey = `${layer.id}_price_change`;
    return {
    label: `${layer.strike} | ${layer.optionType?.[0] ?? ''}`,
    data: chartData.map(row => row[layer.id] ?? null),
    borderColor: layer.color,
    backgroundColor: `${layer.color}33`, // Add transparency
    borderWidth: 2,
    borderDash: layer.optionType === 'Put' ? [5, 5] : [],
    tension: 0.1,
    pointRadius: 4,
    pointHoverRadius: 6,
    pointStyle: layer.optionType === 'Put' ? 'triangle' : 'circle',
    fill: false,
    strike: layer.strike, // Store strike for the plugin
    _priceChangeData: chartData.map(row => row[priceChangeKey] ?? null), // Store price_change data
    _lastPriceData: chartData.map(row => {
      // Find the corresponding last_price data for this layer at this timestamp
      const point = layer.points.find(pt => pt.fetched_at === row.fetched_at);
      return point?.last_price ?? null;
    })
    };
  });
  
  const datasetEnd = performance.now();
  logWithTimestamp(`[CHART] Datasets built in ${(datasetEnd - datasetStart).toFixed(2)}ms`);
  
  // Custom plugin to draw strike labels at the end of lines
  const strikeLabelsPlugin = {
    id: 'strikeLabels',
    afterDatasetsDraw: function(chart) {
      const ctx = chart.ctx;
      chart.data.datasets.forEach((dataset, i) => {
        const meta = chart.getDatasetMeta(i);
        if (!meta.hidden && meta.data.length > 0) {
          // Find the last non-null data point
          let lastPointIndex = meta.data.length - 1;
          while (lastPointIndex >= 0 && dataset.data[lastPointIndex] === null) {
            lastPointIndex--;
          }
          
          if (lastPointIndex >= 0) {
            const lastPoint = meta.data[lastPointIndex];
            if (lastPoint && dataset.strike) {
              ctx.save();
              ctx.fillStyle = dataset.borderColor;
              ctx.font = 'bold 12px sans-serif';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.fillText(dataset.strike, lastPoint.x + 10, lastPoint.y);
              ctx.restore();
            }
          }
        }
      });
    }
  };
  
  const optionChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    layout: {
      padding: {
        right: 50 // Add padding for strike labels
      }
    },
    interaction: {
      mode: 'index',
      intersect: false,
    },
    onHover: (event, activeElements, chart) => {
      if (nqChartRef.current) {
        syncTooltips(chart, nqChartRef.current, activeElements);
      }
    },
    plugins: {
      title: {
        display: false
      },
      legend: {
        display: true,
        position: 'top',
        labels: {
          color: '#cbd5f5',
          font: {
            size: 12
          },
          usePointStyle: true
        }
      },
      tooltip: {
        enabled: false, // Disable default tooltip
        external: function(context) {
          // Get or create custom tooltip element
          let tooltipEl = document.getElementById('chartjs-tooltip');
          
          if (!tooltipEl) {
            tooltipEl = document.createElement('div');
            tooltipEl.id = 'chartjs-tooltip';
            tooltipEl.style.background = '#1e293b';
            tooltipEl.style.borderRadius = '6px';
            tooltipEl.style.color = '#cbd5f5';
            tooltipEl.style.opacity = 0;
            tooltipEl.style.pointerEvents = 'none';
            tooltipEl.style.position = 'absolute';
            tooltipEl.style.transition = 'all 0.1s ease';
            tooltipEl.style.padding = '12px';
            tooltipEl.style.border = '1px solid #334155';
            tooltipEl.style.fontSize = '14px';
            tooltipEl.style.fontFamily = 'Arial, sans-serif';
            tooltipEl.style.zIndex = '1000';
            document.body.appendChild(tooltipEl);
          }
          
          const tooltipModel = context.tooltip;
          
          if (tooltipModel.opacity === 0) {
            tooltipEl.style.opacity = 0;
            return;
          }
          
          if (tooltipModel.body) {
            const dataPoints = tooltipModel.dataPoints;
            
            let innerHtml = '';
            
            // Add title if present
            if (tooltipModel.title && tooltipModel.title[0]) {
              innerHtml += '<div style="margin-bottom: 6px; font-weight: bold;">' + tooltipModel.title[0] + '</div>';
            }
            
            dataPoints.forEach(function(dataPoint) {
              const dataset = dataPoint.dataset;
              const dataIndex = dataPoint.dataIndex;
              const label = dataset.label;
              const value = dataPoint.formattedValue;
              const lineColor = dataset.borderColor || '#cbd5f5';
              
              // Calculate percentage if data exists
              let percentageHtml = '';
              if (dataset._priceChangeData && dataset._priceChangeData[dataIndex] !== null && 
                  dataset._priceChangeData[dataIndex] !== undefined && 
                  dataset._lastPriceData && dataset._lastPriceData[dataIndex] !== null) {
                
                const priceChange = dataset._priceChangeData[dataIndex];
                const lastPrice = dataset._lastPriceData[dataIndex];
                const previousPrice = lastPrice - priceChange;
                
                if (previousPrice !== 0) {
                  const percentage = (priceChange / previousPrice) * 100;
                  const sign = percentage >= 0 ? '+' : '';
                  const percentageColor = percentage >= 0 ? '#10b981' : '#ef4444'; // green or red
                  
                  percentageHtml = ' <span style="color: ' + percentageColor + '; font-weight: bold;">(' + sign + percentage.toFixed(2) + '%)</span>';
                }
              }
              
              // Create line with line color for label/value and percentage color for percentage
              innerHtml += '<div style="margin: 2px 0;">' +
                '<span style="color: ' + lineColor + '; font-weight: bold;">' + label + ':</span> ' +
                '<span style="color: ' + lineColor + ';">' + value + '</span>' +
                percentageHtml +
                '</div>';
            });
            
            tooltipEl.innerHTML = innerHtml;
          }
          
          // Position tooltip
          const position = context.chart.canvas.getBoundingClientRect();
          const bodyFont = tooltipModel.options.bodyFont;
          
          tooltipEl.style.opacity = 1;
          tooltipEl.style.left = position.left + window.pageXOffset + tooltipModel.caretX + 'px';
          tooltipEl.style.top = position.top + window.pageYOffset + tooltipModel.caretY + 'px';
          tooltipEl.style.font = bodyFont.string;
        }
      }
    },
    scales: {
      x: {
        grid: {
          color: '#334155',
          drawBorder: true,
          borderDash: [3, 3]
        },
        ticks: {
          color: '#cbd5f5',
          maxTicksLimit: 8
        },
        title: {
          display: true,
          text: 'Time',
          color: '#cbd5f5'
        }
      },
      y: {
        grid: {
          color: '#334155',
          drawBorder: true,
          borderDash: [3, 3]
        },
        ticks: {
          color: '#cbd5f5',
          callback: function(value) {
            return value.toLocaleString();
          }
        },
        title: {
          display: true,
          text: 'Value',
          color: '#cbd5f5'
        }
      }
    }
  };
  
  React.useEffect(() => {
    const renderEnd = performance.now();
    logWithTimestamp(`[CHART] Chart.js component rendered in ${(renderEnd - renderStart).toFixed(2)}ms`);
  }, []);
  
  return (
    <div style={{ 
      backgroundColor: '#1a1f2e', 
      padding: '20px', 
      borderRadius: '8px',
      height: '400px'
    }}>
      <Line 
        ref={optionChartRef}
        data={{ labels, datasets }} 
        options={optionChartOptions} 
        plugins={[strikeLabelsPlugin]}
      />
    </div>
  );
  } catch (error) {
    console.error('[CHART] Error in ChartJSChart component:', error);
    console.error('[CHART] Error stack:', error.stack);
    return (
      <div style={{
        backgroundColor: '#ff0000',
        color: 'white',
        padding: '20px',
        borderRadius: '8px'
      }}>
        Chart Error: {error.message}
      </div>
    );
  }
}

export default App;
