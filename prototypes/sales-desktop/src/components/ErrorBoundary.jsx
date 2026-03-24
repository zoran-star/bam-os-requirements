import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '60px 24px', textAlign: 'center', minHeight: 300,
        }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>&#9888;</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--tp)', marginBottom: 6 }}>Something went wrong</div>
          <div style={{ fontSize: 13, color: 'var(--ts)', maxWidth: 320, lineHeight: 1.5, marginBottom: 16 }}>
            This section ran into an issue. Try refreshing the page.
          </div>
          <button onClick={() => this.setState({ hasError: false, error: null })} style={{
            padding: '10px 24px', background: 'var(--gold)', color: '#fff',
            border: 'none', borderRadius: 'var(--r-md)', fontSize: 13, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'var(--ff)',
          }}>Try again</button>
        </div>
      )
    }
    return this.props.children
  }
}
