// ==UserScript==
// @name         Bilibili & YouTube 逐帧播放、AI字幕下载与长图拼合
// @namespace    https://github.com/user/bilibili-frame-screenshot
// @version      1.5.0
// @description  适配 Bilibili 与 YouTube：右下角悬浮球独立入口，分开提供「长图截图」「字幕快截」「字幕下载」三大面板；支持 Shift/Ctrl/Shift+Ctrl 多倍率逐帧播放、Shift+S 快捷截图、720p 字幕批量截图、SRT/ASS/MD/TXT 导出、原图缩略图分离防卡顿、正序长图拼合及双节点滑块字幕折叠
// @author       Custom
// @match        https://www.bilibili.com/video/*
// @match        https://www.bilibili.com/list/*
// @match        https://www.bilibili.com/bangumi/play/*
// @match        https://www.bilibili.com/festival/*
// @match        https://www.youtube.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      api.bilibili.com
// @connect      aisubtitle.hdslb.com
// @connect      *.hdslb.com
// @connect      www.youtube.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const IS_YOUTUBE = location.hostname.includes('youtube.com');

  // =========================================================================
  // 1. 配置与状态管理
  // =========================================================================
  const STORAGE_KEY_FPS = 'bili_ext_fps';
  const STORAGE_KEY_AUTOPAUSE = 'bili_ext_autopause';
  const STORAGE_KEY_TOP_CROP = 'bili_ext_top_crop';
  const STORAGE_KEY_BOTTOM_CROP = 'bili_ext_bottom_crop';
  const STORAGE_KEY_BURN_SUB = 'bili_ext_burn_sub';
  const STORAGE_KEY_SUB_FMT = 'bili_ext_sub_fmt';

  const state = {
    fps: Number(GM_getValue(STORAGE_KEY_FPS, 30)) || 30,
    autoPause: GM_getValue(STORAGE_KEY_AUTOPAUSE, true),
    burnSubtitle: GM_getValue(STORAGE_KEY_BURN_SUB, false),
    subExportFmt: GM_getValue(STORAGE_KEY_SUB_FMT, 'srt'),
    // screenshots: { id, blob, thumbUrl, width, height, timestamp, timeText }
    screenshots: [],
    panelVisible: false,
    activeTab: 'screenshots', // 'screenshots' | 'subCapture' | 'subDownload'
    subtitleFold: false,
    topCropPct: Number(GM_getValue(STORAGE_KEY_TOP_CROP, 78)),
    bottomCropPct: Number(GM_getValue(STORAGE_KEY_BOTTOM_CROP, 96)),
    toastTimer: null,
    fpsPopoverOpen: false,
    lastSeekAt: 0,

    // 字幕状态
    subTracks: [],
    subTrackIdx: 0,
    subItems: [],
    subFilter: '',
    subLoading: false,
    subBatchRunning: false,
    subVideoKey: '',
    lastCheckedSubIdx: -1,
  };

  if (isNaN(state.topCropPct) || state.topCropPct < 0 || state.topCropPct > 95) {
    state.topCropPct = 78;
  }
  if (isNaN(state.bottomCropPct) || state.bottomCropPct <= state.topCropPct || state.bottomCropPct > 100) {
    state.bottomCropPct = 96;
  }

  let mountedSsBtn = null;
  let mountedFrameBtn = null;
  let cachedPanel = null;
  let cachedFab = null;
  let cachedToast = null;

  const captureCanvas = document.createElement('canvas');
  const thumbCanvas = document.createElement('canvas');

  // =========================================================================
  // 2. 样式注入
  // =========================================================================
  GM_addStyle(`
    /* 播放器控制栏按钮 */
    .bili-ext-ctrl-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 22px;
      padding: 0 7px;
      margin: 0 4px;
      border-radius: 4px;
      color: hsla(0, 0%, 100%, 0.92);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      user-select: none;
      transition: background-color 0.15s, color 0.15s;
      position: relative;
      line-height: 22px;
      vertical-align: middle;
    }
    .bili-ext-ctrl-btn.yt-mode {
      height: 100%;
      padding: 0 8px;
      margin: 0 2px;
      vertical-align: top;
      border-radius: 0;
    }
    .bili-ext-ctrl-btn:hover {
      background-color: rgba(255, 255, 255, 0.16);
      color: #00aeec;
    }
    .bili-ext-ctrl-btn svg {
      width: 15px;
      height: 15px;
      margin-right: 3px;
      fill: currentColor;
      flex-shrink: 0;
    }

    /* 逐帧设置气泡 */
    .bili-ext-fps-popover {
      position: absolute;
      bottom: 36px;
      right: 0;
      width: 240px;
      background: rgba(24, 25, 28, 0.96);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 8px;
      padding: 10px 12px;
      color: #e7e7e7;
      font-size: 12px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
      z-index: 100001;
      display: none;
      text-align: left;
      line-height: 1.5;
    }
    .bili-ext-ctrl-btn.yt-mode .bili-ext-fps-popover {
      bottom: 54px;
    }
    .bili-ext-fps-popover.open {
      display: block;
    }
    .bili-ext-fps-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .bili-ext-fps-pills {
      display: flex;
      gap: 4px;
    }
    .bili-ext-fps-pill {
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.1);
      color: #ccc;
      cursor: pointer;
      font-size: 11px;
    }
    .bili-ext-fps-pill.active {
      background: #00aeec;
      color: #fff;
      font-weight: 600;
    }
    .bili-ext-shortcut-tips {
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      padding-top: 6px;
      font-size: 11px;
      color: #aaa;
    }
    .bili-ext-shortcut-tips div {
      display: flex;
      justify-content: space-between;
      margin: 2px 0;
    }
    .bili-ext-kbd {
      background: rgba(255, 255, 255, 0.12);
      padding: 0 4px;
      border-radius: 3px;
      color: #fff;
      font-family: monospace;
    }

    /* 播放器内提示 Toast */
    #bili-ext-player-toast {
      position: absolute;
      left: 50%;
      bottom: 68px;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.84);
      color: #fff;
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      pointer-events: none;
      z-index: 99998;
      opacity: 0;
      transition: opacity 0.12s ease;
      white-space: nowrap;
      border: 1px solid rgba(255, 255, 255, 0.12);
    }
    #bili-ext-player-toast.show {
      opacity: 1;
    }

    /* 右下角独立悬浮球入口 */
    #bili-ext-fab {
      position: fixed;
      right: 24px;
      bottom: 28px;
      width: 46px;
      height: 46px;
      border-radius: 50%;
      background: linear-gradient(135deg, #00aeec, #008ac5);
      color: #fff;
      box-shadow: 0 6px 18px rgba(0, 174, 236, 0.38);
      border: 2px solid rgba(255, 255, 255, 0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 100000;
      user-select: none;
      touch-action: none;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    #bili-ext-fab:hover {
      transform: scale(1.07);
      box-shadow: 0 8px 22px rgba(0, 174, 236, 0.52);
    }
    #bili-ext-fab.active {
      background: linear-gradient(135deg, #fb7299, #e55982);
      box-shadow: 0 6px 18px rgba(251, 114, 153, 0.45);
    }
    #bili-ext-fab svg {
      width: 22px;
      height: 22px;
      fill: currentColor;
      pointer-events: none;
    }
    #bili-ext-fab-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      min-width: 18px;
      height: 18px;
      padding: 0 4px;
      border-radius: 9px;
      background: #fb7299;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      line-height: 18px;
      text-align: center;
      border: 1.5px solid #18191c;
      display: none;
      pointer-events: none;
    }
    #bili-ext-fab-badge.show {
      display: block;
    }

    /* 主面板（固定在右侧，留出右下角悬浮球位置） */
    #bili-ext-ss-panel {
      position: fixed;
      bottom: 86px;
      right: 24px;
      width: 380px;
      max-height: calc(100vh - 120px);
      background: rgba(24, 25, 28, 0.96);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 12px;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.55);
      color: #f1f2f3;
      z-index: 99999;
      display: none;
      flex-direction: column;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    #bili-ext-ss-panel.visible {
      display: flex;
    }

    .bili-ext-ss-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      background: rgba(255, 255, 255, 0.04);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      font-size: 13px;
      font-weight: 600;
    }
    .bili-ext-ss-header-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .bili-ext-btn-sm {
      padding: 4px 8px;
      border-radius: 5px;
      border: none;
      background: rgba(255, 255, 255, 0.1);
      color: #e5e5e5;
      font-size: 12px;
      cursor: pointer;
    }
    .bili-ext-btn-sm:hover {
      background: rgba(255, 255, 255, 0.2);
    }
    .bili-ext-btn-sm.primary {
      background: #00aeec;
      color: #fff;
    }
    .bili-ext-btn-sm.primary:hover {
      background: #009cd6;
    }
    .bili-ext-btn-sm.danger:hover {
      background: #f56c6c;
      color: #fff;
    }

    /* 顶部三大独立入口 Tab */
    .bili-ext-tabs {
      display: flex;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.02);
    }
    .bili-ext-tab {
      flex: 1;
      text-align: center;
      padding: 9px 0;
      font-size: 12px;
      font-weight: 600;
      color: #9ea3ab;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: color 0.15s, border-color 0.15s;
    }
    .bili-ext-tab:hover {
      color: #e5e5e5;
    }
    .bili-ext-tab.active {
      color: #00aeec;
      border-bottom-color: #00aeec;
    }

    .bili-ext-tab-body {
      display: none;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    .bili-ext-tab-body.active {
      display: flex;
    }

    /* 字幕折叠与双节点滑块控制区 */
    .bili-ext-ss-controls {
      padding: 10px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.02);
    }
    .bili-ext-switch-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
    }
    .bili-ext-switch {
      position: relative;
      display: inline-block;
      width: 34px;
      height: 18px;
      cursor: pointer;
    }
    .bili-ext-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .bili-ext-switch-slider {
      position: absolute;
      inset: 0;
      background-color: rgba(255, 255, 255, 0.22);
      border-radius: 18px;
      transition: 0.2s;
    }
    .bili-ext-switch-slider::before {
      content: "";
      position: absolute;
      height: 14px;
      width: 14px;
      left: 2px;
      bottom: 2px;
      background-color: #fff;
      border-radius: 50%;
      transition: 0.2s;
    }
    .bili-ext-switch input:checked + .bili-ext-switch-slider {
      background-color: #00aeec;
    }
    .bili-ext-switch input:checked + .bili-ext-switch-slider::before {
      transform: translateX(16px);
    }

    /* 双节点范围滑块 */
    .bili-ext-range-wrap {
      margin-top: 10px;
      display: none;
    }
    .bili-ext-range-wrap.active {
      display: block;
    }
    .bili-ext-range-labels {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #b5b8bd;
      margin-bottom: 8px;
    }
    .bili-ext-range-labels span b {
      color: #fff;
      font-weight: 600;
    }
    .bili-ext-range-track {
      position: relative;
      height: 6px;
      background: rgba(255, 255, 255, 0.16);
      border-radius: 3px;
      margin: 10px 6px 6px;
      cursor: pointer;
      touch-action: none;
    }
    .bili-ext-range-fill {
      position: absolute;
      top: 0;
      bottom: 0;
      background: linear-gradient(90deg, #00aeec, #fb7299);
      border-radius: 3px;
      pointer-events: none;
    }
    .bili-ext-range-thumb {
      position: absolute;
      top: 50%;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      cursor: grab;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
      border: 2px solid #fff;
      touch-action: none;
    }
    .bili-ext-range-thumb:active {
      cursor: grabbing;
      transform: translate(-50%, -50%) scale(1.15);
    }
    .bili-ext-range-thumb.left {
      background: #00aeec;
      z-index: 2;
    }
    .bili-ext-range-thumb.right {
      background: #fb7299;
      z-index: 3;
    }
    .bili-ext-range-hint {
      font-size: 11px;
      color: #8c9096;
      margin-top: 4px;
      line-height: 1.35;
    }

    /* 截图列表容器（正序：早在上，晚在下） */
    .bili-ext-ss-list {
      flex: 1;
      overflow-y: auto;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-height: 140px;
      max-height: 48vh;
      contain: layout style;
    }
    .bili-ext-ss-list.folded {
      gap: 0;
    }
    .bili-ext-ss-list::-webkit-scrollbar,
    .bili-ext-sub-list::-webkit-scrollbar,
    .bili-ext-dl-preview::-webkit-scrollbar {
      width: 6px;
    }
    .bili-ext-ss-list::-webkit-scrollbar-thumb,
    .bili-ext-sub-list::-webkit-scrollbar-thumb,
    .bili-ext-dl-preview::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
      border-radius: 3px;
    }

    .bili-ext-ss-empty {
      text-align: center;
      color: #8c9096;
      font-size: 12px;
      padding: 28px 10px;
      line-height: 1.6;
    }

    .bili-ext-ss-item {
      position: relative;
      border-radius: 6px;
      overflow: hidden;
      background: #000;
      flex-shrink: 0;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .bili-ext-ss-list.folded .bili-ext-ss-item {
      border-radius: 0;
      border-left: none;
      border-right: none;
      border-top: none;
      border-bottom: 1px dashed rgba(255, 255, 255, 0.14);
    }
    .bili-ext-ss-list.folded .bili-ext-ss-item:first-child {
      border-top-left-radius: 6px;
      border-top-right-radius: 6px;
    }
    .bili-ext-ss-list.folded .bili-ext-ss-item:last-child {
      border-bottom-left-radius: 6px;
      border-bottom-right-radius: 6px;
      border-bottom: none;
    }

    .bili-ext-ss-crop-box {
      position: relative;
      width: 100%;
      overflow: hidden;
    }
    .bili-ext-ss-crop-box img {
      display: block;
      width: 100%;
      height: auto;
      user-select: none;
      pointer-events: none;
    }

    .bili-ext-ss-badge {
      position: absolute;
      left: 6px;
      top: 6px;
      background: rgba(0, 0, 0, 0.65);
      color: #fff;
      font-size: 10px;
      padding: 1px 5px;
      border-radius: 3px;
      pointer-events: none;
    }
    .bili-ext-ss-item-actions {
      position: absolute;
      right: 6px;
      top: 6px;
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .bili-ext-ss-item:hover .bili-ext-ss-item-actions {
      opacity: 1;
    }
    .bili-ext-ss-mini-btn {
      background: rgba(0, 0, 0, 0.72);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 11px;
      cursor: pointer;
    }
    .bili-ext-ss-mini-btn:hover {
      background: #00aeec;
      border-color: #00aeec;
    }
    .bili-ext-ss-mini-btn.del:hover {
      background: #f56c6c;
      border-color: #f56c6c;
    }

    /* 字幕快截 & 字幕下载 Tab 样式 */
    .bili-ext-sub-toolbar {
      padding: 10px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: rgba(255, 255, 255, 0.02);
    }
    .bili-ext-sub-row {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .bili-ext-select,
    .bili-ext-input {
      flex: 1;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 5px;
      color: #f1f2f3;
      font-size: 12px;
      padding: 5px 8px;
      outline: none;
    }
    .bili-ext-select option {
      background: #1f2024;
      color: #f1f2f3;
    }
    .bili-ext-input:focus,
    .bili-ext-select:focus {
      border-color: #00aeec;
    }
    .bili-ext-sub-list {
      flex: 1;
      overflow-y: auto;
      padding: 6px 8px;
      min-height: 150px;
      max-height: 44vh;
      display: flex;
      flex-direction: column;
      gap: 4px;
      contain: layout style;
    }
    .bili-ext-sub-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid transparent;
      font-size: 12px;
      line-height: 1.45;
      cursor: pointer;
    }
    .bili-ext-sub-item:hover {
      background: rgba(255, 255, 255, 0.07);
    }
    .bili-ext-sub-item.selected {
      background: rgba(0, 174, 236, 0.14);
      border-color: rgba(0, 174, 236, 0.45);
    }
    .bili-ext-sub-item input[type="checkbox"] {
      margin-top: 3px;
      accent-color: #00aeec;
      cursor: pointer;
    }
    .bili-ext-sub-time {
      color: #00aeec;
      font-family: monospace;
      font-size: 11px;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .bili-ext-sub-time:hover {
      text-decoration: underline;
    }
    .bili-ext-sub-text {
      color: #e7e7e7;
      word-break: break-word;
      flex: 1;
    }

    /* 独立字幕下载 Tab */
    .bili-ext-dl-panel {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      flex: 1;
      min-height: 0;
    }
    .bili-ext-dl-meta {
      font-size: 12px;
      color: #b5b8bd;
      display: flex;
      justify-content: space-between;
    }
    .bili-ext-dl-preview {
      flex: 1;
      min-height: 130px;
      max-height: 36vh;
      overflow-y: auto;
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 12px;
      line-height: 1.55;
      color: #d7d9dd;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .bili-ext-dl-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
    }
    .bili-ext-dl-fmt-btn {
      padding: 8px 4px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      background: rgba(255, 255, 255, 0.06);
      color: #f1f2f3;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      text-align: center;
      transition: background 0.15s, border-color 0.15s;
    }
    .bili-ext-dl-fmt-btn:hover:not(:disabled) {
      background: #00aeec;
      border-color: #00aeec;
      color: #fff;
    }
    .bili-ext-dl-fmt-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .bili-ext-dl-fmt-sub {
      display: block;
      font-size: 10px;
      font-weight: 400;
      color: #9ea3ab;
      margin-top: 2px;
    }
    .bili-ext-dl-fmt-btn:hover:not(:disabled) .bili-ext-dl-fmt-sub {
      color: rgba(255, 255, 255, 0.85);
    }

    /* 底部操作栏 */
    .bili-ext-ss-footer {
      padding: 10px 12px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      gap: 8px;
      background: rgba(255, 255, 255, 0.03);
      align-items: center;
    }
    .bili-ext-ss-footer button {
      flex: 1;
      padding: 7px 10px;
      border-radius: 6px;
      border: none;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .bili-ext-ss-footer button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    .bili-ext-btn-stitch {
      background: linear-gradient(135deg, #00aeec, #008ac5);
      color: #fff;
    }
    .bili-ext-btn-copy {
      background: rgba(255, 255, 255, 0.12);
      color: #f1f2f3;
    }
    .bili-ext-btn-copy:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.2);
    }
  `);

  // =========================================================================
  // 3. 平台适配与通用工具函数
  // =========================================================================
  function gmFetchJson(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType: 'json',
        onload: (res) => {
          if (res.status >= 200 && res.status < 300) {
            try {
              const data = res.response || JSON.parse(res.responseText);
              resolve(data);
            } catch (e) {
              reject(e);
            }
          } else {
            reject(new Error(`HTTP ${res.status}`));
          }
        },
        onerror: reject,
      });
    });
  }

  function getVideoElement() {
    if (IS_YOUTUBE) {
      return (
        document.querySelector('#movie_player video.html5-main-video') ||
        document.querySelector('video.html5-main-video') ||
        document.querySelector('#shorts-player video')
      );
    }
    return (
      document.querySelector('.bpx-player-video-wrap video') ||
      document.querySelector('.bilibili-player-video video') ||
      document.querySelector('video')
    );
  }

  function getPlayerContainer() {
    if (IS_YOUTUBE) {
      return (
        document.querySelector('#movie_player') ||
        document.querySelector('#shorts-player') ||
        document.body
      );
    }
    return (
      document.querySelector('.bpx-player-container') ||
      document.querySelector('.bilibili-player-area') ||
      document.body
    );
  }

  function getControlRightBar() {
    if (IS_YOUTUBE) {
      return document.querySelector('#movie_player .ytp-right-controls');
    }
    return (
      document.querySelector('.bpx-player-control-bottom-right') ||
      document.querySelector('.bilibili-player-video-control-bottom-right')
    );
  }

  function formatTime(seconds, withMs = true) {
    if (!isFinite(seconds) || seconds < 0) return withMs ? '00:00.000' : '00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    const pad2 = (n) => String(n).padStart(2, '0');
    const pad3 = (n) => String(n).padStart(3, '0');
    const base = hrs > 0 ? `${hrs}:${pad2(mins)}:${pad2(secs)}` : `${pad2(mins)}:${pad2(secs)}`;
    return withMs ? `${base}.${pad3(ms)}` : base;
  }

  function showToast(text) {
    const container = getPlayerContainer();
    if (!cachedToast) {
      cachedToast = document.createElement('div');
      cachedToast.id = 'bili-ext-player-toast';
    }
    if (cachedToast.parentElement !== container) {
      container.appendChild(cachedToast);
    }
    cachedToast.textContent = text;
    cachedToast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      cachedToast.classList.remove('show');
    }, 1200);
  }

  function isEditableTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function getVideoTitleRaw() {
    if (IS_YOUTUBE) {
      return (
        document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim() ||
        document.title.replace(/\s*-\s*YouTube$/, '').trim() ||
        'youtube_video'
      );
    }
    return (
      document.querySelector('.video-title')?.textContent?.trim() ||
      document.title.replace(/_哔哩哔哩.*$/, '').trim() ||
      'bilibili_video'
    );
  }

  function getVideoTitleSafe() {
    return getVideoTitleRaw().replace(/[\\/:*?"<>|]/g, '_').slice(0, 48);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // =========================================================================
  // 4. 功能一：逐帧播放 & 快捷键（含 Shift+S 快捷截图）
  // =========================================================================
  function seekByDelta(deltaSeconds, label) {
    const now = performance.now();
    if (now - state.lastSeekAt < 45) return;
    state.lastSeekAt = now;

    const video = getVideoElement();
    if (!video || !isFinite(video.duration)) return;

    if (state.autoPause && !video.paused) {
      video.pause();
    }

    const nextTime = Math.max(0, Math.min(video.duration, video.currentTime + deltaSeconds));
    video.currentTime = nextTime;
    showToast(`${label}  (${formatTime(nextTime)})`);
  }

  function stepFrames(frameCount) {
    const delta = frameCount / state.fps;
    const sign = frameCount > 0 ? '+' : '';
    const arrow = frameCount > 0 ? '▶' : '◀';
    seekByDelta(delta, `${arrow} ${sign}${frameCount} 帧`);
  }

  function stepSeconds(seconds) {
    const sign = seconds > 0 ? '+' : '';
    const arrow = seconds > 0 ? '▶' : '◀';
    seekByDelta(seconds, `${arrow} ${sign}${seconds} 秒`);
  }

  window.addEventListener(
    'keydown',
    (e) => {
      if (isEditableTarget(e.target) || e.altKey) return;

      const hasShift = e.shiftKey;
      const hasCtrl = e.ctrlKey || e.metaKey;

      if (hasShift && !hasCtrl && (e.code === 'KeyS' || e.key === 's' || e.key === 'S')) {
        if (e.repeat) return;
        const video = getVideoElement();
        if (video && video.videoWidth > 0) {
          e.preventDefault();
          e.stopPropagation();
          captureVideoFrame();
        }
        return;
      }

      const isLeft = e.key === 'ArrowLeft';
      const isRight = e.key === 'ArrowRight';
      if (!isLeft && !isRight) return;

      const dir = isRight ? 1 : -1;

      if (hasShift && hasCtrl) {
        e.preventDefault();
        e.stopPropagation();
        stepSeconds(dir * 1);
      } else if (hasCtrl && !hasShift) {
        e.preventDefault();
        e.stopPropagation();
        stepFrames(dir * 5);
      } else if (hasShift && !hasCtrl) {
        e.preventDefault();
        e.stopPropagation();
        stepFrames(dir * 1);
      }
    },
    true
  );

  // =========================================================================
  // 5. AI/CC 字幕拉取与多格式导出（SRT / ASS / MD / TXT）
  // =========================================================================
  async function fetchBilibiliSubTracks() {
    const u = new URL(location.href);
    const bvMatch = u.pathname.match(/\/video\/(BV[\w]+)/i);
    let bvid = bvMatch ? bvMatch[1] : unsafeWindow.__INITIAL_STATE__?.bvid || '';
    let cid = unsafeWindow.__INITIAL_STATE__?.cid || 0;

    if (!bvid && unsafeWindow.__INITIAL_STATE__?.epInfo?.bvid) {
      bvid = unsafeWindow.__INITIAL_STATE__.epInfo.bvid;
      cid = unsafeWindow.__INITIAL_STATE__.epInfo.cid;
    }

    if (!bvid) throw new Error('未识别到当前 B 站视频 BVID');

    if (!cid) {
      const viewRes = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
        credentials: 'include',
      }).then((r) => r.json());
      const p = Math.max(1, Number(u.searchParams.get('p') || 1));
      const pages = viewRes?.data?.pages || [];
      cid = pages[p - 1]?.cid || viewRes?.data?.cid || 0;
    }

    if (!cid) throw new Error('未获取到视频 CID');

    const playerRes = await fetch(
      `https://api.bilibili.com/x/player/wbi/v2?bvid=${bvid}&cid=${cid}`,
      { credentials: 'include' }
    ).then((r) => r.json());

    const rawSubs = playerRes?.data?.subtitle?.subtitles || [];
    if (rawSubs.length === 0) {
      throw new Error('当前视频无可用 AI/CC 字幕（请确认已登录 B 站账号）');
    }

    return rawSubs.map((s) => {
      let subUrl = s.subtitle_url || '';
      if (subUrl.startsWith('//')) subUrl = 'https:' + subUrl;
      return {
        label: s.lan_doc || s.lan || '字幕',
        lang: s.lan || '',
        url: subUrl,
        isAuto: s.type === 1 || (s.lan_doc || '').includes('自动'),
      };
    });
  }

  async function fetchBilibiliSubItems(track) {
    const json = await gmFetchJson(track.url);
    const body = json?.body || [];
    return body
      .filter((item) => item && typeof item.content === 'string' && item.content.trim() !== '')
      .map((item, idx) => ({
        idx,
        from: Number(item.from) || 0,
        to: Number(item.to) || Number(item.from) + 1,
        text: item.content.trim(),
        selected: false,
      }));
  }

  async function fetchYouTubeSubTracks() {
    const videoId = new URL(location.href).searchParams.get('v') || '';
    let playerResp = null;

    try {
      const mp = unsafeWindow.document.querySelector('#movie_player');
      if (mp && typeof mp.getPlayerResponse === 'function') {
        const resp = mp.getPlayerResponse();
        if (!videoId || resp?.videoDetails?.videoId === videoId) {
          playerResp = resp;
        }
      }
    } catch (_) {}

    if (!playerResp) {
      const html = await fetch(location.href, { credentials: 'include' }).then((r) => r.text());
      const marker = 'ytInitialPlayerResponse = ';
      const start = html.indexOf(marker);
      if (start !== -1) {
        const sub = html.slice(start + marker.length);
        const end = sub.indexOf(';</script>');
        const jsonStr = end !== -1 ? sub.slice(0, end) : sub.split(';var ')[0];
        playerResp = JSON.parse(jsonStr);
      }
    }

    const tracks = playerResp?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    if (tracks.length === 0) {
      throw new Error('当前 YouTube 视频没有可用字幕');
    }

    return tracks.map((t) => ({
      label: `${t.name?.simpleText || t.languageCode}${t.kind === 'asr' ? ' (自动生成)' : ''}`,
      lang: t.languageCode || '',
      url: t.baseUrl + (t.baseUrl.includes('?') ? '&' : '?') + 'fmt=json3',
      isAuto: t.kind === 'asr',
    }));
  }

  async function fetchYouTubeSubItems(track) {
    const json = await fetch(track.url, { credentials: 'include' }).then((r) => r.json());
    const events = json?.events || [];
    const items = [];
    let idx = 0;

    for (const ev of events) {
      if (!ev.segs || ev.tStartMs == null) continue;
      const text = ev.segs
        .map((s) => s.utf8 || '')
        .join('')
        .replace(/\n+/g, ' ')
        .trim();
      if (!text) continue;
      const from = ev.tStartMs / 1000;
      const to = (ev.tStartMs + (ev.dDurationMs || 2000)) / 1000;
      items.push({ idx: idx++, from, to, text, selected: false });
    }
    return items;
  }

  async function loadCurrentVideoSubtitles(forceReload = false) {
    const key = location.href;
    if (!forceReload && state.subVideoKey === key && state.subItems.length > 0) {
      renderSubtitlesTab();
      renderSubDownloadTab();
      return;
    }

    state.subLoading = true;
    state.subItems = [];
    state.subTracks = [];
    state.lastCheckedSubIdx = -1;
    renderSubtitlesTab();
    renderSubDownloadTab();

    try {
      const tracks = IS_YOUTUBE ? await fetchYouTubeSubTracks() : await fetchBilibiliSubTracks();
      state.subTracks = tracks;
      state.subTrackIdx = 0;
      state.subVideoKey = key;

      const items = IS_YOUTUBE
        ? await fetchYouTubeSubItems(tracks[0])
        : await fetchBilibiliSubItems(tracks[0]);

      state.subItems = items;
      showToast(`已加载 ${items.length} 条字幕`);
    } catch (err) {
      console.error('[BiliExt] 加载字幕失败:', err);
      showToast(err.message || '加载字幕失败');
    } finally {
      state.subLoading = false;
      renderSubtitlesTab();
      renderSubDownloadTab();
    }
  }

  async function switchSubtitleTrack(trackIdx) {
    const track = state.subTracks[trackIdx];
    if (!track) return;
    state.subTrackIdx = trackIdx;
    state.subLoading = true;
    state.subItems = [];
    state.lastCheckedSubIdx = -1;
    renderSubtitlesTab();
    renderSubDownloadTab();

    try {
      state.subItems = IS_YOUTUBE
        ? await fetchYouTubeSubItems(track)
        : await fetchBilibiliSubItems(track);
    } catch (err) {
      showToast('切换字幕轨道失败');
    } finally {
      state.subLoading = false;
      renderSubtitlesTab();
      renderSubDownloadTab();
    }
  }

  function formatSrtTime(sec) {
    const s = Math.max(0, sec);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 1000);
    const p2 = (n) => String(n).padStart(2, '0');
    const p3 = (n) => String(n).padStart(3, '0');
    return `${p2(hrs)}:${p2(mins)}:${p2(secs)},${p3(ms)}`;
  }

  function formatAssTime(sec) {
    const s = Math.max(0, sec);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = Math.floor(s % 60);
    const cs = Math.floor((s % 1) * 100);
    const p2 = (n) => String(n).padStart(2, '0');
    return `${hrs}:${p2(mins)}:${p2(secs)}.${p2(cs)}`;
  }

  function exportSubtitlesFile(fmtOverride = null) {
    if (state.subItems.length === 0) {
      showToast('请先拉取字幕');
      return;
    }
    const fmt = fmtOverride || state.subExportFmt;
    const items = state.subItems;
    const trackLabel = state.subTracks[state.subTrackIdx]?.label || 'sub';
    const titleRaw = getVideoTitleRaw();
    let content = '';
    let mime = 'text/plain;charset=utf-8';

    if (fmt === 'srt') {
      content = items
        .map((it, i) => `${i + 1}\n${formatSrtTime(it.from)} --> ${formatSrtTime(it.to)}\n${it.text}\n`)
        .join('\n');
    } else if (fmt === 'ass') {
      const header = [
        '[Script Info]',
        `Title: ${titleRaw}`,
        'ScriptType: v4.00+',
        'WrapStyle: 0',
        'ScaledBorderAndShadow: yes',
        'PlayResX: 1920',
        'PlayResY: 1080',
        '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        'Style: Default,Microsoft YaHei,54,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2.5,1,2,20,20,36,1',
        '',
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      ].join('\n');
      const dialogues = items
        .map((it) => `Dialogue: 0,${formatAssTime(it.from)},${formatAssTime(it.to)},Default,,0,0,0,,${it.text.replace(/\r?\n/g, '\\N')}`)
        .join('\n');
      content = `${header}\n${dialogues}\n`;
    } else if (fmt === 'md') {
      mime = 'text/markdown;charset=utf-8';
      const lines = items.map((it) => `- **[${formatTime(it.from, false)}]** ${it.text}`).join('\n');
      content = `# ${titleRaw}\n\n- 视频链接：${location.href}\n- 字幕轨道：${trackLabel}\n- 条数：${items.length}\n\n---\n\n${lines}\n`;
    } else {
      content = items.map((it) => it.text).join('\n') + '\n';
    }

    const blob = new Blob([content], { type: mime });
    const filename = `${getVideoTitleSafe()}_${trackLabel.replace(/[\\/:*?"<>|]/g, '_')}.${fmt}`;
    downloadBlob(blob, filename);
    showToast(`已下载 ${items.length} 条字幕 (${fmt.toUpperCase()})`);
  }

  // =========================================================================
  // 6. 功能二：视频截取（720p 批量截图 + 原图/缩略图分离 + 内存彻底释放）
  // =========================================================================
  function drawSubtitleOnCanvas(ctx, width, height, text) {
    if (!text) return;
    const fontSize = Math.max(18, Math.round(height * 0.042));
    ctx.save();
    ctx.font = `600 ${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    const maxWidth = width * 0.88;
    const chars = text.split('');
    const lines = [];
    let currentLine = '';
    for (const ch of chars) {
      const testLine = currentLine + ch;
      if (ctx.measureText(testLine).width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = ch;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);

    const lineHeight = fontSize * 1.28;
    const bottomPadding = Math.round(height * 0.045);

    lines.reverse().forEach((line, idx) => {
      const y = height - bottomPadding - idx * lineHeight;
      ctx.lineWidth = Math.max(3, Math.round(fontSize * 0.16));
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.88)';
      ctx.strokeText(line, width / 2, y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(line, width / 2, y);
    });
    ctx.restore();
  }

  function canvasToBlobAsync(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('画布编码失败'))),
        type,
        quality
      );
    });
  }

  async function grabVideoFrameToBlob(overlaySubtitleText = '', maxShortSide = 0) {
    const video = getVideoElement();
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      throw new Error('未检测到有效视频画面');
    }

    let width = video.videoWidth;
    let height = video.videoHeight;
    if (maxShortSide > 0) {
      const shortSide = Math.min(width, height);
      if (shortSide > maxShortSide) {
        const scale = maxShortSide / shortSide;
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
    }
    const currentTime = video.currentTime;

    if (captureCanvas.width !== width || captureCanvas.height !== height) {
      captureCanvas.width = width;
      captureCanvas.height = height;
    }
    const ctx = captureCanvas.getContext('2d');
    ctx.drawImage(video, 0, 0, width, height);
    if (overlaySubtitleText) {
      drawSubtitleOnCanvas(ctx, width, height, overlaySubtitleText);
    }

    const thumbW = Math.min(360, width);
    const thumbH = Math.max(1, Math.round((thumbW * height) / width));
    if (thumbCanvas.width !== thumbW || thumbCanvas.height !== thumbH) {
      thumbCanvas.width = thumbW;
      thumbCanvas.height = thumbH;
    }
    const tCtx = thumbCanvas.getContext('2d');
    tCtx.drawImage(captureCanvas, 0, 0, thumbW, thumbH);

    const [fullBlob, thumbBlob] = await Promise.all([
      canvasToBlobAsync(captureCanvas, 'image/png'),
      canvasToBlobAsync(thumbCanvas, 'image/webp', 0.85).catch(() =>
        canvasToBlobAsync(thumbCanvas, 'image/jpeg', 0.85)
      ),
    ]);

    return {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      blob: fullBlob,
      thumbUrl: URL.createObjectURL(thumbBlob),
      width,
      height,
      timestamp: currentTime,
      timeText: formatTime(currentTime),
    };
  }

  async function captureVideoFrame() {
    try {
      const item = await grabVideoFrameToBlob('', 0);
      state.screenshots.push(item);
      state.panelVisible = true;
      state.activeTab = 'screenshots';
      appendScreenshotItem(item);

      requestAnimationFrame(() => {
        const panel = ensureScreenshotPanel();
        const listEl = panel.querySelector('#bili-ext-ss-list');
        if (listEl) listEl.scrollTop = listEl.scrollHeight;
      });

      showToast(`已截图 #${state.screenshots.length} (${item.timeText})`);
    } catch (err) {
      console.error('[BiliExt] 截图失败:', err);
      showToast(err.message || '无法截取当前画面');
    }
  }

  function seekAndWaitFrame(video, targetTime) {
    return new Promise((resolve) => {
      const clamped = Math.max(0, Math.min(video.duration || targetTime, targetTime));
      if (Math.abs(video.currentTime - clamped) < 0.02) {
        requestAnimationFrame(() => setTimeout(resolve, 60));
        return;
      }

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        video.removeEventListener('seeked', onSeeked);
        clearTimeout(timer);
        requestAnimationFrame(() => setTimeout(resolve, 70));
      };
      const onSeeked = () => finish();
      const timer = setTimeout(finish, 1800);

      video.addEventListener('seeked', onSeeked, { once: true });
      video.currentTime = clamped;
    });
  }

  async function batchCaptureSelectedSubtitles() {
    const selected = state.subItems.filter((s) => s.selected).sort((a, b) => a.from - b.from);
    if (selected.length === 0 || state.subBatchRunning) return;

    const video = getVideoElement();
    if (!video || !isFinite(video.duration)) {
      showToast('未检测到有效视频');
      return;
    }

    state.subBatchRunning = true;
    renderSubtitlesTab();
    if (!video.paused) video.pause();

    let count = 0;
    try {
      for (const sub of selected) {
        if (!state.subBatchRunning) break;
        const midTime = (sub.from + sub.to) / 2;
        showToast(`正在截取字幕 (${count + 1}/${selected.length})...`);
        await seekAndWaitFrame(video, midTime);
        const item = await grabVideoFrameToBlob(state.burnSubtitle ? sub.text : '', 720);
        state.screenshots.push(item);
        appendScreenshotItem(item);
        count++;
        await new Promise((r) => setTimeout(r, 15));
      }
      state.activeTab = 'screenshots';
      syncPanelState();
      showToast(`已完成 ${count} 张字幕截图（720p），可直接拼合长图`);
    } catch (err) {
      console.error('[BiliExt] 批量字幕截图出错:', err);
      showToast('批量截图中断：' + (err.message || '未知错误'));
    } finally {
      state.subBatchRunning = false;
      captureCanvas.width = 0;
      captureCanvas.height = 0;
      thumbCanvas.width = 0;
      thumbCanvas.height = 0;
      renderSubtitlesTab();
    }
  }

  function loadImageFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      img.src = url;
    });
  }

  async function buildStitchedCanvas() {
    if (state.screenshots.length === 0) return null;

    const first = state.screenshots[0];
    const targetWidth = first.width;
    const topRatio = state.topCropPct / 100;
    const bottomRatio = state.bottomCropPct / 100;

    const sliceSpecs = state.screenshots.map((ss, index) => {
      const scale = targetWidth / ss.width;
      const scaledH = ss.height * scale;
      const syRatio = state.subtitleFold ? (index === 0 ? 0 : topRatio) : 0;
      const eyRatio = state.subtitleFold ? bottomRatio : 1;

      const sy = Math.round(ss.height * syRatio);
      const sh = Math.max(1, Math.round(ss.height * (eyRatio - syRatio)));
      const destH = Math.max(1, Math.round(scaledH * (eyRatio - syRatio)));
      return { ss, sy, sh, destH };
    });

    const totalHeight = sliceSpecs.reduce((sum, s) => sum + s.destH, 0);
    const outCanvas = document.createElement('canvas');
    outCanvas.width = targetWidth;
    outCanvas.height = totalHeight;
    const ctx = outCanvas.getContext('2d');

    let currentY = 0;
    for (const spec of sliceSpecs) {
      const { img, url } = await loadImageFromBlob(spec.ss.blob);
      ctx.drawImage(img, 0, spec.sy, img.naturalWidth, spec.sh, 0, currentY, targetWidth, spec.destH);
      currentY += spec.destH;
      img.removeAttribute('src');
      img.src = '';
      URL.revokeObjectURL(url);
    }

    return outCanvas;
  }

  async function exportStitchedImage(mode = 'download') {
    if (state.screenshots.length === 0) return;
    let canvas = null;
    try {
      showToast('正在拼合长图...');
      canvas = await buildStitchedCanvas();
      if (!canvas) return;

      const blob = await canvasToBlobAsync(canvas, 'image/png');
      if (mode === 'copy') {
        if (navigator.clipboard && window.ClipboardItem) {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          showToast('拼合长图已复制到剪贴板');
        } else {
          showToast('当前环境不支持直接复制图片，请使用下载');
        }
      } else {
        const suffix = state.subtitleFold ? '_字幕拼合' : '_长图拼合';
        const filename = `${getVideoTitleSafe()}${suffix}_${Date.now()}.png`;
        downloadBlob(blob, filename);
        showToast('长图已开始下载');
      }
    } catch (err) {
      console.error('[BiliExt] 拼合长图失败:', err);
      showToast('拼合长图失败，请查看控制台');
    } finally {
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
  }

  function releaseScreenshotMemory(ss, itemEl = null) {
    if (itemEl) {
      const img = itemEl.querySelector('img');
      if (img) {
        img.removeAttribute('src');
        img.src = '';
      }
      itemEl.remove();
    }
    if (ss) {
      if (ss.thumbUrl) {
        URL.revokeObjectURL(ss.thumbUrl);
        ss.thumbUrl = '';
      }
      ss.blob = null;
    }
  }

  function clearAllScreenshots() {
    const panel = cachedPanel;
    if (panel) {
      panel.querySelectorAll('.bili-ext-ss-item img').forEach((img) => {
        img.removeAttribute('src');
        img.src = '';
      });
    }
    for (const ss of state.screenshots) {
      releaseScreenshotMemory(ss, null);
    }
    state.screenshots = [];
    syncPanelState();
    showToast('已清空截图并释放内存');
  }

  // =========================================================================
  // 7. 右下角悬浮球 & 独立三大功能面板 UI
  // =========================================================================
  function ensureFloatingButton() {
    if (cachedFab && cachedFab.isConnected) return cachedFab;

    const fab = document.createElement('div');
    fab.id = 'bili-ext-fab';
    fab.title = '点击打开/收起截图与字幕工具（可拖动位置）';
    fab.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M4 5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H4zm0 2h16v10H4V7zm3 2.5A1.5 1.5 0 1 0 7 12.5a1.5 1.5 0 0 0 0-3zm11 5.5-3.5-4.5-2.8 3.5-1.7-2.2L6 15h12z"/>
      </svg>
      <span id="bili-ext-fab-badge">0</span>
    `;
    document.body.appendChild(fab);
    cachedFab = fab;

    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let origRight = 24;
    let origBottom = 28;

    fab.addEventListener('pointerdown', (e) => {
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = fab.getBoundingClientRect();
      origRight = window.innerWidth - rect.right;
      origBottom = window.innerHeight - rect.bottom;
      fab.setPointerCapture(e.pointerId);
    });

    fab.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      if (!moved) return;

      const nextRight = Math.max(8, Math.min(window.innerWidth - 54, origRight - dx));
      const nextBottom = Math.max(8, Math.min(window.innerHeight - 54, origBottom - dy));
      fab.style.right = `${nextRight}px`;
      fab.style.bottom = `${nextBottom}px`;
    });

    fab.addEventListener('pointerup', () => {
      if (!dragging) return;
      dragging = false;
      if (!moved) {
        state.panelVisible = !state.panelVisible;
        syncPanelState();
      }
    });

    return fab;
  }

  function updateFabStatus() {
    const fab = ensureFloatingButton();
    fab.classList.toggle('active', state.panelVisible);
    const badge = fab.querySelector('#bili-ext-fab-badge');
    const count = state.screenshots.length;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.toggle('show', count > 0);
  }

  function ensureScreenshotPanel() {
    if (cachedPanel && cachedPanel.isConnected) return cachedPanel;

    const panel = document.createElement('div');
    panel.id = 'bili-ext-ss-panel';
    panel.innerHTML = `
      <div class="bili-ext-ss-header">
        <span class="bili-ext-ss-title">视频截图与字幕工具</span>
        <div class="bili-ext-ss-header-actions">
          <button class="bili-ext-btn-sm primary" data-action="capture" title="快捷键 Shift+S">+ 截一帧</button>
          <button class="bili-ext-btn-sm" data-action="close">收起</button>
        </div>
      </div>

      <div class="bili-ext-tabs">
        <div class="bili-ext-tab active" data-tab="screenshots">长图截图 (0)</div>
        <div class="bili-ext-tab" data-tab="subCapture">字幕快截</div>
        <div class="bili-ext-tab" data-tab="subDownload">字幕下载</div>
      </div>

      <!-- Tab 1: 长图截图 -->
      <div class="bili-ext-tab-body active" data-tab-body="screenshots">
        <div class="bili-ext-ss-controls">
          <div class="bili-ext-switch-row">
            <span>保留字幕（折叠其余图片）</span>
            <div style="display:flex;align-items:center;gap:8px;">
              <button class="bili-ext-btn-sm danger" data-action="clear" style="padding:2px 7px;font-size:11px;">清空截图</button>
              <label class="bili-ext-switch">
                <input type="checkbox" id="bili-ext-fold-toggle" />
                <span class="bili-ext-switch-slider"></span>
              </label>
            </div>
          </div>

          <div class="bili-ext-range-wrap" id="bili-ext-range-wrap">
            <div class="bili-ext-range-labels">
              <span>除首图顶裁: <b id="bili-ext-top-val">${state.topCropPct}%</b></span>
              <span>底部保留至: <b id="bili-ext-bottom-val">${state.bottomCropPct}%</b></span>
            </div>
            <div class="bili-ext-range-track" id="bili-ext-range-track">
              <div class="bili-ext-range-fill" id="bili-ext-range-fill"></div>
              <div class="bili-ext-range-thumb left" id="bili-ext-thumb-left" title="左节点：控制除首图外其他图片顶部裁剪高度"></div>
              <div class="bili-ext-range-thumb right" id="bili-ext-thumb-right" title="右节点：控制所有图片底部裁剪高度"></div>
            </div>
            <div class="bili-ext-range-hint">
              左节点控制除首图外顶部裁剪；右节点控制底部裁剪（首图仅裁底）。
            </div>
          </div>
        </div>

        <div class="bili-ext-ss-list" id="bili-ext-ss-list">
          <div class="bili-ext-ss-empty">
            暂无截图。<br/>
            按 <kbd style="background:rgba(255,255,255,.15);padding:1px 5px;border-radius:3px;">Shift + S</kbd> 或点击「+ 截一帧」，<br/>
            最早截取的画面将排在最上方，方便拼合长图。
          </div>
        </div>

        <div class="bili-ext-ss-footer">
          <button class="bili-ext-btn-stitch" id="bili-ext-btn-stitch" disabled>下载拼合长图</button>
          <button class="bili-ext-btn-copy" id="bili-ext-btn-copy" disabled>复制长图</button>
        </div>
      </div>

      <!-- Tab 2: 字幕快截 (720p) -->
      <div class="bili-ext-tab-body" data-tab-body="subCapture">
        <div class="bili-ext-sub-toolbar">
          <div class="bili-ext-sub-row">
            <select class="bili-ext-select" id="bili-ext-sub-track">
              <option value="">尚未加载字幕</option>
            </select>
            <button class="bili-ext-btn-sm primary" id="bili-ext-sub-load">拉取字幕</button>
          </div>
          <div class="bili-ext-sub-row">
            <input type="text" class="bili-ext-input" id="bili-ext-sub-search" placeholder="搜索台词（支持 Shift 连选）..." />
            <button class="bili-ext-btn-sm" id="bili-ext-sub-select-all">全选</button>
            <button class="bili-ext-btn-sm" id="bili-ext-sub-clear-sel">清空</button>
          </div>
          <div class="bili-ext-switch-row">
            <span title="若原视频没有硬字幕，开启后会将选中的 AI 字幕直接绘制到截图底部">无硬字幕时绘制 AI 字幕到画面</span>
            <label class="bili-ext-switch">
              <input type="checkbox" id="bili-ext-burn-sub-chk" ${state.burnSubtitle ? 'checked' : ''} />
              <span class="bili-ext-switch-slider"></span>
            </label>
          </div>
        </div>

        <div class="bili-ext-sub-list" id="bili-ext-sub-list">
          <div class="bili-ext-ss-empty">
            点击上方「拉取字幕」获取 AI / CC 字幕，<br/>
            勾选想要的台词即可按时间戳批量截取 720p 画面。
          </div>
        </div>

        <div class="bili-ext-ss-footer">
          <button class="bili-ext-btn-stitch" id="bili-ext-btn-sub-capture" disabled>批量截取选中字幕 (0)</button>
        </div>
      </div>

      <!-- Tab 3: 独立字幕下载 -->
      <div class="bili-ext-tab-body" data-tab-body="subDownload">
        <div class="bili-ext-dl-panel">
          <div class="bili-ext-sub-row">
            <select class="bili-ext-select" id="bili-ext-dl-track">
              <option value="">尚未加载字幕</option>
            </select>
            <button class="bili-ext-btn-sm primary" id="bili-ext-dl-load">拉取字幕</button>
          </div>

          <div class="bili-ext-dl-meta">
            <span id="bili-ext-dl-status">未加载</span>
            <span>点击下方格式直接下载完整字幕</span>
          </div>

          <div class="bili-ext-dl-preview" id="bili-ext-dl-preview">点击「拉取字幕」后可在此预览文本内容，并一键导出为 SRT / ASS / MD / TXT。</div>

          <div class="bili-ext-dl-grid">
            <button class="bili-ext-dl-fmt-btn" data-dl-fmt="txt" disabled>
              TXT
              <span class="bili-ext-dl-fmt-sub">纯文本分析</span>
            </button>
            <button class="bili-ext-dl-fmt-btn" data-dl-fmt="md" disabled>
              MD
              <span class="bili-ext-dl-fmt-sub">笔记整理</span>
            </button>
            <button class="bili-ext-dl-fmt-btn" data-dl-fmt="srt" disabled>
              SRT
              <span class="bili-ext-dl-fmt-sub">通用字幕</span>
            </button>
            <button class="bili-ext-dl-fmt-btn" data-dl-fmt="ass" disabled>
              ASS
              <span class="bili-ext-dl-fmt-sub">离线特效</span>
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(panel);
    cachedPanel = panel;

    panel.querySelector('[data-action="capture"]').addEventListener('click', captureVideoFrame);
    panel.querySelector('[data-action="clear"]').addEventListener('click', clearAllScreenshots);
    panel.querySelector('[data-action="close"]').addEventListener('click', () => {
      state.panelVisible = false;
      syncPanelState();
    });

    panel.querySelectorAll('.bili-ext-tab').forEach((tabEl) => {
      tabEl.addEventListener('click', () => {
        state.activeTab = tabEl.dataset.tab;
        if (
          (state.activeTab === 'subCapture' || state.activeTab === 'subDownload') &&
          state.subVideoKey !== location.href
        ) {
          loadCurrentVideoSubtitles(false);
        }
        syncTabVisibility(panel);
      });
    });

    const foldToggle = panel.querySelector('#bili-ext-fold-toggle');
    foldToggle.checked = state.subtitleFold;
    foldToggle.addEventListener('change', () => {
      state.subtitleFold = foldToggle.checked;
      syncPanelState();
    });

    setupDualRangeSlider(panel);

    panel.querySelector('#bili-ext-btn-stitch').addEventListener('click', () => exportStitchedImage('download'));
    panel.querySelector('#bili-ext-btn-copy').addEventListener('click', () => exportStitchedImage('copy'));

    // Tab 2 事件
    panel.querySelector('#bili-ext-sub-load').addEventListener('click', () => loadCurrentVideoSubtitles(true));
    panel.querySelector('#bili-ext-sub-track').addEventListener('change', (e) => {
      switchSubtitleTrack(Number(e.target.value));
    });
    panel.querySelector('#bili-ext-sub-search').addEventListener('input', (e) => {
      state.subFilter = e.target.value.trim().toLowerCase();
      renderSubtitlesTab();
    });
    panel.querySelector('#bili-ext-sub-select-all').addEventListener('click', () => {
      getFilteredSubItems().forEach((it) => {
        it.selected = true;
      });
      renderSubtitlesTab();
    });
    panel.querySelector('#bili-ext-sub-clear-sel').addEventListener('click', () => {
      state.subItems.forEach((it) => {
        it.selected = false;
      });
      renderSubtitlesTab();
    });
    panel.querySelector('#bili-ext-burn-sub-chk').addEventListener('change', (e) => {
      state.burnSubtitle = e.target.checked;
      GM_setValue(STORAGE_KEY_BURN_SUB, state.burnSubtitle);
    });
    panel.querySelector('#bili-ext-btn-sub-capture').addEventListener('click', batchCaptureSelectedSubtitles);

    // Tab 3 独立字幕下载事件
    panel.querySelector('#bili-ext-dl-load').addEventListener('click', () => loadCurrentVideoSubtitles(true));
    panel.querySelector('#bili-ext-dl-track').addEventListener('change', (e) => {
      switchSubtitleTrack(Number(e.target.value));
    });
    panel.querySelectorAll('[data-dl-fmt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        exportSubtitlesFile(btn.dataset.dlFmt);
      });
    });

    return panel;
  }

  function syncTabVisibility(panel) {
    panel.querySelectorAll('.bili-ext-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === state.activeTab);
    });
    panel.querySelectorAll('.bili-ext-tab-body').forEach((b) => {
      b.classList.toggle('active', b.dataset.tabBody === state.activeTab);
    });
    if (state.activeTab === 'screenshots') {
      requestAnimationFrame(() => applyFoldPreviewStyles(panel));
    }
  }

  function getFilteredSubItems() {
    if (!state.subFilter) return state.subItems;
    return state.subItems.filter((it) => it.text.toLowerCase().includes(state.subFilter));
  }

  function renderSubDownloadTab() {
    const panel = ensureScreenshotPanel();
    const trackSelect = panel.querySelector('#bili-ext-dl-track');
    const statusEl = panel.querySelector('#bili-ext-dl-status');
    const previewEl = panel.querySelector('#bili-ext-dl-preview');
    const fmtBtns = panel.querySelectorAll('[data-dl-fmt]');

    if (state.subTracks.length > 0) {
      trackSelect.innerHTML = state.subTracks
        .map((t, i) => `<option value="${i}" ${i === state.subTrackIdx ? 'selected' : ''}>${t.label}</option>`)
        .join('');
    } else {
      trackSelect.innerHTML = '<option value="">尚未加载字幕</option>';
    }

    if (state.subLoading) {
      statusEl.textContent = '正在加载...';
      previewEl.textContent = '正在获取字幕轨道，请稍候...';
      fmtBtns.forEach((b) => (b.disabled = true));
      return;
    }

    if (state.subItems.length === 0) {
      statusEl.textContent = '未加载';
      previewEl.textContent = '点击「拉取字幕」后可在此预览文本内容，并一键导出为 SRT / ASS / MD / TXT。';
      fmtBtns.forEach((b) => (b.disabled = true));
      return;
    }

    statusEl.textContent = `共 ${state.subItems.length} 条字幕`;
    previewEl.textContent = state.subItems
      .slice(0, 60)
      .map((it) => `[${formatTime(it.from, false)}] ${it.text}`)
      .join('\n') + (state.subItems.length > 60 ? `\n\n... 其余 ${state.subItems.length - 60} 条将在导出文件中完整包含` : '');
    fmtBtns.forEach((b) => (b.disabled = false));
  }

  function renderSubtitlesTab() {
    const panel = ensureScreenshotPanel();
    const trackSelect = panel.querySelector('#bili-ext-sub-track');
    const listEl = panel.querySelector('#bili-ext-sub-list');
    const batchBtn = panel.querySelector('#bili-ext-btn-sub-capture');

    if (state.subTracks.length > 0) {
      trackSelect.innerHTML = state.subTracks
        .map((t, i) => `<option value="${i}" ${i === state.subTrackIdx ? 'selected' : ''}>${t.label}</option>`)
        .join('');
    } else {
      trackSelect.innerHTML = '<option value="">尚未加载字幕</option>';
    }

    const selectedCount = state.subItems.filter((s) => s.selected).length;
    batchBtn.disabled = selectedCount === 0 || state.subBatchRunning;
    batchBtn.textContent = state.subBatchRunning ? '截取中...' : `批量截取选中字幕 (${selectedCount})`;

    if (state.subLoading) {
      listEl.innerHTML = '<div class="bili-ext-ss-empty">正在加载字幕数据...</div>';
      return;
    }

    const filtered = getFilteredSubItems();
    if (state.subItems.length === 0) {
      listEl.innerHTML = `
        <div class="bili-ext-ss-empty">
          点击上方「拉取字幕」获取 AI / CC 字幕，<br/>
          勾选想要的台词即可按时间戳批量截取 720p 画面。
        </div>
      `;
      return;
    }

    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="bili-ext-ss-empty">没有匹配的台词</div>';
      return;
    }

    listEl.innerHTML = '';
    const frag = document.createDocumentFragment();

    for (const item of filtered) {
      const row = document.createElement('div');
      row.className = `bili-ext-sub-item ${item.selected ? 'selected' : ''}`;
      row.innerHTML = `
        <input type="checkbox" ${item.selected ? 'checked' : ''} />
        <span class="bili-ext-sub-time" title="点击跳转至此时间">${formatTime(item.from, false)}</span>
        <span class="bili-ext-sub-text"></span>
      `;
      row.querySelector('.bili-ext-sub-text').textContent = item.text;

      const chk = row.querySelector('input[type="checkbox"]');
      const toggleSelect = (e) => {
        if (e.shiftKey && state.lastCheckedSubIdx !== -1) {
          const min = Math.min(state.lastCheckedSubIdx, item.idx);
          const max = Math.max(state.lastCheckedSubIdx, item.idx);
          const targetState = !item.selected;
          for (let i = min; i <= max; i++) {
            if (state.subItems[i]) state.subItems[i].selected = targetState;
          }
          state.lastCheckedSubIdx = item.idx;
          renderSubtitlesTab();
          return;
        }
        item.selected = !item.selected;
        state.lastCheckedSubIdx = item.idx;
        chk.checked = item.selected;
        row.classList.toggle('selected', item.selected);
        const cnt = state.subItems.filter((s) => s.selected).length;
        batchBtn.disabled = cnt === 0 || state.subBatchRunning;
        batchBtn.textContent = `批量截取选中字幕 (${cnt})`;
      };

      row.querySelector('.bili-ext-sub-time').addEventListener('click', (e) => {
        e.stopPropagation();
        const video = getVideoElement();
        if (video) {
          video.currentTime = (item.from + item.to) / 2;
          showToast(`已跳转至 ${formatTime(item.from, false)}`);
        }
      });

      chk.addEventListener('click', (e) => {
        e.stopPropagation();
        chk.checked = item.selected;
        toggleSelect(e);
      });

      row.addEventListener('click', toggleSelect);
      frag.appendChild(row);
    }

    listEl.appendChild(frag);
  }

  function setupDualRangeSlider(panel) {
    const track = panel.querySelector('#bili-ext-range-track');
    const thumbLeft = panel.querySelector('#bili-ext-thumb-left');
    const thumbRight = panel.querySelector('#bili-ext-thumb-right');

    let activeHandle = null;
    let rafPending = false;
    const MIN_GAP = 2;

    function schedulePreviewUpdate() {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        updateRangeVisuals(panel);
        applyFoldPreviewStyles(panel);
      });
    }

    function updateFromClientX(clientX) {
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = Math.round(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));

      if (activeHandle === 'left') {
        state.topCropPct = Math.min(pct, state.bottomCropPct - MIN_GAP);
      } else if (activeHandle === 'right') {
        state.bottomCropPct = Math.max(pct, state.topCropPct + MIN_GAP);
      }
      schedulePreviewUpdate();
    }

    thumbLeft.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      activeHandle = 'left';
      thumbLeft.setPointerCapture(e.pointerId);
    });

    thumbRight.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      activeHandle = 'right';
      thumbRight.setPointerCapture(e.pointerId);
    });

    track.addEventListener('pointerdown', (e) => {
      const rect = track.getBoundingClientRect();
      const clickPct = ((e.clientX - rect.left) / rect.width) * 100;
      const distL = Math.abs(clickPct - state.topCropPct);
      const distR = Math.abs(clickPct - state.bottomCropPct);
      activeHandle = distL <= distR ? 'left' : 'right';
      track.setPointerCapture(e.pointerId);
      updateFromClientX(e.clientX);
    });

    panel.addEventListener('pointermove', (e) => {
      if (!activeHandle) return;
      updateFromClientX(e.clientX);
    });

    window.addEventListener('pointerup', () => {
      if (!activeHandle) return;
      activeHandle = null;
      GM_setValue(STORAGE_KEY_TOP_CROP, state.topCropPct);
      GM_setValue(STORAGE_KEY_BOTTOM_CROP, state.bottomCropPct);
    });
  }

  function updateRangeVisuals(panel) {
    const fill = panel.querySelector('#bili-ext-range-fill');
    const thumbLeft = panel.querySelector('#bili-ext-thumb-left');
    const thumbRight = panel.querySelector('#bili-ext-thumb-right');
    const topVal = panel.querySelector('#bili-ext-top-val');
    const bottomVal = panel.querySelector('#bili-ext-bottom-val');

    thumbLeft.style.left = `${state.topCropPct}%`;
    thumbRight.style.left = `${state.bottomCropPct}%`;
    fill.style.left = `${state.topCropPct}%`;
    fill.style.width = `${state.bottomCropPct - state.topCropPct}%`;

    topVal.textContent = `${state.topCropPct}%`;
    bottomVal.textContent = `${state.bottomCropPct}%`;
  }

  function applyFoldPreviewStyles(panel) {
    const listEl = panel.querySelector('#bili-ext-ss-list');
    const items = listEl.querySelectorAll('.bili-ext-ss-item');
    if (items.length === 0) return;

    const topPct = state.topCropPct;
    const bottomPct = state.bottomCropPct;
    const boxWidth = items[0].querySelector('.bili-ext-ss-crop-box')?.clientWidth || 320;

    items.forEach((itemEl, index) => {
      const cropBox = itemEl.querySelector('.bili-ext-ss-crop-box');
      const img = cropBox.querySelector('img');
      const w = Number(itemEl.dataset.w) || 16;
      const h = Number(itemEl.dataset.h) || 9;
      const renderedFullH = (boxWidth * h) / w;

      if (!state.subtitleFold) {
        cropBox.style.height = 'auto';
        img.style.marginTop = '0px';
      } else {
        const syRatio = index === 0 ? 0 : topPct / 100;
        const eyRatio = bottomPct / 100;
        const visibleH = Math.max(4, renderedFullH * (eyRatio - syRatio));
        const marginTop = -(renderedFullH * syRatio);

        cropBox.style.height = `${visibleH}px`;
        img.style.marginTop = `${marginTop}px`;
      }
    });
  }

  function refreshBadgesAndActions(panel) {
    const items = panel.querySelectorAll('.bili-ext-ss-item');
    items.forEach((itemEl, idx) => {
      const ss = state.screenshots[idx];
      if (!ss) return;
      const badge = itemEl.querySelector('.bili-ext-ss-badge');
      if (badge) badge.textContent = `#${idx + 1} · ${ss.timeText}`;
    });
  }

  function createScreenshotItemElement(ss, index) {
    const itemEl = document.createElement('div');
    itemEl.className = 'bili-ext-ss-item';
    itemEl.dataset.id = ss.id;
    itemEl.dataset.w = ss.width;
    itemEl.dataset.h = ss.height;

    itemEl.innerHTML = `
      <div class="bili-ext-ss-crop-box">
        <img src="${ss.thumbUrl}" loading="lazy" decoding="async" alt="screenshot" />
      </div>
      <div class="bili-ext-ss-badge">#${index + 1} · ${ss.timeText}</div>
      <div class="bili-ext-ss-item-actions">
        <button class="bili-ext-ss-mini-btn" data-act="dl" title="下载该张截图">下载</button>
        <button class="bili-ext-ss-mini-btn del" data-act="del" title="删除并释放内存">✕</button>
      </div>
    `;

    itemEl.querySelector('[data-act="dl"]').addEventListener('click', () => {
      downloadBlob(ss.blob, `${getVideoTitleSafe()}_${ss.timeText.replace(/:/g, '-')}.png`);
    });

    itemEl.querySelector('[data-act="del"]').addEventListener('click', () => {
      const idx = state.screenshots.findIndex((x) => x.id === ss.id);
      if (idx !== -1) {
        const removed = state.screenshots.splice(idx, 1)[0];
        releaseScreenshotMemory(removed, itemEl);
      } else {
        releaseScreenshotMemory(null, itemEl);
      }
      syncPanelState();
    });

    return itemEl;
  }

  function appendScreenshotItem(ss) {
    const panel = ensureScreenshotPanel();
    const listEl = panel.querySelector('#bili-ext-ss-list');
    const emptyEl = listEl.querySelector('.bili-ext-ss-empty');
    if (emptyEl) emptyEl.remove();

    const itemEl = createScreenshotItemElement(ss, state.screenshots.length - 1);
    listEl.appendChild(itemEl);
    syncPanelState(false);
  }

  function syncPanelState(rebuildEmptyIfNeeded = true) {
    updateFabStatus();
    const panel = ensureScreenshotPanel();
    panel.classList.toggle('visible', state.panelVisible);
    syncTabVisibility(panel);

    panel.querySelector('[data-tab="screenshots"]').textContent = `长图截图 (${state.screenshots.length})`;
    panel.querySelector('#bili-ext-range-wrap').classList.toggle('active', state.subtitleFold);
    updateRangeVisuals(panel);

    const listEl = panel.querySelector('#bili-ext-ss-list');
    listEl.classList.toggle('folded', state.subtitleFold);

    const hasItems = state.screenshots.length > 0;
    panel.querySelector('#bili-ext-btn-stitch').disabled = !hasItems;
    panel.querySelector('#bili-ext-btn-copy').disabled = !hasItems;

    if (!hasItems && rebuildEmptyIfNeeded) {
      listEl.innerHTML = `
        <div class="bili-ext-ss-empty">
          暂无截图。<br/>
          按 <kbd style="background:rgba(255,255,255,.15);padding:1px 5px;border-radius:3px;">Shift + S</kbd> 或点击「+ 截一帧」，<br/>
          最早截取的画面将排在最上方，方便拼合长图。
        </div>
      `;
      return;
    }

    refreshBadgesAndActions(panel);
    requestAnimationFrame(() => applyFoldPreviewStyles(panel));
  }

  // =========================================================================
  // 8. 播放器控制栏挂载
  // =========================================================================
  function injectControlButtons() {
    ensureFloatingButton();

    if (mountedSsBtn && mountedSsBtn.isConnected && mountedFrameBtn && mountedFrameBtn.isConnected) {
      return;
    }

    const rightBar = getControlRightBar();
    if (!rightBar || rightBar.querySelector('.bili-ext-ss-ctrl')) return;

    const modeClass = IS_YOUTUBE ? ' yt-mode' : '';

    const frameBtn = document.createElement('div');
    frameBtn.className = `bili-ext-ctrl-btn bili-ext-frame-ctrl${modeClass}`;
    frameBtn.innerHTML = `
      <svg viewBox="0 0 24 24"><path d="M4 6h2v12H4V6zm4 6l8-6v12l-8-6zm10-6h2v12h-2V6z"/></svg>
      <span>${state.fps}fps</span>
      <div class="bili-ext-fps-popover">
        <div class="bili-ext-fps-row">
          <span>参考帧率</span>
          <div class="bili-ext-fps-pills">
            ${[24, 25, 30, 60]
              .map((f) => `<span class="bili-ext-fps-pill ${state.fps === f ? 'active' : ''}" data-fps="${f}">${f}</span>`)
              .join('')}
          </div>
        </div>
        <div class="bili-ext-fps-row">
          <span>微调时自动暂停</span>
          <label class="bili-ext-switch">
            <input type="checkbox" id="bili-ext-autopause-chk" ${state.autoPause ? 'checked' : ''} />
            <span class="bili-ext-switch-slider"></span>
          </label>
        </div>
        <div class="bili-ext-shortcut-tips">
          <div><span>单帧微调</span><span class="bili-ext-kbd">Shift + ←/→</span></div>
          <div><span>5 帧微调</span><span class="bili-ext-kbd">Ctrl + ←/→</span></div>
          <div><span>1 整秒微调</span><span class="bili-ext-kbd">Shift+Ctrl+←/→</span></div>
          <div><span>快捷截图</span><span class="bili-ext-kbd">Shift + S</span></div>
        </div>
      </div>
    `;

    const popover = frameBtn.querySelector('.bili-ext-fps-popover');
    frameBtn.addEventListener('click', (e) => {
      if (popover.contains(e.target)) return;
      state.fpsPopoverOpen = !state.fpsPopoverOpen;
      popover.classList.toggle('open', state.fpsPopoverOpen);
    });

    popover.querySelectorAll('.bili-ext-fps-pill').forEach((pill) => {
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        state.fps = Number(pill.dataset.fps);
        GM_setValue(STORAGE_KEY_FPS, state.fps);
        frameBtn.querySelector('span').textContent = `${state.fps}fps`;
        popover.querySelectorAll('.bili-ext-fps-pill').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        showToast(`逐帧参考帧率已切换为 ${state.fps} fps`);
      });
    });

    const autoPauseChk = popover.querySelector('#bili-ext-autopause-chk');
    autoPauseChk.addEventListener('change', (e) => {
      e.stopPropagation();
      state.autoPause = autoPauseChk.checked;
      GM_setValue(STORAGE_KEY_AUTOPAUSE, state.autoPause);
    });

    const ssBtn = document.createElement('div');
    ssBtn.className = `bili-ext-ctrl-btn bili-ext-ss-ctrl${modeClass}`;
    ssBtn.title = '截取当前帧 (快捷键 Shift+S)';
    ssBtn.innerHTML = `
      <svg viewBox="0 0 24 24"><path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/></svg>
      <span>截图</span>
    `;
    ssBtn.addEventListener('click', captureVideoFrame);

    rightBar.prepend(ssBtn);
    rightBar.prepend(frameBtn);

    mountedSsBtn = ssBtn;
    mountedFrameBtn = frameBtn;
  }

  document.addEventListener('click', (e) => {
    if (state.fpsPopoverOpen && mountedFrameBtn && !mountedFrameBtn.contains(e.target)) {
      state.fpsPopoverOpen = false;
      mountedFrameBtn.querySelector('.bili-ext-fps-popover')?.classList.remove('open');
    }
  });

  injectControlButtons();
  setInterval(injectControlButtons, 1500);
})();