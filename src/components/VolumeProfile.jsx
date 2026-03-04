import React, { useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  LineElement,
  PointElement,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import zoomPlugin from 'chartjs-plugin-zoom';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  LineElement,
  PointElement,
  annotationPlugin,
  zoomPlugin
);

// Helper function to calculate Point of Control (price level with highest volume)
export const calculatePOC = (volumeData) => {
  if (!volumeData || volumeData.length === 0) return null;
  
  let maxVolume = 0;
  let pocPrice = null;
  
  volumeData.forEach(level => {
    const totalVolume = (level.callVolume || 0) + (level.putVolume || 0);
    if (totalVolume > maxVolume) {
      maxVolume = totalVolume;
      pocPrice = level.strike || level.price;
    }
  });
  
  return pocPrice;
};

// Helper function to calculate Value Area (price range containing 70% of volume)
export const calculateValueArea = (volumeData, percentage = 0.7) => {
  if (!volumeData || volumeData.length === 0) return { high: null, low: null };
  
  // Calculate total volume and create sorted array by volume
  const volumeLevels = volumeData.map(level => ({
    price: level.strike || level.price,
    volume: (level.callVolume || 0) + (level.putVolume || 0)
  })).filter(level => level.volume > 0);
  
  const totalVolume = volumeLevels.reduce((sum, level) => sum + level.volume, 0);
  const targetVolume = totalVolume * percentage;
  
  // Sort by volume descending
  volumeLevels.sort((a, b) => b.volume - a.volume);
  
  // Find price levels that contain target volume
  let accumulatedVolume = 0;
  const valueAreaPrices = [];
  
  for (const level of volumeLevels) {
    accumulatedVolume += level.volume;
    valueAreaPrices.push(level.price);
    if (accumulatedVolume >= targetVolume) break;
  }
  
  return {
    high: Math.max(...valueAreaPrices),
    low: Math.min(...valueAreaPrices)
  };
};

