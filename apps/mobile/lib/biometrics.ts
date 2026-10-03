import * as LocalAuthentication from 'expo-local-authentication';

/**
 * Fingerprint, face or passcode before anything is signed — whatever the phone
 * has.
 *
 * The embedded wallet can sign as soon as the app is unlocked, so without this
 * a phone handed over unlocked is a phone that can send money.
 *
 * Android: only Class 3 ("strong") biometrics count — a real fingerprint
 * sensor or secure face unlock. Class 2 includes camera-only face unlock that a
 * photo can fool on some phones, which is not good enough to approve money.
 * The device PIN remains a fallback, so a phone without strong biometrics can
 * still approve with its lock-screen PIN.
 */
export type Approval = { ok: true } | { ok: false; message: string | null };

export async function confirmWithBiometrics(reason: string): Promise<Approval> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
    biometricsSecurityLevel: 'strong',
  });

  if (result.success) return { ok: true };

  switch (result.error) {
    // The user backed out. Say nothing; they know.
    case 'user_cancel':
    case 'system_cancel':
    case 'app_cancel':
      return { ok: false, message: null };

    // The failure that used to be silent: no lock screen, so nothing can approve.
    case 'not_enrolled':
    case 'passcode_not_set':
    case 'not_available':
      return {
        ok: false,
        message:
          'Set up a screen lock (a PIN, pattern or fingerprint) on this phone first. Blocky uses it to make sure it’s really you before money moves or your key is shown.',
      };

    case 'lockout':
      return { ok: false, message: 'Too many attempts. Unlock your phone and try again.' };

    default:
      return { ok: false, message: "Couldn't confirm it's you. Try again." };
  }
}
