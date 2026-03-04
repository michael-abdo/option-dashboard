# Volume Profile Overlay Analysis

## Overview
This document analyzes the current implementation of the NQ Futures Price chart and Volume Profile components to plan overlaying them into a single combined visualization.

## Current Architecture

### 1. Component Structure

#### NQ Futures Price Chart (`NQPriceChart.jsx`)
- **Type**: Line chart using Chart.js
- **Data Structure**: Array of objects with `fetched_at`, `price`/`value` fields
- **Features**:
  - Time-series line chart showing NQ futures prices
  - Synchronized tooltips with option charts
  - Configurable price range for Y-axis alignment
  - Responsive to chart start time filters

#### Volume Profile Chart (`VolumeProfile.jsx`)
- **Type**: Horizontal bar chart using Chart.js
- **Data Structure**: Array of objects with:
  - `strike`: Price level
  - `callVolume`: Call option volume at this strike
  - `putVolume`: Put option volume at this strike
  - `callOpenInterest`: Call OI at this strike
  - `putOpenInterest`: Put OI at this strike
- **Features**:
  - Horizontal bars showing volume at each strike price
  - POC (Point of Control) line annotation
  - Value Area (70% volume) box annotation
  - Zoom and pan functionality (Shift+scroll, Ctrl+scroll)
  - Toggle visibility for call/put volumes

### 2. Layout Configuration

#### Current Side-by-Side Layout (in /v2 route)
```css
.nq-charts-container {
  display: flex;
  gap: 1rem;
}
.nq-chart-wrapper {
  flex: 0 0 70%;  /* 70% width for NQ price chart */
}
.volume-profile-wrapper {
  flex: 0 0 30%;  /* 30% width for volume profile */
}
```

### 3. Data Flow

1. **NQ Price Data**: Fetched via `/futures/historical` API
   - Returns time-series data with timestamps and prices
   - Can be filtered by start/end time

2. **Volume Profile Data**: Fetched via `/volume-profile` API
   - Returns aggregated volume data by strike price
   - Can be filtered by chain and start time

3. **Synchronization**: 
   - Charts share a `priceRange` object for Y-axis alignment
   - Hover sync between NQ price and volume profile
   - Common time filtering via `chartStartTime`

## Chart.js Configuration

### Dependencies
- `chart.js@3.9.1` (Note: v4.x causes blank page issues)
- `react-chartjs-2@4.3.1`
- `chartjs-plugin-annotation@1.4.0` (for POC/Value Area lines)
- `chartjs-plugin-zoom@2.2.0` (for volume profile zoom/pan)

### Key Chart.js Features Used
1. **Multiple Y-axes**: Can overlay different data types
2. **Mixed chart types**: Can combine line and bar charts
3. **Annotation plugin**: For POC and Value Area indicators
4. **Custom tooltips**: Already implemented for both charts
5. **Dataset visibility toggle**: Used in volume profile

## Technical Considerations for Overlay

### 1. Chart Type Mixing
- Chart.js supports mixed chart types in a single chart
- Can have line datasets (NQ price) and bar datasets (volume profile) together
- Need to configure separate Y-axes for price and volume

### 2. Y-Axis Configuration
```javascript
scales: {
  y: {
    // Primary Y-axis for price
    type: 'linear',
    position: 'left',
    grid: { display: true }
  },
  y1: {
    // Secondary Y-axis for volume
    type: 'linear',
    position: 'right',
    grid: { display: false }
  }
}
```

### 3. Data Alignment Challenges
- **Time vs Strike**: NQ data is time-based, volume profile is strike-based
- **Solution Options**:
  1. Display volume bars at their strike price levels on the Y-axis
  2. Create a "volume cloud" or area chart overlay
  3. Use vertical bars at specific time points showing volume distribution

### 4. Visual Design Considerations
- **Transparency**: Volume bars need alpha channel to not obscure price line
- **Colors**: 
  - NQ price: `#17BECF` (cyan)
  - Call volume: `rgba(34, 197, 94, 0.6)` (green)
  - Put volume: `rgba(239, 68, 68, 0.6)` (red)
- **Z-ordering**: Price line should render on top of volume bars

### 5. Interaction Requirements
- Maintain all existing functionality:
  - Tooltips showing both price and volume data
  - POC and Value Area annotations
  - Dataset visibility toggles
  - Zoom/pan capabilities

## Proposed Implementation Approach

### Option 1: Volume Bars at Strike Levels (Recommended)
- Display horizontal volume bars at their corresponding strike prices
- Bars extend from left edge of chart
- Use transparency to show price line through bars
- Benefits: Most intuitive visualization of volume at price levels

### Option 2: Volume Profile as Background
- Render volume profile as a filled area chart in background
- Price line renders on top
- Benefits: Clean look, emphasizes price movement

### Option 3: Split View Within Single Chart
- Top 70% for price line
- Bottom 30% for volume bars
- Benefits: Maintains separation while being in same chart

## Key Data Structures

### Combined Dataset Format
```javascript
{
  // Time-series data for X-axis
  labels: [...timestamps],
  
  datasets: [
    {
      // NQ Price Line
      type: 'line',
      label: 'NQ Futures Price',
      data: [...prices],
      yAxisID: 'y',
      borderColor: '#17BECF',
      // ... other line config
    },
    {
      // Call Volume Bars
      type: 'bar',
      label: 'Call Volume',
      data: [...callVolumes], // Mapped to price levels
      yAxisID: 'y1',
      backgroundColor: 'rgba(34, 197, 94, 0.3)',
      // ... other bar config
    },
    {
      // Put Volume Bars
      type: 'bar',
      label: 'Put Volume',
      data: [...putVolumes], // Mapped to price levels
      yAxisID: 'y1',
      backgroundColor: 'rgba(239, 68, 68, 0.3)',
      // ... other bar config
    }
  ]
}
```

## Implementation Steps

1. **Create new combined chart component** (e.g., `NQPriceVolumeChart.jsx`)
2. **Merge data preparation logic** from both components
3. **Configure mixed chart type** with appropriate scales
4. **Implement volume data mapping** to price Y-axis
5. **Add all interactive features** (tooltips, annotations, toggles)
6. **Test performance** with large datasets
7. **Add toggle to switch** between overlay and side-by-side view

## Performance Considerations
- Volume profile data is typically much smaller than time-series data
- Need efficient mapping between strike prices and Y-axis positions
- Consider data decimation for very long time ranges
- May need to limit number of visible strike levels

## Conclusion
The overlay implementation is technically feasible using Chart.js mixed charts. The recommended approach is Option 1 (volume bars at strike levels) as it provides the most intuitive visualization while maintaining all existing functionality. The main challenge is properly mapping volume data to the price Y-axis scale.