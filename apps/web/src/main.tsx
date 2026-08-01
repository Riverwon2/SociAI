import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App.js'
import { createBrowserLiveRunTransport } from './live/browser-live-run-transport.js'
import './styles.css'

const root = document.querySelector('#root')
if (root === null) throw new Error('Application root is missing')
const liveTransport = createBrowserLiveRunTransport({})

createRoot(root).render(
  <StrictMode>
    <App liveTransport={liveTransport} />
  </StrictMode>
)

