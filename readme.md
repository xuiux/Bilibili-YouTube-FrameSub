# Bilibili & YouTube 逐帧播放、AI 字幕下载与长图拼合

一个轻量级、高性能的 Tampermonkey 油猴脚本，同时适配 **Bilibili** 与 **YouTube**。整合了多倍率逐帧播放、快捷截图、长图拼合、双节点滑块字幕折叠、AI/CC 字幕批量自动截图（720p）以及多格式字幕导出功能。

---

## 中文介绍

### 核心功能

1. **多倍率逐帧播放**
   - `Shift + ← / →`：单帧后退 / 前进（1 帧）
   - `Ctrl + ← / →`（macOS 支持 `Cmd`）：快速微调（5 帧）
   - `Shift + Ctrl + ← / →`：整秒跳转（1 秒）
   - 播放器控制栏内置帧率切换气泡（支持 `24 / 25 / 30 / 60 fps`）与「微调时自动暂停」开关，在评论区、弹幕框等输入状态下自动屏蔽快捷键。

2. **长图截图与双节点字幕折叠**
   - 按 `Shift + S` 或点击播放器控制栏「截图」即可截取当前帧。
   - **正序排列**：按截取时间从早到晚、从上到下排列，符合长截图阅读习惯。
   - **保留字幕（折叠长图）**：提供**双节点范围滑块**实时预览裁剪效果：
     - **左节点**：控制除首图以外其余图片顶部的裁剪高度。
     - **右节点**：控制所有图片底部的裁剪高度（首图仅裁剪底部）。
   - 支持一键「下载拼合长图」或「复制长图」到剪贴板。

3. **AI 字幕快截（720p 批量自动截图）**
   - 自动拉取 B 站（需登录态）或 YouTube 的 AI / CC 字幕轨道，支持切换语言与关键词搜索。
   - 支持勾选单句或按住 `Shift` 连选区间，自动按台词中点时间戳跳转并截取 `720p` 画面归入长图列表。
   - 提供「无硬字幕时绘制 AI 字幕到画面」开关，方便为无内嵌字幕的视频制作台词长图。

4. **独立字幕下载（SRT / ASS / MD / TXT）**
   - 与截图功能入口分离，支持预览字幕文本并一键导出：
     - `TXT`：纯净逐行文本，适合文本分析与 AI 总结。
     - `MD`：包含视频标题、链接与时间轴的 Markdown 笔记。
     - `SRT` / `ASS`：标准时间轴字幕文件，适合离线播放器与视频压制。

5. **悬浮球入口与性能优化**
   - 页面右下角提供可拖动的独立 SVG 悬浮球（带截图计数角标），点击即可随时展开/收起面板，无需额外截图。
   - 面板采用「原图与 360px 缩略图分离」机制，大量截图不卡顿；删除或清空时主动释放 `ObjectURL` 与图像内存；长图拼合采用串行解码绘制以降低内存峰值。

### 安装与使用

1. 在浏览器中安装 [Tampermonkey](https://www.tampermonkey.net/) 扩展。
2. 新建脚本，将 `bilibili-frame-and-screenshot.user.js` 的内容完整粘贴并保存。
3. 打开任意 Bilibili 或 YouTube 视频页面即可使用（首次在 B 站拉取字幕时，若 Tampermonkey 提示跨域请求 `aisubtitle.hdslb.com`，请点击「总是允许」）。

---

## English

A lightweight, high-performance Tampermonkey userscript for **Bilibili** and **YouTube**, combining multi-step frame-by-frame playback, ordered screenshot stitching, dual-handle subtitle-folding, AI/CC subtitle batch capture (720p), and multi-format subtitle exporting.

### Features

1. **Multi-Step Frame-by-Frame Playback**
   - `Shift + Left / Right`: Step backward / forward by **1 frame**
   - `Ctrl + Left / Right` (`Cmd` on macOS): Step by **5 frames**
   - `Shift + Ctrl + Left / Right`: Jump by **1 full second**
   - Includes a player control bar popover to switch reference FPS (`24 / 25 / 30 / 60 fps`) and toggle auto-pause while seeking. Shortcuts are automatically ignored when typing in inputs or comment boxes.

2. **Ordered Long-Image Stitching & Dual-Handle Subtitle Folding**
   - Press `Shift + S` or click the player control bar button to capture the current frame.
   - **Chronological Order**: Earliest captures stay at the top and newest append to the bottom for natural long-screenshot reading.
   - **Subtitle Folding Mode**: Features a **dual-handle range slider** with live preview:
     - **Left handle**: Controls the top crop height for all images *except the first image*.
     - **Right handle**: Controls the bottom crop height across images (the first image keeps its full top and only crops the bottom).
   - Export the stitched result as a PNG download or copy it directly to the clipboard.

3. **AI/CC Subtitle Batch Capture (720p)**
   - Fetches available AI/CC subtitle tracks on Bilibili (login required for AI subtitles) and YouTube (`json3`), with track switching and keyword filtering.
   - Select lines (supports `Shift + Click` range selection) to automatically seek and capture frames at `720p` resolution into the stitching queue.
   - Optional toggle to burn selected AI/CC subtitle text onto the bottom of captured frames when the video has no hardcoded subtitles.

4. **Standalone Subtitle Downloader (SRT / ASS / MD / TXT)**
   - Dedicated tab separated from screenshot workflows, with text preview and one-click export:
     - `TXT`: Plain text lines for text analysis and LLM summarization.
     - `MD`: Markdown notes with video title, URL, and timestamps.
     - `SRT` / `ASS`: Standard subtitle files for offline media players and archiving.

5. **Floating Action Button & Performance**
   - A draggable bottom-right SVG floating ball (with capture count badge) toggles the panel anytime without triggering a screenshot.
   - Uses 360px thumbnails for UI preview while keeping full-resolution blobs off the DOM, revokes `ObjectURL`s and clears image sources immediately upon deletion, and stitches long images sequentially to minimize peak memory usage.

### Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension.
2. Create a new userscript, paste the contents of `bilibili-frame-and-screenshot.user.js`, and save.
3. Open any Bilibili or YouTube video page. (On first subtitle fetch on Bilibili, allow the cross-origin request to `aisubtitle.hdslb.com` when prompted by Tampermonkey.)

---

## 参考致谢 / Acknowledgements

- [the1812/Bilibili-Evolved](https://github.com/the1812/Bilibili-Evolved)
- [DFameMaster/bilibili-transcript](https://github.com/DFameMaster/bilibili-transcript)

---

## 开源协议 / License

本项目采用 [MIT License](https://opensource.org/licenses/MIT) 开源。

```text
MIT License

Copyright (c) 2026

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
