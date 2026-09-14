/**
 * dsh-topic-trail — 会话工作线索悬浮窗（Client 半）
 *
 * DSH 模块加载器的私有 bundle 格式：window.__ModuleLoader__.load({ id, factory })。
 * factory 是浏览器 CJS 形状，必须自行声明 module/exports；react 由 shell 提供。
 *
 * 通过 slots 服务注册进 shell.overlay（root 作用域的 list 槽位，AppFrame 渲染的
 * 整页悬浮层）：可拖动的悬浮窗，风格跟随 dsh（深色卡片、蓝色强调、系统字体栈），支持：
 *  - 三级线索导航（全部工作区 → 工作区 → 会话），左键切换、右键开始总结
 *  - 对没有线索的历史会话一键「导入」，host 从 dsh 会话日志重建话题
 *  - 展示 DeepSeek 总结出的「话题（线索）」与每个话题的进度步骤
 *  - 收起为可拖动的小球
 */
window.__ModuleLoader__.load({
  id: 'dsh-topic-trail',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');
    var useState = React.useState;
    var useEffect = React.useEffect;
    var useRef = React.useRef;
    var useCallback = React.useCallback;
    var h = React.createElement;

    // ── CSS（data-plugin-css 注入，随插件卸载由 HMR/loader 清理） ──────────
    // 配色取自 dsh 实际渲染：背景 #151517、卡片 #2C2C2E、主文字 #F9FAFB、
    // 次要 #ADB2B8、边框 rgba(255,255,255,0.12)、强调蓝 #679EFE、成功绿 #4CAF50。
    var CSS_ID = 'dsh-topic-trail/panel.css';
    var CSS = [
      '.dtt-root{position:fixed;z-index:9999;pointer-events:auto;font-size:13px;line-height:1.5;',
      '  width:256px;max-height:76vh;display:flex;flex-direction:column;border-radius:16px;overflow:hidden;',
      '  background:rgba(38,38,41,0.96);',
      '  color:#f9fafb;border:1px solid rgba(255,255,255,0.10);',
      '  box-shadow:0 18px 52px rgba(0,0,0,0.55),0 4px 16px rgba(0,0,0,0.35);',
      '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Arial,sans-serif}',
      '.dtt-head{display:flex;align-items:center;gap:8px;padding:12.5px 12px;cursor:move;user-select:none;',
      '  background:linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.015));',
      '  border-bottom:1px solid rgba(255,255,255,0.08)}',
      '.dtt-head-ball{position:absolute;left:9.5px;top:12.5px;width:30px;height:30px;border-radius:50%;',
      '  background:linear-gradient(135deg,#4f8cff,#2563eb);box-shadow:0 2px 8px rgba(37,99,235,0.4);',
      '  display:flex;align-items:center;justify-content:center;overflow:visible;z-index:2;cursor:pointer}',
      '.dtt-head-ball::before{content:"";position:absolute;inset:-3px;border-radius:50%;',
      '  border:2px solid rgba(200,220,255,0.35);animation:dtt-fab-pulse 3.2s ease-in-out infinite;pointer-events:none}',
      '.dtt-head{position:relative;padding-left:50.5px !important}',
      '.dtt-title{font-weight:600;font-size:13px;display:flex;align-items:center;gap:7px;white-space:nowrap;letter-spacing:0.2px}',
      '.dtt-title .dtt-dot{width:8px;height:8px;border-radius:50%;background:#4caf50;display:inline-block;',
      '  animation:dtt-pulse 1.8s ease-in-out infinite;box-shadow:0 0 10px rgba(76,175,80,0.55)}',
      '/* 标题栏小眼睛（与大球同尺寸同样式） */',
      '.dtt-head-eye{position:relative;width:30px;height:30px;border-radius:50%;flex:none;',
      '  background:linear-gradient(135deg,#4f8cff,#2563eb);',
      '  border:1px solid rgba(255,255,255,0.2);',
      '  display:flex;align-items:center;justify-content:center;',
      '  box-shadow:0 4px 14px rgba(37,99,235,0.5),0 1px 4px rgba(0,0,0,0.3)}',
      '.dtt-head-eye::before{content:"";position:absolute;inset:-6px;border-radius:50%;',
      '  border:3px solid rgba(210,225,255,0.5);pointer-events:none;',
      '  animation:dtt-fab-pulse 2.8s ease-in-out infinite}',
      '.dtt-head-eye.busy::before{animation-duration:1.1s;border-color:rgba(230,240,255,0.75)}',
      '.dtt-head-eye .dtt-fab-pupil{font-weight:700;color:#fff;line-height:1;pointer-events:none;',
      '  transition:transform 0.15s cubic-bezier(0.4,0,0.2,1)}',
      '@keyframes dtt-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.45;transform:scale(0.82)}}',
      '.dtt-nav{position:relative;flex:1;min-width:0}',
      '.dtt-nav-btn{width:100%;font-size:12px;padding:5px 10px;border-radius:9px;',
      '  border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.05);',
      '  color:#f9fafb;cursor:pointer;text-align:left;display:flex;align-items:center;gap:6px;',
      '  transition:background 0.15s ease,border-color 0.15s ease}',
      '.dtt-nav-btn:hover{background:rgba(255,255,255,0.09);border-color:rgba(255,255,255,0.2)}',
      '.dtt-nav-label{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dtt-nav-arrow{flex:none;font-size:9px;color:#adb2b8;transition:transform 0.18s ease}',
      '.dtt-nav-open .dtt-nav-arrow{transform:rotate(180deg)}',
      '.dtt-nav-pop{position:fixed;left:0;top:0;width:300px;max-width:min(92vw,340px);max-height:min(60vh,340px);overflow-y:auto;z-index:10000;',
      '  background:rgba(38,38,41,0.98);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);',
      '  border:1px solid rgba(255,255,255,0.12);border-radius:12px;',
      '  box-shadow:0 18px 48px rgba(0,0,0,0.5);padding:5px;animation:dtt-fade 0.12s ease both}',
      '.dtt-nav-pop::-webkit-scrollbar{width:6px}',
      '.dtt-nav-pop::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.14);border-radius:3px}',
      '.dtt-nav-item{display:flex;align-items:center;gap:6px;padding:6px 9px;border-radius:8px;cursor:pointer;font-size:12px;',
      '  color:#e6e8ea;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background 0.12s ease}',
      '.dtt-nav-item:hover{background:rgba(255,255,255,0.08)}',
      '.dtt-nav-item.sel{background:rgba(103,158,254,0.16);color:#a8c2ff}',
      '.dtt-nav-item.sel:hover{background:rgba(103,158,254,0.22)}',
      '.dtt-nav-item.ws{font-weight:600;color:#f9fafb;margin-top:4px}',
      '.dtt-nav-item.ws:first-of-type{margin-top:0}',
      '.dtt-nav-item.ses{padding-left:24px;color:#adb2b8}',
      '.dtt-nav-item .dtt-nav-ic{flex:none;font-size:10px;opacity:0.75}',
      '.dtt-nav-item .dtt-nav-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dtt-nav-pin{flex:none;width:20px;height:20px;border:0;background:transparent;cursor:pointer;font-size:11px;opacity:0.3;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;padding:0;transition:opacity 0.12s ease,background 0.12s ease}',
      '.dtt-nav-pin:hover{opacity:1;background:rgba(255,255,255,0.08)}',
      '.dtt-nav-pin.on{opacity:1}',
      '.dtt-btn{border:0;background:transparent;cursor:pointer;color:#adb2b8;border-radius:7px;width:26px;height:26px;',
      '  display:inline-flex;align-items:center;justify-content:center;font-size:14px;line-height:1;padding:0;flex:none;',
      '  transition:background 0.12s ease,color 0.12s ease}',
      '.dtt-btn:hover{background:rgba(255,255,255,0.09);color:#f9fafb}',
      '.dtt-btn:active{background:rgba(255,255,255,0.13)}',
      '.dtt-body{flex:1;min-height:0;overflow-y:auto;padding:6px;display:flex;flex-direction:column;gap:5px}',
      '.dtt-bootstrap{padding:7px 11px;border-radius:9px;font-size:11px;color:#a8c2ff;',
      '  background:rgba(103,158,254,0.10);border:1px solid rgba(103,158,254,0.22);display:flex;align-items:center;gap:7px}',
      '.dtt-body::-webkit-scrollbar{width:8px}',
      '.dtt-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.18);border-radius:4px;border:2px solid transparent;background-clip:padding-box}',
      '.dtt-body::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.28);border:2px solid transparent;background-clip:padding-box}',
      '.dtt-body::-webkit-scrollbar-track{background:transparent}',
      '.dtt-resize-handle{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;z-index:10}',
      '.dtt-resize-handle::after{content:"";position:absolute;right:3px;bottom:3px;width:8px;height:8px;',
      '  border-right:2px solid rgba(255,255,255,0.3);border-bottom:2px solid rgba(255,255,255,0.3);',
      '  border-radius:0 0 2px 0}',
      '.dtt-resize-handle:hover::after{border-color:rgba(255,255,255,0.5)}',
      '/* 笔记区域（所见即所得：透明 textarea 叠加预览层） */',
      '.dtt-note{border-top:1px solid rgba(255,255,255,0.08);background:rgba(0,0,0,0.15)}',
      '.dtt-note-wysiwyg{position:relative}',
      '.dtt-note-preview-layer{position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:1;overflow:hidden;transition:opacity 0.15s ease}',
      '.dtt-note-input-layer{position:relative;z-index:2;color:transparent;caret-color:#e5e7eb;background:transparent;resize:vertical;transition:color 0.15s ease}',
      '.dtt-note-wysiwyg.focused .dtt-note-preview-layer{opacity:0}',
      '.dtt-note-wysiwyg.focused .dtt-note-input-layer{color:#e5e7eb}',
      '.dtt-note-input{width:100%;min-height:80px;max-height:180px;padding:8px 10px;border:0;outline:none;font-size:0.92em;line-height:1.6;font-family:inherit;box-sizing:border-box}',
      '.dtt-note-preview{min-height:60px;padding:8px 10px;color:#e5e7eb;font-size:0.92em;line-height:1.6;box-sizing:border-box;word-break:break-word}',
      '.dtt-btn.active{background:rgba(79,140,255,0.2);color:#7cb0ff}',
      '.dtt-btn.drawing{background:rgba(79,140,255,0.3);color:#7cb0ff;box-shadow:0 0 0 1px rgba(79,140,255,0.5)}',
      '/* 独立笔记浮窗 */',
      '.dtt-note-win{position:fixed;z-index:10000;width:320px;min-height:200px;max-height:60vh;display:flex;flex-direction:column;border-radius:14px;overflow:hidden;',
      '  background:rgba(38,38,41,0.97);color:#f9fafb;border:1px solid rgba(255,255,255,0.10);',
      '  box-shadow:0 18px 52px rgba(0,0,0,0.55),0 4px 16px rgba(0,0,0,0.35);',
      '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Arial,sans-serif;font-size:13px;line-height:1.5}',
      '.dtt-note-win-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;cursor:move;user-select:none;',
      '  background:linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.015));border-bottom:1px solid rgba(255,255,255,0.06)}',
      '.dtt-note-win-title{font-weight:600;font-size:13px;color:#f3f4f6}',
      '.dtt-note-win-close{flex:none;width:24px;height:24px;border-radius:6px;background:transparent;border:0;color:#9ca3af;font-size:18px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center}',
      '.dtt-note-win-close:hover{background:rgba(255,255,255,0.08);color:#f3f4f6}',
      '.dtt-note-win-body{flex:1;min-height:160px;position:relative;overflow:hidden}',
      '.dtt-note-win-body.drawing .dtt-note-input-layer{pointer-events:none}',
      '/* 绘画 canvas */',
      '.dtt-note-canvas{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:3}',
      '.dtt-note-canvas.active{pointer-events:auto;cursor:crosshair}',
      '.dtt-note-wysiwyg.drawing .dtt-note-input-layer{pointer-events:none}',
      '.dtt-draw-bar{display:flex;align-items:center;gap:8px;padding:4px 8px;border-top:1px solid rgba(255,255,255,0.08);background:rgba(0,0,0,0.2);font-size:11px}',
      '.dtt-draw-mode{color:#9ca3af}',
      '.dtt-draw-color{width:14px;height:14px;border-radius:50%;border:1px solid rgba(255,255,255,0.3)}',
      '.dtt-draw-btn{flex:none;padding:2px 8px;font-size:11px;border-radius:5px;background:rgba(255,255,255,0.08);border:0;color:#d1d5db;cursor:pointer}',
      '.dtt-draw-btn:hover{background:rgba(255,255,255,0.14)}',
      '/* 绘画右键菜单 */',
      '.dtt-draw-menu .dtt-menu-item.active{background:rgba(79,140,255,0.18);color:#7cb0ff}',
      '.dtt-draw-colors{display:flex;flex-wrap:wrap;gap:6px;padding:6px 10px}',
      '.dtt-draw-color-swatch{width:18px;height:18px;border-radius:50%;cursor:pointer;border:2px solid transparent;transition:transform 0.1s}',
      '.dtt-draw-color-swatch:hover{transform:scale(1.15)}',
      '.dtt-draw-color-swatch.active{border-color:#fff;box-shadow:0 0 0 1px rgba(79,140,255,0.8)}',
      '.dtt-menu-sep{height:1px;background:rgba(255,255,255,0.08);margin:4px 0}',
      '.dtt-empty{color:#9ca3af;text-align:center;padding:24px 12px;font-size:12px;line-height:1.9}',
      '.dtt-empty .dtt-empty-ic{font-size:24px;display:block;margin-bottom:6px;opacity:0.45}',
      '.dtt-import-box{display:flex;flex-direction:column;gap:10px;padding:8px 6px}',
      '.dtt-import-title{font-weight:600;font-size:13px;color:#f9fafb;word-break:break-all}',
      '.dtt-import-hint{color:#9ca3af;font-size:11px;line-height:1.7}',
      '.dtt-import-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;',
      '  padding:8px 16px;border-radius:9px;border:0;cursor:pointer;font-size:12px;font-weight:600;',
      '  background:linear-gradient(135deg,#2f6fed,#1d4ed8);color:#ffffff;',
      '  box-shadow:0 4px 14px rgba(29,78,216,0.35);transition:filter 0.12s ease,transform 0.12s ease}',
      '.dtt-import-btn:hover{filter:brightness(1.1)}',
      '.dtt-import-btn:active{transform:translateY(1px)}',
      '.dtt-import-btn:disabled{opacity:0.55;cursor:wait}',
      '.dtt-import-err{color:#f87171;font-size:11px}',
      '.dtt-topic{border:1px solid rgba(255,255,255,0.09);border-radius:10px;overflow:hidden;min-height:44px;',
      '  background:rgba(255,255,255,0.04);transition:border-color 0.15s ease,background 0.15s ease;',
      '  animation:dtt-in 0.18s ease both}',
      '.dtt-topic:hover{border-color:rgba(255,255,255,0.16);background:rgba(255,255,255,0.055)}',
      '@keyframes dtt-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}',
      '@keyframes dtt-fade{from{opacity:0}to{opacity:1}}',
      '.dtt-topic-head{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;cursor:pointer;text-align:left;width:100%;min-height:44px;',
      '  border:0;background:transparent;color:inherit;font:inherit}',
      '.dtt-topic-head:hover{background:rgba(255,255,255,0.03)}',
      '.dtt-status{flex:none;width:8px;height:8px;border-radius:50%;margin-top:6px}',
      '.dtt-status.active{background:#4caf50;box-shadow:0 0 0 3px rgba(76,175,80,0.22);animation:dtt-pulse 1.8s ease-in-out infinite}',
      '.dtt-status.done{background:#4b4b52}',
      '.dtt-topic-main{flex:1;min-width:0}',
      '.dtt-topic-title{font-weight:600;font-size:calc(16px * var(--dtt-scale, 1));word-break:break-all;line-height:1.45}',
      '.dtt-topic-edit-input{width:100%;font-size:13px;font-weight:600;color:#f3f4f6;line-height:1.45;',
      '  background:rgba(255,255,255,0.08);border:1px solid rgba(103,158,254,0.5);border-radius:6px;',
      '  padding:2px 6px;outline:none;box-sizing:border-box}',
      // hover 动效展开的描述区（默认收起为 0 高度，悬停缓慢平滑展开）
      '.dtt-topic-reveal{max-height:0;opacity:0;overflow:hidden;margin-top:0;',
      '  transition:max-height 0.5s cubic-bezier(0.4,0,0.2,1),opacity 0.42s ease,margin-top 0.5s cubic-bezier(0.4,0,0.2,1)}',
      '.dtt-topic:hover .dtt-topic-reveal,.dtt-topic:focus-within .dtt-topic-reveal',
      '  {max-height:150px;opacity:1;margin-top:3px}',
      '.dtt-topic-summary{color:#adb2b8;font-size:12px;word-break:break-all;line-height:1.55}',
      '.dtt-topic-meta{color:#9ca3af;font-size:11px;margin-top:5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dtt-badge{flex:none;font-size:10px;line-height:16px;height:16px;padding:0 6px;border-radius:4px;font-weight:500}',
      '.dtt-badge-llm{background:rgba(103,158,254,0.18);color:#a8c2ff}',
      '.dtt-badge-live{background:rgba(255,255,255,0.08);color:#adb2b8}',
      '.dtt-badge-locked{background:rgba(255,193,7,0.15);color:#ffc107}',
            '.dtt-topic.locked{border-color:rgba(255,193,7,0.25)}',
      '.dtt-topic.locked .dtt-topic-head{cursor:default}',
      '.dtt-topic.merging{opacity:0.55;pointer-events:none;animation:dtt-pulse 1.2s ease-in-out infinite}',
      '.dtt-merging-text{color:#679eff!important;font-weight:600}',
      '.dtt-chevron{flex:none;color:#9ca3af;transition:transform 0.2s ease;font-size:11px;margin-top:5px;width:16px;text-align:center}',
      '.dtt-chevron.open{transform:rotate(90deg)}',
      // 拖拽合并：会话级视图下线索可拖动，拖到另一条上高亮目标
      '.dtt-topic.drag-source{opacity:0.35}',
      '.dtt-topic.drag-over{border-color:#4f8cff!important;background:rgba(79,140,255,0.12)!important;box-shadow:0 0 0 2px rgba(79,140,255,0.35),0 0 18px rgba(79,140,255,0.18)}',
      '.dtt-topic.draggable .dtt-topic-head{cursor:grab}',
      '.dtt-topic.draggable .dtt-topic-head:active{cursor:grabbing}',
      '.dtt-merge-hint{color:#6b7280;font-size:10px;margin-left:6px;letter-spacing:0.3px}',
      '.dtt-steps{border-top:1px solid rgba(255,255,255,0.07);padding:6px 8px 10px;display:flex;flex-direction:column;gap:4px;max-height:42vh;overflow-y:auto;overscroll-behavior:contain;}',
      '.dtt-steps::-webkit-scrollbar{width:5px;}',
      '.dtt-steps::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:3px;}',
      '.dtt-steps::-webkit-scrollbar-track{background:transparent;}',
      '.dtt-step{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;min-height:38px;border-radius:8px;border-left:2px solid transparent;cursor:pointer;overflow:hidden;position:relative;',
      '  transition:background 0.12s ease}',
      '.dtt-step:hover{background:rgba(255,255,255,0.05)}',
      '.dtt-step-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.dtt-step-title{font-size:12px;word-break:break-word;color:#e6e8ea;line-height:1.5;font-weight:500}',
      '.dtt-step-detail{color:#9ca3af;font-size:11px;margin-top:1px;word-break:break-word;line-height:1.5;display:block;max-height:4.5em;overflow:hidden}',
      '.dtt-step.user{border-left-color:#4caf50}',
      '.dtt-step.assistant{border-left-color:#679efe}',
      '.dtt-step.tool{border-left-color:#f59e0b}',
      '.dtt-step.reasoning{border-left-color:#a78bfa}',
      '.dtt-step-badge{flex:none;font-size:10px;line-height:16px;height:16px;padding:0 6px;border-radius:4px;margin-top:2px;',
      '  background:rgba(255,255,255,0.08);color:#adb2b8;font-weight:500}',
      '.dtt-step-badge.user{background:rgba(76,175,80,0.16);color:#6fce7a}',
      '.dtt-step-badge.assistant{background:rgba(103,158,254,0.16);color:#a8c2ff}',
      '.dtt-step-badge.tool{background:rgba(245,158,11,0.16);color:#fbbf24}',
      '.dtt-step-badge.reasoning{background:rgba(167,139,250,0.16);color:#c4b5fd}',
      '.dtt-step-foot{display:flex;gap:8px;margin-top:3px;color:#9ca3af;font-size:10px;flex-wrap:wrap;align-items:center}',
      '.dtt-step-ok{color:#6fce7a;font-weight:500}.dtt-step-error{color:#f87171;font-weight:500}.dtt-step-running{color:#fbbf24;font-weight:500}',
      '.dtt-fab{position:fixed;z-index:9999;pointer-events:auto;cursor:pointer;width:30px;height:30px;border-radius:50%;',
      '  display:flex;align-items:center;justify-content:center;',
      '  background:linear-gradient(135deg,#4f8cff,#2563eb);',
      '  box-shadow:0 4px 14px rgba(37,99,235,0.5),0 1px 4px rgba(0,0,0,0.3);',
      '  border:1px solid rgba(255,255,255,0.2);transition:transform 0.15s ease,box-shadow 0.15s ease}',
      '.dtt-fab.fab-small .dtt-fab-pupil{font-size:10px}',
      '/* 瞳孔（数字） */',
      '.dtt-fab-pupil{position:relative;z-index:2;color:#fff;font-weight:700;font-size:13px;',
      '  transition:transform 0.15s cubic-bezier(0.4,0,0.2,1);pointer-events:none;line-height:1}',
      '.dtt-fab-pupil.blink{animation:dtt-pupil-blink 0.2s ease both}',
      '@keyframes dtt-pupil-blink{0%{transform:scaleY(1)}30%{transform:scaleY(0.08)}70%{transform:scaleY(0.08)}100%{transform:scaleY(1)}}',
      '/* 呼吸辉光圆环 */',
      '.dtt-fab::before{content:"";position:absolute;inset:-6px;border-radius:50%;',
      '  border:3px solid rgba(210,225,255,0.5);pointer-events:none;',
      '  animation:dtt-fab-pulse 2.8s ease-in-out infinite}',
      '.dtt-fab.busy::before{animation-duration:1.1s;border-color:rgba(230,240,255,0.75)}',
      '@keyframes dtt-fab-pulse{0%,100%{opacity:0.3;transform:scale(1)}50%{opacity:0.8;transform:scale(1.2)}}',
      '.dtt-fab:hover{transform:scale(1.1);box-shadow:0 6px 20px rgba(37,99,235,0.6)}',
      '.dtt-fab:active{transform:scale(0.95)}',
      '.dtt-fab-flying{transition:transform 0.3s cubic-bezier(0.4,0,0.2,1);z-index:10002}',
      '.dtt-menu{position:fixed;z-index:10001;min-width:180px;background:rgba(38,38,41,0.98);backdrop-filter:blur(24px);',
      '  -webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.12);border-radius:12px;',
      '  box-shadow:0 18px 48px rgba(0,0,0,0.5);padding:5px;animation:dtt-fade 0.12s ease both}',
      '.dtt-menu-hint{padding:7px 12px 3px;font-size:10px;color:#9ca3af;word-break:break-all;max-width:260px;line-height:1.6}',
      '.dtt-menu-item{display:flex;align-items:center;gap:7px;padding:8px 12px;border-radius:8px;cursor:pointer;font-size:12px;',
      '  color:#f9fafb;font-weight:500;transition:background 0.12s ease,color 0.12s ease}',
      '.dtt-menu-item:hover{background:rgba(103,158,254,0.18);color:#a8c2ff}',
      '.dtt-menu-item.dtt-menu-danger:hover{background:rgba(239,68,68,0.18);color:#fca5a5}',
      '.dtt-menu-item .dtt-menu-ic{flex:none;font-size:11px;opacity:0.9}',
      '.dtt-toast{position:fixed;z-index:10002;left:50%;bottom:74px;transform:translateX(-50%);',
      '  background:rgba(30,30,33,0.96);color:#f9fafb;font-size:12px;padding:9px 16px;border-radius:22px;',
      '  border:1px solid rgba(255,255,255,0.12);box-shadow:0 12px 32px rgba(0,0,0,0.45);',
      '  pointer-events:none;max-width:82vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
      '  animation:dtt-in 0.18s ease both}',
      '.dtt-toast.ok{border-color:rgba(74,222,128,0.4);color:#86efac}',
      '.dtt-toast.err{border-color:rgba(248,113,113,0.45);color:#fca5a5}',
      // 设置页「任务线索」面板（dsh 设置 section）
      '.dtt-settings{font-size:13px;color:#f9fafb;padding:2px 0;max-width:560px}',
      '.dtt-settings-row{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:13px 2px;',
      '  border-bottom:1px solid rgba(255,255,255,0.06)}',
      '.dtt-settings-row:last-of-type{border-bottom:0}',
      '.dtt-settings-text{flex:1;min-width:0}',
      '.dtt-settings-name{font-weight:600;color:#f9fafb;font-size:13px}',
      '.dtt-settings-desc{font-size:12px;color:#9ca3af;line-height:1.65;margin-top:3px}',
      '.dtt-switch{position:relative;width:40px;height:22px;border-radius:11px;flex:none;cursor:pointer;',
      '  border:1px solid rgba(255,255,255,0.16);background:rgba(255,255,255,0.08);padding:0;',
      '  transition:background 0.2s ease,border-color 0.2s ease}',
      '.dtt-switch:hover{border-color:rgba(255,255,255,0.28)}',
      '.dtt-switch:disabled{opacity:0.55;cursor:default}',
      '.dtt-switch.on{background:#3b82f6;border-color:rgba(103,158,254,0.55)}',
      '.dtt-switch-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;',
      '  box-shadow:0 1px 3px rgba(0,0,0,0.35);transition:transform 0.22s cubic-bezier(0.4,0,0.2,1)}',
      '.dtt-switch.on .dtt-switch-knob{transform:translateX(18px)}',
      '.dtt-seg{display:inline-flex;background:rgba(255,255,255,0.06);border-radius:8px;padding:2px;gap:2px;flex-shrink:0}',
      '.dtt-seg-btn{border:none;background:transparent;color:#9ca3af;font-size:11px;padding:5px 10px;border-radius:6px;cursor:pointer;white-space:nowrap;transition:all 0.15s}',
      '.dtt-seg-btn.on{background:rgba(79,140,255,0.25);color:#fff;font-weight:600}',
      '.dtt-seg-btn:hover:not(.on){color:#d1d5db}',
      '.dtt-group-wrapper{margin-bottom:6px;position:relative;border:1px solid rgba(255,255,255,0.09);border-radius:12px;background:rgba(255,255,255,0.04);transition:border-color 0.15s ease,background 0.15s ease;display:block}',
      '.dtt-group-wrapper .dtt-topic{border:none;border-radius:0;background:transparent;margin-bottom:0;animation:none;display:block;height:auto;overflow:visible;min-height:44px}',
      '.dtt-group-wrapper .dtt-topic-head{min-height:52px;display:flex}',
      '.dtt-group-wrapper .dtt-group-children{display:none;padding:0 12px;border-top:1px solid rgba(255,255,255,0.07)}',
      '.dtt-group-wrapper.hover{border-color:rgba(255,255,255,0.16);background:rgba(255,255,255,0.055)}',
      '.dtt-group-wrapper.hover .dtt-group-children{display:block;padding:8px 12px 12px;animation:dtt-fade 0.45s ease both}',
      '.dtt-group-wrapper.hover .dtt-chevron{transform:rotate(90deg)}',
      '.dtt-group-wrapper .dtt-chevron{transition:transform 0.45s ease}',
      '.dtt-settings-foot{font-size:11px;color:#6b7280;padding:12px 2px 4px;line-height:1.6}',
      '@media (max-width:768px){.dtt-root{width:min(92vw,256px);max-height:64vh}}',
    ].join('');

    function injectCss() {
      if (typeof document === 'undefined') return;
      if (document.querySelector('style[data-plugin-css="' + CSS_ID + '"]')) return;
      var tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-topic-trail';
      tag.dataset.pluginCss = CSS_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    // ── i18n 国际化 ─────────────────────────────────────────────────────────
    var I18N = {
      zh: {
        'app.title': '工作线索',
        'nav.selectSession': '选择会话',
        'nav.allWorkspaces': '全部工作区',
        'nav.workspace': '工作区',
        'nav.session': '对话',
        'menu.regenerate': '重新生成线索',
        'menu.regenerateAll': '重新生成该对话的所有线索',
        'menu.regenerateAllDesc': '清除已有线索，完整重新导入并总结',
        'menu.editTopic': '编辑此线索',
        'menu.deleteTopic': '删除此线索',
        'menu.import': '导入历史会话',
        'menu.settings': '设置',
        'toast.summarizing': '正在总结线索...',
        'toast.summarized': '线索总结完成',
        'toast.summarizeFail': '总结失败，请重试',
        'toast.importing': '正在导入历史会话...',
        'toast.imported': '导入完成',
        'toast.importFail': '导入失败',
        'toast.merging': '正在合并线索...',
        'toast.merged': '合并完成',
        'toast.mergeFail': '合并失败',
        'toast.noPermission': '请先在设置中启用插件',
        'empty.noTopics': '暂无线索，右键会话或工作区开始总结',
        'empty.noSessions': '暂无会话',
        'status.active': '进行中',
        'status.done': '已完成',
        'settings.title': '任务线索',
        'settings.enabled': '启用插件',
        'settings.enabledDesc': '关闭后悬浮窗隐藏、停止记录新线索；已有线索数据保留，可随时在此重新启用。',
        'settings.followSession': '切换对话时跟随',
        'settings.followSessionDesc': '切换对话时，任务线索自动跟随到当前对话：此前在工作区级 → 切到该对话所属工作区；此前在对话级 → 切到该对话。',
        'settings.learnFromModifications': '从修改中学习',
        'settings.learnFromModificationsDesc': '记录你手动合并/整理线索的操作，AI 后续总结时参考你的划分偏好与命名风格，越用越贴合你的习惯。',
        'settings.eyeAnimation': '小球眼睛动画',
        'settings.eyeAnimationDesc': '开启后收起小球的数字瞳孔会追鼠标、忙碌时乱飘、偶尔眨眼。关闭后为静态数字。',
        'settings.preserveTopics': '强制不删话题',
        'settings.preserveTopicsDesc': '开启后 AI 总结时保留所有已有话题，只追加新话题，话题数只增不减。适合不想让 AI 删掉旧线索的场景。',
        'settings.workspaceMemory': '工作区结构记忆',
        'settings.workspaceMemoryDesc': '开启后 AI 会记住每个工作区的项目结构和总结规律，首次全看工作区生成，后续增量更新，让总结更贴合项目习惯。',
        'settings.summarizeMode': '总结方式',
        'settings.summarizeAuto': '自动：LLM 优先，失败回退规则',
        'settings.summarizeLlm': '仅 LLM 总结',
        'settings.summarizeRule': '仅规则模式（不调用模型）',
        'settings.pollInterval': '刷新间隔',
        'settings.workspaceView': '工作区视图',
        'settings.workspaceViewDesc': '相似合并：跨会话的相似线索聚成一组，悬停展开组内线索；按对话分类：每个对话一张卡，悬停展开该对话的线索。',
        'settings.workspaceViewMerge': '相似合并',
        'settings.workspaceViewSession': '按对话分类',
        'settings.provider': 'AI 提供商',
        'settings.model': '模型',
        'settings.save': '保存',
        'settings.saved': '已保存',
        'settings.loading': '加载中…',
        'settings.footer': '数据持久化于 DSH_HOME/data/topic-trail/；总结走 dsh 已配置的 DeepSeek 路由（DeepSeek API）。',
        'settings.switchOn': '已启用，点击关闭',
        'settings.switchOff': '已关闭，点击启用',
        'bootstrap.progress': '后台正在补全历史线索：{done}/{total}（完成一个显示一个）',
        'fab.title': '工作线索（{count} 条）——拖动移动位置，点击展开',
        'fab.collapse': '点击收起',
        'step.jump': '点击跳转到对应对话',
        'topic.doubleClick': '双击跳转到对应对话',
        'merge.hint': '拖动到另一条线索上合并',
        'merge.target': '松开合并到这里',
      },
      en: {
        'app.title': 'Task Trails',
        'nav.selectSession': 'Select Session',
        'nav.allWorkspaces': 'All Workspaces',
        'nav.workspace': 'Workspace',
        'nav.session': 'Session',
        'menu.regenerate': 'Regenerate Trails',
        'menu.regenerateAll': 'Regenerate All Trails for This Session',
        'menu.regenerateAllDesc': 'Clear existing trails, fully re-import and summarize',
        'menu.editTopic': 'Edit Topic',
        'menu.deleteTopic': 'Delete this trail',
        'menu.import': 'Import History',
        'menu.settings': 'Settings',
        'toast.summarizing': 'Summarizing trails...',
        'toast.summarized': 'Trails summarized',
        'toast.summarizeFail': 'Summarize failed, retry',
        'toast.importing': 'Importing history...',
        'toast.imported': 'Import complete',
        'toast.importFail': 'Import failed',
        'toast.merging': 'Merging trails...',
        'toast.merged': 'Merge complete',
        'toast.mergeFail': 'Merge failed',
        'toast.noPermission': 'Enable plugin in settings first',
        'empty.noTopics': 'No trails yet. Right-click a session or workspace to summarize.',
        'empty.noSessions': 'No sessions',
        'status.active': 'Active',
        'status.done': 'Done',
        'settings.title': 'Task Trails',
        'settings.enabled': 'Enable Plugin',
        'settings.enabledDesc': 'Hide overlay and stop recording when off. Existing data preserved; re-enable anytime.',
        'settings.followSession': 'Follow Session Switch',
        'settings.followSessionDesc': 'Auto-switch trails to current session: workspace view → that session\'s workspace; session view → that session.',
        'settings.learnFromModifications': 'Learn from Edits',
        'settings.learnFromModificationsDesc': 'Record your manual merges/reorganization. AI uses your grouping preferences and naming style in future summaries.',
        'settings.eyeAnimation': 'Eye Animation',
        'settings.eyeAnimationDesc': 'When on, the collapsed ball pupil follows mouse, drifts when busy, and blinks occasionally. Off = static number.',
        'settings.preserveTopics': 'Preserve All Topics',
        'settings.preserveTopicsDesc': 'When on, AI summaries keep all existing topics and only append new ones. Topic count never decreases.',
        'settings.workspaceMemory': 'Workspace Memory',
        'settings.workspaceMemoryDesc': 'When on, AI remembers each workspace structure and summary rules. First-time full scan, then incremental updates.',
        'settings.summarizeMode': 'Summarize Mode',
        'settings.summarizeAuto': 'Auto: LLM first, fallback to rules',
        'settings.summarizeLlm': 'LLM only',
        'settings.summarizeRule': 'Rules only (no model)',
        'settings.pollInterval': 'Refresh Interval',
        'settings.workspaceView': 'Workspace View',
        'settings.workspaceViewDesc': 'Merge similar: group similar trails across sessions, hover to expand. Group by session: one card per session, hover to expand.',
        'settings.workspaceViewMerge': 'Merge Similar',
        'settings.workspaceViewSession': 'Group by Session',
        'settings.provider': 'AI Provider',
        'settings.model': 'Model',
        'settings.save': 'Save',
        'settings.saved': 'Saved',
        'settings.loading': 'Loading...',
        'settings.footer': 'Data persisted in DSH_HOME/data/topic-trail/. Summaries use dsh-configured DeepSeek API.',
        'settings.switchOn': 'Enabled, click to disable',
        'settings.switchOff': 'Disabled, click to enable',
        'bootstrap.progress': 'Backfilling history: {done}/{total}',
        'fab.title': 'Task Trails ({count}) — drag to move, click to expand',
        'fab.collapse': 'Click to collapse',
        'step.jump': 'Click to jump to session',
        'topic.doubleClick': 'Double-click to jump to session',
        'merge.hint': 'Drag onto another trail to merge',
        'merge.target': 'Release to merge here',
      },
    };

    // 检测语言：优先 dsh 设置，其次浏览器语言，默认中文
    function detectLang() {
      try {
        var dshLang = localStorage.getItem('dsh.language') || localStorage.getItem('locale');
        if (dshLang) return dshLang.toLowerCase().startsWith('en') ? 'en' : 'zh';
      } catch { /* ignore */ }
      var nav = (navigator.language || 'zh').toLowerCase();
      return nav.startsWith('en') ? 'en' : 'zh';
    }

    var currentLang = detectLang();

    function t(key, vars) {
      var dict = I18N[currentLang] || I18N.zh;
      var str = dict[key] || I18N.zh[key] || key;
      if (vars) {
        Object.keys(vars).forEach(function (k) {
          str = str.replace('{' + k + '}', vars[k]);
        });
      }
      return str;
    }

    // ── 工具 ────────────────────────────────────────────────────────────────
    function fmtTime(iso) {
      try {
        var d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        var hh = String(d.getHours()).padStart(2, '0');
        var mm = String(d.getMinutes()).padStart(2, '0');
        return hh + ':' + mm;
      } catch { return ''; }
    }

    function fmtDate(iso) {
      try {
        var d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + fmtTime(iso);
      } catch { return ''; }
    }

    // 格式化工具步骤详情：把 bash({"command":"..."}) 等原始调用转成可读文本
    function formatToolDetail(detail) {
      if (!detail) return '';
      var s = String(detail);
      // bash({"command":"..."})
      var m = s.match(/bash\(\s*\{\s*"command"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m) {
        var cmd = m[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').replace(/\\t/g, ' ').replace(/\s+/g, ' ').trim();
        return cmd.length > 100 ? cmd.slice(0, 100) + '…' : cmd;
      }
      // run_code({"code":"..."})
      var m2 = s.match(/run_code\(\s*\{\s*"code"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m2) {
        var code = m2[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').replace(/\\t/g, ' ').replace(/\s+/g, ' ').trim();
        return code.length > 100 ? code.slice(0, 100) + '…' : code;
      }
      // 其他工具调用：提取工具名
      var m3 = s.match(/^(\w+)\(/);
      if (m3) return m3[1] + '()';
      return s.length > 100 ? s.slice(0, 100) + '…' : s;
    }
    function fmtTitle(title, max) {
      var t = String(title || '').trim();
      if (t.length <= max) return t;
      return t.slice(0, max) + '…';
    }
    // 从 cwd 取最后一段作为工作区短名（如 D:\MC_idea\forge-1.20.1 - dev → forge-1.20.1 - dev）
    function pathBasename(p) {
      if (!p) return '';
      var parts = String(p).split(/[\\/]/);
      return parts[parts.length - 1] || p;
    }

    var KIND_LABEL = currentLang === 'en'
      ? { user: 'User', assistant: 'AI', tool: 'Tool', reasoning: 'Thinking' }
      : { user: '用户', assistant: 'AI', tool: '工具', reasoning: '思考' };
    var NAV_ICON = { all: '◉', ws: '▣', session: '·' };

    var POS_KEY = 'dsh-topic-trail.pos';
    var COLLAPSED_KEY = 'dsh-topic-trail.collapsed';
    var SESSION_KEY = 'dsh-topic-trail.session';
    var WS_KEY = 'dsh-topic-trail.ws';
    var CACHE_KEY = 'dsh-topic-trail.cache.v3'; // v3: 修复空数据缓存 + version 跳过逻辑

    // 本地快照缓存：刷新/重开页面时秒开渲染（用上次数据立即展示），后台轮询再更新
    function loadCachedSnapshot() {
      try {
        var raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (raw && raw.t && raw.snap && raw.sessions && (Date.now() - raw.t) < 12 * 3600 * 1000) {
          // 防御：缓存里的 sessions 没有 cwd 字段（旧格式/空数据）→ 丢弃
          var cachedSessions = raw.snap && Array.isArray(raw.snap.sessions) ? raw.snap.sessions : [];
          var hasCwd = cachedSessions.some(function (s) { return s && s.cwd; });
          if (hasCwd) return { snap: raw.snap, sessions: raw.sessions };
        }
      } catch (e) { /* ignore */ }
      return null;
    }

    function saveCachedSnapshot(snap, sess) {
      try {
        // 只缓存有效数据（至少有一个会话有 cwd），避免缓存后端启动初期的空数据
        var snapSessions = snap && Array.isArray(snap.sessions) ? snap.sessions : [];
        var hasCwd = snapSessions.some(function (s) { return s && s.cwd; });
        if (hasCwd) {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), snap: snap, sessions: sess }));
        }
      } catch (e) { /* ignore */ }
    }

    function loadPos() {
      try {
        var raw = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
        if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)) {
          // 脏坐标防御：旧版本可把面板拖出屏幕，坐标若明显在视口外 → 丢弃并清除，
          // 让面板回到默认右下角，避免「刷新后悬浮窗消失、线索也没了」
          var w = window.innerWidth || 1280, h = window.innerHeight || 800;
          if (raw.x > -60 && raw.x < w + 60 && raw.y > -60 && raw.y < h + 60) return raw;
          try { localStorage.removeItem(POS_KEY); } catch (e2) { /* ignore */ }
        }
      } catch { /* ignore */ }
      return { x: undefined, y: undefined }; // 未保存过 → 默认右下角
    }

    // ── 悬浮窗面板 ─────────────────────────────────────────────────────────
    function TopicTrailPanel() {
      var pos = useRef(loadPos());
      var [xy, setXy] = useState({ x: pos.current.x, y: pos.current.y });
      var [panelSize, setPanelSize] = useState(function () {
        try {
          var saved = localStorage.getItem('dtt-panel-size');
          if (saved) { var p = JSON.parse(saved); if (p && p.width) return p; }
        } catch (e) { /* ignore */ }
        return { width: 256, height: null };
      });
      var panelSizeRef = useRef(panelSize);
      useEffect(function () { panelSizeRef.current = panelSize; }, [panelSize]);
      var scale = Math.min(1, panelSize.width / 256);
      var resizing = useRef(null);
      function onResizeStart(e) {
        e.preventDefault();
        e.stopPropagation();
        var startX = e.clientX, startY = e.clientY;
        var baseW = panelSizeRef.current.width;
        var baseH = panelSizeRef.current.height || 500;
        resizing.current = { startX: startX, startY: startY, baseW: baseW, baseH: baseH };
        function onMove(ev) {
          var d = resizing.current;
          if (!d) return;
          var nw = Math.max(180, Math.min(512, d.baseW + (ev.clientX - d.startX)));
          var nh = Math.max(200, Math.min(800, d.baseH + (ev.clientY - d.startY)));
          setPanelSize({ width: nw, height: nh });
        }
        function onUp() {
          resizing.current = null;
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          try { localStorage.setItem('dtt-panel-size', JSON.stringify(panelSizeRef.current)); } catch (e) { /* ignore */ }
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      }
      var [collapsed, setCollapsed] = useState(function () {
        try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
      });
      var collapsedRef = useRef(collapsed);
      useEffect(function () { collapsedRef.current = collapsed; }, [collapsed]);
      // snapshot 里的话题数据（按 sessionId 索引）
      var [trails, setTrails] = useState([]);
      // 工作区线索网络：{ all: {topics}, byId: { [wsId]: { title, sessionCount, topics } } }
      var [workspaces, setWorkspaces] = useState({ all: { topics: [] }, byId: {} });
      var workspacesRef = useRef(workspaces);
      useEffect(function () { workspacesRef.current = workspaces; }, [workspaces]);
      // /sessions 列表（下拉选项）
      var [sessionList, setSessionList] = useState([]);
      var [selectedId, setSelectedId] = useState(function () {
        try { return localStorage.getItem(SESSION_KEY) || null; } catch { return null; }
      });
      // 视图层级：'__all__' 全部工作区 | 'ws:<id>' 具体工作区 | null 会话视图
      // 默认「全部工作区」：打开即看到所有合并线索；记住的工作区优先（会话选择不把视图拉回单个会话）
      var [selectedWsId, setSelectedWsId] = useState(function () {
        try {
          var wsRaw = localStorage.getItem(WS_KEY);
          if (wsRaw === '__all__') return '__all__';
          if (wsRaw && wsRaw.indexOf('ws:') === 0) return wsRaw.slice(3);
        } catch (e) { /* ignore */ }
        return '__all__';
      });
      var [openTopic, setOpenTopic] = useState(null);
      var [editingTopic, setEditingTopic] = useState(null); // {sessionId, topicId, title}
      var [error, setError] = useState(null);
      var [jumpingStep, setJumpingStep] = useState(null);
      var [importing, setImporting] = useState(false);
      var [importError, setImportError] = useState(null);
      // 自定义导航下拉展开 / 右键菜单 / toast 提示
      var [navOpen, setNavOpen] = useState(false);
      var [menu, setMenu] = useState(null);
      var [notice, setNotice] = useState(null);
      // 工作区置顶（localStorage 持久化）
      var [pinnedWs, setPinnedWs] = useState(function () {
        try { return JSON.parse(localStorage.getItem('dtt-pinned-ws') || '[]'); } catch { return []; }
      });
      function togglePin(wsKey) {
        setPinnedWs(function (prev) {
          var next = prev.indexOf(wsKey) === -1 ? [wsKey].concat(prev) : prev.filter(function (k) { return k !== wsKey; });
          try { localStorage.setItem('dtt-pinned-ws', JSON.stringify(next)); } catch { /* ignore */ }
          return next;
        });
      }
      var dragging = useRef(null);
      var refreshRef = useRef(null);
      // 手动刷新标记（刷新按钮自增，触发轮询立即拉取）
      var [refreshTick, setRefreshTick] = useState(0);
      // 笔记功能（按对话独立存储）
      var [noteOpen, setNoteOpen] = useState(false);
      var [noteFocused, setNoteFocused] = useState(false);
      // 笔记浮窗位置
      var [noteWinPos, setNoteWinPos] = useState(function () {
        try {
          var saved = localStorage.getItem('dtt-note-win-pos');
          return saved ? JSON.parse(saved) : { x: null, y: null };
        } catch (e) { return { x: null, y: null }; }
      });
      var noteWinDragRef = useRef(null);
      // 绘画功能
      var [drawMode, setDrawMode] = useState('none'); // 'none' | 'pen' | 'eraser'
      var [drawColor, setDrawColor] = useState('#4f8cff');
      var [drawSize, setDrawSize] = useState(2);
      var [drawMenu, setDrawMenu] = useState(null); // {x, y}
      var canvasRef = useRef(null);
      var drawingRef = useRef(false);
      var lastPosRef = useRef(null);
      // 绘画数据按 noteKey 存储
      var [drawingsMap, setDrawingsMap] = useState(function () {
        try {
          var saved = localStorage.getItem('dtt-drawings');
          return saved ? JSON.parse(saved) : {};
        } catch (e) { return {}; }
      });
      useEffect(function () {
        try { localStorage.setItem('dtt-drawings', JSON.stringify(drawingsMap)); } catch (e) { /* ignore */ }
      }, [drawingsMap]);
      var [notesMap, setNotesMap] = useState(function () {
        try {
          var saved = localStorage.getItem('dtt-notes');
          return saved ? JSON.parse(saved) : {};
        } catch (e) { return {}; }
      });
      // 当前笔记的 key：会话视图用 sessionId，工作区视图用 wsId，全部工作区用 '__all__'
      var noteKey = selectedId || (selectedWsId === '__all__' ? '__all__' : (selectedWsId ? 'ws:' + selectedWsId : '__all__'));
      var noteText = notesMap[noteKey] || '';
      function setCurrentNote(text) {
        setNotesMap(function (prev) {
          var next = Object.assign({}, prev);
          if (text) next[noteKey] = text; else delete next[noteKey];
          return next;
        });
      }
      useEffect(function () {
        try { localStorage.setItem('dtt-notes', JSON.stringify(notesMap)); } catch (e) { /* ignore */ }
      }, [notesMap]);
      // 切换对话/打开笔记时重新加载绘画到 canvas
      useEffect(function () {
        if (!noteOpen) return;
        var canvas = canvasRef.current;
        if (canvas) {
          var ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        requestAnimationFrame(function () {
          resizeCanvas();
          loadDrawingToCanvas();
        });
      }, [noteKey, noteOpen]);
      // 边缘反向展开：菜单/下拉贴近视口边界时翻转方向，保证整体在界面内
      var menuElRef = useRef(null);
      var [menuPos, setMenuPos] = useState(null);
      var navBtnRef = useRef(null);
      var navPopRef = useRef(null);
      var [navDir, setNavDir] = useState(null);
      // 首次打开自动补全进度（host bootstrap）
      var [bootstrap, setBootstrap] = useState(null);
      var bootstrapRef = useRef(bootstrap);
      useEffect(function () { bootstrapRef.current = bootstrap; }, [bootstrap]);
      // 插件全局启用/禁用（设置页开关；禁用时悬浮窗不渲染、事件不处理）
      var [pluginEnabled, setPluginEnabled] = useState(true);
      // 从 dsh localStorage 读取工作区分组（dsh.workspace.view.v5 → sessionOrderByAccount）
      // 用于导航下拉里和 dsh 界面保持一致的工作区分组（区分同路径下的不同 profile）
      var [dshWsGroups, setDshWsGroups] = useState(null);
      useEffect(function () {
        function load() {
          try {
            var raw = localStorage.getItem('dsh.workspace.view.v5');
            if (!raw) { setDshWsGroups(null); return; }
            var data = JSON.parse(raw);
            var order = data && data.sessionOrderByAccount ? data.sessionOrderByAccount : {};
            var groups = [];
            var ungrouped = [];
            Object.keys(order).forEach(function (key) {
              if (key === '__flat_session_order__') return;
              var list = Array.isArray(order[key]) ? order[key] : [];
              if (key === '') {
                ungrouped = list;
              } else if (list.length > 0) {
                groups.push({ id: key, sessions: list });
              }
            });
            setDshWsGroups({ groups: groups, ungrouped: ungrouped });
          } catch (e) { setDshWsGroups(null); }
        }
        load();
        // 监听 storage 变化（dsh 切换工作区时更新）
        var handler = function (e) { if (e.key === 'dsh.workspace.view.v5') load(); };
        window.addEventListener('storage', handler);
        return function () { window.removeEventListener('storage', handler); };
      }, []);
      // 拖拽合并：会话级视图下拖动线索到另一条上触发 AI 合并
      var [dragTopicId, setDragTopicId] = useState(null);
      var [dropTargetId, setDropTargetId] = useState(null);
      var [merging, setMerging] = useState(false);
      var [mergingPair, setMergingPair] = useState(null);
      // 工作区视图组卡片 hover 展开
      var [hoveredGroup, setHoveredGroup] = useState(null);
      // 工作区视图模式：merge（相似合并，默认）/ bySession（按对话分类）
      var [wsViewMode, setWsViewMode] = useState('merge');
      // Ferry 眼睛：瞳孔偏移 + 眨眼
      var [pupilOffset, setPupilOffset] = useState({ x: 0, y: 0 });
      var [blinking, setBlinking] = useState(false);
      // 小球展开/收起飞行动画：飞行中大球保持可见并平滑移动到目标位置
      var [flying, setFlying] = useState(null); // {x, y, targetX, targetY, phase:'to-panel'|'to-ball'}
      var headEyeRef = useRef(null);
      var pupilTarget = useRef({ x: 0, y: 0 });
      var pupilCur = useRef({ x: 0, y: 0 });
      // 瞳孔动画：空闲追鼠标，忙碌随机飘
      useEffect(function () {
        var raf;
        function tick() {
          var cur = pupilCur.current;
          var tgt = pupilTarget.current;
          var nx = cur.x + (tgt.x - cur.x) * 0.15;
          var ny = cur.y + (tgt.y - cur.y) * 0.15;
          pupilCur.current = { x: nx, y: ny };
          if (Math.abs(nx - cur.x) > 0.05 || Math.abs(ny - cur.y) > 0.05) {
            setPupilOffset({ x: nx, y: ny });
          }
          raf = requestAnimationFrame(tick);
        }
        raf = requestAnimationFrame(tick);
        return function () { cancelAnimationFrame(raf); };
      }, []);
      // 鼠标跟随（收起时找大球，展开时找标题栏小眼睛）
      useEffect(function () {
        function onMove(e) {
          if (!appConfig.eyeAnimation || isBusy) return;
          var eye = document.querySelector('.dtt-fab') || document.querySelector('.dtt-head-eye');
          if (!eye) return;
          var rect = eye.getBoundingClientRect();
          var cx = rect.left + rect.width / 2;
          var cy = rect.top + rect.height / 2;
          var dx = e.clientX - cx;
          var dy = e.clientY - cy;
          var dist = Math.sqrt(dx * dx + dy * dy);
          var maxDist = 4;
          if (dist > 0) {
            pupilTarget.current = {
              x: (dx / dist) * Math.min(dist / 40, 1) * maxDist,
              y: (dy / dist) * Math.min(dist / 40, 1) * maxDist,
            };
          }
        }
        window.addEventListener('mousemove', onMove);
        return function () { window.removeEventListener('mousemove', onMove); };
      }, [isBusy]);
      // 忙碌时瞳孔随机飘动
      useEffect(function () {
        if (!appConfig.eyeAnimation || !isBusy) return;
        var timeout;
        function wander() {
          pupilTarget.current = {
            x: (Math.random() - 0.5) * 7,
            y: (Math.random() - 0.5) * 5,
          };
          timeout = setTimeout(wander, 800 + Math.random() * 600);
        }
        timeout = setTimeout(wander, 300);
        return function () { clearTimeout(timeout); };
      }, [isBusy]);
      // 随机眨眼
      useEffect(function () {
        if (!appConfig.eyeAnimation) return;
        var timeout;
        function blink() {
          setBlinking(true);
          setTimeout(function () { setBlinking(false); }, 140);
          timeout = setTimeout(blink, 2500 + Math.random() * 4000);
        }
        timeout = setTimeout(blink, 1500 + Math.random() * 2000);
        return function () { clearTimeout(timeout); };
      }, []);
      useEffect(function () {
        fetch('/plugins/topic-trail/config', { headers: { Accept: 'application/json' } })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (c) {
            if (c && c.workspaceViewMode) setWsViewMode(c.workspaceViewMode);
          })
          .catch(function () { /* 忽略 */ });
      }, []);
      // 跟随对话切换：ref 保存最新层级与上次跟随的会话，避免轮询闭包读到旧值
      var selectedWsIdRef = useRef(selectedWsId);
      selectedWsIdRef.current = selectedWsId;
      var selectedIdRef = useRef(selectedId);
      selectedIdRef.current = selectedId;
      var lastFollowRef = useRef(null);
      // 数据版本：与快照 version 相同 → 数据未变化，跳过全部 setState（避免轮询反复重渲染）
      var lastVersionRef = useRef(null);
      // 步骤按需加载用：缓存 + 重渲染信号。
      // 必须留在组件顶部的 hook 区 —— 本组件在渲染中途有 `if (collapsed) return fabEl`
      // 的提前返回（"折叠 → 只显示小球"那一处），hook 放在它后面会让「收起」时少跑
      // hook，React 抛 #300（Rendered fewer hooks than expected）。
      var stepsStoreRef = useRef({}); // key = sessionId + ':' + topicId
      var [, setStepsTick] = useState(0); // 步骤到货后触发重渲染

      // toast 自动消失
      useEffect(function () {
        if (!notice) return;
        var t = setTimeout(function () { setNotice(null); }, 3600);
        return function () { clearTimeout(t); };
      }, [notice]);

      // 点击下拉/菜单以外区域 → 关闭
      useEffect(function () {
        if (!menu && !navOpen) return;
        function onDocDown(e) {
          var t = e.target;
          if (t && t.closest && (t.closest('.dtt-nav-pop') || t.closest('.dtt-nav-btn') || t.closest('.dtt-menu'))) return;
          setMenu(null);
          setNavOpen(false);
        }
        window.addEventListener('pointerdown', onDocDown, true);
        return function () { window.removeEventListener('pointerdown', onDocDown, true); };
      }, [menu, navOpen]);

      // 启动时拉取运行时配置（含插件启用状态）
      useEffect(function () {
        fetch('/plugins/topic-trail/config', { headers: { Accept: 'application/json' } })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (c) {
            if (c && typeof c.enabled === 'boolean') setPluginEnabled(c.enabled);
          })
          .catch(function () { /* 配置拉取失败不致命，默认启用 */ });
      }, []);

      // 轮询快照 + 会话列表
      useEffect(function () {
        var cancelled = false;
        var timer = null;
        // 秒开：先用上次的本地缓存渲染，避免每次刷新都白等全量接口（后台轮询随后更新）
        var cached = loadCachedSnapshot();
        if (cached) {
          var csnap = cached.snap, csess = cached.sessions;
          if (csnap && Array.isArray(csnap.sessions)) setTrails(csnap.sessions);
          if (csnap && csnap.workspaces) {
            var cws = csnap.workspaces;
            if (!cws.all || !Array.isArray(cws.all.topics)) cws.all = { id: 'all', title: '全部工作区', topics: [] };
            if (!cws.byId || typeof cws.byId !== 'object') cws.byId = {};
            setWorkspaces(cws);
          }
          if (csess && Array.isArray(csess.sessions)) setSessionList(csess.sessions);
        }
        async function refresh() {
          try {
            var [snapRes, sessRes] = await Promise.all([
              fetch('/plugins/topic-trail/snapshot', { headers: { Accept: 'application/json' } }),
              fetch('/plugins/topic-trail/sessions', { headers: { Accept: 'application/json' } }),
            ]);
            var snap = snapRes.ok ? await snapRes.json() : { sessions: [] };
            var sess = sessRes.ok ? await sessRes.json() : { sessions: [] };
            if (cancelled) return;
            // 数据未变化（version 相同且会话数一致）→ 跳过重渲染，避免轮询反复加载/闪烁
            // 注意：不能只比 version——后端启动初期空数据和加载后有数据可能 version 相同
            var newList = Array.isArray(snap.sessions) ? snap.sessions : [];
            if (lastVersionRef.current !== null && snap.version !== undefined
                && lastVersionRef.current === snap.version
                && newList.length === trails.length) {
              return;
            }
            if (snap.version !== undefined) lastVersionRef.current = snap.version;
            var list = newList;
            var slist = Array.isArray(sess.sessions) ? sess.sessions : [];
            var wsData = snap.workspaces && typeof snap.workspaces === 'object' ? snap.workspaces : { all: { topics: [] }, byId: {} };
            if (!wsData.all || !Array.isArray(wsData.all.topics)) wsData.all = { id: 'all', title: '全部工作区', topics: [] };
            if (!wsData.byId || typeof wsData.byId !== 'object') wsData.byId = {};
            setTrails(list);
            setSessionList(slist);
            setWorkspaces(wsData);
            setError(null);
            if (snap.bootstrap) setBootstrap(snap.bootstrap);
            saveCachedSnapshot(snap, sess);
            // 默认选中：记住的 id 仍存在 → 用它；否则选最新一个有线索的会话；再否则最新会话
            setSelectedId(function (prev) {
              if (prev && slist.some(function (s) { return s.sessionId === prev; })) return prev;
              var withTrail = slist.filter(function (s) { return s.hasTrail; });
              var pool = withTrail.length > 0 ? withTrail : slist;
              if (pool.length === 0) return null;
              pool.sort(function (a, b) {
                var at = a.trailUpdatedAt || a.createdAt || '';
                var bt = b.trailUpdatedAt || b.createdAt || '';
                return bt > at ? 1 : bt < at ? -1 : 0;
              });
              return pool[0].sessionId;
            });
          } catch (err) {
            if (!cancelled) setError(String(err && err.message || err));
          }
        }
        refreshRef.current = refresh;
        refresh();
        // 自适应轮询：页面隐藏时完全不请求；收起时 15s（省电）；展开时 5s；忙碌时 2s（看进度）
        var pollTimer = null;
        function schedulePoll() {
          if (typeof document !== 'undefined' && document.hidden) {
            pollTimer = setTimeout(schedulePoll, 1000);
            return;
          }
          var isBusyNow = false;
          try {
            var allTopics = (workspacesRef.current && workspacesRef.current.all && workspacesRef.current.all.topics) || [];
            isBusyNow = allTopics.some(function (t) { return t.status === 'active'; })
              || (bootstrapRef.current && bootstrapRef.current.progress != null && bootstrapRef.current.progress < 1);
          } catch (e) { /* ignore */ }
          var delay = collapsedRef.current ? 15000 : (isBusyNow ? 2000 : 5000);
          pollTimer = setTimeout(function () {
            if (refreshRef.current) refreshRef.current();
            schedulePoll();
          }, delay);
        }
        schedulePoll();
        function onVis() {
          if (typeof document === 'undefined' || document.hidden) return;
          if (refreshRef.current) refreshRef.current();
        }
        document.addEventListener('visibilitychange', onVis);
        return function () {
          cancelled = true;
          if (pollTimer) clearTimeout(pollTimer);
          document.removeEventListener('visibilitychange', onVis);
        };
      }, []);

      // 手动刷新按钮：立即拉一次
      useEffect(function () {
        if (refreshTick === 0) return;
        if (refreshRef.current) refreshRef.current();
      }, [refreshTick]);

      // 监听设置页配置变更：立即生效，不等轮询
      useEffect(function () {
        function onConfigChanged(e) {
          var c = e && e.detail ? e.detail : {};
          if (typeof c.followSession === 'boolean') appConfig.followSession = c.followSession;
          if (typeof c.eyeAnimation === 'boolean') appConfig.eyeAnimation = c.eyeAnimation;
          if (typeof c.preserveTopics === 'boolean') appConfig.preserveTopics = c.preserveTopics;
          if (typeof c.enabled === 'boolean') appConfig.enabled = c.enabled;
          if (typeof c.learnFromModifications === 'boolean') appConfig.learnFromModifications = c.learnFromModifications;
          if (c.workspaceViewMode) appConfig.workspaceViewMode = c.workspaceViewMode;
          // 强制重渲染以应用新配置
          setRefreshTick(function (n) { return n + 1; });
        }
        try { window.addEventListener('dtt-config-changed', onConfigChanged); } catch (e) { /* ignore */ }
        return function () {
          try { window.removeEventListener('dtt-config-changed', onConfigChanged); } catch (e) { /* ignore */ }
        };
      }, []);

      // 记忆选中的会话 / 视图层级（手动选择与跟随切换都经此持久化）
      useEffect(function () {
        try {
          if (selectedWsId === '__all__') {
            localStorage.setItem(WS_KEY, '__all__');
            localStorage.removeItem(SESSION_KEY);
          } else if (selectedWsId) {
            localStorage.setItem(WS_KEY, 'ws:' + selectedWsId);
            localStorage.removeItem(SESSION_KEY);
          } else if (selectedId) {
            localStorage.setItem(SESSION_KEY, selectedId);
            localStorage.removeItem(WS_KEY);
          }
        } catch (e) { /* ignore */ }
      }, [selectedWsId, selectedId]);

      // 跟随对话切换：轮询 inject 获取当前会话，变化时跟随跳转
      var wsIdBySessionRef = useRef({});
      var wsCacheVersionRef = useRef(0);
      var followToSession = useCallback(function (curId) {
        if (!curId || curId === lastFollowRef.current) return;
        lastFollowRef.current = curId;
        // 缓存工作区→会话映射，workspaces 变化时才重新计算
        var wsData = workspacesRef.current || { byId: {} };
        var wsVer = wsData._version || Object.keys(wsData.byId || {}).length;
        if (wsCacheVersionRef.current !== wsVer) {
          wsCacheVersionRef.current = wsVer;
          var mapping = {};
          Object.keys(wsData.byId || {}).forEach(function (wid) {
            var wTopics = wsData.byId[wid].topics;
            if (!Array.isArray(wTopics)) return;
            wTopics.forEach(function (tp) {
              (Array.isArray(tp.sources) ? tp.sources : []).forEach(function (src) {
                if (src.sessionId) mapping[src.sessionId] = wid;
              });
            });
          });
          wsIdBySessionRef.current = mapping;
        }
        var wsIdBySession = wsIdBySessionRef.current;
        if (selectedWsIdRef.current === '__all__') {
          // 全工作区视图：保持不变
        } else if (selectedWsIdRef.current) {
          var wid2 = wsIdBySession[curId];
          if (wid2 && wsData.byId[wid2] && wid2 !== selectedWsIdRef.current) {
            setSelectedWsId(wid2);
          }
        } else {
          if (curId !== selectedIdRef.current) setSelectedId(curId);
        }
      }, []);

      // 跟随对话切换：1.5 秒轮询 + 点击后立即检查，确保响应快且不干扰 dsh
      useEffect(function () {
        if (appConfig.followSession === false) return;
        if (!appCtx || typeof appCtx.inject !== 'function') return;

        var checkSession = function () {
          try {
            appCtx.inject(['sessions'], function (scope) {
              try {
                if (!scope.sessions || !scope.sessions.list) return;
                var curSnap = scope.sessions.list.getSnapshot();
                var curId = curSnap && curSnap.current ? String(curSnap.current) : null;
                if (!curId) return;
                followToSession(curId);
              } catch (e) { /* ignore */ }
            });
          } catch (e) { /* ignore */ }
        };

        // 轮询兜底（1.5 秒）
        var timer = setInterval(checkSession, 1500);

        // 点击后立即检查（50ms、100ms 各一次，确保 dsh 处理完会话切换后能检测到）
        var onClick = function () {
          setTimeout(checkSession, 50);
          setTimeout(checkSession, 100);
        };
        document.addEventListener('click', onClick, false);

        return function () {
          clearInterval(timer);
          document.removeEventListener('click', onClick, false);
        };
      }, [appConfig.followSession, followToSession]);

      // 导入历史会话
      var doImport = useCallback(function () {
        if (!selectedId || importing) return;
        setImporting(true);
        setImportError(null);
        fetch('/plugins/topic-trail/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: selectedId }),
        })
          .then(function (res) {
            if (!res.ok) return res.json().then(function (d) { throw new Error(d && d.error || ('HTTP ' + res.status)); });
            return res.json();
          })
          .then(function () {
            // 立即拉一次刷新（next tick 让 host 落盘）
            setTimeout(function () {
              fetch('/plugins/topic-trail/snapshot', { headers: { Accept: 'application/json' } })
                .then(function (r) { return r.ok ? r.json() : { sessions: [] }; })
                .then(function (snap) {
                  if (Array.isArray(snap.sessions)) setTrails(snap.sessions);
                  setOpenTopic(null);
                })
                .catch(function () { /* 下轮轮询会补上 */ });
            }, 400);
          })
          .catch(function (e) { setImportError(String(e && e.message || e)); })
          .finally(function () { setImporting(false); });
      }, [selectedId, importing]);

      // 合并两条线索（同一会话内拖拽触发）：AI 找共同点并合并步骤/时间关系
      var doMerge = useCallback(function (topicIdA, topicIdB) {
        if (!selectedId || merging) return;
        if (topicIdA === topicIdB) return;
        setMerging(true);
        setMergingPair([topicIdA, topicIdB]);
        setDragTopicId(null);
        setDropTargetId(null);
        // 立即反馈：释放后立刻提示，避免用户以为没反应
        showNotice('正在用 AI 合并线索…', '');
        fetch('/plugins/topic-trail/merge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: selectedId, topicIdA: topicIdA, topicIdB: topicIdB }),
        })
          .then(function (res) { return res.json(); })
          .then(function (data) {
            if (data && data.ok === false && data.cannotMerge) {
              showNotice('无法合并：' + (data.reason || '两条线索无关联'), 'warn');
              return;
            }
            if (data && data.ok) {
              showNotice('已合并为「' + (data.topic && data.topic.title || '线索') + '」', 'ok');
            }
            setTimeout(function () {
              fetch('/plugins/topic-trail/snapshot', { headers: { Accept: 'application/json' } })
                .then(function (r) { return r.ok ? r.json() : { sessions: [] }; })
                .then(function (snap) {
                  if (Array.isArray(snap.sessions)) setTrails(snap.sessions);
                  setOpenTopic(null);
                })
                .catch(function () { /* 下轮轮询补上 */ });
            }, 300);
          })
          .catch(function (e) { showNotice(t('toast.mergeFail') + ': ' + String(e && e.message || e), 'err'); })
          .finally(function () { setMerging(false); setMergingPair(null); });
      }, [selectedId, merging]);

      // 拖动（展开头部 + 收起小球共用；moved 标记用于区分「拖动」与「点击」）
      var onPointerDown = useCallback(function (e) {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        var startX = e.clientX, startY = e.clientY;
        var baseX = xy.x, baseY = xy.y;
        if (baseX === undefined) {
          baseX = window.innerWidth - 380;
          baseY = window.innerHeight - 220;
        }
        dragging.current = { startX: startX, startY: startY, baseX: baseX, baseY: baseY, moved: false };
        // 拖动开始时记录弹层当前位置（若打开），拖动中用位移增量平滑跟随，避免每帧重测按钮位置导致抖动
        var popStart = (navOpen && navDir && navDir.ready) ? { left: navDir.left, top: navDir.top } : null;
        var moved = false;
        function onMove(ev) {
          var d = dragging.current;
          if (!d) return;
          var dx = ev.clientX - d.startX, dy = ev.clientY - d.startY;
          if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
          moved = true;
          d.moved = true;
          // 拖动中：弹层用初始位置 + 位移增量跟随（不重新测按钮，避免 React 重渲染滞后导致位置抖动）
          if (popStart) {
            var vw = window.innerWidth || 1280, vh = window.innerHeight || 800;
            var nleft = Math.max(4, Math.min(popStart.left + dx, vw - 304));
            var ntop = Math.max(4, Math.min(popStart.top + dy, vh - 344));
            setNavDir({ left: nleft, top: ntop, ready: true });
          }
          // 限制拖动范围：展开面板至少留 40px 可见；折叠球（50px）永不出界
          var nx = Math.max(-320, Math.min(window.innerWidth - 50, d.baseX + dx));
          var ny = Math.max(0, Math.min(window.innerHeight - 50, d.baseY + dy));
          setXy({ x: nx, y: ny });
        }
        function onUp() {
          dragging.current = null;
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          // 拖动结束后精确校正一次弹层位置（按按钮当前视口坐标）
          if (navOpen) requestAnimationFrame(function () { measureNavPop(); });
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      }, [xy, navOpen, navDir]);

      useEffect(function () {
        if (xy.x !== undefined) {
          try { localStorage.setItem(POS_KEY, JSON.stringify({ x: xy.x, y: xy.y })); } catch { /* ignore */ }
        }
      }, [xy]);

      // 右键菜单渲染后：测量实际宽高，贴近右/下边缘时向左上收紧，保证在视口内
      // 注意：所有 useEffect 必须在下方「折叠 early return」之前声明（否则折叠/展开切换会触发 React #300）
      useEffect(function () {
        if (!menu) { setMenuPos(null); return; }
        var el = menuElRef.current;
        if (!el) { setMenuPos({ x: menu.clientX, y: menu.clientY }); return; }
        var w = el.offsetWidth || 200;
        var h = el.offsetHeight || 140;
        var x = Math.max(4, Math.min(menu.clientX, window.innerWidth - w - 4));
        var y = Math.max(4, Math.min(menu.clientY, window.innerHeight - h - 4));
        setMenuPos({ x: x, y: y });
      }, [menu]);

      // 导航弹层定位：以按钮当前视口坐标实时计算（fixed 定位，脱离面板 overflow 裁剪）
      function measureNavPop() {
        var btn = navBtnRef.current;
        var pop = navPopRef.current;
        if (!btn || !pop) { setNavDir({ ready: false }); return false; }
        var br = btn.getBoundingClientRect();
        var pw = pop.offsetWidth || 300;
        var ph = pop.offsetHeight || 340;
        var vw = window.innerWidth || 1280, vh = window.innerHeight || 800;
        // 始终左缘对齐按钮左缘（不做向左翻转——翻转会导致拖动时位置跳变不规则）
        var left = br.left;
        var top = br.bottom + 6;
        // 下方放不下 → 向上翻转到按钮上方（垂直翻转不影响水平位置，可接受）
        if (top + ph > vh - 4) top = br.top - ph - 6;
        // 超出视口时 clamp 到屏幕内（保持左缘对齐按钮的相对位置，不翻转方向）
        left = Math.max(4, Math.min(left, vw - pw - 4));
        top = Math.max(4, Math.min(top, vh - ph - 4));
        setNavDir({ left: left, top: top, ready: true });
        return true;
      }

      // 导航下拉打开后测量；首帧测量可能拿到未就绪尺寸，下一帧再校正一次
      useEffect(function () {
        if (!navOpen) { setNavDir(null); return; }
        if (!measureNavPop()) return;
        var raf = requestAnimationFrame(function () { measureNavPop(); });
        return function () { cancelAnimationFrame(raf); };
      }, [navOpen]);

      function toggleCollapsed() {
        setCollapsed(function (prev) {
          var next = !prev;
          try { localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0'); } catch { /* ignore */ }
          return next;
        });
        setOpenTopic(null);
        setNavOpen(false);
        setMenu(null);
      }

      // 当前选中视图的线索数（球上数字和标题栏小眼睛共用）
      var viewCount = 0;
      if (selectedWsId === '__all__') {
        viewCount = Array.isArray(workspaces.all.topics) ? workspaces.all.topics.length : 0;
      } else if (selectedWsId) {
        var wsSel = workspaces.byId[selectedWsId] || null;
        viewCount = wsSel && Array.isArray(wsSel.topics) ? wsSel.topics.length : 0;
      } else {
        var trailSel = trails.find(function (s) { return s.sessionId === selectedId; }) || null;
        viewCount = trailSel && Array.isArray(trailSel.topics) ? trailSel.topics.length : 0;
      }
      var fabCount = viewCount > 0 ? String(viewCount) : '◉';

      // 任务进行中：有 active 话题或 bootstrap 在加载（收起大球和展开标题栏共用）
      var hasActive = false;
      if (selectedWsId === '__all__') {
        hasActive = (workspaces.all.topics || []).some(function (t) { return t.status === 'active'; });
      } else if (selectedWsId) {
        var wsSel2 = workspaces.byId[selectedWsId] || null;
        hasActive = (wsSel2 && wsSel2.topics || []).some(function (t) { return t.status === 'active'; });
      } else {
        var trailSel2 = trails.find(function (s) { return s.sessionId === selectedId; }) || null;
        hasActive = (trailSel2 && trailSel2.topics || []).some(function (t) { return t.status === 'active'; });
      }
      var isBusy = hasActive || (bootstrap && bootstrap.progress != null && bootstrap.progress < 1);

      // 悬浮小球（始终显示在原位，展开时也在，点击可收起；z-index 高于面板）
      var fabX = xy.x, fabY = xy.y;
      if (fabX !== undefined) {
        fabX = Math.max(8, Math.min(fabX, (window.innerWidth || 0) - 38));
        fabY = Math.max(8, Math.min(fabY, (window.innerHeight || 0) - 38));
      }
      var fabEl = h('button', {
        className: 'dtt-fab' + (isBusy ? ' busy' : '') + (viewCount > 99 ? ' fab-small' : ''),
        style: {
          left: fabX !== undefined ? fabX + 'px' : undefined,
          right: fabX !== undefined ? undefined : '20px',
          top: fabY !== undefined ? fabY + 'px' : undefined,
          bottom: fabY !== undefined ? undefined : '20px',
          zIndex: 10001,
          opacity: collapsed ? 1 : 0,
          pointerEvents: collapsed ? 'auto' : 'none',
        },
        title: t('fab.title', { count: viewCount }),
        onPointerDown: onPointerDown,
        onClick: function () {
          if (dragging.current && dragging.current.moved) return;
          toggleCollapsed();
        },
      },
        h('span', {
          className: 'dtt-fab-pupil' + (appConfig.eyeAnimation && blinking ? ' blink' : ''),
          style: { transform: appConfig.eyeAnimation ? 'translate(' + pupilOffset.x + 'px,' + pupilOffset.y + 'px)' : 'none' },
        }, String(fabCount)),
      );

      // 折叠 → 只显示小球
      if (collapsed) {
        return fabEl;
      }

      // 展开 → 面板
      // 会话 → 工作区标题映射（悬停提示用）
      var wsOfSession = {};
      var wsKeys = Object.keys(workspaces.byId || {});
      for (var wi = 0; wi < wsKeys.length; wi++) {
        var wt0 = workspaces.byId[wsKeys[wi]];
        if (!wt0 || !Array.isArray(wt0.topics)) continue;
        for (var wj = 0; wj < wt0.topics.length; wj++) {
          var srcs0 = wt0.topics[wj].sources || [];
          for (var wk = 0; wk < srcs0.length; wk++) {
            if (srcs0[wk].sessionId) wsOfSession[srcs0[wk].sessionId] = wt0.title;
          }
        }
      }
      // 会话索引（含 cwd/title/topics）：dsh 工作区视图和导航构建都要用，必须提前定义
      var navSessionSource = trails.length > 0 ? trails : sessionList;
      var sessionById = {};
      for (var si0 = 0; si0 < navSessionSource.length; si0++) {
        var s0 = navSessionSource[si0];
        var normId0 = String(s0.sessionId).replace(/^session-/, '');
        var keys0 = [s0.sessionId, normId0, 'session-' + normId0];
        var hasData0 = (Array.isArray(s0.topics) && s0.topics.length > 0) || (s0.title && s0.title !== '未命名会话');
        for (var ki0 = 0; ki0 < keys0.length; ki0++) {
          var ex0 = sessionById[keys0[ki0]];
          if (!ex0 || (hasData0 && (!ex0.title || ex0.title === '未命名会话') && !(Array.isArray(ex0.topics) && ex0.topics.length > 0))) {
            sessionById[keys0[ki0]] = s0;
          }
        }
      }
      // 是否使用 dsh localStorage 工作区分组（需在 viewWs 构建前定义）
      var useDshGroups = dshWsGroups && dshWsGroups.groups && dshWsGroups.groups.length > 0;
      var viewAll = selectedWsId === '__all__';
      var viewWs = !viewAll && selectedWsId ? (workspaces.byId[selectedWsId] || null) : null;
      // dsh 工作区分组（UUID）：从 localStorage 分组找到对应会话组，拼接所有会话的线索
      var dshGroup = null;
      if (!viewAll && !viewWs && selectedWsId && useDshGroups) {
        var findGroup = function (gid) {
          if (dshWsGroups.groups) {
            for (var i = 0; i < dshWsGroups.groups.length; i++) {
              if (dshWsGroups.groups[i].id === gid) return dshWsGroups.groups[i];
            }
          }
          if (gid === '__ungrouped__' && dshWsGroups.ungrouped) return { id: gid, sessions: dshWsGroups.ungrouped };
          return null;
        };
        dshGroup = findGroup(selectedWsId);
        if (dshGroup) {
          var dshTopics = [];
          var dshName = '未命名工作区';
          for (var dsi = 0; dsi < dshGroup.sessions.length; dsi++) {
            var ds = sessionById[dshGroup.sessions[dsi]];
            if (ds) {
              if (ds.cwd && dshName === '未命名工作区') dshName = pathBasename(ds.cwd);
              if (Array.isArray(ds.topics)) {
                for (var dti = 0; dti < ds.topics.length; dti++) {
                  dshTopics.push(Object.assign({}, ds.topics[dti], {
                    _sessionId: ds.sessionId,
                    _sessionTitle: ds.title,
                    sources: [{ sessionId: ds.sessionId, sessionTitle: ds.title, workspaceTitle: dshName }],
                  }));
                }
              }
            }
          }
          viewWs = { id: dshGroup.id, title: dshName, sessionCount: dshGroup.sessions.length, topics: dshTopics };
        }
      }
      var selectedSession = sessionList.find(function (s) { return s.sessionId === selectedId; }) || null;
      var selectedTrail = trails.find(function (s) { return s.sessionId === selectedId; }) || null;
      var topics;
      if (viewAll) topics = Array.isArray(workspaces.all.topics) ? workspaces.all.topics : [];
      else if (viewWs) topics = Array.isArray(viewWs.topics) ? viewWs.topics : [];
      else topics = selectedTrail && Array.isArray(selectedTrail.topics) ? selectedTrail.topics : [];
      // 渲染位置：展开时面板偏移，让标题栏小球屏幕位置 = 大球位置（小球位置随 scale 变化）
      var ballOffsetX = 9.5 * scale;
      var ballOffsetY = 12.5 * scale;
      var dispX = xy.x !== undefined ? xy.x - ballOffsetX : undefined;
      var dispY = xy.y !== undefined ? xy.y - ballOffsetY : undefined;
      if (dispX !== undefined) {
        var vw = window.innerWidth || 1280, vh = window.innerHeight || 800;
        var pw = Math.min(panelSize.width, vw - 24);
        var ph = Math.min(panelSize.height || 500, vh - 24);
        dispX = Math.max(4, Math.min(dispX, vw - pw - 4));
        dispY = Math.max(4, Math.min(dispY, vh - ph - 4));
      }
      var style = {
        left: dispX !== undefined ? dispX + 'px' : undefined,
        right: dispX !== undefined ? undefined : '10.5px',
        top: dispY !== undefined ? dispY + 'px' : undefined,
        bottom: dispY !== undefined ? undefined : '7.5px',
      };

      // 导航数据：全部工作区 → 工作区（含会话子项） → 会话，每项即「线索」
      // sessionById 已在上方提前构建（含 cwd/title/topics，兼容三种 ID 格式）
      var navItems = [];
      navItems.push({
        key: '__all__',
        type: 'all',
        value: '__all__',
        label: '全部工作区（' + (Array.isArray(workspaces.all.topics) ? workspaces.all.topics.length : 0) + ' 条线索）',
      });
      // 构建工作区→会话的导航列表：优先用 dsh localStorage 里的分组（和 dsh 界面一致），fallback 到 cwd 分组
      if (useDshGroups) {
        var allGroups = dshWsGroups.groups.slice();
        if (dshWsGroups.ungrouped && dshWsGroups.ungrouped.length > 0) {
          allGroups.push({ id: '__ungrouped__', sessions: dshWsGroups.ungrouped });
        }
        allGroups.sort(function (a, b) {
          var pa = pinnedWs.indexOf(a.id) !== -1 ? 0 : 1;
          var pb = pinnedWs.indexOf(b.id) !== -1 ? 0 : 1;
          return pa - pb;
        });
        for (var gi = 0; gi < allGroups.length; gi++) {
          var g = allGroups[gi];
          var gName = '未命名工作区';
          var gTopicCount = 0;
          for (var gsi = 0; gsi < g.sessions.length; gsi++) {
            var gs = sessionById[g.sessions[gsi]];
            if (gs) {
              if (!gName && gs.cwd) gName = pathBasename(gs.cwd);
              if (gs.cwd && gName === '未命名工作区') gName = pathBasename(gs.cwd);
              if (Array.isArray(gs.topics)) gTopicCount += gs.topics.length;
            }
          }
          var gPinned = pinnedWs.indexOf(g.id) !== -1;
          navItems.push({
            key: 'ws:' + g.id,
            type: 'ws',
            value: 'ws:' + g.id,
            wsKey: g.id,
            pinned: gPinned,
            sessionIds: g.sessions.slice(),
            label: (gPinned ? '📌 ' : '') + gName + '（' + g.sessions.length + ' 会话 · ' + gTopicCount + ' 线索）',
          });
          for (var gj = 0; gj < g.sessions.length; gj++) {
            var gsid = g.sessions[gj];
            var gss = sessionById[gsid];
            navItems.push({
              key: gsid,
              type: 'session',
              value: gsid,
              label: fmtTitle(gss ? gss.title : gsid, 20),
              wsTitle: gName,
            });
          }
        }
      } else {
        // fallback：按 cwd 分组
        var sortedWsKeys = wsKeys.slice().sort(function (a, b) {
          var pa = pinnedWs.indexOf(a) !== -1 ? 0 : 1;
          var pb = pinnedWs.indexOf(b) !== -1 ? 0 : 1;
          return pa - pb;
        });
        for (var wi2 = 0; wi2 < sortedWsKeys.length; wi2++) {
          var wsKey2 = sortedWsKeys[wi2];
          var wt2 = workspaces.byId[wsKey2];
          if (!wt2) continue;
          var isPinned = pinnedWs.indexOf(wsKey2) !== -1;
          var wsSessions = Array.isArray(wt2.sessions) ? wt2.sessions.slice() : [];
          wsSessions.sort(function (a, b) {
            var sa = sessionById[a]; var sb = sessionById[b];
            var ta = sa && sa.updatedAt ? new Date(sa.updatedAt).getTime() : 0;
            var tb = sb && sb.updatedAt ? new Date(sb.updatedAt).getTime() : 0;
            return tb - ta;
          });
          navItems.push({
            key: 'ws:' + wsKey2,
            type: 'ws',
            value: 'ws:' + wsKey2,
            wsKey: wsKey2,
            pinned: isPinned,
            sessionIds: wsSessions,
            label: (isPinned ? '📌 ' : '') + fmtTitle(wt2.title, 22) + '（' + wt2.sessionCount + ' 会话 · ' + (Array.isArray(wt2.topics) ? wt2.topics.length : 0) + ' 线索）',
          });
          for (var wj2 = 0; wj2 < wsSessions.length; wj2++) {
            var sid2 = wsSessions[wj2];
            var ss2 = sessionById[sid2];
            navItems.push({
              key: sid2,
              type: 'session',
              value: sid2,
              label: fmtTitle(ss2 ? ss2.title : sid2, 20),
              wsTitle: fmtTitle(wt2.title, 26),
            });
          }
        }
      }
      var navValue = viewAll ? '__all__' : viewWs ? 'ws:' + selectedWsId : (selectedId || '');
      var currentNav = null;
      for (var ni = 0; ni < navItems.length; ni++) {
        if (navItems[ni].value === navValue) { currentNav = navItems[ni]; break; }
      }

      function selectItem(v) {
        setOpenTopic(null);
        if (v === '__all__') { setSelectedWsId('__all__'); setSelectedId(null); }
        else if (v.indexOf('ws:') === 0) { setSelectedWsId(v.slice(3)); setSelectedId(null); }
        else { setSelectedId(v); setSelectedWsId(null); }
        // 动态加载：切换视图立即拉一次最新数据（不依赖轮询），并落盘视图缓存
        if (refreshRef.current) refreshRef.current();
      }

      // 右键菜单：记录弹出位置与总结范围（'all' | 'ws:<id>' | sessionId | sessionIds[]）
      function openMenu(e, scope, label, topicId) {
        e.preventDefault();
        e.stopPropagation();
        // 先记录原始鼠标坐标，渲染后按实际尺寸测量再反向/clamp
        setMenu({ clientX: e.clientX, clientY: e.clientY, scope: scope, label: label, topicId: topicId || null });
        setMenuPos(null);
      }

      // 删除话题
      function doDeleteTopic(sessionId, topicId) {
        fetch('/plugins/topic-trail/topic', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionId, topicId: topicId }),
        })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            // 立即更新前端状态，不等待 refresh
            setTrails(function (prev) {
              return prev.map(function (s) {
                if (s.sessionId !== sessionId) return s;
                return { ...s, topics: (s.topics || []).filter(function (t) { return t.id !== topicId; }) };
              });
            });
            // 同时刷新 workspaces（如果有引用）
            if (refreshRef.current) refreshRef.current();
            showNotice(currentLang === 'en' ? 'Topic deleted' : '线索已删除', 'ok');
          })
          .catch(function () { showNotice(currentLang === 'en' ? 'Delete failed' : '删除失败', 'err'); });
      }

      // 编辑话题标题
      function doUpdateTopic(sessionId, topicId, patch) {
        fetch('/plugins/topic-trail/topic', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionId, topicId: topicId, patch: patch }),
        })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            // 立即更新前端状态
            setTrails(function (prev) {
              return prev.map(function (s) {
                if (s.sessionId !== sessionId) return s;
                return {
                  ...s,
                  topics: (s.topics || []).map(function (t) {
                    if (t.id !== topicId) return t;
                    return { ...t, ...patch };
                  }),
                };
              });
            });
          })
          .catch(function () { showNotice(currentLang === 'en' ? 'Update failed' : '更新失败', 'err'); });
      }

      // 执行「开始总结线索」
      function doSummarize(scope, forceRegenerate) {
        var body = {};
        if (scope === 'all') body.scope = 'all';
        else if (typeof scope === 'string' && scope.indexOf('ws:') === 0) body.workspaceId = scope.slice(3);
        else if (Array.isArray(scope)) body.sessionIds = scope;
        else body.sessionId = scope;
        if (forceRegenerate) body.forceRegenerate = true;
        setMenu(null);
        showNotice(forceRegenerate ? (currentLang === 'en' ? 'Regenerating all trails...' : '正在重新生成所有线索…') : '正在开始总结…', '');
        fetch('/plugins/topic-trail/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
          .then(function (res) {
            if (!res.ok) return res.json().then(function (d) { throw new Error(d && d.error || ('HTTP ' + res.status)); });
            return res.json();
          })
          .then(function (d) {
            if (d.targets !== undefined) {
              showNotice(t('toast.summarizing') + ' ' + d.targets + ' ' + (currentLang === 'en' ? 'sessions' : '个会话') + (d.imported ? ' (' + d.imported + ' ' + (currentLang === 'en' ? 'imported' : '新导入') + ')' : ''), 'ok');
            } else {
              showNotice(forceRegenerate ? (currentLang === 'en' ? 'Trails regenerated' : '线索已重新生成') : t('toast.summarized'), 'ok');
            }
            if (refreshRef.current) refreshRef.current();
          })
          .catch(function (e) { showNotice(t('toast.summarizeFail') + ': ' + String(e && e.message || e), 'err'); });
      }

      function showNotice(text, type) {
        setNotice({ text: text, type: type || '' });
      }

      // 点合并线索的来源 → 下钻到对应会话并展开该话题
      function drillInto(src) {
        if (!src) return;
        setSelectedId(src.sessionId || null);
        setSelectedWsId(null);
        setOpenTopic(src.topicId || null);
      }

      // 点击步骤 → 跳转到该步骤所在的会话（dsh 主界面打开对应对话）
      // 只在任务线索界面内部切换到对话，不触发 dsh 跳转
      function selectSessionInPanel(sessionId) {
        if (!sessionId) return;
        setSelectedWsId(null);
        setSelectedId(sessionId);
      }

      function jumpToSession(sessionId, step, totalSteps) {
        if (!sessionId) return;
        // 先在任务线索界面内部切换到该对话
        setSelectedWsId(null);
        setSelectedId(sessionId);
        setJumpingStep(step ? step.id : sessionId);
        showNotice('正在打开对话…', '');
        try {
          if (appCtx && typeof appCtx.inject === 'function') {
            appCtx.inject(['sessions'], function (scope) {
              try {
                if (scope.sessions && typeof scope.sessions.open === 'function') {
                  scope.sessions.open(sessionId);
                  var targetTime = step && step.time ? step.time : null;
                  var stepSeq = step && step.seq ? step.seq : null;
                  // 多次重试定位：dsh 消息列表异步渲染+虚拟滚动，一次可能不够
                  var attempts = 0;
                  function tryLocate() {
                    attempts++;
                    var ok = scrollToStepTime(targetTime, stepSeq, totalSteps);
                    if (!ok && attempts < 3) {
                      setTimeout(tryLocate, 700);
                    }
                  }
                  // 先滚到底部触发虚拟列表加载，再定位
                  setTimeout(function () {
                    var sc = findMessageScroller();
                    if (sc) sc.scrollTop = sc.scrollHeight;
                    setTimeout(tryLocate, 400);
                  }, 600);
                  setTimeout(function () {
                    setJumpingStep(null);
                    showNotice('已打开对话并定位', 'ok');
                  }, 2500);
                } else {
                  setJumpingStep(null);
                  showNotice('无法打开对话（sessions.open 不可用）', 'err');
                }
              } catch (e2) {
                setJumpingStep(null);
                showNotice('打开对话失败：' + String(e2 && e2.message || e2), 'err');
              }
            });
          } else {
            setJumpingStep(null);
            showNotice('无法打开对话（ctx.inject 不可用）', 'err');
          }
        } catch (e) {
          setJumpingStep(null);
          showNotice('打开对话失败：' + String(e && e.message || e), 'err');
        }
      }

      // 在 dsh 消息列表里按时间戳定位并滚动到对应消息
      // 找 dsh 消息列表的滚动容器（scrollHeight 最大的内部元素）
      function findMessageScroller() {
        var allEls = document.body.querySelectorAll('*');
        var scroller = null, maxScrollH = 0;
        for (var i = 0; i < allEls.length; i++) {
          var el = allEls[i];
          if (el === document.body || el === document.documentElement) continue;
          if (el.scrollHeight > maxScrollH && el.clientHeight > 150 && el.scrollHeight > el.clientHeight + 50) {
            maxScrollH = el.scrollHeight;
            scroller = el;
          }
        }
        return scroller;
      }

      function scrollToStepTime(targetTime, stepSeq, totalSteps) {
        try {
          var scroller = findMessageScroller();
          if (!scroller) return false;
          var targetTs = targetTime ? new Date(targetTime).getTime() : 0;

          // 2. 在容器里找所有直接/间接子元素中包含时间文本的消息块
          var timeRegex = /(\d{1,2}):(\d{2})(?::\d{2})?/;
          var candidates = scroller.querySelectorAll('div, section, article, li');
          var bestEl = null, bestDiff = Infinity;
          for (var j = 0; j < candidates.length; j++) {
            var c = candidates[j];
            // 只取有一定高度的元素（消息块而非行内元素）
            if (c.clientHeight < 20) continue;
            var text = c.textContent || '';
            var m = text.match(timeRegex);
            if (!m) continue;
            // 解析时间（今天的日期 + 时分）
            var now = new Date();
            var h = parseInt(m[1]), min = parseInt(m[2]);
            // 如果文本里有日期，尝试解析
            var dateMatch = text.match(/(\d{1,2})\/(\d{1,2})/);
            var msgDate;
            if (dateMatch) {
              msgDate = new Date(now.getFullYear(), parseInt(dateMatch[1]) - 1, parseInt(dateMatch[2]), h, min);
            } else {
              msgDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, min);
            }
            var ts = msgDate.getTime();
            if (!isNaN(ts) && targetTs > 0) {
              var diff = Math.abs(ts - targetTs);
              if (diff < bestDiff && diff < 12 * 3600 * 1000) {
                bestDiff = diff;
                bestEl = c;
              }
            }
          }

          // 3. 找到时间匹配 → 滚动；没找到 → 按步骤序号比例滚动；再不行 → 底部
          if (bestEl) {
            // 找最顶层的消息容器
            var msgEl = bestEl;
            while (msgEl.parentElement && msgEl.parentElement.parentElement
                   && msgEl.parentElement.clientHeight < scroller.clientHeight * 0.5) {
              msgEl = msgEl.parentElement;
            }
            var rect = msgEl.getBoundingClientRect();
            var scrollerRect = scroller.getBoundingClientRect();
            var targetScroll = scroller.scrollTop + (rect.top - scrollerRect.top) - scroller.clientHeight * 0.3;
            scroller.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
            // 高亮
            var orig = msgEl.style.boxShadow;
            msgEl.style.boxShadow = '0 0 0 2px #679efe, 0 0 16px rgba(103,158,254,0.6)';
            msgEl.style.transition = 'box-shadow 0.3s';
            setTimeout(function () { msgEl.style.boxShadow = orig || ''; }, 2500);
            return true;
          } else if (stepSeq && totalSteps && totalSteps > 0) {
            // 按步骤在话题中的位置比例滚动
            var ratio = Math.min(1, Math.max(0, stepSeq / totalSteps));
            var pos = scroller.scrollHeight * ratio - scroller.clientHeight * 0.35;
            scroller.scrollTo({ top: Math.max(0, pos), behavior: 'smooth' });
            return true;
          } else {
            scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
            return true;
          }
        } catch (e) { return false; }
      }

      function renderStep(step, sessionId, totalSteps) {
        var badge = h('span', { className: 'dtt-step-badge ' + step.kind },
          KIND_LABEL[step.kind] || step.kind);
        var foot = [];
        if (step.kind === 'tool' && step.toolName) foot.push(step.toolName);
        if (step.kind === 'tool') {
          foot.push(h('span', {
            className: step.status === 'error' ? 'dtt-step-error'
              : step.status === 'ok' ? 'dtt-step-ok'
              : 'dtt-step-running',
          }, step.status === 'error' ? '失败' : step.status === 'ok' ? '成功' : '执行中'));
        }
        if (step.kind === 'assistant' && step.status === 'interrupted') {
          foot.push(h('span', { className: 'dtt-step-error' }, '中断'));
        }
        foot.push(fmtTime(step.time));
        var isJumping = jumpingStep === step.id;
        return h('div', {
          className: 'dtt-step ' + step.kind + (isJumping ? ' dtt-step-jumping' : ''),
          key: step.id,
          onClick: function () { jumpToSession(sessionId || selectedId, step, totalSteps); },
          title: '点击跳转到对应对话并定位',
        },
          badge,
          h('div', { className: 'dtt-step-main' },
            h('div', { className: 'dtt-step-title' }, step.title + (isJumping ? '  打开中…' : '')),
            step.detail && step.detail !== step.title
              ? h('div', { className: 'dtt-step-detail' },
                  step.kind === 'tool' ? formatToolDetail(step.detail) : step.detail)
              : null,
            foot.length > 0
              ? h('div', { className: 'dtt-step-foot' },
                  foot.map(function (f, i) { return h('span', { key: i }, f); }))
              : null,
          ),
        );
      }

      // ── 步骤按需加载 ────────────────────────────────────────────────────
      // 快照（轻索引）只带 stepCount；展开线索时才按页取步骤，悬停则预取预热。
      // 这样每 3 秒的轮询不再搬运全部步骤（真实数据下曾达 5.18MB/轮）。
      var STEPS_PAGE = 200;
      // stepsStoreRef / setStepsTick 两个 hook 声明在组件顶部的 hook 区（不能放这里：
      // 本组件在「折叠 → 只显示小球」处有提前返回，hook 放在其后会让收起时少跑 hook → React #300）
      function stepsKey(sessionId, topicId) { return String(sessionId) + ':' + String(topicId); }
      function stepsEntry(sessionId, topicId) {
        var store = stepsStoreRef.current;
        var key = stepsKey(sessionId, topicId);
        if (!store[key]) store[key] = { steps: [], total: null, updatedAt: null, loading: false, error: null };
        return store[key];
      }
      function fetchSteps(sessionId, topic, offset, limit, replace) {
        var entry = stepsEntry(sessionId, topic.id);
        entry.loading = true;
        fetch('/plugins/topic-trail/steps?sessionId=' + encodeURIComponent(sessionId)
          + '&topicId=' + encodeURIComponent(topic.id)
          + '&offset=' + offset + '&limit=' + limit, { headers: { Accept: 'application/json' } })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            // 兼容旧版 host（没有 /steps 路由，或路由尚未随重启生效）：
            // 旧版快照自带 steps，直接用，避免「刷新页面后步骤突然打不开」。
            if (!data || !Array.isArray(data.steps)) {
              var legacy = Array.isArray(topic.steps) ? topic.steps : [];
              if (legacy.length > 0) {
                entry.steps = legacy;
                entry.total = legacy.length;
                entry.updatedAt = topic.updatedAt || null;
                entry.error = null;
                entry.loading = false;
                setStepsTick(function (n) { return n + 1; });
                return;
              }
              throw new Error('响应异常');
            }
            entry.total = typeof data.total === 'number' ? data.total : data.steps.length;
            entry.updatedAt = data.updatedAt || null;
            entry.steps = (replace || offset === 0) ? data.steps : entry.steps.concat(data.steps);
            entry.error = null;
            entry.loading = false;
            setStepsTick(function (n) { return n + 1; });
          })
          .catch(function (e) {
            entry.loading = false;
            entry.error = String(e && e.message || e);
            setStepsTick(function (n) { return n + 1; });
          });
      }
      // mode: 'expand' 确保有数据 | 'more' 追加下一页 | 'prefetch' 悬停预热（已有数据就不动）
      function ensureSteps(sessionId, topic, mode) {
        if (!sessionId || !topic || !topic.id) return;
        var entry = stepsEntry(sessionId, topic.id);
        if (entry.loading) return;
        var total = entry.total !== null
          ? entry.total
          : (typeof topic.stepCount === 'number' ? topic.stepCount : null);
        if (mode === 'prefetch') {
          if (entry.steps.length === 0) fetchSteps(sessionId, topic, 0, STEPS_PAGE, true); // 悬停预取首页
          return;
        }
        if (mode === 'more') {
          if (total !== null && entry.steps.length >= total) return;
          fetchSteps(sessionId, topic, entry.steps.length, STEPS_PAGE, false);
          return;
        }
        if (entry.steps.length === 0) { fetchSteps(sessionId, topic, 0, STEPS_PAGE, true); return; }
        if (total !== null && entry.steps.length < total) { fetchSteps(sessionId, topic, entry.steps.length, STEPS_PAGE, false); return; }
        // 窗口已取全，但期间该线索有更新 → 后台静默刷新同一窗口，保持内容新鲜
        if (topic.updatedAt && entry.updatedAt && entry.updatedAt !== topic.updatedAt) {
          fetchSteps(sessionId, topic, 0, Math.min(500, Math.max(STEPS_PAGE, entry.steps.length)), true);
        }
      }

      // 简单 Markdown 渲染（# 标题、**粗体**、- 列表、换行）
      function renderMarkdown(text) {
        if (!text) return '';
        var lines = text.split('\n');
        var html = '';
        var inList = false;
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          var trimmed = line.trim();
          if (trimmed === '') {
            if (inList) { html += '</ul>'; inList = false; }
            html += '<br/>';
            continue;
          }
          // 标题
          var hMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
          if (hMatch) {
            if (inList) { html += '</ul>'; inList = false; }
            var level = hMatch[1].length;
            var size = 22 - level * 2;
            html += '<div style="font-size:' + size + 'px;font-weight:700;margin:4px 0;line-height:1.3">' + inlineMd(hMatch[2]) + '</div>';
            continue;
          }
          // 列表
          var lMatch = trimmed.match(/^[-*]\s+(.*)$/);
          if (lMatch) {
            if (!inList) { html += '<ul style="margin:2px 0;padding-left:18px">'; inList = true; }
            html += '<li style="margin:1px 0">' + inlineMd(lMatch[1]) + '</li>';
            continue;
          }
          // 普通段落
          if (inList) { html += '</ul>'; inList = false; }
          html += '<div style="margin:1px 0">' + inlineMd(trimmed) + '</div>';
        }
        if (inList) html += '</ul>';
        return html;
      }
      function inlineMd(text) {
        return text
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.+?)\*/g, '<em>$1</em>')
          .replace(/`(.+?)`/g, '<code style="background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:3px;font-size:0.9em">$1</code>');
      }

      // ── 绘画功能 ──────────────────────────────────────────────────────────
      function getCanvasPos(e) {
        var canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        var rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
      }
      function startDraw(e) {
        if (drawMode === 'none') return;
        e.preventDefault();
        drawingRef.current = true;
        lastPosRef.current = getCanvasPos(e);
      }
      function onDraw(e) {
        if (!drawingRef.current || drawMode === 'none') return;
        var canvas = canvasRef.current;
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        var pos = getCanvasPos(e);
        var last = lastPosRef.current;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (drawMode === 'eraser') {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.lineWidth = drawSize * 4;
        } else {
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = drawColor;
          ctx.lineWidth = drawSize;
        }
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        lastPosRef.current = pos;
      }
      function stopDraw() {
        if (!drawingRef.current) return;
        drawingRef.current = false;
        saveCurrentDrawing();
      }
      function saveCurrentDrawing() {
        var canvas = canvasRef.current;
        if (!canvas) return;
        try {
          var dataUrl = canvas.toDataURL('image/png');
          setDrawingsMap(function (prev) {
            var next = Object.assign({}, prev);
            next[noteKey] = dataUrl;
            return next;
          });
        } catch (e) { /* ignore */ }
      }
      function loadDrawingToCanvas() {
        var canvas = canvasRef.current;
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        var saved = drawingsMap[noteKey];
        if (saved) {
          var expectedKey = noteKey;
          var img = new Image();
          img.onload = function () {
            // 加载完成后检查 noteKey 是否还是当前对话，避免串台
            if (expectedKey !== noteKey) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          };
          img.src = saved;
        }
      }
      function clearDrawing() {
        var canvas = canvasRef.current;
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        setDrawingsMap(function (prev) {
          var next = Object.assign({}, prev);
          delete next[noteKey];
          return next;
        });
      }
      function resizeCanvas() {
        var canvas = canvasRef.current;
        if (!canvas) return;
        var parent = canvas.parentElement;
        if (!parent) return;
        var w = parent.clientWidth;
        var h = parent.clientHeight;
        if (canvas.width !== w || canvas.height !== h) {
          var tmp = document.createElement('canvas');
          tmp.width = canvas.width; tmp.height = canvas.height;
          tmp.getContext('2d').drawImage(canvas, 0, 0);
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(tmp, 0, 0, w, h);
        }
      }

      // 会话视图：原始话题卡片（默认只显示标题；悬停动效展开描述；点击展开步骤；右键总结该会话；
      // 会话级视图下可拖拽一条线索到另一条上 → AI 合并）
      function renderTopicCard(topic) {
        var expanded = openTopic === topic.id;
        // 快照只给 stepCount；步骤正文在展开/悬停时按需取（store 里已有就用缓存先渲染）
        var entry = stepsEntry(selectedId, topic.id);
        var stepCount = typeof topic.stepCount === 'number'
          ? topic.stepCount
          : (Array.isArray(topic.steps) ? topic.steps.length : 0);
        var loadedSteps = entry.steps.length > 0 ? entry.steps : (Array.isArray(topic.steps) ? topic.steps : []);
        var totalSteps = entry.total !== null ? entry.total : stepCount;
        var hover = wsOfSession[selectedId] ? ('工作区：' + wsOfSession[selectedId]) : '';
        // 仅会话级视图（选中具体对话、非工作区/全部）允许拖拽合并；locked 线索（用户手动合并）不可再拖
        var canDrag = Boolean(selectedId) && !selectedWsId && !merging && !topic.locked;
        var isSource = dragTopicId === topic.id;
        var isTarget = dropTargetId === topic.id && !isSource;
        var isMerging = mergingPair && mergingPair.indexOf(topic.id) !== -1;
        var cls = 'dtt-topic' + (canDrag ? ' draggable' : '') + (isSource ? ' drag-source' : '') + (isTarget ? ' drag-over' : '') + (topic.locked ? ' locked' : '') + (isMerging ? ' merging' : '');
        var dragProps = canDrag ? {
          draggable: true,
          onDragStart: function (e) {
            setDragTopicId(topic.id);
            setDropTargetId(null);
            try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', topic.id); } catch { /* ignore */ }
          },
          onDragOver: function (e) {
            if (dragTopicId && dragTopicId !== topic.id) {
              e.preventDefault();
              try { e.dataTransfer.dropEffect = 'move'; } catch { /* ignore */ }
              if (dropTargetId !== topic.id) setDropTargetId(topic.id);
            }
          },
          onDragLeave: function () {
            if (dropTargetId === topic.id) setDropTargetId(null);
          },
          onDrop: function (e) {
            e.preventDefault();
            var src = dragTopicId;
            setDropTargetId(null);
            if (src && src !== topic.id) doMerge(src, topic.id);
          },
          onDragEnd: function () { setDragTopicId(null); setDropTargetId(null); },
        } : {};
        return h('div', Object.assign({ className: cls, key: topic.id }, dragProps),
          h('button', {
            className: 'dtt-topic-head',
            title: topic.locked ? (hover + (currentLang === 'en' ? ' (locked, auto-summarize won\'t modify)' : '（已锁定，自动总结不会修改）')) : (canDrag ? (hover + ' ' + t('merge.hint')) : hover),
            onClick: function () {
              if (dragTopicId) return;
              var next = expanded ? null : topic.id;
              setOpenTopic(next);
              if (next) ensureSteps(selectedId, topic, 'expand'); // 展开时才取步骤
            },
            onMouseEnter: function () { ensureSteps(selectedId, topic, 'prefetch'); }, // 悬停预热 → 点击秒开
            onContextMenu: function (e) {
              openMenu(e, selectedId, (currentLang === 'en' ? 'Topic: ' : '线索：') + fmtTitle(topic.title, 30), topic.id);
            },
          },
            h('span', { className: 'dtt-status ' + (topic.status === 'active' ? 'active' : 'done') }),
            h('span', { className: 'dtt-topic-main' },
              editingTopic && editingTopic.topicId === topic.id
                ? h('input', {
                    className: 'dtt-topic-edit-input',
                    value: editingTopic.title,
                    autoFocus: true,
                    onChange: function (e) { setEditingTopic({ ...editingTopic, title: e.target.value }); },
                    onKeyDown: function (e) {
                      if (e.key === 'Enter') {
                        doUpdateTopic(selectedId, topic.id, { title: editingTopic.title });
                        setEditingTopic(null);
                      } else if (e.key === 'Escape') {
                        setEditingTopic(null);
                      }
                    },
                    onBlur: function () {
                      if (editingTopic.title !== topic.title) {
                        doUpdateTopic(selectedId, topic.id, { title: editingTopic.title });
                      }
                      setEditingTopic(null);
                    },
                  })
                : h('div', { className: 'dtt-topic-title' }, topic.title),
              h('div', { className: 'dtt-topic-reveal' },
                topic.summary ? h('div', { className: 'dtt-topic-summary' }, topic.summary) : null,
                h('div', { className: 'dtt-topic-meta' },
                  h('span', null, totalSteps + ' 步'),
                  h('span', { className: 'dtt-badge ' + (topic.source === 'llm' ? 'dtt-badge-llm' : 'dtt-badge-live') },
                    topic.source === 'llm' ? 'AI 总结' : (topic.source === 'llm-merged' ? 'AI 合并' : '实时')),
                  topic.locked
                    ? h('span', { className: 'dtt-badge dtt-badge-locked' }, '已锁定')
                    : null,
                  h('span', null, fmtDate(topic.updatedAt)),
                  canDrag ? h('span', { className: 'dtt-merge-hint' }, '拖拽合并') : null,
                  isMerging ? h('span', { className: 'dtt-merge-hint dtt-merging-text' }, '合并中…') : null,
                ),
              ),
            ),
            h('span', { className: 'dtt-chevron' + (expanded ? ' open' : '') }, '›'),
          ),
          expanded
            ? h('div', { className: 'dtt-steps' },
                (function () {
                  var kids = [];
                  if (loadedSteps.length === 0) {
                    kids.push(h('div', { className: 'dtt-empty', key: 'empty' },
                      entry.loading ? '正在加载步骤…' : (entry.error ? ('步骤加载失败：' + entry.error) : '暂无步骤')));
                  } else {
                    kids.push.apply(kids, loadedSteps.map(function (s) { return renderStep(s, selectedId, totalSteps); }));
                  }
                  // 巨型线索（真实数据里见过单条 7000+ 步）不能一次全渲染，按页追加
                  if (totalSteps > loadedSteps.length) {
                    kids.push(h('button', {
                      className: 'dtt-seg-btn',
                      key: 'more',
                      title: '继续加载该线索的后续步骤',
                      onClick: function (e) { if (e && e.stopPropagation) e.stopPropagation(); ensureSteps(selectedId, topic, 'more'); },
                    }, entry.loading ? '加载中…' : ('加载更多（还有 ' + (totalSteps - loadedSteps.length) + ' 步）')));
                  }
                  return kids;
                })(),
              )
            : null,
        );
      }

      // ── 工作区视图两种模式 ──────────────────────────────────────────────
      // bigram Jaccard 相似度（后端聚类同款）
      function bigrams(s) {
        s = String(s || '').toLowerCase().replace(/\s+/g, '');
        var set = {};
        for (var i = 0; i < s.length - 1; i++) set[s.slice(i, i + 2)] = 1;
        return Object.keys(set);
      }
      function jaccard(a, b) {
        var sa = {}, sb = {};
        bigrams(a).forEach(function (g) { sa[g] = 1; });
        bigrams(b).forEach(function (g) { sb[g] = 1; });
        var inter = 0, ka = Object.keys(sa), kb = Object.keys(sb);
        ka.forEach(function (g) { if (sb[g]) inter++; });
        var union = ka.length + kb.length - inter;
        return union === 0 ? 0 : inter / union;
      }
      // 模式一：相似线索聚类（阈值 0.3，贪心聚类）
      function clusterTopics(topics) {
        var clusters = [];
        var used = {};
        for (var i = 0; i < topics.length; i++) {
          if (used[topics[i].id]) continue;
          var cluster = [topics[i]];
          used[topics[i].id] = 1;
          for (var j = i + 1; j < topics.length; j++) {
            if (used[topics[j].id]) continue;
            if (jaccard(topics[i].title, topics[j].title) >= 0.3) {
              cluster.push(topics[j]);
              used[topics[j].id] = 1;
            }
          }
          clusters.push(cluster);
        }
        return clusters;
      }
      // 模式二：按会话分组
      function groupBySession(topics) {
        var map = {};
        for (var i = 0; i < topics.length; i++) {
          var sid = topics[i]._sessionId || (topics[i].sources && topics[i].sources[0] && topics[i].sources[0].sessionId) || 'unknown';
          if (!map[sid]) map[sid] = { sessionId: sid, sessionTitle: topics[i]._sessionTitle || (topics[i].sources && topics[i].sources[0] && topics[i].sources[0].sessionTitle) || sid, topics: [] };
          map[sid].topics.push(topics[i]);
        }
        return Object.values(map);
      }

      // 全部工作区 / 工作区视图：合并线索卡片（默认只显示标题；悬停动效展开描述；点击下钻到来源会话；右键总结全部来源会话）
      function renderMergedTopic(topic, hoverHint) {
        var expanded = openTopic === topic.id;
        var srcs = Array.isArray(topic.sources) ? topic.sources : [];
        return h('div', { className: 'dtt-topic', key: topic.id },
          h('button', {
            className: 'dtt-topic-head',
            title: hoverHint,
            onClick: function () { setOpenTopic(expanded ? null : topic.id); },
            onDoubleClick: function () {
              // 双击线索 → 跳转到第一个来源会话
              if (srcs.length > 0 && srcs[0].sessionId) {
                jumpToSession(srcs[0].sessionId, null, null);
              }
            },
            onContextMenu: function (e) {
              var srcIds = srcs.map(function (s) { return s.sessionId; }).filter(function (v) { return v; });
              openMenu(e, srcIds.length > 0 ? srcIds : (selectedId || ''),
                '线索：「' + fmtTitle(topic.title, 28) + '」（' + srcIds.length + ' 个来源会话）');
            },
          },
            h('span', { className: 'dtt-status ' + (topic.status === 'active' ? 'active' : 'done') }),
            h('span', { className: 'dtt-topic-main' },
              h('div', { className: 'dtt-topic-title' }, topic.title),
              h('div', { className: 'dtt-topic-reveal' },
                topic.summary ? h('div', { className: 'dtt-topic-summary' }, topic.summary) : null,
                h('div', { className: 'dtt-topic-meta' },
                  h('span', { className: 'dtt-badge ' + (topic.source === 'llm' ? 'dtt-badge-llm' : 'dtt-badge-live') },
                    topic.source === 'llm' ? 'AI 总结' : '实时'),
                  h('span', null, srcs.length + ' 条来源'),
                  topic.status === 'active'
                    ? h('span', { className: 'dtt-step-running' }, t('status.active'))
                    : h('span', null, t('status.done')),
                ),
              ),
            ),
            h('span', { className: 'dtt-chevron' + (expanded ? ' open' : '') }, '›'),
          ),
          expanded
            ? h('div', { className: 'dtt-steps' },
                srcs.length === 0
                  ? h('div', { className: 'dtt-empty' }, '暂无来源')
                  : srcs.map(function (src, i) {
                      return h('div', {
                        className: 'dtt-step',
                        key: i,
                        style: { cursor: 'pointer' },
                        title: '打开会话「' + fmtTitle(src.sessionTitle || src.sessionId, 40) + '」',
                        onClick: function () { drillInto(src); },
                      },
                        h('span', { className: 'dtt-step-badge' }, '来'),
                        h('div', { className: 'dtt-step-main' },
                          h('div', { className: 'dtt-step-title' }, fmtTitle(src.sessionTitle || src.sessionId, 42)),
                          h('div', { className: 'dtt-step-detail' }, src.title),
                          h('div', { className: 'dtt-step-foot' },
                            src.workspaceTitle ? h('span', null, src.workspaceTitle) : null,
                            src.status === 'active'
                              ? h('span', { className: 'dtt-step-running' }, '进行中')
                              : h('span', null, '已完成'),
                          ),
                        ),
                      );
                    }),
              )
            : null,
        );
      }

      // 工作区视图组卡片（模式一聚类 / 模式二按会话）：标题+计数，悬停动态展开子线索，双击跳对话
      function renderGroupCard(groupId, title, subtitle, childTopics, hoverHint) {
        var activeCount = childTopics.filter(function (t) { return t.status === 'active'; }).length;
        var firstSid = childTopics.length > 0
          ? (childTopics[0]._sessionId || (childTopics[0].sources && childTopics[0].sources[0] && childTopics[0].sources[0].sessionId) || '')
          : '';
        var isHover = hoveredGroup === groupId;
        return h('div', {
          className: 'dtt-group-wrapper' + (isHover ? ' hover' : ''),
          key: groupId,
          onMouseLeave: function () { setHoveredGroup(null); },
        },
          h('div', { className: 'dtt-topic dtt-group-card' },
            h('button', {
              className: 'dtt-topic-head',
              title: hoverHint + '（双击在面板中打开此对话）',
              onDoubleClick: function () {
                if (firstSid) selectSessionInPanel(firstSid);
              },
            },
              h('span', { className: 'dtt-status ' + (activeCount > 0 ? 'active' : 'done') }),
              h('span', {
                className: 'dtt-topic-main',
                onMouseEnter: function () { setHoveredGroup(groupId); },
              },
                h('div', { className: 'dtt-topic-title' }, title),
                h('div', { className: 'dtt-topic-reveal' },
                  subtitle ? h('div', { className: 'dtt-topic-summary' }, subtitle) : null,
                  h('div', { className: 'dtt-topic-meta' },
                    h('span', { className: 'dtt-badge dtt-badge-llm' }, childTopics.length + ' 条线索'),
                    activeCount > 0 ? h('span', { className: 'dtt-step-running' }, activeCount + ' ' + t('status.active')) : h('span', null, t('status.done')),
                  ),
                ),
              ),
              h('span', { className: 'dtt-chevron' }, '›'),
            ),
          ),
          h('div', { className: 'dtt-group-children' },
            childTopics.length === 0
              ? h('div', { className: 'dtt-empty' }, t('empty.noTopics'))
              : childTopics.map(function (t, i) {
                  var sid = t._sessionId || (t.sources && t.sources[0] && t.sources[0].sessionId) || '';
                  var stitle = t._sessionTitle || (t.sources && t.sources[0] && t.sources[0].sessionTitle) || '';
                  return h('div', {
                    className: 'dtt-step',
                    key: t.id || i,
                    style: { cursor: 'pointer' },
                    title: '打开会话「' + fmtTitle(stitle || sid, 40) + '」中的此线索',
                    onClick: function () {
                      if (sid) jumpToSession(sid, null, null);
                    },
                  },
                    h('span', { className: 'dtt-step-badge' }, t.status === 'active' ? '进' : '完'),
                    h('div', { className: 'dtt-step-main' },
                      h('div', { className: 'dtt-step-title' }, fmtTitle(t.title, 42)),
                      t.summary ? h('div', { className: 'dtt-step-detail' }, fmtTitle(t.summary, 80)) : null,
                      h('div', { className: 'dtt-step-foot' },
                        stitle ? h('span', null, fmtTitle(stitle, 24)) : null,
                        Array.isArray(t.steps) ? h('span', null, t.steps.length + ' 步') : null,
                      ),
                    ),
                  );
                }),
          ),
        );
      }

      function mergedHintFor(topic) {
        var s = Array.isArray(topic.sources) ? topic.sources : [];
        var ws = [], ses = [], seenWs = {}, seenSes = {};
        for (var i = 0; i < s.length; i++) {
          if (s[i].workspaceTitle && !seenWs[s[i].workspaceTitle]) { seenWs[s[i].workspaceTitle] = 1; ws.push(s[i].workspaceTitle); }
          if (s[i].sessionTitle && !seenSes[s[i].sessionTitle]) { seenSes[s[i].sessionTitle] = 1; ses.push(s[i].sessionTitle); }
        }
        var parts = [];
        if (ws.length) parts.push('来自工作区：' + ws.join('、'));
        if (ses.length) parts.push('会话：' + ses.join('、'));
        return parts.join('\n');
      }

      // 通用眼睛渲染（收起时大球、展开时标题栏小图标共用）
      function renderEye(size, count) {
        var pupilScale = size / 30;
        var anim = appConfig.eyeAnimation;
        return [
          h('span', {
            className: 'dtt-fab-pupil' + (anim && blinking ? ' blink' : ''),
            style: {
              transform: anim ? 'translate(' + (pupilOffset.x * pupilScale) + 'px,' + (pupilOffset.y * pupilScale) + 'px)' : 'none',
              fontSize: (13 * pupilScale) + 'px',
            },
          }, String(count)),
        ];
      }

      var head = h('div', { className: 'dtt-head', onPointerDown: onPointerDown, style: { padding: (12.5 * scale) + 'px 12px', paddingLeft: (50.5 * scale) + 'px' } },
        h('span', {
          className: 'dtt-head-ball',
          onClick: function (e) { e.stopPropagation(); setCollapsed(true); },
          title: t('fab.collapse'),
          style: {
            left: (9.5 * scale) + 'px',
            top: (12.5 * scale) + 'px',
            width: (30 * scale) + 'px',
            height: (30 * scale) + 'px',
            fontSize: (13 * scale) + 'px',
          },
        },
          h('span', {
            className: 'dtt-fab-pupil' + (appConfig.eyeAnimation && blinking ? ' blink' : ''),
            style: { transform: appConfig.eyeAnimation ? 'translate(' + pupilOffset.x + 'px,' + pupilOffset.y + 'px)' : 'none' },
          }, String(fabCount)),
        ),
        panelSize.width <= 259 ? null : h('span', { className: 'dtt-title', style: { fontSize: (13 * scale) + 'px' } },
          t('app.title'),
        ),
        h('span', { className: 'dtt-nav' + (navOpen ? ' dtt-nav-open' : '') },
          h('button', {
            className: 'dtt-nav-btn',
            ref: navBtnRef,
            onClick: function () { setNavOpen(!navOpen); },
            onContextMenu: function (e) {
              e.preventDefault();
              e.stopPropagation();
              setNavOpen(false); // 先关闭下拉菜单，避免遮挡右键菜单
              if (!currentNav) return;
              var scope = currentNav.value;
              if (currentNav.type === 'ws' && Array.isArray(currentNav.sessionIds)) scope = currentNav.sessionIds;
              openMenu(e, scope,
                currentNav.type === 'all' ? t('nav.allWorkspaces')
                  : currentNav.type === 'ws' ? t('nav.workspace') + ': ' + currentNav.label
                  : t('nav.session') + ': ' + currentNav.label);
            },
            title: '线索网络：全部工作区 → 工作区 → 会话；左键选择，右键可手动开始总结',
          },
            h('span', { className: 'dtt-nav-label' }, currentNav ? currentNav.label : t('nav.selectSession')),
            h('span', { className: 'dtt-nav-arrow' }, '▾'),
          ),
          navOpen
            ? h('div', {
                className: 'dtt-nav-pop',
                ref: navPopRef,
                style: navDir && navDir.ready
                  ? { position: 'fixed', left: navDir.left + 'px', top: navDir.top + 'px', width: '300px' }
                  : { visibility: 'hidden' },
              },
                navItems.map(function (it) {
                  return h('div', {
                    key: it.key,
                    className: 'dtt-nav-item'
                      + (it.type === 'ws' ? ' ws' : it.type === 'session' ? ' ses' : '')
                      + (it.value === navValue ? ' sel' : ''),
                    title: it.type === 'session' && it.wsTitle ? ('工作区：' + it.wsTitle + '（右键可总结该会话）') : (it.label + '（右键可总结）'),
                    onClick: function () { selectItem(it.value); setNavOpen(false); },
                    onContextMenu: function (e) {
                      var scope = it.value;
                      if (it.type === 'ws' && Array.isArray(it.sessionIds)) scope = it.sessionIds;
                      openMenu(e, scope,
                        it.type === 'all' ? t('nav.allWorkspaces')
                          : it.type === 'ws' ? t('nav.workspace') + ': ' + it.label
                          : t('nav.session') + ': ' + it.label);
                    },
                  },
                    h('span', { className: 'dtt-nav-ic' }, NAV_ICON[it.type] || '·'),
                    h('span', { className: 'dtt-nav-label' }, it.label),
                    it.type === 'ws'
                      ? h('button', {
                          className: 'dtt-nav-pin' + (it.pinned ? ' on' : ''),
                          title: it.pinned ? '取消置顶' : '置顶此工作区',
                          onClick: function (e) { e.stopPropagation(); togglePin(it.wsKey); },
                        }, it.pinned ? '📌' : '📌')
                      : null,
                  );
                }),
              )
            : null,
        ),
        h('button', {
          className: 'dtt-btn' + (noteOpen ? ' active' : '') + (drawMode !== 'none' ? ' drawing' : ''),
          title: '笔记（左键打开，右键绘画工具）',
          onClick: function () {
            setNoteOpen(!noteOpen);
            if (!noteOpen) setNoteWinPos({ x: null, y: null });
          },
          onContextMenu: function (e) {
            e.preventDefault();
            e.stopPropagation();
            setDrawMenu({ x: e.clientX, y: e.clientY });
          },
        }, '✎'),
        h('button', { className: 'dtt-btn', title: '收起', onClick: toggleCollapsed }, '—'),
      );

      var body;
      if (error) {
        body = h('div', { className: 'dtt-empty' },
          h('span', { className: 'dtt-empty-ic' }, '⚠'),
          '连接异常：' + error);
      } else if (viewAll || viewWs) {
        if (topics.length === 0) {
          body = h('div', { className: 'dtt-empty' },
              h('span', { className: 'dtt-empty-ic' }, '◌'),
              (currentLang === 'en' ? 'No mergeable trails at this level\nDo some work in a session first' : '这个层级还没有可合并的工作线索\n先在某个会话里干点活，这里会自动汇总'));
        } else if (wsViewMode === 'bySession') {
          // 模式二：按对话分类
          var sessGroups = groupBySession(topics);
          body = sessGroups.map(function (g, gi) {
            return renderGroupCard(
              'sess-' + g.sessionId + '-' + gi,
              fmtTitle(g.sessionTitle || g.sessionId, 30),
              g.topics.length + ' 条线索',
              g.topics,
              '会话：' + (g.sessionTitle || g.sessionId)
            );
          });
        } else {
          // 模式一（默认）：相似线索合并聚类
          var clusters = clusterTopics(topics);
          body = clusters.map(function (cl, ci) {
            var firstTitle = cl[0] ? cl[0].title : '';
            var label = cl.length > 1 ? (firstTitle + ' 等 ' + cl.length + ' 条') : firstTitle;
            return renderGroupCard(
              'cl-' + ci,
              fmtTitle(label, 30),
              cl.length > 1 ? cl.length + ' 条相似线索合并' : '',
              cl,
              cl.length + ' 条相似线索'
            );
          });
        }
      } else if (selectedSession === null) {
        body = h('div', { className: 'dtt-empty' },
          h('span', { className: 'dtt-empty-ic' }, '◌'),
          '还没有会话记录\n开始对话后这里会显示工作线索');
      } else if (selectedTrail === null || topics.length === 0) {
        body = h('div', { className: 'dtt-import-box' },
          h('div', { className: 'dtt-import-title' }, fmtTitle(selectedSession.title || '未命名会话', 26)),
          h('div', { className: 'dtt-import-hint' },
            '这个会话还没有工作线索。导入后会用 DeepSeek 从会话记录中提炼话题与进度。'),
          h('button', {
            className: 'dtt-import-btn',
            disabled: importing,
            onClick: doImport,
          }, importing ? (currentLang === 'en' ? 'Importing...' : '正在导入…') : (currentLang === 'en' ? 'Import this session' : '导入此会话')),
          importError ? h('div', { className: 'dtt-import-err' }, t('toast.importFail') + ': ' + importError) : null,
        );
      } else {
        body = topics.map(renderTopicCard);
      }

      // 插件禁用时不渲染悬浮窗（设置页仍可重新启用）
      if (!pluginEnabled) return null;

      return [
        h('div', { className: 'dtt-root', style: Object.assign({}, style, {
          width: panelSize.width + 'px',
          maxHeight: panelSize.height ? panelSize.height + 'px' : undefined,
          fontSize: (13 * scale) + 'px',
          '--dtt-scale': scale,
        }) },
          head,
          h('div', { className: 'dtt-body' },
          bootstrap && bootstrap.running && bootstrap.total > 0
            ? h('div', { className: 'dtt-bootstrap' },
                t('bootstrap.progress', { done: bootstrap.done, total: bootstrap.total }))
            : null,
          body,
        ),
        h('div', {
          className: 'dtt-resize-handle',
          onPointerDown: onResizeStart,
          title: '拖拽调整大小',
        }),
        drawMenu
          ? h('div', {
              className: 'dtt-menu dtt-draw-menu',
              style: { left: drawMenu.x + 'px', top: drawMenu.y + 'px' },
              onContextMenu: function (e) { e.preventDefault(); },
            },
              h('div', { className: 'dtt-menu-hint' }, '绘画工具'),
              h('div', {
                className: 'dtt-menu-item' + (drawMode === 'pen' ? ' active' : ''),
                onClick: function () { setDrawMode('pen'); setDrawMenu(null); if (!noteOpen) setNoteOpen(true); },
              }, '✏️ 画笔'),
              h('div', {
                className: 'dtt-menu-item' + (drawMode === 'eraser' ? ' active' : ''),
                onClick: function () { setDrawMode('eraser'); setDrawMenu(null); if (!noteOpen) setNoteOpen(true); },
              }, '🧽 橡皮'),
              h('div', { className: 'dtt-menu-sep' }),
              h('div', { className: 'dtt-menu-hint' }, '颜色'),
              h('div', { className: 'dtt-draw-colors' },
                ['#4f8cff', '#ef4444', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#ffffff'].map(function (c) {
                  return h('div', {
                    key: c,
                    className: 'dtt-draw-color-swatch' + (drawColor === c ? ' active' : ''),
                    style: { background: c },
                    onClick: function () { setDrawColor(c); },
                  });
                }),
              ),
              h('div', { className: 'dtt-menu-sep' }),
              h('div', {
                className: 'dtt-menu-item',
                onClick: function () { clearDrawing(); setDrawMenu(null); },
              }, '🗑 清除绘画'),
              drawMode !== 'none'
                ? h('div', {
                    className: 'dtt-menu-item',
                    onClick: function () { setDrawMode('none'); setDrawMenu(null); },
                  }, '✓ 退出绘画')
                : null,
            )
          : null,
        menu
          ? h('div', {
              className: 'dtt-menu',
              ref: menuElRef,
              style: menuPos
                ? { left: menuPos.x + 'px', top: menuPos.y + 'px' }
                : { left: menu.clientX + 'px', top: menu.clientY + 'px', visibility: 'hidden' },
            },
              h('div', { className: 'dtt-menu-hint' }, menu.label),
              h('div', {
                className: 'dtt-menu-item',
                onClick: function () { doSummarize(menu.scope); },
              },
                h('span', { className: 'dtt-menu-ic' }, '✦'),
                t('menu.regenerate')),
              !menu.topicId ? h('div', { className: 'dtt-menu-sep' }) : null,
              !menu.topicId ? h('div', {
                className: 'dtt-menu-item',
                onClick: function () { doSummarize(menu.scope, true); },
                title: t('menu.regenerateAllDesc'),
              },
                h('span', { className: 'dtt-menu-ic' }, '↻'),
                t('menu.regenerateAll')) : null,
              menu.topicId ? h('div', {
                className: 'dtt-menu-item',
                onClick: function () {
                  var top = trails.find(function (s) { return s.sessionId === menu.scope; });
                  var tp = top && top.topics && top.topics.find(function (t) { return t.id === menu.topicId; });
                  setEditingTopic({ sessionId: menu.scope, topicId: menu.topicId, title: tp ? tp.title : '' });
                  setMenu(null);
                },
              },
                h('span', { className: 'dtt-menu-ic' }, '✎'),
                t('menu.editTopic')) : null,
              menu.topicId ? h('div', {
                className: 'dtt-menu-item dtt-menu-danger',
                onClick: function () { doDeleteTopic(menu.scope, menu.topicId); },
              },
                h('span', { className: 'dtt-menu-ic' }, '✕'),
                t('menu.deleteTopic')) : null,
            )
          : null,
        notice ? h('div', { className: 'dtt-toast ' + (notice.type || '') }, notice.text) : null,
        noteOpen ? h('div', {
          className: 'dtt-note-win',
          style: {
            left: noteWinPos.x !== null ? noteWinPos.x + 'px' : undefined,
            right: noteWinPos.x !== null ? undefined : '20px',
            top: noteWinPos.y !== null ? noteWinPos.y + 'px' : '20px',
            transform: noteWinPos.y !== null ? undefined : 'none',
          },
        },
          h('div', {
            className: 'dtt-note-win-head',
            onPointerDown: function (e) {
              if (e.button !== 0 && e.pointerType === 'mouse') return;
              var startX = e.clientX, startY = e.clientY;
              var baseX = noteWinPos.x, baseY = noteWinPos.y;
              if (baseX === null) {
                var rect = e.currentTarget.parentElement.getBoundingClientRect();
                baseX = rect.left; baseY = rect.top;
              }
              noteWinDragRef.current = { startX: startX, startY: startY, baseX: baseX, baseY: baseY };
              function onMove(ev) {
                var d = noteWinDragRef.current;
                if (!d) return;
                var nx = d.baseX + (ev.clientX - d.startX);
                var ny = d.baseY + (ev.clientY - d.startY);
                setNoteWinPos({ x: nx, y: ny });
              }
              function onUp() {
                noteWinDragRef.current = null;
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                try { localStorage.setItem('dtt-note-win-pos', JSON.stringify(noteWinPos)); } catch (e) { /* ignore */ }
              }
              window.addEventListener('pointermove', onMove);
              window.addEventListener('pointerup', onUp);
            },
          },
            h('span', { className: 'dtt-note-win-title' }, '📝 笔记'),
            h('button', {
              className: 'dtt-note-win-close',
              onClick: function () { setNoteOpen(false); setDrawMode('none'); },
              title: '关闭',
            }, '×'),
          ),
          h('div', { className: 'dtt-note-win-body' + (drawMode !== 'none' ? ' drawing' : '') },
            h('div', {
              className: 'dtt-note-preview dtt-note-preview-layer',
              dangerouslySetInnerHTML: { __html: renderMarkdown(noteText) || '<div style="opacity:0.4">这个对话的笔记... 支持 Markdown：# 标题、**粗体**、- 列表</div>' },
            }),
            h('textarea', {
              className: 'dtt-note-input dtt-note-input-layer',
              value: noteText,
              placeholder: '',
              onInput: function (e) { setCurrentNote(e.target.value); },
              onFocus: function () { setNoteFocused(true); },
              onBlur: function () { setNoteFocused(false); },
              spellcheck: false,
              disabled: drawMode !== 'none',
            }),
            h('canvas', {
              ref: canvasRef,
              className: 'dtt-note-canvas' + (drawMode !== 'none' ? ' active' : ''),
              onPointerDown: startDraw,
              onPointerMove: onDraw,
              onPointerUp: stopDraw,
              onPointerLeave: stopDraw,
            }),
          ),
          drawMode !== 'none' ? h('div', { className: 'dtt-draw-bar' },
            h('span', { className: 'dtt-draw-mode' }, drawMode === 'pen' ? '✏️ 画笔' : '🧽 橡皮'),
            h('span', { className: 'dtt-draw-color', style: { background: drawColor } }),
            h('button', { className: 'dtt-draw-btn', onClick: clearDrawing }, '清除'),
            h('button', { className: 'dtt-draw-btn', onClick: function () { setDrawMode('none'); } }, '完成'),
          ) : null,
        ) : null,
        ),
        fabEl,
      ];
    }

    // ── 设置页组件：dsh 设置 →「任务线索」 ───────────────────────────────────
    function TopicTrailSettings() {
      var [cfg, setCfg] = useState(null);
      var [saving, setSaving] = useState(false);
      useEffect(function () {
        fetch('/plugins/topic-trail/config', { headers: { Accept: 'application/json' } })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (c) {
            if (c) {
              setCfg(c);
              if (typeof c.followSession === 'boolean') appConfig.followSession = c.followSession;
              if (typeof c.eyeAnimation === 'boolean') appConfig.eyeAnimation = c.eyeAnimation;
              if (typeof c.preserveTopics === 'boolean') appConfig.preserveTopics = c.preserveTopics;
              if (typeof c.workspaceMemory === 'boolean') appConfig.workspaceMemory = c.workspaceMemory;
            }
          })
          .catch(function () { /* 配置拉取失败不致命 */ });
      }, []);
      function update(patch) {
        setSaving(true);
        fetch('/plugins/topic-trail/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) {
            if (d && d.config) {
              setCfg(d.config);
              // 立即更新所有配置字段
              var c = d.config;
              if (typeof c.followSession === 'boolean') appConfig.followSession = c.followSession;
              if (typeof c.eyeAnimation === 'boolean') appConfig.eyeAnimation = c.eyeAnimation;
              if (typeof c.preserveTopics === 'boolean') appConfig.preserveTopics = c.preserveTopics;
              if (typeof c.workspaceMemory === 'boolean') appConfig.workspaceMemory = c.workspaceMemory;
              if (typeof c.enabled === 'boolean') appConfig.enabled = c.enabled;
              if (typeof c.learnFromModifications === 'boolean') appConfig.learnFromModifications = c.learnFromModifications;
              if (c.workspaceViewMode) appConfig.workspaceViewMode = c.workspaceViewMode;
              // 通知主组件配置已变更（立即生效，不等轮询）
              try { window.dispatchEvent(new CustomEvent('dtt-config-changed', { detail: c })); } catch (e) { /* ignore */ }
            }
          })
          .catch(function () { /* 保存失败由开关状态保持原样 */ })
          .finally(function () { setSaving(false); });
      }
      var follow = cfg ? cfg.followSession !== false : true;
      var learn = cfg ? cfg.learnFromModifications !== false : true;
      var enabled = cfg ? cfg.enabled !== false : true;
      var eyeAnim = cfg ? cfg.eyeAnimation === true : false;
      var preserve = cfg ? cfg.preserveTopics !== false : true;
      var wsMem = cfg ? cfg.workspaceMemory !== false : true;
      var wsMode = cfg && cfg.workspaceViewMode ? cfg.workspaceViewMode : 'merge';
      return h('div', { className: 'dtt-settings' },
        h('div', { className: 'dtt-settings-row' },
          h('div', { className: 'dtt-settings-text' },
            h('div', { className: 'dtt-settings-name' }, t('settings.enabled')),
            h('div', { className: 'dtt-settings-desc' }, t('settings.enabledDesc'))),
          h('button', {
            className: 'dtt-switch' + (enabled ? ' on' : ''),
            type: 'button',
            role: 'switch',
            'aria-checked': enabled,
            disabled: saving,
            title: enabled ? t('settings.switchOn') : t('settings.switchOff'),
            onClick: function () { update({ enabled: !enabled }); },
          }, h('span', { className: 'dtt-switch-knob' })),
        ),
        h('div', { className: 'dtt-settings-row' },
          h('div', { className: 'dtt-settings-text' },
            h('div', { className: 'dtt-settings-name' }, t('settings.followSession')),
            h('div', { className: 'dtt-settings-desc' }, t('settings.followSessionDesc'))),
          h('button', {
            className: 'dtt-switch' + (follow ? ' on' : ''),
            type: 'button',
            role: 'switch',
            'aria-checked': follow,
            disabled: saving,
            title: follow ? t('settings.switchOn') : t('settings.switchOff'),
            onClick: function () { update({ followSession: !follow }); },
          }, h('span', { className: 'dtt-switch-knob' })),
        ),
        h('div', { className: 'dtt-settings-row' },
          h('div', { className: 'dtt-settings-text' },
            h('div', { className: 'dtt-settings-name' }, t('settings.learnFromModifications')),
            h('div', { className: 'dtt-settings-desc' }, t('settings.learnFromModificationsDesc'))),
          h('button', {
            className: 'dtt-switch' + (learn ? ' on' : ''),
            type: 'button',
            role: 'switch',
            'aria-checked': learn,
            disabled: saving,
            title: learn ? t('settings.switchOn') : t('settings.switchOff'),
            onClick: function () { update({ learnFromModifications: !learn }); },
          }, h('span', { className: 'dtt-switch-knob' })),
        ),
        h('div', { className: 'dtt-settings-row' },
          h('div', { className: 'dtt-settings-text' },
            h('div', { className: 'dtt-settings-name' }, t('settings.eyeAnimation')),
            h('div', { className: 'dtt-settings-desc' }, t('settings.eyeAnimationDesc'))),
          h('button', {
            className: 'dtt-switch' + (eyeAnim ? ' on' : ''),
            type: 'button',
            role: 'switch',
            'aria-checked': eyeAnim,
            disabled: saving,
            title: eyeAnim ? t('settings.switchOn') : t('settings.switchOff'),
            onClick: function () { update({ eyeAnimation: !eyeAnim }); },
          }, h('span', { className: 'dtt-switch-knob' })),
        ),
        h('div', { className: 'dtt-settings-row' },
          h('div', { className: 'dtt-settings-text' },
            h('div', { className: 'dtt-settings-name' }, t('settings.preserveTopics')),
            h('div', { className: 'dtt-settings-desc' }, t('settings.preserveTopicsDesc'))),
          h('button', {
            className: 'dtt-switch' + (preserve ? ' on' : ''),
            type: 'button',
            role: 'switch',
            'aria-checked': preserve,
            disabled: saving,
            title: preserve ? t('settings.switchOn') : t('settings.switchOff'),
            onClick: function () { update({ preserveTopics: !preserve }); },
          }, h('span', { className: 'dtt-switch-knob' })),
        ),
        h('div', { className: 'dtt-settings-row' },
          h('div', { className: 'dtt-settings-text' },
            h('div', { className: 'dtt-settings-name' }, t('settings.workspaceMemory')),
            h('div', { className: 'dtt-settings-desc' }, t('settings.workspaceMemoryDesc'))),
          h('button', {
            className: 'dtt-switch' + (wsMem ? ' on' : ''),
            type: 'button',
            role: 'switch',
            'aria-checked': wsMem,
            disabled: saving,
            title: wsMem ? t('settings.switchOn') : t('settings.switchOff'),
            onClick: function () { update({ workspaceMemory: !wsMem }); },
          }, h('span', { className: 'dtt-switch-knob' })),
        ),
        h('div', { className: 'dtt-settings-row' },
          h('div', { className: 'dtt-settings-text' },
            h('div', { className: 'dtt-settings-name' }, t('settings.workspaceView')),
            h('div', { className: 'dtt-settings-desc' }, t('settings.workspaceViewDesc'))),
          h('div', { className: 'dtt-seg' },
            h('button', {
              className: 'dtt-seg-btn' + (wsMode === 'merge' ? ' on' : ''),
              type: 'button', disabled: saving,
              onClick: function () { update({ workspaceViewMode: 'merge' }); },
            }, t('settings.workspaceViewMerge')),
            h('button', {
              className: 'dtt-seg-btn' + (wsMode === 'bySession' ? ' on' : ''),
              type: 'button', disabled: saving,
              onClick: function () { update({ workspaceViewMode: 'bySession' }); },
            }, t('settings.workspaceViewSession')),
          ),
        ),
        h('div', { className: 'dtt-settings-row' },
          h('div', { className: 'dtt-settings-text' },
            h('div', { className: 'dtt-settings-name' }, t('settings.summarizeMode')),
            h('div', { className: 'dtt-settings-desc' },
              cfg
                ? (cfg.summarize === 'auto' ? t('settings.summarizeAuto')
                  : cfg.summarize === 'llm' ? t('settings.summarizeLlm') : t('settings.summarizeRule'))
                : t('settings.loading')))),
        h('div', { className: 'dtt-settings-row' },
          h('div', { className: 'dtt-settings-text' },
            h('div', { className: 'dtt-settings-name' }, t('settings.pollInterval')),
            h('div', { className: 'dtt-settings-desc' }, cfg ? (cfg.pollMs + ' ms') : t('settings.loading')))),
        h('div', { className: 'dtt-settings-foot' }, t('settings.footer')),
      );
    }

    // ── 错误边界：渲染崩溃时显示错误条，而不是整个悬浮窗（连同线索）消失 ─────
    class TrailBoundary extends React.Component {
      constructor(props) { super(props); this.state = { err: null }; }
      static getDerivedStateFromError(e) { return { err: e }; }
      componentDidCatch(e, info) {
        try {
          localStorage.setItem('dsh-topic-trail.err', String(e && (e.stack || e.message) || e));
        } catch (e2) { /* ignore */ }
        try { console.error('[dsh-topic-trail] render error:', e, info); } catch (e2) { /* ignore */ }
      }
      render() {
        var self = this;
        if (this.state.err) {
          var msg = String(this.state.err && (this.state.err.message || this.state.err.stack) || this.state.err);
          // 热更新（HMR）把「hook 数量不同」的新组件灌进已挂载页面时，React 会抛
          // #310 / #300（Rendered more/fewer hooks than during the previous render）。
          // 这种错误重试没用——fiber 上的 hook 序列必须重建，只能刷新页面。
          var hookMismatch = /#310|#300|Rendered (more|fewer) hooks/.test(msg);
          var btnStyle = {
            padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(255,255,255,0.08)', color: '#f9fafb', cursor: 'pointer', fontSize: 12,
          };
          var primaryStyle = {
            padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(103,158,254,0.5)',
            background: 'rgba(103,158,254,0.22)', color: '#f9fafb', cursor: 'pointer', fontSize: 12,
          };
          return h('div', {
            style: {
              position: 'fixed', right: '20px', bottom: '20px', zIndex: 10003,
              background: 'rgba(58,20,20,0.97)', color: '#fca5a5',
              padding: '12px 16px', borderRadius: '12px', fontSize: '12px',
              maxWidth: '320px', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              boxShadow: '0 10px 28px rgba(0,0,0,0.5)', border: '1px solid rgba(248,113,113,0.4)',
            },
          },
            h('div', { style: { fontWeight: 600, marginBottom: 6 } }, '⚠ 工作线索出错了'),
            h('div', { style: { lineHeight: 1.6, fontSize: 11 } }, msg),
            hookMismatch
              ? h('div', { style: { marginTop: 6, color: '#fcd34d', fontSize: 11, lineHeight: 1.6 } },
                  '若刚更新过插件代码，刷新页面通常即可恢复（数据不会丢）；若刷新后仍出现，说明是代码问题——请把控制台里 [dsh-topic-trail] render error 的堆栈反馈一下。')
              : null,
            h('div', { style: { display: 'flex', gap: 8, marginTop: 10 } },
              hookMismatch
                ? null
                : h('button', { style: btnStyle, onClick: function () { self.setState({ err: null }); } }, '重试'),
              h('button', {
                style: hookMismatch ? primaryStyle : btnStyle,
                onClick: function () { try { window.location.reload(); } catch (e2) { /* ignore */ } },
              }, '刷新页面')));
        }
        return this.props.children;
      }
    }

    function TrailPanelWrapped() {
      return React.createElement(TrailBoundary, null, React.createElement(TopicTrailPanel));
    }

    // ── 插件注册 ────────────────────────────────────────────────────────────
    injectCss();
    // 全局错误记录：崩溃现场写进 localStorage，便于诊断；不打断页面
    try {
      window.addEventListener('error', function (ev) {
        try {
          localStorage.setItem('dsh-topic-trail.err',
            String((ev && ev.error && (ev.error.stack || ev.error.message)) || (ev && ev.message) || 'page-error'));
        } catch (e2) { /* ignore */ }
      });
      window.addEventListener('unhandledrejection', function (ev) {
        try {
          localStorage.setItem('dsh-topic-trail.err',
            'rejection: ' + String((ev && ev.reason && (ev.reason.stack || ev.reason.message)) || (ev && ev.reason) || 'rejection'));
        } catch (e2) { /* ignore */ }
      });
    } catch (e) { /* ignore */ }
    var appCtx = null; // apply 注入的 ctx（供组件调用 ctx.sessions.open 跳转会话 / 读取当前会话）
    // 运行时配置（设置页「任务线索」可开关；启动时从 /plugins/topic-trail/config 拉取）
    var appConfig = { followSession: true, eyeAnimation: false, preserveTopics: true, workspaceMemory: true };
    exports.name = 'dsh-topic-trail';
    exports.inject = ['slots'];
    exports.apply = function (ctx) {
      appCtx = ctx;
      ctx.inject(['slots'], function (scope) {
        var dispose = scope.slots.inject('shell.overlay', function () {
          return scope.slots.register({ name: 'shell.overlay', id: 'dsh-topic-trail' }, TrailPanelWrapped);
        });
        var disposeSettings = null;
        try {
          disposeSettings = scope.slots.inject('settings.section', function () {
            return scope.slots.register(
              { name: 'settings.section', id: 'dsh-topic-trail', order: 60, label: function () { return t('settings.title'); } },
              TopicTrailSettings
            );
          });
        } catch (e) { /* 设置槽位不可用不致命 */ }
        return function () {
          dispose();
          if (disposeSettings) disposeSettings();
        };
      });
    };

    return module.exports;
  },
});
