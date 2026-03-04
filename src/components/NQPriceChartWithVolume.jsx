import React, { useMemo, useEffect } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import annotationPlugin from 'chartjs-plugin-annotation';
import { calculateValueArea, calculatePOC } from './VolumeProfile';

// Register Chart.js components and plugins
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  zoomPlugin,
  annotationPlugin
);

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

// Set to true to enable click debugging
const DEBUG_CLICKS = false;

// NQ Price Chart Component
const NQPriceChartWithVolume = React.forwardRef(({ data, volumeData, onHoverSync, labels, timestamps, priceRange, volumeBarPosition = 'left' }, ref) => {
  logWithTimestamp('[NQ CHART] Rendering with:', { 
    dataLength: data?.length, 
    labelsLength: labels?.length, 
    timestampsLength: timestamps?.length 
  });

  // Track mouse position using a ref to make it accessible in callbacks
  const mouseYRef = React.useRef(null);
  
  // State to track visibility of different elements
  const [visibility, setVisibility] = React.useState({
    calls: true,
    puts: true,
    nqPrice: true,
    poc: true,
    valueArea: true
  });
  
  // Use ref to make visibility accessible in plugins
  const visibilityRef = React.useRef(visibility);
  React.useEffect(() => {
    visibilityRef.current = visibility;
    if (DEBUG_CLICKS) console.log(`[VISIBILITY CHANGE] New visibility state:`, visibility);
    // Also force chart update here
    if (ref && ref.current) {
      ref.current.update('none');
    }
  }, [visibility]);
  
  // Toggle visibility function with logging
  const toggleVisibility = (key) => {
    if (DEBUG_CLICKS) {
      console.log(`[CLICK DEBUG] toggleVisibility called for: ${key}`);
      console.log(`[CLICK DEBUG] Current visibility:`, visibility);
    }
    
    setVisibility(prev => {
      const newState = { ...prev, [key]: !prev[key] };
      if (DEBUG_CLICKS) {
        logWithTimestamp(`[NQ CHART] Toggling ${key}: ${prev[key]} -> ${newState[key]}`);
        console.log(`[CLICK DEBUG] New state will be:`, newState);
      }
      
      // Force chart update after state change
      if (ref && ref.current) {
        if (DEBUG_CLICKS) console.log(`[CLICK DEBUG] Chart ref exists, forcing update`);
        setTimeout(() => {
          ref.current.update('none'); // Update without animation
        }, 0);
      } else if (DEBUG_CLICKS) {
        console.log(`[CLICK DEBUG] WARNING: Chart ref is null`);
      }
      return newState;
    });
  };

  // Reset zoom when data changes
  useEffect(() => {
    if (ref && ref.current && data) {
      ref.current.resetZoom();
    }
  }, [data, ref]);

  // Function to reset zoom
  const resetZoom = () => {
    if (ref && ref.current) {
      ref.current.resetZoom();
    }
  };

  // Calculate Value Area for Y-axis bounds (must be before any early returns)
  const valueArea = useMemo(() => {
    const va = calculateValueArea(volumeData);
    logWithTimestamp('[NQ CHART] Value Area calculated:', va);
    return va;
  }, [volumeData]);

  // Calculate POC (Point of Control) - price with highest volume
  const poc = useMemo(() => {
    const pocValue = calculatePOC(volumeData);
    logWithTimestamp('[NQ CHART] POC calculated:', pocValue);
    return pocValue;
  }, [volumeData]);

  // Add CSS to ensure tooltip is on top
  React.useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      .chartjs-tooltip {
        z-index: 999999 !important;
        position: absolute !important;
      }
    `;
    document.head.appendChild(style);
    
    return () => {
      document.head.removeChild(style);
    };
  }, []);

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

  // Calculate max volume for scaling
  let maxVolume = 0;
  if (volumeData && volumeData.length > 0) {
    maxVolume = Math.max(...volumeData.map(d => (d.callVolume || 0) + (d.putVolume || 0)));
    logWithTimestamp('[NQ CHART] Max volume:', maxVolume);
  }

  // Get the latest NQ price (last non-null value)
  const latestPrice = useMemo(() => {
    if (!mappedData || mappedData.length === 0) return null;
    // Find the last non-null price
    for (let i = mappedData.length - 1; i >= 0; i--) {
      if (mappedData[i] !== null && mappedData[i] !== undefined) {
        return mappedData[i];
      }
    }
    return null;
  }, [mappedData]);

  // Create a custom plugin to draw volume bars at the right edge
  const rightEdgeVolumePlugin = React.useMemo(() => ({
    id: 'rightEdgeVolume',
    afterDatasetsDraw: (chart) => {  // Draw after datasets (NQ price) but before tooltip
      if (volumeBarPosition !== 'right' || !volumeData || volumeData.length === 0 || maxVolume === 0) {
        return;
      }

      const ctx = chart.ctx;
      const chartArea = chart.chartArea;
      const xScale = chart.scales.x;
      const yScale = chart.scales.y;
      
      // Calculate the right edge position
      const rightEdge = chartArea.right;
      const maxBarWidth = chartArea.width * 0.15; // Max 15% of chart width
      
      // Save the current context state
      ctx.save();
      
      volumeData.forEach((volumeLevel) => {
        const strike = volumeLevel.strike || volumeLevel.price;
        const callVolume = volumeLevel.callVolume || 0;
        const putVolume = volumeLevel.putVolume || 0;
        const totalVolume = callVolume + putVolume;
        
        if (totalVolume > 0) {
          const yPos = yScale.getPixelForValue(strike);
          
          // Calculate bar widths proportional to volume
          const callBarWidth = (callVolume / maxVolume) * maxBarWidth;
          const putBarWidth = (putVolume / maxVolume) * maxBarWidth;
          
          // Bar height (thickness)
          const barHeight = Math.max(2, Math.min(10, 50 / volumeData.length));
          
          // Draw call volume bar (green) - extends left from right edge
          if (callVolume > 0 && visibilityRef.current.calls) {
            ctx.fillStyle = 'rgba(34, 197, 94, 0.7)';
            ctx.fillRect(
              rightEdge - callBarWidth,  // Start position (left edge of bar)
              yPos - barHeight / 2,      // Top edge
              callBarWidth,              // Width
              barHeight                  // Height
            );
            
            // Add border
            ctx.strokeStyle = 'rgba(34, 197, 94, 1)';
            ctx.lineWidth = 1;
            ctx.strokeRect(
              rightEdge - callBarWidth,
              yPos - barHeight / 2,
              callBarWidth,
              barHeight
            );
          }
          
          // Draw put volume bar (red) - extends left from call bar
          if (putVolume > 0 && visibilityRef.current.puts) {
            const callOffset = visibilityRef.current.calls ? callBarWidth : 0; // Adjust position if calls are hidden
            ctx.fillStyle = 'rgba(239, 68, 68, 0.7)';
            ctx.fillRect(
              rightEdge - callOffset - putBarWidth,  // Start position
              yPos - barHeight / 2,                    // Top edge
              putBarWidth,                             // Width
              barHeight                                // Height
            );
            
            // Add border
            ctx.strokeStyle = 'rgba(239, 68, 68, 1)';
            ctx.lineWidth = 1;
            ctx.strokeRect(
              rightEdge - callOffset - putBarWidth,
              yPos - barHeight / 2,
              putBarWidth,
              barHeight
            );
          }
        }
      });
      
      // Restore the context state
      ctx.restore();
    }
  }), [volumeBarPosition, volumeData, maxVolume, visibility, poc, valueArea]); // Add visibility to dependencies

  // Create a custom plugin to highlight current price on the y-axis
  const currentPricePlugin = React.useMemo(() => ({
    id: 'currentPrice',
    afterDraw: (chart) => {
      const ctx = chart.ctx;
      const yScale = chart.scales.y;
      const chartArea = chart.chartArea;
      
      // Save context state
      ctx.save();
      
      // Track label positions to prevent overlap
      const drawnLabels = [];
      
      // Helper function to check if labels would overlap
      const wouldOverlap = (newY, newHeight) => {
        return drawnLabels.some(label => {
          const overlap = Math.abs(label.y - newY) < (label.height + newHeight) / 2 + 2;
          return overlap;
        });
      };
      
      // Draw current NQ price
      if (latestPrice !== null && visibilityRef.current.nqPrice) {
        const yPos = yScale.getPixelForValue(latestPrice);
        
        if (yPos >= chartArea.top && yPos <= chartArea.bottom) {
          // Draw a line across the chart at current price
          ctx.strokeStyle = '#17BECF';
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(chartArea.left, yPos);
          ctx.lineTo(chartArea.right, yPos);
          ctx.stroke();
          ctx.setLineDash([]);
          
          // Draw price label on the right edge
          const labelText = `$${latestPrice.toFixed(0)}`;
          const padding = 6;
          const labelHeight = 20;
          const labelWidth = ctx.measureText(labelText).width + padding * 2;
          
          // Background for the label
          ctx.fillStyle = '#17BECF';
          ctx.fillRect(chartArea.right + 2, yPos - labelHeight/2, labelWidth, labelHeight);
          
          // Text
          ctx.fillStyle = '#000000';
          ctx.font = '12px sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(labelText, chartArea.right + 2 + padding, yPos);
          
          // Track this label
          drawnLabels.push({ y: yPos, height: labelHeight });
        }
      }
      
      // Draw POC value on y-axis
      if (poc !== null && visibilityRef.current.poc) {
        const pocYPos = yScale.getPixelForValue(poc);
        
        if (pocYPos >= chartArea.top && pocYPos <= chartArea.bottom) {
          const pocText = `$${poc.toFixed(0)}`;
          const padding = 6;
          const labelHeight = 20;
          
          // Check for overlap and adjust position if needed
          let adjustedYPos = pocYPos;
          if (wouldOverlap(pocYPos, labelHeight)) {
            // Try moving down first
            adjustedYPos = pocYPos + labelHeight + 4;
            if (adjustedYPos + labelHeight/2 > chartArea.bottom) {
              // If that goes out of bounds, try moving up
              adjustedYPos = pocYPos - labelHeight - 4;
            }
          }
          
          ctx.font = '11px sans-serif';
          const labelWidth = ctx.measureText(pocText).width + padding * 2;
          
          // Background for POC label
          ctx.fillStyle = 'rgba(251, 191, 36, 0.9)'; // Amber
          ctx.fillRect(chartArea.right + 2, adjustedYPos - labelHeight/2, labelWidth, labelHeight);
          
          // Text
          ctx.fillStyle = '#000000';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(pocText, chartArea.right + 2 + padding, adjustedYPos);
          
          // Track this label
          drawnLabels.push({ y: adjustedYPos, height: labelHeight });
        }
      }
      
      // Draw Value Area bounds on y-axis
      if (valueArea.high && valueArea.low && visibilityRef.current.valueArea) {
        // VA High
        const vaHighYPos = yScale.getPixelForValue(valueArea.high);
        if (vaHighYPos >= chartArea.top && vaHighYPos <= chartArea.bottom) {
          const vaHighText = `$${valueArea.high.toFixed(0)}`;
          const padding = 6;
          const labelHeight = 18;
          
          // Check for overlap and adjust position if needed
          let adjustedVAHYPos = vaHighYPos;
          if (wouldOverlap(vaHighYPos, labelHeight)) {
            adjustedVAHYPos = vaHighYPos - labelHeight - 4;
            if (adjustedVAHYPos - labelHeight/2 < chartArea.top) {
              adjustedVAHYPos = vaHighYPos + labelHeight + 4;
            }
          }
          
          ctx.font = '10px sans-serif';
          const labelWidth = ctx.measureText(vaHighText).width + padding * 2;
          
          ctx.fillStyle = 'rgba(147, 51, 234, 0.9)'; // Purple
          ctx.fillRect(chartArea.right + 2, adjustedVAHYPos - labelHeight/2, labelWidth, labelHeight);
          
          ctx.fillStyle = '#FFFFFF';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(vaHighText, chartArea.right + 2 + padding, adjustedVAHYPos);
          
          // Track this label
          drawnLabels.push({ y: adjustedVAHYPos, height: labelHeight });
        }
        
        // VA Low
        const vaLowYPos = yScale.getPixelForValue(valueArea.low);
        if (vaLowYPos >= chartArea.top && vaLowYPos <= chartArea.bottom) {
          const vaLowText = `$${valueArea.low.toFixed(0)}`;
          const padding = 6;
          const labelHeight = 18;
          
          // Check for overlap and adjust position if needed
          let adjustedVALYPos = vaLowYPos;
          if (wouldOverlap(vaLowYPos, labelHeight)) {
            adjustedVALYPos = vaLowYPos + labelHeight + 4;
            if (adjustedVALYPos + labelHeight/2 > chartArea.bottom) {
              adjustedVALYPos = vaLowYPos - labelHeight - 4;
            }
          }
          
          ctx.font = '10px sans-serif';
          const labelWidth = ctx.measureText(vaLowText).width + padding * 2;
          
          ctx.fillStyle = 'rgba(147, 51, 234, 0.9)'; // Purple
          ctx.fillRect(chartArea.right + 2, adjustedVALYPos - labelHeight/2, labelWidth, labelHeight);
          
          ctx.fillStyle = '#FFFFFF';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(vaLowText, chartArea.right + 2 + padding, adjustedVALYPos);
          
          // Track this label
          drawnLabels.push({ y: adjustedVALYPos, height: labelHeight });
        }
      }
      
      // Restore context state
      ctx.restore();
    }
  }), [latestPrice, visibility, poc, valueArea]); // Add visibility to dependencies

  // Create horizontal volume profile bars with color coding
  const volumeBarDatasets = [];
  
  // Only create line datasets for left-edge positioning
  if (volumeBarPosition !== 'right' && volumeData && volumeData.length > 0 && maxVolume > 0) {
    // Create separate datasets for call and put volumes
    volumeData.forEach((volumeLevel) => {
      const strike = volumeLevel.strike || volumeLevel.price;
      const callVolume = volumeLevel.callVolume || 0;
      const putVolume = volumeLevel.putVolume || 0;
      
      if (callVolume > 0 || putVolume > 0) {
        // Calculate bar length as percentage of chart width (0 to 30%)
        const callBarLengthPercent = (callVolume / maxVolume) * 0.3;
        const putBarLengthPercent = (putVolume / maxVolume) * 0.3;
        
        // Create call volume bar (green) - only for left-edge positioning
        if (callVolume > 0 && labels && labels.length > 0) {
          const callBarData = [];
          const numPoints = Math.ceil(labels.length * callBarLengthPercent);
          for (let i = 0; i < numPoints && i < labels.length; i++) {
            callBarData.push({
              x: labels[i],
              y: strike
            });
          }
          
          volumeBarDatasets.push({
            type: 'line',
            label: `Call Volume at ${strike}`,
            data: callBarData,
            borderColor: 'rgba(34, 197, 94, 0.8)', // Green
            backgroundColor: 'rgba(34, 197, 94, 0.3)',
            borderWidth: volumeBarPosition === 'right' 
              ? Math.max(4, (callVolume / maxVolume) * 16) // Thicker for right-edge
              : Math.max(2, (callVolume / maxVolume) * 8),
            fill: false,
            pointRadius: 0,
            pointHoverRadius: 0,
            showLine: true,
            tension: 0,
            order: 1,
            hidden: false
          });
        }
        
        // Create put volume bar (red) - positioned after call bar
        if (putVolume > 0 && labels && labels.length > 0) {
          const putBarData = [];
          const callBarEndPoint = Math.ceil(labels.length * callBarLengthPercent);
          const numPoints = Math.ceil(labels.length * putBarLengthPercent);
          for (let i = callBarEndPoint; i < callBarEndPoint + numPoints && i < labels.length; i++) {
            putBarData.push({
              x: labels[i],
              y: strike
            });
          }
          
          volumeBarDatasets.push({
            type: 'line',
            label: `Put Volume at ${strike}`,
            data: putBarData,
            borderColor: 'rgba(239, 68, 68, 0.8)', // Red
            backgroundColor: 'rgba(239, 68, 68, 0.3)',
            borderWidth: volumeBarPosition === 'right' 
              ? Math.max(4, (putVolume / maxVolume) * 16) // Thicker for right-edge
              : Math.max(2, (putVolume / maxVolume) * 8),
            fill: false,
            pointRadius: 0,
            pointHoverRadius: 0,
            showLine: true,
            tension: 0,
            order: 2,
            hidden: false
          });
        }
      }
    });
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
    datasets: [
      {
        type: 'line',
        label: 'NQ Futures Price',
        data: mappedData,
        borderColor: '#17BECF',
        backgroundColor: '#17BECF20',
        borderWidth: 2,
        fill: false,
        spanGaps: true, // Connect lines across null values
        order: 0, // Draw on top (lower order = drawn last)
        hidden: !visibility.nqPrice // Control visibility
      },
      ...(volumeBarPosition === 'right' ? [] : volumeBarDatasets)
    ]
  };
  
  const nqChartOptions = React.useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
      includeInvisible: true, // Show tooltip for data outside visible area
    },
    onHover: (event, activeElements, chart) => {
      // Capture the actual mouse Y position
      if (event && event.y !== undefined) {
        // event.y is already the position relative to the chart
        const dataY = chart.scales.y.getValueForPixel(event.y);
        mouseYRef.current = dataY;
      }
      
      if (onHoverSync) {
        onHoverSync(chart, activeElements);
      }
    },
    onLeave: (event, activeElements, chart) => {
      // Clear mouse position when leaving chart
      mouseYRef.current = null;
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
        position: 'right', // Move y-axis to right side
        grid: {
          color: '#334155',
        },
        ticks: {
          color: '#cbd5f5',
        },
        // Use Value Area bounds if available, with extended limits for panning
        ...(valueArea.low && valueArea.high ? {
          min: valueArea.low - (valueArea.high - valueArea.low) * 0.1, // Add 10% padding below
          max: valueArea.high + (valueArea.high - valueArea.low) * 0.1  // Add 10% padding above
        } : priceRange ? {
          min: priceRange.min,
          max: priceRange.max
        } : {})
      }
    },
    plugins: {
      legend: {
        display: false // Hide default legend since we have custom one
      },
      tooltip: {
        mode: 'index',
        axis: 'x',
        intersect: false,
        backgroundColor: '#1e293b', // Solid color, no transparency
        titleColor: '#cbd5f5',
        bodyColor: '#cbd5f5',
        borderColor: '#334155',
        borderWidth: 1,
        displayColors: false,
        // Ensure tooltip stays visible
        enabled: true,
        position: 'nearest',
        // Keep tooltip within chart area when zoomed
        bodyAlign: 'center',
        titleAlign: 'center',
        // Display tooltip even if data point is outside visible area
        includeInvisible: true,
        // Ensure tooltip is always on top
        z: 9999,
        // Remove any transparency
        opacity: 1,
        // Add padding for better readability
        padding: 12,
        cornerRadius: 6,
        callbacks: {
          title: function(context) {
            const currentMouseY = mouseYRef.current;
            
            // Show strike price at the top of the tooltip based on mouse Y position
            if (volumeData && volumeData.length > 0 && currentMouseY !== null) {
              let closestStrike = null;
              let closestDiff = Infinity;
              
              volumeData.forEach(level => {
                const strike = level.strike || level.price;
                const diff = Math.abs(strike - currentMouseY);
                if (diff < closestDiff) {
                  closestDiff = diff;
                  closestStrike = strike;
                }
              });
              
              if (closestStrike !== null) {
                return `Strike: $${closestStrike.toLocaleString()}`;
              }
            }
            
            // Fallback: if no mouse position, use the Y value from the data point
            if (context[0] && volumeData && volumeData.length > 0) {
              const yValue = context[0].parsed?.y;
              if (yValue) {
                let closestStrike = null;
                let closestDiff = Infinity;
                
                volumeData.forEach(level => {
                  const strike = level.strike || level.price;
                  const diff = Math.abs(strike - yValue);
                  if (diff < closestDiff) {
                    closestDiff = diff;
                    closestStrike = strike;
                  }
                });
                
                if (closestStrike !== null) {
                  return `Strike: $${closestStrike.toLocaleString()}`;
                }
              }
            }
            
            return 'No strike data';
          },
          label: function(context) {
            // Don't show any label here - strike is in title, volumes in afterLabel
            return null;
          },
          afterLabel: function(context) {
            // Only add volume info once for the NQ dataset
            const currentMouseY = mouseYRef.current;
            if (context.dataset.label === 'NQ Futures Price' && volumeData && currentMouseY !== null) {
              // Find the closest strike price in volume data
              let closestVolumeLevel = null;
              let closestDiff = Infinity;
              
              volumeData.forEach(level => {
                const strike = level.strike || level.price;
                const diff = Math.abs(strike - currentMouseY);
                if (diff < closestDiff) {
                  closestDiff = diff;
                  closestVolumeLevel = level;
                }
              });
              
              if (closestVolumeLevel) {
                const callVolume = closestVolumeLevel.callVolume || 0;
                const putVolume = closestVolumeLevel.putVolume || 0;
                const totalVolume = callVolume + putVolume;
                
                return [
                  `🟢 Calls: ${callVolume.toLocaleString()}`,
                  `🔴 Puts: ${putVolume.toLocaleString()}`,
                  `📊 Total: ${totalVolume.toLocaleString()}`
                ];
              }
            }
            return '';
          },
          footer: function(context) {
            // Show time and NQ price at the bottom
            const timeLabel = context[0]?.label || '';
            const nqPrice = context[0]?.parsed?.y;
            
            const footerLines = [];
            if (timeLabel) {
              footerLines.push(`Time: ${timeLabel}`);
            }
            if (nqPrice !== undefined && nqPrice !== null) {
              footerLines.push(`NQ Price: $${nqPrice.toFixed(2)}`);
            }
            
            return footerLines;
          },
          filter: function(tooltipItem) {
            // Only show tooltip items for the NQ Futures Price dataset
            return tooltipItem.dataset.label === 'NQ Futures Price';
          }
        }
      },
      annotation: {
        annotations: {
          ...(poc !== null && visibility.poc ? {
            pocLine: {
              type: 'line',
              yMin: poc,
              yMax: poc,
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
          ...(valueArea.high && valueArea.low && visibility.valueArea ? {
            valueAreaBox: {
              type: 'box',
              yMin: valueArea.low,
              yMax: valueArea.high,
              backgroundColor: 'rgba(147, 51, 234, 0.1)', // Purple with transparency
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
          mode: 'xy', // Allow zooming both X and Y axes
        },
        pan: {
          enabled: true,
          mode: 'xy', // Allow panning both X and Y axes
          drag: true, // Enable simple click/drag panning
        },
        limits: {
          x: {
            min: 'original',
            max: 'original'
          },
          y: {
            // Allow panning to see extended strike range
            ...(volumeData && volumeData.length > 0 ? {
              min: Math.min(...volumeData.map(d => d.strike || d.price)) - 500,
              max: Math.max(...volumeData.map(d => d.strike || d.price)) + 500
            } : {
              min: 'original',
              max: 'original'
            })
          }
        },
        onZoomComplete: function() {
          // Optional: Add any zoom complete callback logic here
        }
      }
    }
  }), [volumeData, priceRange, valueArea, poc, visibility, onHoverSync]);
  
  return (
    <div style={{ 
      backgroundColor: '#1a1f2e', 
      padding: '20px', 
      borderRadius: '8px',
      height: '300px',
      position: 'relative',
      // Ensure tooltips render on top
      zIndex: 1
    }}>
      {/* Legend at the top */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: '20px',
        backgroundColor: 'rgba(30, 41, 59, 0.9)',
        padding: '8px 16px',
        borderRadius: '4px',
        border: '1px solid #334155',
        fontSize: '12px',
        color: '#cbd5f5',
        zIndex: 1000  // Much higher z-index to ensure it's above chart
      }}>
        <div 
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px',
            cursor: 'pointer',
            opacity: visibility.calls ? 1 : 0.4,
            transition: 'opacity 0.2s'
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (DEBUG_CLICKS) console.log(`[CLICK EVENT] Calls legend clicked`);
            toggleVisibility('calls');
          }}
          title="Click to show/hide Call volume"
        >
          <div style={{
            width: '16px',
            height: '3px',
            backgroundColor: 'rgba(34, 197, 94, 0.8)',
            borderRadius: '1px'
          }}></div>
          <span>Calls</span>
        </div>
        <div 
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px',
            cursor: 'pointer',
            opacity: visibility.puts ? 1 : 0.4,
            transition: 'opacity 0.2s'
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (DEBUG_CLICKS) console.log(`[CLICK EVENT] Puts legend clicked`);
            toggleVisibility('puts');
          }}
          title="Click to show/hide Put volume"
        >
          <div style={{
            width: '16px',
            height: '3px',
            backgroundColor: 'rgba(239, 68, 68, 0.8)',
            borderRadius: '1px'
          }}></div>
          <span>Puts</span>
        </div>
        <div 
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px',
            cursor: 'pointer',
            opacity: visibility.nqPrice ? 1 : 0.4,
            transition: 'opacity 0.2s'
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (DEBUG_CLICKS) console.log(`[CLICK EVENT] NQ Price legend clicked`);
            toggleVisibility('nqPrice');
          }}
          title="Click to show/hide NQ Price line"
        >
          <div style={{
            width: '16px',
            height: '2px',
            backgroundColor: '#17BECF',
            borderRadius: '1px'
          }}></div>
          <span>NQ Price</span>
        </div>
        <div 
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px',
            cursor: 'pointer',
            opacity: visibility.poc ? 1 : 0.4,
            transition: 'opacity 0.2s'
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (DEBUG_CLICKS) console.log(`[CLICK EVENT] POC legend clicked`);
            toggleVisibility('poc');
          }}
          title="Click to show/hide POC line"
        >
          <div style={{
            width: '16px',
            height: 0,
            borderTop: '2px dashed rgba(251, 191, 36, 1)'
          }}></div>
          <span>POC</span>
        </div>
        <div 
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px',
            cursor: 'pointer',
            opacity: visibility.valueArea ? 1 : 0.4,
            transition: 'opacity 0.2s'
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (DEBUG_CLICKS) console.log(`[CLICK EVENT] Value Area legend clicked`);
            toggleVisibility('valueArea');
          }}
          title="Click to show/hide Value Area"
        >
          <div style={{
            width: '16px',
            height: '10px',
            backgroundColor: 'rgba(147, 51, 234, 0.3)',
            border: '1px solid rgba(147, 51, 234, 0.8)',
            borderRadius: '1px'
          }}></div>
          <span>VA</span>
        </div>
      </div>
      <button
        onClick={resetZoom}
        style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          background: 'rgba(30, 41, 59, 0.9)',
          border: '1px solid #334155',
          color: '#cbd5f5',
          padding: '6px 12px',
          borderRadius: '4px',
          fontSize: '12px',
          cursor: 'pointer',
          zIndex: 1000  // Match legend z-index
        }}
        title="Reset zoom"
      >
        Reset Zoom
      </button>
      <div style={{
        position: 'absolute',
        bottom: '10px',
        left: '10px',
        backgroundColor: 'rgba(30, 41, 59, 0.9)',
        padding: '6px 8px',
        borderRadius: '4px',
        fontSize: '11px',
        color: '#94a3b8'
      }}>
Shift+Wheel: Zoom | Click+Drag: Pan to see more strikes
      </div>
      <div style={{ 
        position: 'relative', 
        height: '100%', 
        paddingTop: '45px', // Add top padding to prevent legend overlap
        zIndex: 1  // Lower than legend and buttons
      }}>
        <Line 
          ref={ref} 
          data={chartData} 
          options={nqChartOptions} 
          plugins={volumeBarPosition === 'right' ? [rightEdgeVolumePlugin, currentPricePlugin] : [currentPricePlugin]} 
        />
      </div>
    </div>
  );
});

NQPriceChartWithVolume.displayName = 'NQPriceChartWithVolume';

export default NQPriceChartWithVolume;