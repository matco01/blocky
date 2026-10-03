import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * blocky.page/export, built into ../public/export and committed, so the
 * website itself never needs an install or a build step.
 *
 * The page must use the same Privy app as the mobile app, so its id comes from
 * the app's own .env (or PRIVY_APP_ID). It's a public identifier — it ships
 * inside the app too — and it's the only value read from that file.
 */
function privyAppId() {
  if (process.env.PRIVY_APP_ID) return process.env.PRIVY_APP_ID;
  const env = readFileSync(fileURLToPath(new URL('../../mobile/.env', import.meta.url)), 'utf8');
  const match = env.match(/^EXPO_PUBLIC_PRIVY_APP_ID=(.+)$/m);
  if (!match) throw new Error('Set PRIVY_APP_ID, or EXPO_PUBLIC_PRIVY_APP_ID in apps/mobile/.env');
  return match[1].trim().replace(/^["']|["']$/g, '');
}

export default defineConfig({
  plugins: [react()],
  base: '/export/',
  define: { __PRIVY_APP_ID__: JSON.stringify(privyAppId()) },
  build: {
    outDir: '../public/export',
    emptyOutDir: true,
    sourcemap: false,
  },
});
