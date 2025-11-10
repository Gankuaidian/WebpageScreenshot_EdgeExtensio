// 内容脚本：区域选择、滚动捕获与拼接

let selection = null; // {x, y, width, height} 相对于视口
let capturing = false;
let overlapPx = 120;
let containerEl = null; // 当前绑定的滚动容器（自动检测或用户选择）
let containerIframeCtx = null; // 若绑定的是 iframe，则记录其内部滚动上下文 { iframeEl, scrollingEl, win, doc }
let verticalOnlyPreferred = false; // 全局偏好：只选择纵向可滚动容器
let candidateCache = new Map(); // id -> { el, type, iframeCtx, score, label }

// 创建覆盖层用于选择区域
function createOverlay() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.background = 'rgba(0,0,0,0.2)';
    overlay.style.zIndex = '2147483647';
    overlay.style.cursor = 'crosshair';

    const guide = document.createElement('div');
    guide.style.position = 'absolute';
    guide.style.border = '2px solid #e74c3c';
    guide.style.pointerEvents = 'none';
    overlay.appendChild(guide);

    let startX = 0, startY = 0;
    function onMouseDown(e) {
      startX = e.clientX; startY = e.clientY;
      guide.style.left = startX + 'px';
      guide.style.top = startY + 'px';
      guide.style.width = '0px';
      guide.style.height = '0px';
    }
    function onMouseMove(e) {
      const x1 = Math.min(startX, e.clientX);
      const y1 = Math.min(startY, e.clientY);
      const x2 = Math.max(startX, e.clientX);
      const y2 = Math.max(startY, e.clientY);
      guide.style.left = x1 + 'px';
      guide.style.top = y1 + 'px';
      guide.style.width = (x2 - x1) + 'px';
      guide.style.height = (y2 - y1) + 'px';
    }
    function onMouseUp(e) {
      const x1 = Math.min(startX, e.clientX);
      const y1 = Math.min(startY, e.clientY);
      const x2 = Math.max(startX, e.clientX);
      const y2 = Math.max(startY, e.clientY);
      selection = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
      cleanup();
      resolve(selection);
    }
    function onKey(e) {
      if (e.key === 'Escape') { cleanup(); resolve(null); }
    }
    function cleanup() {
      overlay.removeEventListener('mousedown', onMouseDown);
      overlay.removeEventListener('mousemove', onMouseMove);
      overlay.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keydown', onKey);
      overlay.remove();
    }

    overlay.addEventListener('mousedown', onMouseDown);
    overlay.addEventListener('mousemove', onMouseMove);
    overlay.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  });
}

// 选择滚动容器：鼠标移动高亮元素，点击确认
function pickScrollContainer() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.background = 'rgba(0,0,0,0.1)';
    overlay.style.zIndex = '2147483647';
    overlay.style.cursor = 'crosshair';

    const box = document.createElement('div');
    box.style.position = 'fixed';
    box.style.border = '2px solid #4CAF50';
    box.style.background = 'rgba(76,175,80,0.1)';
    box.style.pointerEvents = 'none';
    box.style.zIndex = '2147483647';
    overlay.appendChild(box);

    function updateBoxForElement(el) {
      if (!el) return;
      const r = el.getBoundingClientRect();
      box.style.left = r.left + 'px';
      box.style.top = r.top + 'px';
      box.style.width = r.width + 'px';
      box.style.height = r.height + 'px';
    }

    function onMouseMove(e) {
      // 临时关闭 overlay 的命中，获取底层元素
      overlay.style.pointerEvents = 'none';
      const el = document.elementFromPoint(e.clientX, e.clientY);
      overlay.style.pointerEvents = 'auto';
      updateBoxForElement(el);
    }
    function onClick(e) {
      overlay.style.pointerEvents = 'none';
      const el = document.elementFromPoint(e.clientX, e.clientY);
      overlay.style.pointerEvents = 'auto';
      containerEl = el || null;
      cleanup();
      resolve(containerEl);
    }
    function onKey(e) {
      if (e.key === 'Escape') { containerEl = null; cleanup(); resolve(null); }
    }

    function cleanup() {
      overlay.removeEventListener('mousemove', onMouseMove);
      overlay.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      overlay.remove();
    }

    overlay.addEventListener('mousemove', onMouseMove);
    overlay.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    (document.documentElement || document.body).appendChild(overlay);
  });
}

