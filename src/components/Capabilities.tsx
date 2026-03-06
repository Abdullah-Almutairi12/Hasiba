import './Capabilities.css'

function Capabilities() {
  const capabilities = [
    'Wireframes',
    'High-Fidelity Mockups',
    'Mobile Interfaces',
    'Desktop Layouts',
    'Responsive Designs',
    'Interactive Prototypes',
    'Predictive Heatmaps',
    'Landing Pages',
    'Dashboard Designs',
    'Component Libraries'
  ]

  return (
    <section className="capabilities" id="capabilities">
      <div className="capabilities-container">
        <div className="capabilities-content">
          <h2 className="capabilities-title">
            Create Any Design You Can Imagine
          </h2>
          <p className="capabilities-description">
            From wireframes to production-ready interfaces, UX Pilot handles every stage of your design process with AI-powered precision.
          </p>

          <div className="capabilities-list">
            {capabilities.map((capability, index) => (
              <div key={index} className="capability-item">
                <svg className="check-icon" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>{capability}</span>
              </div>
            ))}
          </div>

          <button className="capabilities-cta">Explore All Capabilities</button>
        </div>

        <div className="capabilities-visual">
          <div className="visual-window">
            <div className="window-header">
              <div className="window-dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <div className="window-title">Design Preview</div>
            </div>
            <div className="window-body">
              <div className="preview-toolbar">
                <div className="toolbar-item"></div>
                <div className="toolbar-item"></div>
                <div className="toolbar-item"></div>
              </div>
              <div className="preview-content">
                <div className="preview-section section-1"></div>
                <div className="preview-section section-2"></div>
                <div className="preview-section section-3"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default Capabilities
