// 标注页：加载最终图像，支持画线、缩放与保存

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('canvasWrap');
const liveBindCheckbox = document.getElementById('liveBind');
const bindStatusEl = document.getElementById('bindStatus');

let baseImg = null;
let scale = 1.0;
let drawing = false;
let lastX = 0, lastY = 0;
let colorInput = document.getElementById('color');

let boundTabId = undefined;
let bindingEnabled = false;

function setBindStatus(text) {
  if (bindStatusEl) bindStatusEl.textContent = text || '';
}

function hasExtensionAPI() {
  return typeof chrome !== 'undefined' && !!chrome.runtime;
}

function resizeCanvasToImage() {
  if (!baseImg) return;
  canvas.width = Math.floor(baseImg.width * scale);
  canvas.height = Math.floor(baseImg.height * scale);
}

function render() {
  if (!baseImg) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(baseImg, 0, 0, baseImg.width, baseImg.height, 0, 0, canvas.width, canvas.height);
}

async function loadImage(tabId) {
  // 读取指定标签页的截图数据；若未指定则读取默认键
  if (!hasExtensionAPI()) { setBindStatus('预览模式：无法访问扩展接口'); return; }
  const payload = tabId ? { type: 'get_image_data', tabId } : { type: 'get_image_data' };
  const res = await chrome.runtime.sendMessage(payload);
  if (!res || !res.ok || !res.dataUrl) {
    // 当指定 tabId 下无数据时，尝试回退到“最后一次截图”（不带 tabId）
    if (tabId) {
      const fallback = await chrome.runtime.sendMessage({ type: 'get_image_data' });
      if (fallback && fallback.ok && fallback.dataUrl) {
        baseImg = new Image();
        baseImg.onload = () => { resizeCanvasToImage(); render(); };
        baseImg.src = fallback.dataUrl;
        setBindStatus(`标签页 ${tabId}：未找到截图，已回退到最后一次截图`);
        return;
      }
      setBindStatus(`标签页 ${tabId}：未找到截图数据`);
      return;
    } else {
      setBindStatus('未找到最终截图数据');
      return;
    }
  }
  baseImg = new Image();
  baseImg.onload = () => { resizeCanvasToImage(); render(); };
  baseImg.src = res.dataUrl;
  if (tabId) setBindStatus(`已加载标签页 ${tabId} 的截图`);
}

async function getActiveTabId() {
  if (!hasExtensionAPI() || !chrome.tabs) return undefined;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function updateActiveBinding() {
  if (!bindingEnabled) return;
  const activeId = await getActiveTabId();
  if (!activeId) { setBindStatus('未检测到活动标签页'); return; }
  if (boundTabId !== activeId) {
    boundTabId = activeId;
  }
  await loadImage(boundTabId);
}

function onActivated() { updateActiveBinding(); }
function onWindowFocusChanged() { updateActiveBinding(); }

function enableBinding() {
  if (bindingEnabled) return;
  bindingEnabled = true;
  if (hasExtensionAPI() && chrome.tabs && chrome.windows) {
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.windows.onFocusChanged.addListener(onWindowFocusChanged);
  }
  updateActiveBinding();
  setBindStatus('实时绑定已开启');
}

function disableBinding() {
  if (!bindingEnabled) return;
  bindingEnabled = false;
  if (hasExtensionAPI() && chrome.tabs && chrome.windows) {
    try { chrome.tabs.onActivated.removeListener(onActivated); } catch {}
    try { chrome.windows.onFocusChanged.removeListener(onWindowFocusChanged); } catch {}
  }
  setBindStatus('实时绑定已关闭');
}

// 画线
canvas.addEventListener('mousedown', (e) => {
  drawing = true;
  const rect = canvas.getBoundingClientRect();
  lastX = e.clientX - rect.left;
  lastY = e.clientY - rect.top;
});
canvas.addEventListener('mousemove', (e) => {
  if (!drawing) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  ctx.strokeStyle = colorInput.value;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(x, y);
  ctx.stroke();
  lastX = x; lastY = y;
});
canvas.addEventListener('mouseup', () => drawing = false);
canvas.addEventListener('mouseleave', () => drawing = false);

// 缩放（Ctrl+滚轮缩放，或使用按钮重置）
wrap.addEventListener('wheel', (e) => {
  if (!baseImg) return;
  if (!e.ctrlKey) return; // 仅在按住 Ctrl 时进行缩放，避免与页面滚动冲突
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 0.9;
  scale = Math.min(5, Math.max(0.2, scale * factor));
  resizeCanvasToImage();
  render();
});

document.getElementById('resetZoom').addEventListener('click', () => {
  scale = 1.0; resizeCanvasToImage(); render();
});

document.getElementById('save').addEventListener('click', async () => {
  // 下载当前画布内容为 PNG
  const dataUrl = canvas.toDataURL('image/png');
  const ts = new Date();
  const name = `scrolling_screenshot_${ts.getFullYear()}${String(ts.getMonth()+1).padStart(2,'0')}${String(ts.getDate()).padStart(2,'0')}_${String(ts.getHours()).padStart(2,'0')}${String(ts.getMinutes()).padStart(2,'0')}${String(ts.getSeconds()).padStart(2,'0')}.png`;
  await chrome.downloads.download({ url: dataUrl, filename: name, saveAs: true });
});

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  const url = new URL(window.location.href);
  const tabIdStr = url.searchParams.get('tabId');
  if (tabIdStr) {
    boundTabId = parseInt(tabIdStr, 10);
    // 默认关闭实时绑定，按指定 tabId 加载
    if (liveBindCheckbox) liveBindCheckbox.checked = false;
    disableBinding();
    await loadImage(boundTabId);
    setBindStatus(`已绑定指定标签页 ${boundTabId}`);
  } else {
    // 默认开启实时绑定，跟随当前活动标签页
    if (liveBindCheckbox) liveBindCheckbox.checked = true;
    enableBinding();
  }
});

if (liveBindCheckbox) {
  liveBindCheckbox.addEventListener('change', async (e) => {
    if (e.target.checked) {
      enableBinding();
    } else {
      disableBinding();
    }
  });
}