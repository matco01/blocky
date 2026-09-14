import * as LocalAuthentication from 'expo-local-authentication';

/**
 * Face ID (or fingerprint, or passcode) before anything is signed.
 *
 * The embedded wallet can sign as soon as the app is unlocked, so without this
 * a phone handed over unlocked is a phone that can send money. This is the
 * "tap to approve" moment the confirmation card promises.
 *
 * Falls back to the device passcode when biometrics are unavailable or not
 * enrolled, rather than skipping the check: a device with no biometrics is not
 * a reason to have no gate.
 */
export async function confirmWithBiometrics(reason: string): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
  });

  return result.success;
}
