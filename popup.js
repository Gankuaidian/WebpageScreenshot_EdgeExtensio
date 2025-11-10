async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureInjected() {
  const tab = await getActiveTab();
  const url = tab?.url || '';
  // 只允许在普通网页上注入内容脚本，避免在扩展页/浏览器内部页上报错
  const isSupported = /^(https?:|file:)/i.test(url);
  if (!isSupported) {
    setStatus('请在要截图的网页上使用（当前页不支持注入：' + url + '）');
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['content.js']
    });
    setStatus('内容脚本已注入');
  } catch (e) {
    console.error(e);
    setStatus('注入内容脚本失败：' + e.message);
  }
}

function setStatus(text) {
  document.getElementById('status').textContent = text;
}

async function sendCommand(cmd, payload = {}) {
  const tab = await getActiveTab();
  return chrome.tabs.sendMessage(tab.id, { cmd, payload });
}

document.getElementById('inject').addEventListener('click', ensureInjected);

document.getElementById('selectRegion').addEventListener('click', async () => {
  await ensureInjected();
  const res = await sendCommand('select_region');
  if (res && res.ok) {
    setStatus('区域选择完成：' + JSON.stringify(res.region));
  } else {
    setStatus('区域选择取消或失败');
  }
});

document.getElementById('captureRegion').addEventListener('click', async () => {
  const overlap = Number(document.getElementById('overlap').value || 120);
  await ensureInjected();
  setStatus('开始区域捕获（请手动滚动页面，完成后点击“停止”）…');
  const res = await sendCommand('start_capture', { mode: 'region', overlap });
  if (res && res.ok) setStatus('正在捕获中（请手动滚动页面，完成后点击“停止”）…');
});

document.getElementById('captureFull').addEventListener('click', async () => {
  const overlap = Number(document.getElementById('overlap').value || 120);
  await ensureInjected();
  setStatus('开始整页捕获…');
  const res = await sendCommand('start_capture', { mode: 'full', overlap });
  if (res && res.ok) setStatus('正在捕获中…');
});

document.getElementById('stop').addEventListener('click', async () => {
  // 停止时不要重新注入内容脚本，避免打断当前捕获实例
  await sendCommand('stop_capture');
  setStatus('已请求停止');
});
// 已移除“打开标注页”功能：停止后由内容脚本在页面内弹出截图预览并选择是否保存

// 新增：选择滚动容器与容器捕获
document.getElementById('selectContainer').addEventListener('click', async () => {
  await ensureInjected();
  const res = await sendCommand('select_container');
  if (res && res.ok) {
    setStatus(res.info || '容器选择完成');
    if (document.getElementById('scrollbarInfo')) {
      document.getElementById('scrollbarInfo').textContent = res.info || '容器选择完成';
    }
  } else {
    setStatus('容器选择取消或失败');
  }
});

document.getElementById('captureContainer').addEventListener('click', async () => {
  const overlap = Number(document.getElementById('overlap').value || 120);
  await ensureInjected();
  setStatus('开始容器捕获…');
  const res = await sendCommand('start_capture', { mode: 'container', overlap });
  if (res && res.ok) setStatus('正在捕获中…');
});

// 自动检测滚动条并绑定
document.getElementById('autoDetectScrollbar').addEventListener('click', async () => {
  await ensureInjected();
  const res = await sendCommand('auto_pick_scrollbar');
  if (res && res.ok) {
    setStatus(res.info);
    const infoEl = document.getElementById('scrollbarInfo');
    if (infoEl) infoEl.textContent = res.info;
  } else {
    setStatus(res?.info || '未检测到滚动容器，将使用窗口滚动');
    const infoEl = document.getElementById('scrollbarInfo');
    if (infoEl) infoEl.textContent = res?.info || '未检测到滚动容器，将使用窗口滚动';
  }
});

// 清除绑定
document.getElementById('clearScrollbar').addEventListener('click', async () => {
  await ensureInjected();
  const res = await sendCommand('clear_scrollbar');
  const msg = res && res.ok ? res.info : '清除失败';
  setStatus(msg);
  const infoEl = document.getElementById('scrollbarInfo');
  if (infoEl) infoEl.textContent = msg;
});

// 只纵向容器开关
const verticalOnlyEl = document.getElementById('verticalOnly');
verticalOnlyEl.addEventListener('change', async () => {
  await ensureInjected();
  const res = await sendCommand('set_vertical_only_preference', { value: verticalOnlyEl.checked });
  const msg = res && res.ok ? res.info : '设置失败';
  setStatus(msg);
});

// 候选列表刷新与绑定
const candidateSelect = document.getElementById('candidateSelect');
document.getElementById('refreshCandidates').addEventListener('click', async () => {
  await ensureInjected();
  const res = await sendCommand('list_scroll_candidates', { verticalOnly: verticalOnlyEl.checked });
  if (res && res.ok) {
    candidateSelect.innerHTML = '';
    (res.candidates || []).forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.label;
      candidateSelect.appendChild(opt);
    });
    setStatus(`候选数：${(res.candidates || []).length}`);
  } else {
    setStatus('刷新候选列表失败');
  }
});

document.getElementById('bindCandidate').addEventListener('click', async () => {
  await ensureInjected();
  const id = candidateSelect.value;
  if (!id) { setStatus('请先选择候选项'); return; }
  const res = await sendCommand('bind_scroll_candidate', { id });
  if (res && res.ok) {
    setStatus(res.info);
    const infoEl = document.getElementById('scrollbarInfo');
    if (infoEl) infoEl.textContent = res.info;
  } else {
    setStatus(res?.info || '绑定失败');
  }
});