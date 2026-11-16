import { connect } from './connect.js';
import { mock } from './mock.js';
import { detectMock } from '../lib/session.js';

export const isMock = detectMock();

/** De laag die de muziek aanstuurt: echt (Spotify Connect) of nagebootst. */
export const player = isMock ? mock : connect;

export { completeLogin, redirectUri } from './auth.js';
