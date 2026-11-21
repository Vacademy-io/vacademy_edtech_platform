/**
 * Text selection inside a sandboxed document frame (creative HTML slides).
 *
 * The frame has an opaque origin, so the app cannot read its selection. A
 * script injected into the document posts it instead (FRAME_SELECTION_SCRIPT);
 * the frame's host turns the frame-relative box into viewport coordinates and
 * re-broadcasts it on `window` (publishFrameSelection). useSelectionAsk takes
 * it only from a frame inside the container it watches.
 */

export const FRAME_SELECTION_MSG = "vacademy:selection";
export const FRAME_SELECTION_EVENT = "vacademy:frame-selection";

export interface FrameRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface FrameSelectionDetail {
  frame: HTMLIFrameElement;
  /** Empty when the selection was cleared. */
  text: string;
  /** In viewport coordinates of the app, null when cleared. */
  rect: FrameRect | null;
}

/**
 * Mirrors useSelectionAsk inside the frame: mouse selections are reported on
 * pointer-up, touch / keyboard ones on a debounced selectionchange; selections
 * in inputs or editable regions are reported as cleared.
 */
export const FRAME_SELECTION_SCRIPT = `<script>(function(){
  var timer,down=false;
  function editable(n){var e=n&&(n.nodeType===1?n:n.parentElement);
    return !!(e&&e.closest&&e.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"]'));}
  function send(){try{
    var s=document.getSelection(),text='',rect=null;
    if(s&&!s.isCollapsed&&s.rangeCount){
      var r=s.getRangeAt(0);
      if(!editable(r.commonAncestorContainer)&&!editable(document.activeElement)){
        text=s.toString().slice(0,4000);
        var b=r.getBoundingClientRect();
        rect={top:b.top,bottom:b.bottom,left:b.left,right:b.right};
      }
    }
    parent.postMessage({type:'${FRAME_SELECTION_MSG}',text:text,rect:rect},'*');
  }catch(e){}}
  function schedule(ms){clearTimeout(timer);timer=setTimeout(send,ms);}
  document.addEventListener('pointerdown',function(e){if(e.pointerType==='mouse')down=true;},true);
  document.addEventListener('pointerup',function(){down=false;schedule(60);},true);
  document.addEventListener('selectionchange',function(){if(!down)schedule(250);});
})();</script>`;

function isRect(value: unknown): value is FrameRect {
  const r = value as FrameRect | null;
  return (
    !!r &&
    [r.top, r.bottom, r.left, r.right].every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/** Re-broadcast a frame's selection message (its `data`) in app viewport coordinates. */
export function publishFrameSelection(frame: HTMLIFrameElement, data: unknown): void {
  const msg = data as { text?: unknown; rect?: unknown } | null;
  const text = typeof msg?.text === "string" ? msg.text : "";
  let rect: FrameRect | null = null;
  if (text && isRect(msg?.rect)) {
    const box = frame.getBoundingClientRect();
    rect = {
      top: box.top + msg.rect.top,
      bottom: box.top + msg.rect.bottom,
      left: box.left + msg.rect.left,
      right: box.left + msg.rect.right,
    };
  }
  const detail: FrameSelectionDetail = { frame, text: rect ? text : "", rect };
  window.dispatchEvent(new CustomEvent<FrameSelectionDetail>(FRAME_SELECTION_EVENT, { detail }));
}
