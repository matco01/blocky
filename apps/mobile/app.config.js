const { existsSync } = require('node:fs');
const { join } = require('node:path');

/**
 * `app.json`, plus what's decided when the app is built.
 *
 * Push on Android goes through Firebase Cloud Messaging, which needs the
 * Firebase project's `google-services.json` next to this file (it holds only
 * public identifiers, so it's committed). Until it's there the app still
 * builds — it just can't get a push token on Android. See "Push
 * notifications" in docs/ENGINEERING.md.
 */
module.exports = ({ config }) =>
  existsSync(join(__dirname, 'google-services.json'))
    ? { ...config, android: { ...config.android, googleServicesFile: './google-services.json' } }
    : config;
