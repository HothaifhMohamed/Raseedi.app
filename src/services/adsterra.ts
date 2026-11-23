export const ADSTERRA_BANNER_KEY = '0891c1d3ea3d6bed258a7ebd3c28256b';
export const ADSTERRA_BANNER_SCRIPT_SRC =
  'https://bauval.org/22/0891c1d3ea3d6bed258a7ebd3c28256b';
export const ADSTERRA_BANNER_WIDTH = 320;
export const ADSTERRA_BANNER_HEIGHT = 50;
export const ADSTERRA_BANNER_IFRAME_ID = 'raseedi-adsterra-banner-320x50';
export const ADSTERRA_BANNER_ERROR_MESSAGE = 'raseedi-adsterra-320x50-error';
export const ADSTERRA_BANNER_FILLED_MESSAGE = 'raseedi-adsterra-320x50-filled';
export const ADSTERRA_BANNER_NO_FILL_MESSAGE = 'raseedi-adsterra-320x50-no-fill';
export const ADSTERRA_NO_FILL_TIMEOUT_MS = 4500;

export const ADSTERRA_BANNER_SANDBOX =
  'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation';

export type AdBannerTheme = 'light' | 'dark';
export type AdBannerLoadState = 'loading' | 'filled' | 'no-fill' | 'error';
export type AdBannerVisibility = 'hidden' | 'loading-hidden' | 'visible';

export interface ResolveAdBannerVisibilityParams {
  showAds: boolean;
  hasConsent: boolean;
  isOnline: boolean;
  loadState: AdBannerLoadState;
}

/**
 * Resolves how the banner container should render so users NEVER see an empty
 * or bright-white 320x50 rectangle while loading or on No-Fill/error:
 * - `'hidden'`: collapsed completely (`return null`) with zero height & zero iframe.
 * - `'loading-hidden'`: mounted off-visual-flow (`h-0 opacity-0`) so Adsterra can
 *   load and report fill status without displaying any blank white box.
 * - `'visible'`: revealed cleanly inside the theme-matched card once an actual ad fills.
 */
export function resolveAdBannerVisibility(
  params: ResolveAdBannerVisibilityParams
): AdBannerVisibility {
  if (!params.showAds || !params.hasConsent || !params.isOnline) {
    return 'hidden';
  }
  if (params.loadState === 'filled') {
    return 'visible';
  }
  if (params.loadState === 'loading') {
    return 'loading-hidden';
  }
  return 'hidden';
}

export interface BuildAdsterraSrcDocOptions {
  theme?: AdBannerTheme;
}

/**
 * Builds the isolated HTML document for Adsterra's 320x50 iframe banner unit.
 * - Matches the host `color-scheme` (`dark` or `light`) with a transparent
 *   canvas so browsers never paint an opaque white backdrop in Dark Mode.
 * - Keeps `atOptions` and synchronous `document.write()` completely isolated
 *   from the React SPA DOM.
 * - Observes DOM mutations to report `filled`, `no-fill`, or `error` back to
 *   the host container so empty/No-Fill boxes never appear on screen.
 */
