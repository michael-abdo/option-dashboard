import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';

const data = [
  { strike: 25000, callVolume: 100, putVolume: 50 },
  { strike: 24900, callVolume: 200, putVolume: 150 },
  { strike: 24800, callVolume: 150, putVolume: 100 },
  { strike: 24700, callVolume: 300, putVolume: 200 },
];

function TestBarChart() {
  console.log('TestBarChart rendering with data:', data);
  
  return (
    <div style={{ padding: '20px', background: 'white' }}>
      <h2 style={{ color: 'black' }}>Test Bar Chart Component</h2>
      <BarChart 
        width={600} 
        height={400} 
        data={data}
        layout="horizontal"
        margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
      >
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="strike" />
        <YAxis />
        <Bar dataKey="callVolume" fill="#FFD54F" />
        <Bar dataKey="putVolume" fill="#FF7043" />
      </BarChart>
    </div>
  );
}

export default TestBarChart;