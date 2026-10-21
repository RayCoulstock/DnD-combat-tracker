import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Multiplayer from './Multiplayer'
import './styles.css'

createRoot(document.getElementById('root')).render(<StrictMode><Multiplayer /></StrictMode>)
