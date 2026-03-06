import { useState } from 'react'
import './Header.css'

function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  return (
    <header className="header">
      <div className="header-container">
        <div className="header-logo">
          <span className="logo-text">UX Pilot</span>
        </div>

        <button
          className="mobile-menu-toggle"
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          aria-label="Toggle menu"
        >
          <span></span>
          <span></span>
          <span></span>
        </button>

        <nav className={`header-nav ${isMenuOpen ? 'open' : ''}`}>
          <a href="#features" className="nav-link">Features</a>
          <a href="#capabilities" className="nav-link">Capabilities</a>
          <a href="#integrations" className="nav-link">Integrations</a>
          <a href="#pricing" className="nav-link">Pricing</a>
        </nav>

        <div className={`header-actions ${isMenuOpen ? 'open' : ''}`}>
          <select className="language-selector">
            <option value="en">EN</option>
            <option value="es">ES</option>
            <option value="fr">FR</option>
          </select>
          <button className="btn-secondary">Sign In</button>
          <button className="btn-primary">Start for Free</button>
        </div>
      </div>
    </header>
  )
}

export default Header
