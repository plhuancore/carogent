import React from 'react';
import ReactDOM from 'react-dom/client';

const isOverlayWindow = new URLSearchParams(window.location.search).get('overlay') === '1';
const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

if (isOverlayWindow) {
  import('./OverlayApp').then(({ default: OverlayApp }) => {
    root.render(
      <React.StrictMode>
        <OverlayApp />
      </React.StrictMode>
    );
  });
} else {
  import('./App').then(({ default: App }) => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  });
}
