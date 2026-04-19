import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './features/auth/LoginPage'
import RequireAuth from './features/auth/RequireAuth'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Routes>
              <Route path="fleet" element={<div style={{ padding: 24, color: 'var(--text-primary)' }}>Fleet (próximamente)</div>} />
              <Route path="vehicles/:id" element={<div style={{ padding: 24, color: 'var(--text-primary)' }}>Vehicle detail (próximamente)</div>} />
              <Route path="*" element={<Navigate to="/fleet" replace />} />
            </Routes>
          </RequireAuth>
        }
      />
    </Routes>
  )
}
