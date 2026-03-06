import Header from './components/Header'
import Hero from './components/Hero'
import Features from './components/Features'
import Capabilities from './components/Capabilities'
import Integrations from './components/Integrations'
import Pricing from './components/Pricing'
import Footer from './components/Footer'
import './App.css'

function App() {
  return (
    <div className="app">
      <Header />
      <main>
        <Hero />
        <Features />
        <Capabilities />
        <Integrations />
        <Pricing />
      </main>
      <Footer />
    </div>
  )
}

export default App
