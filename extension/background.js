// Fetches cross-origin images for the content script (page CORS rules would
// otherwise stop it from reading their pixels).
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "fetch-image") {
    (async () => {
      try {
        const r = await fetch(msg.url);
        if (!r.ok) throw new Error("bad status");
        const mime = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
        const buf = new Uint8Array(await r.arrayBuffer());
        let bin = "";
        const chunk = 0x8000;
        for (let i = 0; i < buf.length; i += chunk) {
          bin += String.fromCharCode.apply(null, buf.subarray(i, i + chunk));
        }
        sendResponse({ ok: true, mime, b64: btoa(bin) });
      } catch (e) {
        sendResponse({ ok: false });
      }
    })();
    return true; // keep the channel open for the async response
  }
});
