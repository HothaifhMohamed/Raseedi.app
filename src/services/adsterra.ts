export const ADSTERRA_BANNER_KEY = '0891c1d3ea3d6bed258a7ebd3c28256b';
export const ADSTERRA_BANNER_SCRIPT_SRC =
  'https://bauval.org/22/0891c1d3ea3d6bed258a7ebd3c28256b';
export const ADSTERRA_BANNER_WIDTH = 320;
export const ADSTERRA_BANNER_HEIGHT = 50;
export const ADSTERRA_BANNER_IFRAME_ID = 'raseedi-adsterra-banner-320x50';
export const ADSTERRA_BANNER_ERROR_MESSAGE = 'raseedi-adsterra-320x50-error';

export const ADSTERRA_BANNER_SANDBOX =
  'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation';

/**
 * Builds the isolated HTML document for Adsterra's 320x50 iframe banner unit.
 * Running inside a dedicated srcdoc iframe keeps `atOptions` and synchronous
 * `document.write()` completely isolated from the React SPA DOM and prevents
 * layout shifts or cross-tab script collisions.
 */
export function buildAdsterraBannerSrcDoc(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
html,body{margin:0;padding:0;width:${ADSTERRA_BANNER_WIDTH}px;height:${ADSTERRA_BANNER_HEIGHT}px;overflow:hidden;background:transparent;display:flex;align-items:center;justify-content:center;}
</style>
</head>
<body>
<script>
window.addEventListener('error',function(ev){
  var target=ev&&ev.target;
  if(target&&target.tagName==='SCRIPT'&&window.parent&&window.parent!==window){
    try{window.parent.postMessage({type:'${ADSTERRA_BANNER_ERROR_MESSAGE}'},'*');}catch(_){}
  }
},true);
atOptions = {
  'key' : '${ADSTERRA_BANNER_KEY}',
  'format' : 'iframe',
  'height' : ${ADSTERRA_BANNER_HEIGHT},
  'width' : ${ADSTERRA_BANNER_WIDTH},
  'params' : {}
};
</script>
<script src="${ADSTERRA_BANNER_SCRIPT_SRC}"></script>
</body>
</html>`;
}

export interface MountAdsterraBannerOptions {
  onError?: () => void;
  doc?: Document;
  title?: string;
}

function removeExistingBannerIframes(doc: Document): void {
  if (typeof doc.querySelectorAll === 'function') {
    const matches = doc.querySelectorAll(`iframe#${ADSTERRA_BANNER_IFRAME_ID}`);
    matches.forEach((node) => {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    });
    return;
  }

  const existing = doc.getElementById(ADSTERRA_BANNER_IFRAME_ID);
  if (existing && existing.parentNode) {
    existing.parentNode.removeChild(existing);
  }
}

/**
 * Safely mounts a single isolated 320x50 Adsterra banner iframe into `hostEl`.
 * Guarantees at most one active banner iframe in the document (cleaning any
 * stale duplicate before mounting) and cleanly removes the iframe on unmount.
 */
export function mountAdsterraBanner320x50(
  hostEl: HTMLElement,
  options: MountAdsterraBannerOptions = {}
): () => void {
  const doc = options.doc || hostEl.ownerDocument || document;
  const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);

  // Ensure strictly one active 320x50 Adsterra banner iframe at a time
  removeExistingBannerIframes(doc);

  const iframe = doc.createElement('iframe');
  iframe.id = ADSTERRA_BANNER_IFRAME_ID;
  iframe.title = options.title || 'Advertisement';
  iframe.width = String(ADSTERRA_BANNER_WIDTH);
  iframe.height = String(ADSTERRA_BANNER_HEIGHT);
  iframe.setAttribute('width', String(ADSTERRA_BANNER_WIDTH));
  iframe.setAttribute('height', String(ADSTERRA_BANNER_HEIGHT));
  iframe.setAttribute('frameborder', '0');
  iframe.setAttribute('scrolling', 'no');
  iframe.setAttribute('loading', 'lazy');
  iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
  iframe.setAttribute('sandbox', ADSTERRA_BANNER_SANDBOX);
  iframe.setAttribute(
    'style',
    `border:0;width:${ADSTERRA_BANNER_WIDTH}px;height:${ADSTERRA_BANNER_HEIGHT}px;max-width:100%;overflow:hidden;display:block;background:transparent;`
  );
  iframe.setAttribute('data-ad-network', 'adsterra');
  iframe.setAttribute('data-ad-key', ADSTERRA_BANNER_KEY);
  iframe.srcdoc = buildAdsterraBannerSrcDoc();

  const onError = options.onError;
  const handleIframeError = () => {
    if (onError) onError();
  };
  iframe.addEventListener('error', handleIframeError, { once: true });

  const handleWindowMessage = (event: MessageEvent) => {
    if (!onError) return;
    if (
      event.data &&
      typeof event.data === 'object' &&
      (event.data as { type?: string }).type === ADSTERRA_BANNER_ERROR_MESSAGE &&
      (!iframe.contentWindow || event.source === iframe.contentWindow)
    ) {
      onError();
    }
  };

  if (win && typeof win.addEventListener === 'function') {
    win.addEventListener('message', handleWindowMessage);
  }

  hostEl.appendChild(iframe);

  return () => {
    if (win && typeof win.removeEventListener === 'function') {
      win.removeEventListener('message', handleWindowMessage);
    }
    if (iframe.parentNode === hostEl) {
      hostEl.removeChild(iframe);
    } else if (iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }
  };
}

/**
 * Completely removes any mounted Adsterra 320x50 banner iframe (called when
 * the user upgrades to PRO/Business, enters an active paid org, or revokes consent).
 */
export function teardownAdsterraBanner320x50(doc: Document = document): void {
  removeExistingBannerIframes(doc);
}