// 判断元素是否可纵向滚动
function isScrollableY(el) {
  if (!el) return false;
  // 支持 document.scrollingElement（页面窗口滚动）
  if (el === document.scrollingElement) {
    const canScroll = (el.scrollHeight > el.clientHeight + 1);
    return canScroll;
  }
  if (el === document || el === window) return false;
  const style = getComputedStyle(el);
  const overflowY = style.overflowY;
  const canScroll = (overflowY === 'auto' || overflowY === 'scroll')
    && (el.scrollHeight > el.clientHeight + 1)
    && (style.visibility !== 'hidden')
    && (style.display !== 'none');
  return canScroll;
}

// 判断元素是否可滚动（纵向或横向，适配 puppeteer-iframe-demo 的检测逻辑）
function isScrollableAny(el) {
  if (!el) return false;
  if (el === document || el === window) return false;
  if (el === document.scrollingElement) {
    return (el.scrollHeight > el.clientHeight + 1) || (el.scrollWidth > el.clientWidth + 1);
  }
  const style = getComputedStyle(el);
  if ((style.visibility === 'hidden') || (style.display === 'none')) return false;
  const overflowY = style.overflowY;
  const overflowX = style.overflowX;
  const canY = (overflowY === 'auto' || overflowY === 'scroll') && (el.scrollHeight > el.clientHeight + 1);
  const canX = (overflowX === 'auto' || overflowX === 'scroll') && (el.scrollWidth > el.clientWidth + 1);
  return canY || canX;
}

// 寻找最近可滚动的祖先（包含自身）
function findScrollableAncestor(el) {
  let cur = el;
  // 若选择的是 iframe，则尝试绑定其内部滚动容器（同源）
  if (cur && cur.tagName && cur.tagName.toLowerCase() === 'iframe') {
    const ctx = scanIframeScrollables(cur, { verticalOnly: verticalOnlyPreferred });
    if (ctx) {
      containerIframeCtx = ctx;
      return cur; // 返回 iframe 元素作为外层容器
    } else {
      return null; // 跨域或未检测到内部滚动
    }
  }
  while (cur && cur !== document.documentElement) {
    if (verticalOnlyPreferred ? isScrollableY(cur) : isScrollableAny(cur)) return cur;
    cur = cur.parentElement;
  }
  // 如果页面整体滚动，返回 null 表示使用 window 滚动
  return null;
}

function describeEl(el) {
  if (!el) return 'null';
  const id = el.id ? `#${el.id}` : '';
  const cls = (el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\s+/).join('.') : '';
  return `${el.tagName.toLowerCase()}${id}${cls}`;
}

// 判断 iframe 是否同源且可访问
function isSameOriginIframe(iframe) {
  try {
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) return false;
    // 触发一次访问，若跨域将抛异常
    void doc.body; void win.scrollTo;
    return true;
  } catch (e) {
    return false;
  }
}

