// 背景 service worker：负责截图与标注页打开/数据存储

async function captureVisible(tabId) {
  // 使用当前窗口的可见标签进行截图
  const dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: 'png' });
  return dataUrl;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'capture') {
        const dataUrl = await captureVisible(sender.tab.id);
        sendResponse({ ok: true, dataUrl });
        return; // keep listener alive?
      }
      if (message.type === 'save_image_data') {
        const tabId = sender?.tab?.id;
        const key = tabId ? `finalImageData_${tabId}` : 'finalImageData';
        const toSet = { [key]: message.dataUrl };
        // 同时更新默认键，便于旧逻辑回退
        toSet['finalImageData'] = message.dataUrl;
        if (tabId) toSet['lastSavedTabId'] = tabId;
        await chrome.storage.local.set(toSet);
        sendResponse({ ok: true, key });
        return;
      }
      if (message.type === 'get_image_data') {
        const tabId = message.tabId;
        if (tabId) {
          const key = `finalImageData_${tabId}`;
          const obj = await chrome.storage.local.get(key);
          const dataUrl = obj[key];
          sendResponse({ ok: !!dataUrl, dataUrl: dataUrl || null });
        } else {
          const { finalImageData } = await chrome.storage.local.get('finalImageData');
          sendResponse({ ok: !!finalImageData, dataUrl: finalImageData || null });
        }
        return;
      }
      if (message.type === 'download_image') {
        // 由内容脚本发起保存请求，使用 downloads API 弹出保存对话框
        const filename = message.filename || `scrolling_screenshot_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        await chrome.downloads.download({
          url: message.dataUrl,
          filename,
          saveAs: true
        });
        sendResponse({ ok: true });
        return;
      }
    } catch (e) {
      console.error('background error', e);
      sendResponse({ ok: false, error: e.message });
    }
  })();
  // return true 以便异步响应
  return true;
});