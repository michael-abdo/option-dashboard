import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App.jsx';

function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/v2" element={<App />} />
        <Route path="/v3" element={<App />} />
      </Routes>
    </BrowserRouter>
  );
}

export default Router;