// 在同源 iframe 内部扫描滚动容器
function scanIframeScrollables(iframe, { verticalOnly = verticalOnlyPreferred } = {}) {
  if (!isSameOriginIframe(iframe)) return null;
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  const getStyle = (el) => (doc.defaultView || win).getComputedStyle(el);
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const isScrollableAnyInDoc = (el) => {
    if (!el) return false;
    const style = getStyle(el);
    const visible = !(style.visibility === 'hidden' || style.display === 'none');
    if (!visible) return false;
    const overflowY = style.overflowY;
    const overflowX = style.overflowX;
    const canY = (overflowY === 'auto' || overflowY === 'scroll') && (el.scrollHeight > el.clientHeight + 1);
    const canX = (overflowX === 'auto' || overflowX === 'scroll') && (el.scrollWidth > el.clientWidth + 1);
    return canY || canX;
  };
  const score = (el) => {
    const r = el.getBoundingClientRect();
    const area = r.width * r.height;
    const vspan = Math.max(0, el.scrollHeight - el.clientHeight);
    const hspan = Math.max(0, el.scrollWidth - el.clientWidth);
    const preferVertical = vspan > 1;
    const span = preferVertical ? vspan : hspan;
    const axisWeight = preferVertical ? 1.0 : 0.5;
    const viewportBonus = (r.width >= iframe.clientWidth * 0.6 && r.height >= iframe.clientHeight * 0.6) ? 1.5 : 1.0;
    return area * viewportBonus + span * Math.max(1, r.width / (iframe.clientWidth || 1)) * axisWeight;
  };

  // 优先 document.scrollingElement
  let candidates = [];
  if (doc.scrollingElement && (doc.scrollingElement.scrollHeight > doc.scrollingElement.clientHeight + 1)) {
    candidates.push({ el: doc.scrollingElement, type: 'document', score: score(doc.scrollingElement) });
  }
  const all = Array.from(doc.querySelectorAll('*'));
  const limit = Math.min(all.length, 2000);
  for (let i = 0; i < limit; i++) {
    const el = all[i];
    if (!isVisible(el)) continue;
    if (isScrollableAnyInDoc(el)) {
      if (verticalOnly) {
        const style = getStyle(el);
        const oy = style.overflowY;
        const vspan = Math.max(0, el.scrollHeight - el.clientHeight);
        const canV = (oy === 'auto' || oy === 'scroll') && vspan > 1;
        if (!canV) continue;
      }
      candidates.push({ el, type: 'element', score: score(el) });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length === 0) return null;
  return { iframeEl: iframe, scrollingEl: candidates[0].el, win, doc };
}

// 等待动态内容直到出现滚动条（用于内容异步渲染场景）
function waitForScrollbar(timeout = 3000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const observer = new MutationObserver(() => {
      const el = Array.from(document.querySelectorAll('*')).find(el => {
        const hasScroll = el.scrollHeight > el.clientHeight;
        const style = getComputedStyle(el);
        const isScrollable = ['auto', 'scroll'].includes(style.overflowY);
        return hasScroll && isScrollable;
      });
      if (el) { observer.disconnect(); resolve(el); }
      else if (Date.now() - start > timeout) { observer.disconnect(); reject(new Error('Timeout waiting for scrollbar')); }
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true, attributes: true });
  });
}

// 自动扫描页面滚动条候选
function isElementVisible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function scoreScrollable(el) {
  const r = el.getBoundingClientRect();
  const area = r.width * r.height;
  const vspan = Math.max(0, el.scrollHeight - el.clientHeight);
  const hspan = Math.max(0, el.scrollWidth - el.clientWidth);
  const style = getComputedStyle(el);
  const oy = style.overflowY;
  const ox = style.overflowX;
  const canV = (oy === 'auto' || oy === 'scroll') && vspan > 1;
  const canH = (ox === 'auto' || ox === 'scroll') && hspan > 1;
  if (!canV && !canH) return 0;
  const preferVertical = canV;
  const span = preferVertical ? vspan : hspan;
  const axisWeight = preferVertical ? 1.0 : 0.5; // 垂直优先，水平次之
  const viewportBonus = (r.width >= window.innerWidth * 0.6 && r.height >= window.innerHeight * 0.6) ? 1.5 : 1.0;
  // 评分：面积 * viewportBonus + 滚动跨度权重（依据轴别加权）
  return area * viewportBonus + span * Math.max(1, r.width / (window.innerWidth || 1)) * axisWeight;
}