const VolumeProfile = React.forwardRef(({ 
  data, 
  priceRange,
  onPriceRangeUpdate,
  onHoverSync,
  height = '300px',
  showPOC = true,
  showValueArea = true,
  loading = false,
  error = null
}, ref) => {
  // State to track dataset visibility
  const [datasetVisibility, setDatasetVisibility] = useState({
    callVolume: true,
    putVolume: true
  });

  // Toggle dataset visibility
  const toggleDataset = (dataset) => {
    setDatasetVisibility(prev => ({
      ...prev,
      [dataset]: !prev[dataset]
    }));
  };

  // Log incoming data
  React.useEffect(() => {
    console.log('[VolumeProfile] Received data:', data);
    if (data && data.length > 0) {
      console.log('[VolumeProfile] Data length:', data.length);
      console.log('[VolumeProfile] First 5 levels:', data.slice(0, 5));
      console.log('[VolumeProfile] Levels with volume:', data.filter(l => (l.callVolume || 0) > 0 || (l.putVolume || 0) > 0));
    }
  }, [data]);

  // Reset zoom when data changes
  React.useEffect(() => {
    if (ref && ref.current && data) {
      ref.current.resetZoom();
    }
  }, [data, ref]);
  
  // Calculate POC and Value Area
  const poc = useMemo(() => calculatePOC(data), [data]);
  const valueArea = useMemo(() => calculateValueArea(data), [data]);
  
  // Prepare chart data
  const chartData = useMemo(() => {
    if (!data || data.length === 0) {
      return {
        labels: [],
        datasets: []
      };
    }
    
    // Sort data by strike price
    const sortedData = [...data].sort((a, b) => 
      (a.strike || a.price || 0) - (b.strike || b.price || 0)
    );
    
    console.log('[VolumeProfile] Sorted data for chart:', sortedData);
    
    const labels = sortedData.map(level => 
      `$${(level.strike || level.price || 0).toLocaleString()}`
    );
    
    const callVolumeData = sortedData.map(level => level.callVolume || 0);
    const putVolumeData = sortedData.map(level => level.putVolume || 0);
    
    console.log('[VolumeProfile] Chart labels:', labels);
    console.log('[VolumeProfile] Call volume data:', callVolumeData);
    console.log('[VolumeProfile] Put volume data:', putVolumeData);
    console.log('[VolumeProfile] POC calculated:', poc);
    console.log('[VolumeProfile] Value Area:', valueArea);
    
    const datasets = [];
    
    if (datasetVisibility.callVolume) {
      datasets.push({
        label: 'Call Volume',
        data: callVolumeData,
        backgroundColor: 'rgba(34, 197, 94, 0.6)', // Green
        borderColor: 'rgba(34, 197, 94, 1)',
        borderWidth: 1,
        barPercentage: 0.9,
        categoryPercentage: 1.0,
      });
    }
    
    if (datasetVisibility.putVolume) {
      datasets.push({
        label: 'Put Volume',
        data: putVolumeData,
        backgroundColor: 'rgba(239, 68, 68, 0.6)', // Red
        borderColor: 'rgba(239, 68, 68, 1)',
        borderWidth: 1,
        barPercentage: 0.9,
        categoryPercentage: 1.0,
      });
    }

    return {
      labels,
      datasets
    };
  }, [data, poc, valueArea, datasetVisibility]);
  
  // Chart options with POC and Value Area annotations
  const chartOptions = useMemo(() => ({
    indexAxis: 'y', // Horizontal bars
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
    layout: {
      padding: {
        right: 10
      }
    },
    scales: {
      x: {
        stacked: true,
        grid: {
          display: true,
          color: '#334155',
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
          text: 'Volume',
          color: '#cbd5f5'
        }
      },
      y: {
        stacked: true,
        grid: {
          display: false
        },
        ticks: {
          color: '#cbd5f5',
          font: {
            size: 11
          },
          autoSkip: false,
          maxRotation: 0,
          minRotation: 0
        },
        title: {
          display: true,
          text: 'Strike Price',
          color: '#cbd5f5'
        }
      }
    },
    plugins: {
      legend: {
        display: false // Hide default legend, we'll create custom one
      },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: '#1e293b',
        titleColor: '#cbd5f5',
        bodyColor: '#cbd5f5',
        borderColor: '#334155',
        borderWidth: 1,
        callbacks: {
          label: function(context) {
            const label = context.dataset.label || '';
            const value = context.parsed.x || 0;
            return `${label}: ${value.toLocaleString()}`;
          },
          afterLabel: function(context) {
            if (context.dataIndex >= 0 && data && data[context.dataIndex]) {
              const level = data[context.dataIndex];
              const totalVolume = (level.callVolume || 0) + (level.putVolume || 0);
              return `Total: ${totalVolume.toLocaleString()}`;
            }
            return '';
          }
        }
      },
      annotation: {
        annotations: {
          ...(showPOC && poc ? {
            pocLine: {
              type: 'line',
              yMin: `$${poc.toLocaleString()}`,
              yMax: `$${poc.toLocaleString()}`,
              borderColor: 'rgba(251, 191, 36, 1)', // Amber
              borderWidth: 2,
              borderDash: [5, 5],
              label: {
                display: true,
                content: 'POC',
                position: 'end',
                backgroundColor: 'rgba(251, 191, 36, 0.8)',
                color: 'white',
                font: {
                  size: 11,
                  weight: 'bold'
                }
              }
            }
          } : {}),
          ...(showValueArea && valueArea.high && valueArea.low ? {
            valueArea: {
              type: 'box',
              yMin: `$${valueArea.low.toLocaleString()}`,
              yMax: `$${valueArea.high.toLocaleString()}`,
              backgroundColor: 'rgba(147, 51, 234, 0.1)', // Purple
              borderColor: 'rgba(147, 51, 234, 0.5)',
              borderWidth: 1,
              borderDash: [3, 3],
              label: {
                display: true,
                content: 'Value Area (70%)',
                position: 'start',
                color: 'rgba(147, 51, 234, 1)',
                font: {
                  size: 10,
                  weight: 'bold'
                }
              }
            }
          } : {})
        }
      },
      zoom: {
        zoom: {
          wheel: {
            enabled: true,
            modifierKey: 'shift', // Require Shift+wheel to zoom
          },
          pinch: {
            enabled: true
          },
          mode: 'y', // Only zoom Y-axis (strike prices)
          scaleMode: 'y', // Scale only the Y axis
        },
        pan: {
          enabled: true,
          mode: 'y', // Only pan Y-axis
          wheel: {
            enabled: true,
            modifierKey: 'ctrl', // Require Ctrl+wheel to pan
          }
        },
        limits: {
          y: {
            min: 'original',
            max: 'original'
          }
        }
      },
      onDoubleClick: function(event, activeElements, chart) {
        chart.resetZoom();
      }
    }
  }), [data, poc, valueArea, showPOC, showValueArea, priceRange]);
  
  if (loading) {
    return (
      <div style={{ 
        backgroundColor: '#1a1f2e', 
        padding: '20px', 
        borderRadius: '8px',
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#cbd5f5'
      }}>
        Loading volume profile...
      </div>
    );
  }
  
  if (error) {
    return (
      <div style={{ 
        backgroundColor: '#1a1f2e', 
        padding: '20px', 
        borderRadius: '8px',
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#ef4444'
      }}>
        Error: {error}
      </div>
    );
  }
  
  if (!data || data.length === 0) {
    return (
      <div style={{ 
        backgroundColor: '#1a1f2e', 
        padding: '20px', 
        borderRadius: '8px',
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#cbd5f5'
      }}>
        No volume data available
      </div>
    );
  }
  
  const resetZoom = () => {
    if (ref && ref.current) {
      ref.current.resetZoom();
    }
  };

  return (
    <div style={{ 
      backgroundColor: '#1a1f2e', 
      padding: '20px', 
      borderRadius: '8px',
      height,
      position: 'relative'
    }}>
      {(poc || valueArea.high) && (
        <div style={{
          backgroundColor: 'rgba(30, 41, 59, 0.9)',
          padding: '8px',
          borderRadius: '4px',
          fontSize: '12px',
          color: '#cbd5f5',
          border: '1px solid #334155',
          marginBottom: '10px',
          display: 'flex',
          gap: '16px'
        }}>
          <span>POC: ${poc ? poc.toLocaleString() : 'N/A'}</span>
          <span>VA: ${valueArea.low ? valueArea.low.toLocaleString() : 'N/A'} - ${valueArea.high ? valueArea.high.toLocaleString() : 'N/A'}</span>
        </div>
      )}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '10px',
        padding: '8px 0'
      }}>
        <div style={{
          display: 'flex',
          gap: '20px',
          alignItems: 'center',
          fontSize: '12px',
          color: '#cbd5f5'
        }}>
          <div 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px', 
              cursor: 'pointer',
              opacity: datasetVisibility.callVolume ? 1 : 0.5,
              transition: 'opacity 0.2s'
            }}
            onClick={() => toggleDataset('callVolume')}
            title="Click to show/hide Call Volume"
          >
            <div style={{
              width: '12px',
              height: '12px',
              backgroundColor: datasetVisibility.callVolume ? 'rgba(34, 197, 94, 0.6)' : 'transparent',
              border: '1px solid rgba(34, 197, 94, 1)',
              borderRadius: '2px'
            }}></div>
            <span>Call Volume</span>
          </div>
          <div 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px', 
              cursor: 'pointer',
              opacity: datasetVisibility.putVolume ? 1 : 0.5,
              transition: 'opacity 0.2s'
            }}
            onClick={() => toggleDataset('putVolume')}
            title="Click to show/hide Put Volume"
          >
            <div style={{
              width: '12px',
              height: '12px',
              backgroundColor: datasetVisibility.putVolume ? 'rgba(239, 68, 68, 0.6)' : 'transparent',
              border: '1px solid rgba(239, 68, 68, 1)',
              borderRadius: '2px'
            }}></div>
            <span>Put Volume</span>
          </div>
        </div>
        <button
          onClick={resetZoom}
          style={{
            background: 'rgba(30, 41, 59, 0.9)',
            border: '1px solid #334155',
            color: '#cbd5f5',
            padding: '6px 12px',
            borderRadius: '4px',
            fontSize: '12px',
            cursor: 'pointer'
          }}
          title="Reset zoom (or double-click chart)"
        >
          Reset Zoom
        </button>
      </div>
      <Bar ref={ref} data={chartData} options={chartOptions} />
    </div>
  );
});

VolumeProfile.displayName = 'VolumeProfile';

export default VolumeProfile;