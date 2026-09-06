import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import '@livekit/components-styles';
import './styles.css';
import { Home } from './pages/Home';
import { Host } from './pages/Host';
import { Play } from './pages/Play';
import { Builder } from './pages/Builder';
import { JoinByCode } from './pages/JoinByCode';

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/join/:code', element: <JoinByCode /> },
  { path: '/host/:sessionId', element: <Host /> },
  { path: '/host/:sessionId/build', element: <Builder /> },
  { path: '/play/:sessionId', element: <Play /> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