function scanScrollables(maxNodes = 2000, { verticalOnly = verticalOnlyPreferred } = {}) {
  const list = [];
  // 包含页面滚动元素
  if (document.scrollingElement && isScrollableY(document.scrollingElement)) {
    list.push({ el: document.scrollingElement, type: 'document', score: scoreScrollable(document.scrollingElement) });
  }
  // 快速选择器提升常见主容器的命中率
  const quickSelectors = [
    'main', 'article', '.content', '.container', '#content', '#main', '#page',
    '.scroll-container', '.scrollable', '.list', '.feed', '.app', '.player-wrap', '.player'
  ];
  for (const sel of quickSelectors) {
    const nodes = document.querySelectorAll(sel);
    nodes.forEach(el => {
      if (!isElementVisible(el)) return;
      if (verticalOnly ? isScrollableY(el) : isScrollableAny(el)) {
        const sc = scoreScrollable(el) * 1.2; // Quick 命中加成
        list.push({ el, type: 'element', score: sc });
      }
    });
  }
  // 全量扫描（上限 maxNodes）
  const all = Array.from(document.querySelectorAll('*'));
  const limit = Math.min(all.length, maxNodes);
  for (let i = 0; i < limit; i++) {
    const el = all[i];
    if (!isElementVisible(el)) continue;
    if (verticalOnly ? isScrollableY(el) : isScrollableAny(el)) {
      list.push({ el, type: 'element', score: scoreScrollable(el) });
    }
  }
  // 同源 iframe 内部主滚动容器
  const iframes = Array.from(document.querySelectorAll('iframe'));
  for (const iframe of iframes) {
    if (!isElementVisible(iframe)) continue;
    const ctx = scanIframeScrollables(iframe, { verticalOnly });
    if (ctx && ctx.scrollingEl) {
      const r = iframe.getBoundingClientRect();
      const area = r.width * r.height;
      const span = Math.max(0, ctx.scrollingEl.scrollHeight - ctx.scrollingEl.clientHeight);
      const viewportBonus = (r.width >= window.innerWidth * 0.4 && r.height >= window.innerHeight * 0.4) ? 1.3 : 1.0;
      const score = area * viewportBonus + span * Math.max(1, r.width / (window.innerWidth || 1));
      list.push({ el: iframe, type: 'iframe', score, iframeCtx: ctx });
    }
  }
  list.sort((a, b) => b.score - a.score);
  return list;
}

function autoPickScrollable({ verticalOnly = verticalOnlyPreferred } = {}) {
  const candidates = scanScrollables(2000, { verticalOnly });
  if (candidates.length === 0) {
    // 尝试等待内容渲染后出现滚动条
    try {
      return waitForScrollbar(1500).then(el => {
        containerEl = findScrollableAncestor(el) || document.scrollingElement || null;
        return containerEl;
      }).catch(() => {
        containerEl = document.scrollingElement || null;
        containerIframeCtx = null;
        return containerEl;
      });
    } catch {
      containerEl = document.scrollingElement || null;
      containerIframeCtx = null;
      return containerEl;
    }
  }
  // 首选第一个候选（得分最高）
  const chosen = candidates[0];
  containerEl = chosen.el;
  if (chosen.type === 'iframe') {
    containerIframeCtx = chosen.iframeCtx || null;
  } else {
    containerIframeCtx = null;
  }
  return containerEl;
}

// 工具：从 dataUrl 裁剪出指定视口区域的图像（返回 HTMLCanvasElement）
async function cropDataUrl(dataUrl, rect) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = rect.width;
      canvas.height = rect.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
      resolve(canvas);
    };
    img.src = dataUrl;
  });
}

