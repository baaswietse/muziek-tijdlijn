// Publieke instellingen van de site. Niets hiervan is geheim.

// Client ID van de Spotify-app (developer.spotify.com/dashboard).
// Een Client Secret is niet nodig en hoort hier niet.
export const SPOTIFY_CLIENT_ID = 'f0f0b2df47324153ba60b5988aca4bc4';

// Adres van de spelserver (Cloudflare Worker), zonder schuine streep op het einde.
const DEFAULT_SERVER_URL = 'https://muziek-tijdlijn.wietse-delclef.workers.dev';

// Bij lokaal ontwikkelen en testen kan VITE_SERVER_URL het adres overschrijven.
export const SERVER_URL = (import.meta.env.VITE_SERVER_URL || DEFAULT_SERVER_URL).replace(/\/+$/, '');

export const APP_NAME = 'Muziek-tijdlijn';
