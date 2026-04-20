import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// When running from file:// in Electron, all relative /api/* paths would resolve
// to the local filesystem. Intercept fetch globally so any path starting with /
// is prefixed with the backend URL that the user configured in settings.
const backendUrl = (window as Window & { electronAPI?: { backendUrl?: string } })
  .electronAPI?.backendUrl ?? ''

if (backendUrl) {
  const _fetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/')) {
      input = `${backendUrl}${input}`
    } else if (input instanceof Request && input.url.startsWith('/')) {
      input = new Request(`${backendUrl}${input.url}`, input)
    }
    return _fetch(input, init)
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
