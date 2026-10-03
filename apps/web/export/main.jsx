/*
 * blocky.page/export — where a Blocky user takes their private key elsewhere.
 *
 * Privy's mobile SDKs don't export keys, on purpose: export needs a browser's
 * origin isolation. So the app opens this page in a WebView, the user signs in
 * again, and Privy's own modal shows the key. That modal is an iframe on
 * Privy's domain — the key is assembled there, and neither this page, the app
 * nor Blocky's server can read it. That is what keeps Blocky non-custodial.
 *
 * Never use useGetWalletPrivateKey here: it would hand the raw key to this
 * page's own code, which is exactly what the iframe exists to prevent.
 *
 * The app opens this page in a browser tab (Custom Tabs), not a WebView:
 * Google refuses to sign anyone in inside an embedded WebView, and a tab is one
 * the app can't reach into. When the user is done, the page sends them back
 * with a blocky:// link.
 *
 * The app passes the wallet it expects and the email to prefill in the URL
 * fragment (#from=app&address=…&email=…). A fragment is never sent to any
 * server, so neither ends up in a log.
 *
 * Every visit starts signed out. A browser tab keeps its session, and a page
 * that stayed signed in would let whoever picks up the phone next export the
 * key without the app's fingerprint check.
 */
import { PrivyProvider, useExportWallet, useLogout, usePrivy } from '@privy-io/react-auth';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

const params = new URLSearchParams(window.location.hash.slice(1));
const EXPECTED = (params.get('address') || '').toLowerCase();
const EMAIL = params.get('email') || '';
const FROM_APP = params.get('from') === 'app';

/**
 * Tell the app what happened, by sending the user back to it. The address is
 * fixed: a return URL taken from the link would make this page an open
 * redirect. Opened outside the app, there is nobody to tell.
 */
function tellApp(message) {
  if (FROM_APP) window.location.href = `blocky://?export=${encodeURIComponent(message.status)}`;
  else if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
}

function embeddedWallet(user) {
  const wallet = user?.linkedAccounts?.find(
    (account) => account.type === 'wallet' && account.walletClientType === 'privy' && account.chainType === 'ethereum',
  );
  return wallet?.address?.toLowerCase() || null;
}

function Shell({ children }) {
  return (
    <main className="export wrap">
      <div className="export-head">
        <img src="/img/neutral.webp" alt="" width="72" height="72" />
        <p className="eyebrow">Your wallet</p>
        <h1>Export your private key</h1>
      </div>
      {children}
    </main>
  );
}

function Warning() {
  return (
    <div className="export-warning" role="note">
      <strong>Anyone with this key can take all your money.</strong>
      <span>
        Only use it to move your wallet into another wallet app you trust, like MetaMask. Never share it, never paste it
        into a website, and never send it to anyone. Blocky will never ask you for it.
      </span>
    </div>
  );
}

function ExportPage() {
  const { ready, authenticated, user, login } = usePrivy();
  const { exportWallet } = useExportWallet();
  const { logout } = useLogout();
  const [state, setState] = useState('idle'); // idle | open | done | error
  const [error, setError] = useState('');
  // Whether any session this tab arrived with has been ended.
  const [fresh, setFresh] = useState(false);

  useEffect(() => {
    if (!ready || fresh) return;
    if (authenticated) logout().finally(() => setFresh(true));
    else setFresh(true);
    // Only the state on arrival matters; signing in afterwards must not undo it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  if (!ready || !fresh) {
    return (
      <Shell>
        <p className="export-muted">Loading…</p>
      </Shell>
    );
  }

  const cancel = (
    <button type="button" className="export-link" onClick={() => tellApp({ status: 'cancel' })}>
      Cancel
    </button>
  );

  if (!authenticated) {
    return (
      <Shell>
        <Warning />
        <ol className="export-steps">
          <li><b>Sign in again.</b> We ask every time, so nobody holding your unlocked phone can do this.</li>
          <li><b>Copy your key</b> into the other wallet app.</li>
        </ol>
        <button
          type="button"
          className="block export-cta"
          onClick={() =>
            login({
              loginMethods: ['email', 'google'],
              disableSignup: true,
              ...(EMAIL ? { prefill: { type: 'email', value: EMAIL } } : {}),
            })
          }
        >
          Sign in to continue
        </button>
        {cancel}
      </Shell>
    );
  }

  const address = embeddedWallet(user);

  if (!address || (EXPECTED && address !== EXPECTED)) {
    return (
      <Shell>
        <div className="export-warning">
          <strong>{address ? 'That’s a different account.' : 'No Blocky wallet on this account.'}</strong>
          <span>Sign in with the same email or Google account you use in the Blocky app.</span>
        </div>
        <button type="button" className="block export-cta" onClick={() => void logout()}>
          Sign in with another account
        </button>
        {cancel}
      </Shell>
    );
  }

  async function show() {
    setState('open');
    setError('');
    try {
      await exportWallet({ address });
      setState('done');
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : String(e));
      tellApp({ status: 'error', error: String(e) });
    }
  }

  function finish() {
    // Leave nothing behind: the session on this page ends with the export.
    // Not awaited: the trip back to the app has to start inside the tap.
    void logout().catch(() => {});
    tellApp({ status: 'done' });
  }

  return (
    <Shell>
      <Warning />
      <p className="export-muted">
        Wallet <code>{address.slice(0, 6)}…{address.slice(-4)}</code>
      </p>
      {state === 'done' ? (
        <>
          <div className="export-ok">
            <strong>All done.</strong>
            <span>Your key is still in Blocky too — exporting it doesn't move or remove anything.</span>
          </div>
          <button type="button" className="block export-cta" onClick={finish}>
            {FROM_APP ? 'Back to Blocky' : 'Done'}
          </button>
        </>
      ) : (
        <>
          <button type="button" className="block export-cta" disabled={state === 'open'} onClick={() => void show()}>
            {state === 'open' ? 'Showing your key…' : 'Show my private key'}
          </button>
          {state === 'error' ? <p className="export-error">Couldn't show your key: {error}</p> : null}
          {cancel}
        </>
      )}
    </Shell>
  );
}

createRoot(document.getElementById('root')).render(
  <PrivyProvider
    appId={__PRIVY_APP_ID__}
    config={{
      appearance: { theme: 'dark', accentColor: '#7DBE5A', logo: '/img/neutral.webp', showWalletLoginFirst: false },
      // This page only ever exports: it must never create a wallet.
      embeddedWallets: { ethereum: { createOnLogin: 'off' } },
    }}
  >
    <ExportPage />
  </PrivyProvider>,
);
