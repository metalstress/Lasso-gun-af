import React from 'react';
import ReactDOM from 'react-dom/client';
import { SpeedInsights } from '@vercel/speed-insights/react';
import App from './App.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <SpeedInsights />
  </React.StrictMode>,
);
