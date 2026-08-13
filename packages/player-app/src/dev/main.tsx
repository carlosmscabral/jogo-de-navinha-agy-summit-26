import React from 'react';
import ReactDOM from 'react-dom/client';
import { DevHarness } from './DevHarness.js';
import '../index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DevHarness />
  </React.StrictMode>
);
