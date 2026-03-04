import React from 'react';
import { Line } from 'react-chartjs-2';
import 'chart.js/auto';

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

// NQ Price Chart Component
const NQPriceChart = React.forwardRef(({ data, startTime, onHoverSync, labels, timestamps, priceRange }, ref) => {
  logWithTimestamp('[NQ CHART] Rendering with:', { 
    dataLength: data?.length, 
    labelsLength: labels?.length, 
    timestampsLength: timestamps?.length 
  });

  if (!data || data.length === 0) {
    return (
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
        No NQ futures data available (Found {data ? data.length : 0} points)
      </div>
    );
  }

  // Map NQ data to option chart timestamps if labels provided
  let mappedData;
  try {
    if (labels && timestamps) {
      logWithTimestamp('[NQ CHART] Mapping data to option timestamps');
      // Create a map of NQ data by timestamp for quick lookup
      const nqDataMap = new Map();
      const normalizeTimestamp = (raw) => {
        if (!raw) return null;
        return raw.includes('Z') ? raw : `${raw}Z`;
      };
      data.forEach(point => {
        const timestamp = normalizeTimestamp(point.fetched_at || point.timestamp);
        if (timestamp) {
          nqDataMap.set(timestamp, point.price || point.value || 0);
        }
      });
      logWithTimestamp('[NQ CHART] Created NQ data map with', nqDataMap.size, 'entries');
      
      // Debug: log a few timestamps from each dataset
      logWithTimestamp('[NQ CHART] Sample option timestamps:', timestamps.slice(0, 3));
      logWithTimestamp('[NQ CHART] Sample NQ timestamps:', Array.from(nqDataMap.keys()).slice(0, 3));
      
      // Map to option timestamps, using null for missing data
      mappedData = timestamps.map(timestamp => {
        // Try exact match first
        if (nqDataMap.has(timestamp)) {
          return nqDataMap.get(timestamp);
        }
        
        // Find closest timestamp within 10 minutes (increased window)
        const targetTime = new Date(timestamp).getTime();
        let closestValue = null;
        let closestDiff = 10 * 60 * 1000; // 10 minutes in ms
        
        for (const [nqTimestamp, value] of nqDataMap) {
          const diff = Math.abs(new Date(nqTimestamp).getTime() - targetTime);
          if (diff < closestDiff) {
            closestDiff = diff;
            closestValue = value;
          }
        }
        
        return closestValue;
      });
      
      const validPoints = mappedData.filter(v => v !== null).length;
      logWithTimestamp('[NQ CHART] Mapped', validPoints, 'valid points out of', timestamps.length, 'timestamps');
    } else {
      logWithTimestamp('[NQ CHART] Using original data mapping');
      // Fallback to original data if no labels provided
      mappedData = data.map(point => point.price || point.value || 0);
    }
  } catch (error) {
    console.error('[NQ CHART] Error mapping data:', error);
    mappedData = data.map(point => point.price || point.value || 0);
  }

  // Use provided labels or generate own
  const chartData = {
    labels: labels || data.map(point => {
      const time = new Date(point.timestamp || point.fetched_at);
      return time.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      });
    }),
    datasets: [{
      label: 'NQ Futures Price',
      data: mappedData,
      borderColor: '#17BECF',
      backgroundColor: '#17BECF20',
      borderWidth: 2,
      fill: false,
      spanGaps: true, // Connect lines across null values
    }]
  };
  
  const nqChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    onHover: (event, activeElements, chart) => {
      if (onHoverSync) {
        onHoverSync(chart, activeElements);
      }
    },
    scales: {
      x: {
        grid: {
          color: '#334155',
        },
        ticks: {
          color: '#cbd5f5',
          maxTicksLimit: 8
        },
      },
      y: {
        grid: {
          color: '#334155',
        },
        ticks: {
          color: '#cbd5f5',
        },
        ...(priceRange ? {
          min: priceRange.min,
          max: priceRange.max
        } : {})
      }
    },
    plugins: {
      legend: {
        labels: {
          color: '#cbd5f5'
        }
      },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: '#1e293b',
        titleColor: '#cbd5f5',
        bodyColor: '#cbd5f5',
        borderColor: '#334155',
        borderWidth: 1
      }
    }
  };
  
  return (
    <div style={{ 
      backgroundColor: '#1a1f2e', 
      padding: '20px', 
      borderRadius: '8px',
      height: '300px'
    }}>
      <Line ref={ref} data={chartData} options={nqChartOptions} />
    </div>
  );
});

NQPriceChart.displayName = 'NQPriceChart';

export default NQPriceChart;