import './Hero.css'

function Hero() {
  return (
    <section className="hero">
      <div className="hero-container">
        <div className="hero-badge">
          AI-Powered Design Platform
        </div>

        <h1 className="hero-title">
          Create Professional Designs
          <br />
          in Minutes, Not Hours
        </h1>

        <p className="hero-description">
          UX Pilot transforms your ideas into stunning, production-ready designs with AI.
          <br />
          Superfast design generation with flexible workflows and seamless Figma integration.
        </p>

        <div className="hero-actions">
          <button className="hero-btn-primary">Start for Free</button>
          <button className="hero-btn-secondary">Watch Demo</button>
        </div>

        <div className="hero-stats">
          <div className="stat">
            <div className="stat-value">10x</div>
            <div className="stat-label">Faster Design</div>
          </div>
          <div className="stat">
            <div className="stat-value">50K+</div>
            <div className="stat-label">Active Users</div>
          </div>
          <div className="stat">
            <div className="stat-value">99.9%</div>
            <div className="stat-label">Uptime</div>
          </div>
        </div>

        <div className="hero-visual">
          <div className="visual-card card-1">
            <div className="card-header">Mobile App</div>
            <div className="card-body">
              <div className="placeholder-line"></div>
              <div className="placeholder-line short"></div>
              <div className="placeholder-grid">
                <div className="placeholder-box"></div>
                <div className="placeholder-box"></div>
              </div>
            </div>
          </div>

          <div className="visual-card card-2">
            <div className="card-header">Dashboard</div>
            <div className="card-body">
              <div className="placeholder-line"></div>
              <div className="placeholder-chart"></div>
              <div className="placeholder-grid">
                <div className="placeholder-box"></div>
                <div className="placeholder-box"></div>
                <div className="placeholder-box"></div>
              </div>
            </div>
          </div>

          <div className="visual-card card-3">
            <div className="card-header">Landing Page</div>
            <div className="card-body">
              <div className="placeholder-line"></div>
              <div className="placeholder-line short"></div>
              <div className="placeholder-line short"></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default Hero