export function buildAdsterraBannerSrcDoc(
  options: BuildAdsterraSrcDocOptions = {}
): string {
  const colorScheme: AdBannerTheme = options.theme === 'dark' ? 'dark' : 'light';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="${colorScheme}" />
<style>
:root{color-scheme:${colorScheme};}
html,body{margin:0;padding:0;width:${ADSTERRA_BANNER_WIDTH}px;height:${ADSTERRA_BANNER_HEIGHT}px;overflow:hidden;background:transparent!important;background-color:transparent!important;color-scheme:${colorScheme};display:flex;align-items:center;justify-content:center;}
</style>
</head>
<body>
<script>
(function(){
  var settled=false;
  function postStatus(type){
    if(settled)return;
    settled=true;
    if(window.parent&&window.parent!==window){
      try{window.parent.postMessage({type:type},'*');}catch(_){}
    }
  }
  function isVisibleCreativeNode(node){
    if(!node||node.nodeType!==1)return false;
    var tag=node.tagName;
    if(tag==='SCRIPT'||tag==='STYLE'||tag==='META'||tag==='LINK'||tag==='NOSCRIPT')return false;
    var rect=node.getBoundingClientRect?node.getBoundingClientRect():null;
    var w=rect?rect.width:0;
    var h=rect?rect.height:0;
    if(tag==='IFRAME'){
      var attrW=parseInt(node.getAttribute('width')||'0',10)||0;
      var attrH=parseInt(node.getAttribute('height')||'0',10)||0;
      var effW=Math.max(w,attrW);
      var effH=Math.max(h,attrH);
      var hasSrc=Boolean(node.getAttribute('src')||node.getAttribute('srcdoc'));
      return effW>=100&&effH>=25&&(hasSrc||node.contentDocument!==null);
    }
    if(tag==='IMG'){
      var imgW=Math.max(w,node.naturalWidth||0);
      var imgH=Math.max(h,node.naturalHeight||0);
      return imgW>=50&&imgH>=20;
    }
    if(tag==='CANVAS'||tag==='SVG'||tag==='OBJECT'||tag==='EMBED'||tag==='VIDEO'){
      return w>=50&&h>=20;
    }
    if(w>=100&&h>=25){
      var hasMedia=Boolean(node.querySelector&&node.querySelector('iframe,img,canvas,svg,a,ins'));
      var hasText=Boolean((node.textContent||'').trim().length>0);
      if(hasMedia||hasText)return true;
    }
    return false;
  }
  function hasFilledAd(){
    if(!document.body)return false;
    var all=document.body.querySelectorAll('*');
    for(var i=0;i<all.length;i++){
      if(isVisibleCreativeNode(all[i]))return true;
    }
    return false;
  }
  function checkAndReport(){
    if(settled)return;
    if(hasFilledAd()){
      postStatus('${ADSTERRA_BANNER_FILLED_MESSAGE}');
    }
  }
  window.addEventListener('error',function(ev){
    var target=ev&&ev.target;
    if(target&&target.tagName==='SCRIPT'){
      postStatus('${ADSTERRA_BANNER_ERROR_MESSAGE}');
    }
  },true);
  if(typeof MutationObserver!=='undefined'){
    var observer=new MutationObserver(function(){
      checkAndReport();
      if(settled)observer.disconnect();
    });
    if(document.body){
      observer.observe(document.body,{childList:true,subtree:true,attributes:true});
    }
  }
  window.addEventListener('load',function(){
    checkAndReport();
    if(settled)return;
    var checks=0;
    var poll=window.setInterval(function(){
      checks+=1;
      checkAndReport();
      if(settled||checks>=8){
        window.clearInterval(poll);
        if(!settled){
          postStatus('${ADSTERRA_BANNER_NO_FILL_MESSAGE}');
        }
      }
    },200);
  });
})();
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
  onFilled?: () => void;
  onNoFill?: () => void;
  onError?: () => void;
  timeoutMs?: number;
  theme?: AdBannerTheme;
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
 * - Guarantees at most one active banner iframe in the document.
 * - Matches host theme `color-scheme` with transparent background.
 * - Emits at most one terminal callback (`onFilled`, `onNoFill`, or `onError`)
 *   and falls back to `onNoFill` if no creative renders within `timeoutMs`.
 */
export function mountAdsterraBanner320x50(
  hostEl: HTMLElement,
  options: MountAdsterraBannerOptions = {}
): () => void {
  const doc = options.doc || hostEl.ownerDocument || document;
  const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
  const theme: AdBannerTheme = options.theme === 'dark' ? 'dark' : 'light';
  const timeoutMs =
    typeof options.timeoutMs === 'number' && options.timeoutMs > 0
      ? options.timeoutMs
      : ADSTERRA_NO_FILL_TIMEOUT_MS;

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
  iframe.setAttribute('allowtransparency', 'true');
  iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
  iframe.setAttribute('sandbox', ADSTERRA_BANNER_SANDBOX);
  iframe.setAttribute(
    'style',
    `border:0;width:${ADSTERRA_BANNER_WIDTH}px;height:${ADSTERRA_BANNER_HEIGHT}px;max-width:100%;overflow:hidden;display:block;background:transparent;background-color:transparent;color-scheme:${theme};`
  );
  iframe.setAttribute('data-ad-network', 'adsterra');
  iframe.setAttribute('data-ad-key', ADSTERRA_BANNER_KEY);
  iframe.setAttribute('data-ad-theme', theme);
  iframe.srcdoc = buildAdsterraBannerSrcDoc({ theme });

  let settled = false;
  let noFillTimer: ReturnType<typeof setTimeout> | null = null;

  const clearNoFillTimer = () => {
    if (noFillTimer !== null) {
      clearTimeout(noFillTimer);
      noFillTimer = null;
    }
  };

  const settle = (outcome: 'filled' | 'no-fill' | 'error') => {
    if (settled) return;
    settled = true;
    clearNoFillTimer();
    if (outcome === 'filled') {
      options.onFilled?.();
    } else if (outcome === 'no-fill') {
      options.onNoFill?.();
    } else {
      options.onError?.();
    }
  };

  const handleIframeError = () => {
    settle('error');
  };
  iframe.addEventListener('error', handleIframeError, { once: true });

  const handleWindowMessage = (event: MessageEvent) => {
    if (
      !event.data ||
      typeof event.data !== 'object' ||
      (iframe.contentWindow && event.source && event.source !== iframe.contentWindow)
    ) {
      return;
    }

    const msgType = (event.data as { type?: string }).type;
    if (msgType === ADSTERRA_BANNER_FILLED_MESSAGE) {
      settle('filled');
    } else if (msgType === ADSTERRA_BANNER_NO_FILL_MESSAGE) {
      settle('no-fill');
    } else if (msgType === ADSTERRA_BANNER_ERROR_MESSAGE) {
      settle('error');
    }
  };

  if (win && typeof win.addEventListener === 'function') {
    win.addEventListener('message', handleWindowMessage);
  }

  if (options.onNoFill) {
    noFillTimer = setTimeout(() => {
      settle('no-fill');
    }, timeoutMs);
  }

  hostEl.appendChild(iframe);

  return () => {
    settled = true;
    clearNoFillTimer();
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
 * the user upgrades to PRO/Business, enters an active paid org, or no ad fills).
 */
export function teardownAdsterraBanner320x50(doc: Document = document): void {
  removeExistingBannerIframes(doc);
}
