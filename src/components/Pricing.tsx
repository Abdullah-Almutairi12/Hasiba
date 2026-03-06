import './Pricing.css'

function Pricing() {
  const plans = [
    {
      name: 'Free',
      price: '$0',
      period: 'forever',
      description: 'Perfect for trying out UX Pilot',
      features: [
        '100 free credits',
        'Basic templates',
        'Community support',
        'Export to PDF',
        'Basic components'
      ],
      cta: 'Start for Free',
      popular: false
    },
    {
      name: 'Pro',
      price: '$29',
      period: 'per month',
      description: 'For professional designers and teams',
      features: [
        '1000 credits/month',
        'Custom models',
        'Priority support',
        'All export formats',
        'Figma sync',
        'Advanced components',
        'Style consistency check',
        'Team collaboration'
      ],
      cta: 'Get Started',
      popular: true
    },
    {
      name: 'Enterprise',
      price: 'Custom',
      period: 'contact us',
      description: 'For large teams and organizations',
      features: [
        'Unlimited credits',
        'Dedicated support',
        'Custom integrations',
        'SSO authentication',
        'Advanced security',
        'SLA guarantees',
        'Training included',
        'Custom branding'
      ],
      cta: 'Contact Sales',
      popular: false
    }
  ]

  return (
    <section className="pricing" id="pricing">
      <div className="pricing-container">
        <div className="pricing-header">
          <h2 className="pricing-title">Simple, Transparent Pricing</h2>
          <p className="pricing-subtitle">
            Start free and scale as you grow. No hidden fees or surprises.
          </p>
        </div>

        <div className="pricing-grid">
          {plans.map((plan, index) => (
            <div key={index} className={`pricing-card ${plan.popular ? 'popular' : ''}`}>
              {plan.popular && <div className="popular-badge">Most Popular</div>}

              <div className="plan-header">
                <h3 className="plan-name">{plan.name}</h3>
                <div className="plan-price">
                  {plan.price}
                  <span className="plan-period">/{plan.period}</span>
                </div>
                <p className="plan-description">{plan.description}</p>
              </div>

              <ul className="plan-features">
                {plan.features.map((feature, idx) => (
                  <li key={idx} className="feature">
                    <svg className="feature-check" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <button className={`plan-cta ${plan.popular ? 'primary' : 'secondary'}`}>
                {plan.cta}
              </button>
            </div>
          ))}
        </div>

        <div className="pricing-note">
          <p>All plans include our core AI features. Purchase additional credits anytime.</p>
        </div>
      </div>
    </section>
  )
}

export default Pricing
