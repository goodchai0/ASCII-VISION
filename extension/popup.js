const DEFAULTS = { enabled: false, mode: "green", detail: 240 };
const toggle = document.getElementById("toggle");
const mode = document.getElementById("mode");
const detail = document.getElementById("detail");
const detailVal = document.getElementById("detailVal");
const status = document.getElementById("status");

function render(s) {
  toggle.textContent = s.enabled ? "TURN OFF" : "TURN ON";
  toggle.className = s.enabled ? "off" : "";
  mode.value = s.mode;
  detail.value = s.detail;
  detailVal.textContent = s.detail;
}

// Make sure the script is running in the current tab (so no page reload is needed).
async function inject() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ["content.js"]
    });
  } catch (e) {
    status.textContent = "Can't run on this page (chrome:// pages and the Web Store are blocked).";
  }
}

inject();
chrome.storage.sync.get(DEFAULTS, render);

toggle.addEventListener("click", async () => {
  await inject();
  chrome.storage.sync.get(DEFAULTS, (s) => {
    const enabled = !s.enabled;
    chrome.storage.sync.set({ enabled });
    render({ ...s, enabled });
  });
});

mode.addEventListener("change", () => chrome.storage.sync.set({ mode: mode.value }));

detail.addEventListener("input", () => {
  detailVal.textContent = detail.value;
  chrome.storage.sync.set({ detail: parseInt(detail.value, 10) });
});
