export const ADSTERRA_NATIVE_SCRIPT_SRC =
  'https://bauval.org/21/bad6a35cb4587aaf45121214f6b6581c';
export const ADSTERRA_NATIVE_SCRIPT_ID = 'raseedi-adsterra-native-script';
export const ADSTERRA_NATIVE_CONTAINER_ID = 'container-bad6a35cb4587aaf45121214f6b6581c';

let persistentContainer: HTMLDivElement | null = null;
let scriptLoadFailed = false;
const errorListeners = new Set<() => void>();

function notifyScriptError(): void {
  scriptLoadFailed = true;
  errorListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // Ignore individual listener errors
    }
  });
}

function getOrCreateContainer(doc: Document): HTMLDivElement {
  const existingInDoc = doc.getElementById(ADSTERRA_NATIVE_CONTAINER_ID);
  if (existingInDoc && existingInDoc instanceof HTMLDivElement) {
    persistentContainer = existingInDoc;
    return existingInDoc;
  }

  if (persistentContainer && persistentContainer.ownerDocument === doc) {
    return persistentContainer;
  }

  const el = doc.createElement('div');
  el.id = ADSTERRA_NATIVE_CONTAINER_ID;
  persistentContainer = el;
  return el;
}

function findExistingAdsterraScript(doc: Document): HTMLScriptElement | null {
  const byId = doc.getElementById(ADSTERRA_NATIVE_SCRIPT_ID);
  if (byId && byId.tagName === 'SCRIPT') {
    return byId as HTMLScriptElement;
  }
  const bySrc = doc.querySelector(`script[src="${ADSTERRA_NATIVE_SCRIPT_SRC}"]`);
  if (bySrc && bySrc.tagName === 'SCRIPT') {
    return bySrc as HTMLScriptElement;
  }
  return null;
}

export interface MountAdsterraOptions {
  onError?: () => void;
  doc?: Document;
}

/**
 * Safely mounts the singleton Adsterra Native Banner container into `hostEl`
 * and injects the Adsterra script tag at most once per session (even across
 * React StrictMode remounts or tab navigation).
 */
export function mountAdsterraNativeBanner(
  hostEl: HTMLElement,
  options: MountAdsterraOptions = {}
): () => void {
  const doc = options.doc || hostEl.ownerDocument || document;
  const container = getOrCreateContainer(doc);

  if (container.parentElement !== hostEl) {
    hostEl.appendChild(container);
  }

  const onError = options.onError;
  if (onError) {
    if (scriptLoadFailed) {
      onError();
    }
    errorListeners.add(onError);
  }

  let script = findExistingAdsterraScript(doc);
  if (!script && !scriptLoadFailed) {
    script = doc.createElement('script');
    script.id = ADSTERRA_NATIVE_SCRIPT_ID;
    script.async = true;
    script.setAttribute('async', 'async');
    script.setAttribute('data-cfasync', 'false');
    script.src = ADSTERRA_NATIVE_SCRIPT_SRC;
    script.addEventListener('error', notifyScriptError, { once: true });
    (doc.head || doc.body || hostEl).appendChild(script);
  }

  return () => {
    if (onError) {
      errorListeners.delete(onError);
    }
    if (container.parentElement === hostEl) {
      hostEl.removeChild(container);
    }
  };
}

/**
 * Completely removes the injected Adsterra script and clears the singleton
 * container (called when user upgrades to PRO/Business or revokes consent).
 */
export function teardownAdsterraNativeBanner(doc: Document = document): void {
  const existingScript = findExistingAdsterraScript(doc);
  if (existingScript && existingScript.parentNode) {
    existingScript.parentNode.removeChild(existingScript);
  }

  const existingContainer =
    persistentContainer || (doc.getElementById(ADSTERRA_NATIVE_CONTAINER_ID) as HTMLDivElement | null);
  if (existingContainer) {
    existingContainer.innerHTML = '';
    if (existingContainer.parentNode) {
      existingContainer.parentNode.removeChild(existingContainer);
    }
  }

  persistentContainer = null;
  scriptLoadFailed = false;
  errorListeners.clear();
}
