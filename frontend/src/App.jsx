import React from 'react';
import { Outlet } from 'react-router-dom';

export default function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Task Manager</h1>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
