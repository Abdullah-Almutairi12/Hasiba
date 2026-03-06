import './Features.css'

function Features() {
  const features = [
    {
      icon: '🎨',
      title: 'Import Components',
      description: 'Sync your design system and components from Figma with a single click.'
    },
    {
      icon: '🔄',
      title: 'Unify Your Components',
      description: 'Maintain consistency across your entire design system automatically.'
    },
    {
      icon: '💾',
      title: 'Save as Custom Models',
      description: 'Train AI on your brand style and save custom design models.'
    },
    {
      icon: '🔗',
      title: 'Design System Sync',
      description: 'Bidirectional sync with Figma keeps everything up to date.'
    },
    {
      icon: '✓',
      title: 'Style Consistency Check',
      description: 'Automatically validate designs against your style guidelines.'
    },
    {
      icon: '🚀',
      title: 'Generate Smarter Output',
      description: 'AI learns from your feedback to create better designs over time.'
    }
  ]

  return (
    <section className="features" id="features">
      <div className="features-container">
        <div className="features-header">
          <h2 className="features-title">Powerful Features for Modern Designers</h2>
          <p className="features-subtitle">
            Everything you need to create, manage, and scale your design system with AI assistance
          </p>
        </div>

        <div className="features-grid">
          {features.map((feature, index) => (
            <div key={index} className="feature-card">
              <div className="feature-icon">{feature.icon}</div>
              <h3 className="feature-title">{feature.title}</h3>
              <p className="feature-description">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default Features
