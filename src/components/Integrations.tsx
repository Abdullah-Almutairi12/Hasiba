import './Integrations.css'

function Integrations() {
  const integrations = [
    { name: 'Figma', description: 'Bidirectional sync' },
    { name: 'GitHub', description: 'Code export' },
    { name: 'HTML/CSS', description: 'Clean output' },
    { name: 'Tailwind', description: 'Framework ready' }
  ]

  const exportFormats = [
    'PDF Export',
    'Image Export',
    'ZIP Download',
    'Editable Source Code'
  ]

  return (
    <section className="integrations" id="integrations">
      <div className="integrations-container">
        <div className="integrations-header">
          <h2 className="integrations-title">Seamless Integration with Your Workflow</h2>
          <p className="integrations-subtitle">
            Export to any format and integrate with tools you already use
          </p>
        </div>

        <div className="integrations-content">
          <div className="integrations-grid">
            {integrations.map((integration, index) => (
              <div key={index} className="integration-card">
                <div className="integration-icon-wrapper">
                  <div className="integration-icon"></div>
                </div>
                <div className="integration-info">
                  <h3 className="integration-name">{integration.name}</h3>
                  <p className="integration-description">{integration.description}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="export-section">
            <h3 className="export-title">Export Options</h3>
            <div className="export-grid">
              {exportFormats.map((format, index) => (
                <div key={index} className="export-item">
                  <svg className="export-icon" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                  <span>{format}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="security-badge">
          <svg className="security-icon" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <div className="security-text">
            <strong>256-bit AES Encryption</strong>
            <span>Google Cloud Infrastructure • GDPR Compliant • No AI Training on Your Data</span>
          </div>
        </div>
      </div>
    </section>
  )
}

export default Integrations
