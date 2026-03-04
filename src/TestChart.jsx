import React from 'react';
import { LineChart, Line, XAxis, YAxis } from 'recharts';

const data = [
  { x: 0, y: 0 },
  { x: 1, y: 100 },
  { x: 2, y: 50 },
  { x: 3, y: 150 },
];

function TestChart() {
  console.log('TestChart rendering');
  
  return (
    <div style={{ padding: '20px', background: 'white' }}>
      <h2 style={{ color: 'black' }}>Test Chart Component</h2>
      <LineChart width={400} height={300} data={data}>
        <XAxis dataKey="x" stroke="black" />
        <YAxis stroke="black" />
        <Line type="monotone" dataKey="y" stroke="red" strokeWidth={3} />
      </LineChart>
    </div>
  );
}

export default TestChart;