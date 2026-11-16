import { render } from 'preact';
import { App } from './app.jsx';
import { completeLogin } from './spotify/index.js';
import './styles.css';

// Komt de host net terug van Spotify, rond dan eerst het inloggen af.
completeLogin().then((loginResult) => {
  render(<App loginResult={loginResult} />, document.getElementById('app'));
});
