import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

class Boundary extends React.Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  render() { return this.state.err ? <div className="wrap section"><h1>Something went wrong</h1><p className="muted">{String(this.state.err.message)}</p><a className="btn" href="/">Back to home</a></div> : this.props.children; }
}
createRoot(document.getElementById('root')).render(<Boundary><App /></Boundary>);
import './experience.css';