// 计算重叠：对比 prev 底部 strip 与 curr 顶部 strip，寻找最佳重叠高度
function estimateOverlap(prevCanvas, currCanvas) {
  const maxStrip = Math.min(150, Math.floor(prevCanvas.height / 2), Math.floor(currCanvas.height / 2));
  const step = 10;
  const prevCtx = prevCanvas.getContext('2d');
  const currCtx = currCanvas.getContext('2d');
  let bestScore = Number.POSITIVE_INFINITY; // 使用均方差，越低越好
  let bestShift = 0;

  for (let shift = 10; shift <= maxStrip; shift += step) {
    const prevData = prevCtx.getImageData(0, prevCanvas.height - shift, prevCanvas.width, shift).data;
    const currData = currCtx.getImageData(0, 0, currCanvas.width, shift).data;
    let mse = 0;
    for (let i = 0; i < prevData.length; i += 4) {
      const dr = prevData[i] - currData[i];
      const dg = prevData[i + 1] - currData[i + 1];
      const db = prevData[i + 2] - currData[i + 2];
      mse += dr * dr + dg * dg + db * db;
    }
    mse /= (prevData.length / 4);
    if (mse < bestScore) { bestScore = mse; bestShift = shift; }
  }

  // 精细搜索
  const start = Math.max(10, bestShift - 10);
  const end = Math.min(maxStrip, bestShift + 10);
  for (let shift = start; shift <= end; shift++) {
    const prevData = prevCtx.getImageData(0, prevCanvas.height - shift, prevCanvas.width, shift).data;
    const currData = currCtx.getImageData(0, 0, currCanvas.width, shift).data;
    let mse = 0;
    for (let i = 0; i < prevData.length; i += 4) {
      const dr = prevData[i] - currData[i];
      const dg = prevData[i + 1] - currData[i + 1];
      const db = prevData[i + 2] - currData[i + 2];
      mse += dr * dr + dg * dg + db * db;
    }
    mse /= (prevData.length / 4);
    if (mse < bestScore) { bestScore = mse; bestShift = shift; }
  }

  // 如果重叠不稳定，回退到预设 overlapPx
  if (!bestShift || bestShift < 5) return overlapPx;
  return bestShift;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function startCapture(mode) {
  capturing = true;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  let rect = (mode === 'region' && selection)
    ? { ...selection }
    : { x: 0, y: 0, width: viewportW, height: viewportH };

  // full 模式若未绑定容器，则自动检测主滚动容器
  if (mode === 'full' && !containerEl) {
    await autoPickScrollable();
  }

  if ((mode === 'container' || (mode === 'full' && containerEl)) && containerEl) {
    const r = containerEl.getBoundingClientRect();
    const x = Math.max(0, Math.floor(r.left));
    const y = Math.max(0, Math.floor(r.top));
    const w = Math.min(viewportW - x, Math.floor(r.width));
    const h = Math.min(viewportH - y, Math.floor(r.height));
    rect = { x, y, width: Math.max(1, w), height: Math.max(1, h) };
  }

  // 先滚到顶部，保证从顶部开始（容器模式滚动容器；若为 iframe 则滚动其内部容器）
  // 区域模式改为“人工鼠标滚动”，不再自动滚到顶部
  if ((mode === 'container' || (mode === 'full' && containerEl)) && containerEl) {
    try {
      if (containerIframeCtx && containerEl.tagName && containerEl.tagName.toLowerCase() === 'iframe') {
        const scroller = containerIframeCtx.scrollingEl || containerIframeCtx.doc.scrollingElement || containerIframeCtx.doc.body;
        scroller.scrollTo({ top: 0, behavior: 'instant' });
      } else {
        containerEl.scrollTo({ top: 0, behavior: 'instant' });
      }
    } catch {}
  } else if (mode !== 'region') {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  if (mode !== 'region') {
    await sleep(250);
  }

  // 区域模式：改为“人工鼠标滚动”，通过监听滚动事件进行分片截图
  if (mode === 'region') {
    const pieces = [];
    let prevCanvas = null;

    const captureChunk = async () => {
      if (!capturing) return;
      try {
        const shot = await chrome.runtime.sendMessage({ type: 'capture' });
        if (!shot || !shot.ok) return;
        const cropped = await cropDataUrl(shot.dataUrl, rect);
        if (!prevCanvas) {
          pieces.push(cropped);
          prevCanvas = cropped;
        } else {
          // 若几乎无位移（重叠近似整幅），避免重复添加
          const est = estimateOverlap(prevCanvas, cropped);
          if (est < Math.max(5, cropped.height - 5)) {
            pieces.push(cropped);
            prevCanvas = cropped;
          }
        }
      } catch (e) { console.warn('manual region capture chunk failed', e); }
    };

    // 启动后先截一帧，避免用户“立即停止”没有预览
    await captureChunk();

    let debounceTimer = null;
    const onScrollOrWheel = () => {
      if (!capturing) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { captureChunk(); }, 150);
    };

    window.addEventListener('scroll', onScrollOrWheel, { passive: true });
    window.addEventListener('wheel', onScrollOrWheel, { passive: true });

    // 等待停止命令
    while (capturing) { await sleep(100); }

    // 清理监听器
    window.removeEventListener('scroll', onScrollOrWheel);
    window.removeEventListener('wheel', onScrollOrWheel);

    // 拼接到最终画布
    if (pieces.length === 0) {
      try {
        const shot = await chrome.runtime.sendMessage({ type: 'capture' });
        if (shot && shot.ok) {
          const cropped = await cropDataUrl(shot.dataUrl, rect);
          pieces.push(cropped);
        }
      } catch (e) { console.warn('fallback capture failed', e); }
    }

    if (pieces.length > 0) {
      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = rect.width;
      // 使用估计重叠，动态累计高度
      let preciseHeight = pieces[0].height;
      for (let i = 1; i < pieces.length; i++) {
        const est = estimateOverlap(pieces[i - 1], pieces[i]);
        preciseHeight += Math.max(0, pieces[i].height - est);
      }
      finalCanvas.height = preciseHeight;

      const ctx = finalCanvas.getContext('2d');
      let y = 0;
      ctx.drawImage(pieces[0], 0, y);
      y += pieces[0].height;
      for (let i = 1; i < pieces.length; i++) {
        const est = estimateOverlap(pieces[i - 1], pieces[i]);
        ctx.drawImage(pieces[i], 0, est, rect.width, pieces[i].height - est, 0, y - est, rect.width, pieces[i].height - est);
        y += (pieces[i].height - est);
      }

      const dataUrl = finalCanvas.toDataURL('image/png');
      await chrome.runtime.sendMessage({ type: 'save_image_data', dataUrl });
      showPreviewOverlay(dataUrl);
    }
    return; // 区域模式处理完毕
  }

  const pieces = [];
  let prevCanvas = null;
  let totalHeight = 0;
  let maxIterations = 100; // 防止无限循环

  for (let i = 0; i < maxIterations && capturing; i++) {
    const shot = await chrome.runtime.sendMessage({ type: 'capture' });
    if (!shot || !shot.ok) break;
    const cropped = await cropDataUrl(shot.dataUrl, rect);
    pieces.push(cropped);
    if (!prevCanvas) {
      prevCanvas = cropped;
      totalHeight += cropped.height;
    } else {
      const est = estimateOverlap(prevCanvas, cropped);
      totalHeight += Math.max(0, cropped.height - est);
      prevCanvas = cropped;
    }

    // 到达底部判断
    let atBottom = false;
    if ((mode === 'container' || (mode === 'full' && containerEl)) && containerEl) {
      if (containerIframeCtx && containerEl.tagName && containerEl.tagName.toLowerCase() === 'iframe') {
        const scroller = containerIframeCtx.scrollingEl || containerIframeCtx.doc.scrollingElement || containerIframeCtx.doc.body;
        const maxS = scroller.scrollHeight - scroller.clientHeight;
        atBottom = Math.ceil(scroller.scrollTop) >= Math.ceil(maxS);
      } else {
        const maxS = containerEl.scrollHeight - containerEl.clientHeight;
        atBottom = Math.ceil(containerEl.scrollTop) >= Math.ceil(maxS);
      }
    } else {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      atBottom = Math.ceil(window.scrollY) >= Math.ceil(maxScroll);
    }
    if (atBottom) break;

    let step = (mode === 'region' && selection) ? (selection.height - overlapPx) : (window.innerHeight - overlapPx);
    if ((mode === 'container' || (mode === 'full' && containerEl)) && containerEl) {
      if (containerIframeCtx && containerEl.tagName && containerEl.tagName.toLowerCase() === 'iframe') {
        const scroller = containerIframeCtx.scrollingEl || containerIframeCtx.doc.scrollingElement || containerIframeCtx.doc.body;
        step = Math.max(10, scroller.clientHeight - overlapPx);
        scroller.scrollBy({ top: step, behavior: 'instant' });
      } else {
        step = Math.max(10, containerEl.clientHeight - overlapPx);
        containerEl.scrollBy({ top: step, behavior: 'instant' });
      }
    } else {
      window.scrollBy({ top: Math.max(10, step), behavior: 'instant' });
    }
    await sleep(300);
  }

  // 拼接到最终画布
  // 若用户在首次截图前就停止，进行一次可视区兜底截图，保证有预览
  if (pieces.length === 0) {
    try {
      const shot = await chrome.runtime.sendMessage({ type: 'capture' });
      if (shot && shot.ok) {
        const cropped = await cropDataUrl(shot.dataUrl, rect);
        pieces.push(cropped);
      }
    } catch (e) { console.warn('fallback capture failed', e); }
  }

  if (pieces.length > 0) {
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = rect.width;
    finalCanvas.height = pieces[0].height + (pieces.length - 1) * (pieces[0].height - overlapPx);
    // 如果使用估计重叠，需要动态累计高度
    // 重新计算精确高度
    let preciseHeight = pieces[0].height;
    for (let i = 1; i < pieces.length; i++) {
      const est = estimateOverlap(pieces[i - 1], pieces[i]);
      preciseHeight += Math.max(0, pieces[i].height - est);
    }
    finalCanvas.height = preciseHeight;

    const ctx = finalCanvas.getContext('2d');
    let y = 0;
    ctx.drawImage(pieces[0], 0, y);
    y += pieces[0].height;
    for (let i = 1; i < pieces.length; i++) {
      const est = estimateOverlap(pieces[i - 1], pieces[i]);
      // 从当前图片的 est 位置开始绘制，避免重叠区域
      ctx.drawImage(pieces[i], 0, est, rect.width, pieces[i].height - est, 0, y - est, rect.width, pieces[i].height - est);
      y += (pieces[i].height - est);
    }

    const dataUrl = finalCanvas.toDataURL('image/png');
    // 仍然保存到 storage，便于后续可能的复用
    await chrome.runtime.sendMessage({ type: 'save_image_data', dataUrl });
    // 不再打开标注页，改为在页面内弹出预览并让用户选择是否保存
    showPreviewOverlay(dataUrl);
  }
}

// 截图预览覆盖层：展示最终截图，提供保存与关闭选项
function showPreviewOverlay(dataUrl) {
  try {
    // 如果已存在，先移除
    const old = document.getElementById('screenshot-preview-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'screenshot-preview-overlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    // 提升 z-index，避免被站点的高层级遮挡
    overlay.style.zIndex = '9999999999';
    overlay.style.background = 'rgba(0,0,0,0.6)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';

    const panel = document.createElement('div');
    panel.style.background = '#fff';
    panel.style.borderRadius = '8px';
    panel.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
    panel.style.maxWidth = '90vw';
    panel.style.maxHeight = '90vh';
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.overflow = 'hidden';

    const header = document.createElement('div');
    header.textContent = '截图预览';
    header.style.padding = '12px 16px';
    header.style.fontSize = '16px';
    header.style.borderBottom = '1px solid #eee';

    const imgWrap = document.createElement('div');
    imgWrap.style.padding = '12px';
    imgWrap.style.overflow = 'auto';
    imgWrap.style.maxWidth = '90vw';
    imgWrap.style.maxHeight = '70vh';

    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = 'Scrolling Screenshot Preview';
    img.style.maxWidth = '100%';
    img.style.height = 'auto';

    imgWrap.appendChild(img);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '12px';
    actions.style.justifyContent = 'flex-end';
    actions.style.padding = '12px 16px';
    actions.style.borderTop = '1px solid #eee';

    const btnSave = document.createElement('button');
    btnSave.textContent = '保存到本地…';
    btnSave.style.padding = '8px 14px';
    btnSave.style.background = '#1557ff';
    btnSave.style.color = '#fff';
    btnSave.style.border = 'none';
    btnSave.style.borderRadius = '4px';
    btnSave.style.cursor = 'pointer';

    const btnClose = document.createElement('button');
    btnClose.textContent = '关闭';
    btnClose.style.padding = '8px 14px';
    btnClose.style.background = '#f2f2f2';
    btnClose.style.color = '#333';
    btnClose.style.border = 'none';
    btnClose.style.borderRadius = '4px';
    btnClose.style.cursor = 'pointer';

    actions.appendChild(btnClose);
    actions.appendChild(btnSave);

    panel.appendChild(header);
    panel.appendChild(imgWrap);
    panel.appendChild(actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    function closeOverlay() { overlay.remove(); }
    btnClose.addEventListener('click', closeOverlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { closeOverlay(); document.removeEventListener('keydown', onKey); }
    });

    btnSave.addEventListener('click', async () => {
      const ts = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const filename = `scrolling_screenshot_${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.png`;
      try {
        await chrome.runtime.sendMessage({ type: 'download_image', dataUrl, filename });
        closeOverlay();
      } catch (e) {
        console.error('download failed', e);
        // 回退：使用 <a download> 触发保存
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        closeOverlay();
      }
    });
  } catch (e) {
    console.error('showPreviewOverlay error', e);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.cmd === 'select_region') {
        const res = await createOverlay();
        if (res) sendResponse({ ok: true, region: res });
        else sendResponse({ ok: false });
        return;
      }
      if (message.cmd === 'select_container') {
        const picked = await pickScrollContainer();
        if (!picked) { sendResponse({ ok: false, info: '已取消选择' }); return; }
        const detected = findScrollableAncestor(picked);
        if (detected) {
          const autoAdjusted = (detected !== picked);
          containerEl = detected;
          const info = autoAdjusted
            ? `已选择容器：${describeEl(detected)}（已从 ${describeEl(picked)} 自动纠正到可滚动祖先）`
            : `已选择容器：${describeEl(detected)}`;
          sendResponse({ ok: true, info });
        } else {
          containerEl = null;
          sendResponse({ ok: true, info: `未找到可滚动容器，页面使用窗口滚动。建议使用“整页捕获”或“选择区域”。` });
        }
        return;
      }
      if (message.cmd === 'auto_pick_scrollbar') {
        const el = await autoPickScrollable({ verticalOnly: verticalOnlyPreferred });
        if (el) {
          sendResponse({ ok: true, info: `已自动绑定滚动容器：${describeEl(el)}` });
        } else {
          sendResponse({ ok: false, info: '未检测到可滚动容器，将使用窗口滚动' });
        }
        return;
      }
      if (message.cmd === 'set_vertical_only_preference') {
        verticalOnlyPreferred = !!message.payload?.value;
        sendResponse({ ok: true, info: verticalOnlyPreferred ? '已开启只纵向容器' : '已关闭只纵向容器' });
        return;
      }
      if (message.cmd === 'list_scroll_candidates') {
        const verticalOnly = !!message.payload?.verticalOnly;
        const candidates = scanScrollables(2000, { verticalOnly });
        // 构建缓存与展示列表
        candidateCache.clear();
        const list = candidates.slice(0, 30).map((c, idx) => {
          const id = 'cnd_' + Date.now() + '_' + idx;
          const label = c.type === 'document'
            ? `document.scrollingElement (score ${Math.round(c.score)})`
            : (c.type === 'iframe'
              ? `iframe: ${describeEl(c.el)} → 内部 ${describeEl(c.iframeCtx?.scrollingEl)} (score ${Math.round(c.score)})`
              : `${describeEl(c.el)} (score ${Math.round(c.score)})`);
          candidateCache.set(id, { el: c.el, type: c.type, iframeCtx: c.iframeCtx || null, score: c.score, label });
          return { id, label };
        });
        sendResponse({ ok: true, candidates: list });
        return;
      }
      if (message.cmd === 'bind_scroll_candidate') {
        const id = message.payload?.id;
        if (!id || !candidateCache.has(id)) { sendResponse({ ok: false, info: '候选不存在或已过期，请刷新列表' }); return; }
        const item = candidateCache.get(id);
        containerEl = item.el;
        if (item.type === 'iframe') containerIframeCtx = item.iframeCtx || null; else containerIframeCtx = null;
        sendResponse({ ok: true, info: `已绑定：${item.label}` });
        return;
      }
      if (message.cmd === 'clear_scrollbar') {
        containerEl = null;
        containerIframeCtx = null;
        sendResponse({ ok: true, info: '已清除滚动容器绑定' });
        return;
      }
      if (message.cmd === 'start_capture') {
        overlapPx = Number(message.payload?.overlap || 120);
        let mode = message.payload?.mode || 'region';
        // 如果明确选择容器但未检测到，则回退为整页模式；整页模式内部会自动选择滚动容器
        if (mode === 'container' && !containerEl) mode = 'full';
        startCapture(mode);
        sendResponse({ ok: true });
        return;
      }
      if (message.cmd === 'stop_capture') {
        capturing = false;
        sendResponse({ ok: true });
        return;
      }
    } catch (e) {
      console.error('content error', e);
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});