import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectStandaloneMode,
  detectIOSDevice,
  getInstallActionKind,
  canShowDirectInstallButton,
} from './pwaInstallLogic';

describe('pwaInstallLogic', () => {
  describe('detectStandaloneMode', () => {
    it('returns true when display-mode: standalone matches', () => {
      assert.equal(detectStandaloneMode({ displayModeStandalone: true }), true);
    });

    it('returns true when display-mode: window-controls-overlay matches', () => {
      assert.equal(detectStandaloneMode({ displayModeWindowControlsOverlay: true }), true);
    });

    it('returns true when navigator.standalone is true (iOS home screen)', () => {
      assert.equal(detectStandaloneMode({ navigatorStandalone: true }), true);
    });

    it('returns true for Trusted Web Activity android-app referrer', () => {
      assert.equal(
        detectStandaloneMode({ referrer: 'android-app://com.raseedi.app' }),
        true
      );
    });

    it('returns false in regular browser tabs', () => {
      assert.equal(
        detectStandaloneMode({
          displayModeStandalone: false,
          displayModeWindowControlsOverlay: false,
          navigatorStandalone: false,
          referrer: 'https://google.com',
        }),
        false
      );
    });
  });

  describe('detectIOSDevice', () => {
    it('detects iPhone Safari user agent', () => {
      assert.equal(
        detectIOSDevice(
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
        ),
        true
      );
    });

    it('detects classic iPad and iPadOS desktop-mode with touch points', () => {
      assert.equal(detectIOSDevice('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)'), true);
      assert.equal(
        detectIOSDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5),
        true
      );
    });

    it('does not misclassify macOS desktop without touch or Android/Windows', () => {
      assert.equal(
        detectIOSDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0),
        false
      );
      assert.equal(
        detectIOSDevice(
          'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36',
          5
        ),
        false
      );
      assert.equal(
        detectIOSDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0'),
        false
      );
    });
  });

  describe('getInstallActionKind & canShowDirectInstallButton', () => {
    it('returns none and hides button when already installed in standalone mode', () => {
      assert.equal(
        getInstallActionKind({ isInstalled: true, hasDeferredPrompt: true, isIOS: false }),
        'none'
      );
      assert.equal(
        getInstallActionKind({ isInstalled: true, hasDeferredPrompt: false, isIOS: true }),
        'none'
      );
      assert.equal(
        canShowDirectInstallButton({ isInstalled: true, hasDeferredPrompt: true, isIOS: true }),
        false
      );
    });

    it('returns native-prompt when beforeinstallprompt is captured on Desktop or Android', () => {
      assert.equal(
        getInstallActionKind({ isInstalled: false, hasDeferredPrompt: true, isIOS: false }),
        'native-prompt'
      );
      assert.equal(
        canShowDirectInstallButton({ isInstalled: false, hasDeferredPrompt: true, isIOS: false }),
        true
      );
    });

    it('returns ios-guide on iOS Safari when not installed and no beforeinstallprompt exists', () => {
      assert.equal(
        getInstallActionKind({ isInstalled: false, hasDeferredPrompt: false, isIOS: true }),
        'ios-guide'
      );
      assert.equal(
        canShowDirectInstallButton({ isInstalled: false, hasDeferredPrompt: false, isIOS: true }),
        true
      );
    });

    it('returns none when not installed, not iOS, and no beforeinstallprompt was captured', () => {
      assert.equal(
        getInstallActionKind({ isInstalled: false, hasDeferredPrompt: false, isIOS: false }),
        'none'
      );
      assert.equal(
        canShowDirectInstallButton({ isInstalled: false, hasDeferredPrompt: false, isIOS: false }),
        false
      );
    });
  });
});
