import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Router from './Router.jsx'

console.log('[MAIN] Starting React app...');

try {
  const root = document.getElementById('root');
  console.log('[MAIN] Root element:', root);
  
  const rootElement = createRoot(root);
  
  window.addEventListener('error', (event) => {
    console.error('[MAIN] Global error caught:', event.error);
  });
  
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[MAIN] Unhandled promise rejection:', event.reason);
  });
  
  rootElement.render(
    <StrictMode>
      <Router />
    </StrictMode>,
  );
  
  console.log('[MAIN] React app rendered successfully');
} catch (error) {
  console.error('[MAIN] Failed to render React app:', error);
  console.error('[MAIN] Error stack:', error.stack);
  // Don't replace the entire body - the error might be after initial render
  const errorDiv = document.createElement('div');
  errorDiv.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; background: red; color: white; padding: 20px; z-index: 9999;';
  errorDiv.textContent = `Error: ${error.message}`;
  document.body.appendChild(errorDiv);
}
