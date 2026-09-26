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
      '  animation:dtt-root-in 0.2s cubic-bezier(0.4,0,0.2,1) both;',
      '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Arial,sans-serif}',
      // 展开时面板淡入。
      // ⚠ 这里刻意只用 opacity，不含 transform：transform 会让 .dtt-root 成为 containing block，
      // 里面的 .dtt-nav-pop（position:fixed）就不再相对视口定位——视觉位置与命中位置错开，
      // 表现就是「下拉看得到、却怎么点都没反应」。
      '@keyframes dtt-root-in{from{opacity:0}to{opacity:1}}',
      '.dtt-head{display:flex;align-items:center;gap:8px;padding:12.5px 12px;cursor:move;user-select:none;',
      '  background:linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.015));',
      '  border-bottom:1px solid rgba(255,255,255,0.08)}',
      '.dtt-head-ball{position:absolute;left:9.5px;top:12.5px;width:calc(30px * var(--dtt-ball-scale, 1));height:calc(30px * var(--dtt-ball-scale, 1));border-radius:50%;',
      '  background:linear-gradient(135deg,#4f8cff,#2563eb);box-shadow:0 2px 8px rgba(37,99,235,0.4);',
      '  display:flex;align-items:center;justify-content:center;overflow:visible;z-index:2;cursor:pointer}',
      '.dtt-head-ball::before{content:"";position:absolute;inset:-3px;border-radius:50%;',
      '  border:2px solid rgba(200,220,255,0.35);animation:dtt-fab-pulse 3.2s ease-in-out infinite;pointer-events:none}',
      '.dtt-head{position:relative;padding-left:calc(50.5px + var(--dtt-ball-extra, 0px)) !important}',
      '.dtt-title{font-weight:600;font-size:13px;display:flex;align-items:center;gap:7px;white-space:nowrap;letter-spacing:0.2px}',
      '@keyframes dtt-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.45;transform:scale(0.82)}}',
      '.dtt-nav{position:relative;flex:1;min-width:0}',
      '.dtt-nav-btn{width:100%;font-size:12px;padding:5px 10px;border-radius:9px;',
      '  border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.05);',
      '  color:#f9fafb;cursor:pointer;text-align:left;display:flex;align-items:center;gap:6px;',
      '  transition:background 0.15s ease,border-color 0.15s ease}',
      '.dtt-nav-btn:hover{background:rgba(255,255,255,0.09);border-color:rgba(255,255,255,0.2)}',
      '.dtt-nav-label{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dtt-search-input{flex:1;min-width:0;background:rgba(255,255,255,0.08);border:1px solid rgba(103,158,254,0.4);border-radius:6px;padding:4px 8px;color:#e5e7eb;font-size:12px;outline:none;box-sizing:border-box}',
      '.dtt-search-input::placeholder{color:#6b7280}',
      '.dtt-nav-arrow{flex:none;font-size:9px;color:#adb2b8;transition:transform 0.18s ease}',
      '.dtt-nav-open .dtt-nav-arrow{transform:rotate(180deg)}',
      '.dtt-nav-pop{position:fixed;left:0;top:0;width:300px;max-width:min(92vw,340px);max-height:min(60vh,340px);overflow-y:auto;z-index:10050;',
      '  background:rgba(38,38,41,0.98);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);',
      '  border:1px solid rgba(255,255,255,0.12);border-radius:12px;',
      '  box-shadow:0 18px 48px rgba(0,0,0,0.5);padding:5px;animation:dtt-fade 0.12s ease both}',
      '.dtt-nav-pop::-webkit-scrollbar{width:6px}',
      '.dtt-nav-pop::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.14);border-radius:3px}',
      '.dtt-nav-item{display:flex;align-items:center;gap:6px;padding:6px 9px;border-radius:8px;cursor:pointer;font-size:12px;',
      '  color:#e6e8ea;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background 0.12s ease}',
      '.dtt-nav-item:hover{background:rgba(255,255,255,0.08)}',
      '.dtt-nav-item.sel{background:rgba(103,158,254,0.16);color:#a8c2ff}',
      // 无线索/无标题的会话弱化显示，避免和真正有内容的条目抢注意力
      '.dtt-nav-item.dim{opacity:0.5}',
      '.dtt-nav-item.dim:hover{opacity:0.8}',
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
      '.dtt-body{flex:1;min-height:0;overflow-y:auto;padding:6px;display:flex;flex-direction:column;gap:4px}',
      '.dtt-bootstrap{padding:7px 11px;border-radius:9px;font-size:11px;color:#a8c2ff;',
      '  background:rgba(103,158,254,0.10);border:1px solid rgba(103,158,254,0.22);display:flex;align-items:center;gap:7px}',
      '.dtt-error-bar{padding:6px 10px;border-radius:9px;font-size:11px;color:#fca5a5;cursor:pointer;',
      '  background:rgba(248,113,113,0.12);border:1px solid rgba(248,113,113,0.3);display:flex;align-items:center;gap:6px}',
      '.dtt-error-bar:hover{background:rgba(248,113,113,0.18)}',
      '.dtt-error-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dtt-error-retry{color:#fcd34d;text-decoration:underline;flex-shrink:0}',
      '.dtt-error-ic{flex-shrink:0;line-height:1;font-size:12px}',
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
      // 画笔粗细：drawSize 一直在被 lineWidth 读取，却没有任何入口能改它
      '.dtt-draw-sizes{display:flex;align-items:center;gap:8px;padding:6px 10px}',
      '.dtt-draw-size-swatch{width:20px;height:20px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;',
      '  border:2px solid transparent;transition:transform 0.12s ease}',
      '.dtt-draw-size-swatch:hover{transform:scale(1.12)}',
      '.dtt-draw-size-swatch.active{border-color:#fff;box-shadow:0 0 0 1px rgba(79,140,255,0.8)}',
      '.dtt-draw-size-dot{border-radius:50%;background:#e5e7eb;display:block}',
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
      '.dtt-topic{border:1px solid rgba(255,255,255,0.09);border-radius:10px;overflow:hidden;min-height:40px;',
      // flex-shrink:0 很关键：.dtt-body 是 flex column，卡片默认会被压缩。
      // 线索多、空间不足时，浏览器会压扁每张卡片，再叠加 overflow:hidden，
      // 展开区就被裁成 0 高——表现正是「线索多时看不到历程」。
      '  flex-shrink:0;',
      '  display:grid;grid-template-rows:auto 0fr auto;',
      '  transition:grid-template-rows 0.5s cubic-bezier(0.4,0,0.2,1),border-color 0.15s ease,background 0.15s ease;',
      '  background:rgba(255,255,255,0.04);animation:dtt-in 0.18s ease both}',
      '.dtt-topic:hover,.dtt-topic:focus-within{grid-template-rows:auto 1fr auto;border-color:rgba(255,255,255,0.16);background:rgba(255,255,255,0.055)}',
      '@keyframes dtt-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}',
      '@keyframes dtt-fade{from{opacity:0}to{opacity:1}}',
      '.dtt-topic-head{display:flex;align-items:flex-start;gap:8px;padding:7px 10px;cursor:pointer;text-align:left;width:100%;min-height:40px;',
      '  border:0;background:transparent;color:inherit;font:inherit}',
      '.dtt-topic-head:hover{background:rgba(255,255,255,0.03)}',
      '.dtt-status{flex:none;width:8px;height:8px;border-radius:50%;margin-top:6px}',
      // 三档：真正在做（亮绿+脉冲）/ 暂时搁置（暗绿）/ 实际已停（灰）
      '.dtt-status.active{background:#4caf50;box-shadow:0 0 0 3px rgba(76,175,80,0.22);animation:dtt-pulse 1.8s ease-in-out infinite}',
      '.dtt-status.done{background:#4b4b52}',
      // 暂时搁置：还是 active，但已经十几分钟没动了（去掉脉冲，颜色压暗）
      '.dtt-status.idle{background:#35703a;box-shadow:none;animation:none}',
      // 实际已停：挂了一天以上没人碰，跟已完成看起来一样
      '.dtt-status.stale{background:#4b4b52;box-shadow:none;animation:none}',
      '.dtt-topic-main{flex:1;min-width:0}',
      '.dtt-topic-title{font-weight:600;font-size:calc(16px * var(--dtt-scale, 1));word-break:break-all;line-height:1.45}',
      '.dtt-topic-edit-input{width:100%;font-size:13px;font-weight:600;color:#f3f4f6;line-height:1.45;',
      '  background:rgba(255,255,255,0.08);border:1px solid rgba(103,158,254,0.5);border-radius:6px;',
      '  padding:2px 6px;outline:none;box-sizing:border-box}',
      // hover 动效展开的描述区（Grid 行高 0fr→1fr 过渡，确保父元素高度正确更新，不溢出不重叠）
      '.dtt-topic-reveal{min-height:0;overflow:hidden;opacity:0;margin-top:0;',
      '  transition:opacity 0.42s ease,margin-top 0.5s cubic-bezier(0.4,0,0.2,1)}',
      '.dtt-topic:hover .dtt-topic-reveal,.dtt-topic:focus-within .dtt-topic-reveal',
      '  {opacity:1;margin-top:3px;overflow-y:auto}',
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
      // 历程时间线（阶段里程碑）
      '.dtt-milestones{border-top:1px solid rgba(255,255,255,0.07);padding:8px 10px 6px;display:flex;flex-direction:column;gap:0;position:relative;}',
      '.dtt-expanded-wrap{display:flex;flex-direction:column;}',
      '.dtt-expanded-wrap .dtt-steps{border-top:none;}',
      '.dtt-milestones-title{color:#9ca3af;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px;}',
      '.dtt-milestone{display:flex;align-items:flex-start;gap:10px;position:relative;padding-bottom:10px;cursor:pointer;flex-shrink:0;}',
      '.dtt-milestone:last-child{padding-bottom:4px;}',
      '.dtt-milestone::before{content:"";position:absolute;left:5px;top:14px;bottom:-2px;width:2px;background:rgba(255,255,255,0.1);border-radius:1px;}',
      '.dtt-milestone:last-child::before{display:none;}',
      '.dtt-milestone-dot{width:12px;height:12px;border-radius:50%;flex:none;margin-top:2px;position:relative;z-index:1;border:2px solid transparent;}',
      '.dtt-milestone-dot.proposal{background:#4caf50;border-color:rgba(76,175,80,0.3);}',
      '.dtt-milestone-dot.exploration{background:#679efe;border-color:rgba(103,158,254,0.3);}',
      '.dtt-milestone-dot.blocked{background:#ff9800;border-color:rgba(255,152,0,0.3);}',
      '.dtt-milestone-dot.breakthrough{background:#ab47bc;border-color:rgba(171,71,188,0.3);}',
      '.dtt-milestone-dot.completion{background:#ffd54f;border-color:rgba(255,213,79,0.3);}',
      '.dtt-milestone-info{flex:1;min-width:0;}',
      '.dtt-milestone-title{font-size:11px;font-weight:600;color:#e6e8ea;line-height:1.4;}',
      '.dtt-milestone-summary{font-size:10px;color:#9ca3af;line-height:1.4;margin-top:2px;display:none;}',
      '.dtt-milestone:hover .dtt-milestone-summary{display:block;}',
      '.dtt-milestone:hover .dtt-milestone-dot{transform:scale(1.2);transition:transform 0.2s ease;}',
      '.dtt-steps{border-top:1px solid rgba(255,255,255,0.07);padding:6px 8px 10px;display:flex;flex-direction:column;gap:4px;flex-shrink:0;}',
      '.dtt-steps::-webkit-scrollbar{width:5px;}',
      '.dtt-steps::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:3px;}',
      '.dtt-steps::-webkit-scrollbar-track{background:transparent;}',
      '.dtt-step{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;min-height:38px;border-radius:8px;border-left:2px solid transparent;cursor:pointer;overflow:hidden;position:relative;',
      '  transition:background 0.12s ease;flex-shrink:0}',
      '.dtt-step:hover{background:rgba(255,255,255,0.05)}',
      '.dtt-step-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.dtt-step-title{font-size:12px;word-break:break-word;color:#e6e8ea;line-height:1.5;font-weight:500}',
      '.dtt-step-detail{color:#9ca3af;font-size:11px;margin-top:1px;word-break:break-word;line-height:1.5;display:block;max-height:4.5em;overflow:hidden}',
      '.dtt-step.user{border-left-color:#4caf50}',
      '.dtt-step.assistant{border-left-color:#679efe}',
      '.dtt-step.tool{border-left-color:#f59e0b}',
      '.dtt-step.reasoning{border-left-color:#a78bfa}',
      // 跳转中：整卡片呼吸高亮。以前只有标题追加「打开中…」文字，卡片本身没有任何反馈，
      // 而这个类名早就在 DOM 上挂着、却一直没有对应样式。
      '.dtt-step-jumping{background:rgba(103,158,254,0.14);',
      '  box-shadow:inset 0 0 0 1px rgba(103,158,254,0.45);animation:dtt-step-jump 1.2s ease-in-out infinite}',
      '.dtt-step-jumping .dtt-step-title{color:#a8c2ff}',
      '@keyframes dtt-step-jump{0%,100%{background:rgba(103,158,254,0.10)}50%{background:rgba(103,158,254,0.22)}}',
      '.dtt-step-badge{flex:none;font-size:10px;line-height:16px;height:16px;padding:0 6px;border-radius:4px;margin-top:2px;',
      '  background:rgba(255,255,255,0.08);color:#adb2b8;font-weight:500}',
      '.dtt-step-badge.user{background:rgba(76,175,80,0.16);color:#6fce7a}',
      '.dtt-step-badge.assistant{background:rgba(103,158,254,0.16);color:#a8c2ff}',
      '.dtt-step-badge.tool{background:rgba(245,158,11,0.16);color:#fbbf24}',
      '.dtt-step-badge.reasoning{background:rgba(167,139,250,0.16);color:#c4b5fd}',
      '.dtt-step-foot{display:flex;gap:8px;margin-top:3px;color:#9ca3af;font-size:10px;flex-wrap:wrap;align-items:center}',
      '.dtt-step-ok{color:#6fce7a;font-weight:500}.dtt-step-error{color:#f87171;font-weight:500}.dtt-step-running{color:#fbbf24;font-weight:500}',
      // 换肤靠 CSS 变量：--dtt-ink 数字/描边色，--dtt-px/--dtt-py 视线偏移，--dtt-eye 眨眼
      '.dtt-fab{position:fixed;z-index:9999;pointer-events:auto;cursor:pointer;width:calc(30px * var(--dtt-ball-scale, 1));height:calc(30px * var(--dtt-ball-scale, 1));border-radius:50%;',
      '  --dtt-ink:#fff;--dtt-ring:rgba(255,255,255,0.2);--dtt-px:0px;--dtt-py:0px;--dtt-eye:1;',
      '  display:flex;align-items:center;justify-content:center;',
      '  background:linear-gradient(135deg,#4f8cff,#2563eb);',
      '  box-shadow:0 4px 14px rgba(37,99,235,0.5),0 1px 4px rgba(0,0,0,0.3);',
      '  border:1px solid var(--dtt-ring);transition:transform 0.15s ease,box-shadow 0.15s ease,opacity 0.22s ease}',
      '.dtt-fab.fab-small .dtt-fab-pupil{font-size:10px}',
      '/* 瞳孔（数字） */',
      '.dtt-fab-pupil{position:relative;z-index:2;color:var(--dtt-ink);font-weight:700;font-size:calc(13px * var(--dtt-ball-scale, 1));',
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
      '/* DeepSeek 娘皮肤头像层：铺满整个圆形（cover），并把视线偏移折算成尺寸位移 */',
      // 头像 URL 带版本号：响应头是 max-age=86400，若不换 URL，换了头像图用户 24 小时看不到
      '.dtt-fab-face{position:absolute;inset:0;border-radius:inherit;overflow:hidden;z-index:1;pointer-events:none;',
      '  background:url("/plugins/topic-trail/avatar?v=2") center/cover no-repeat;',
      '  transform:translate(var(--dtt-px, 0px), calc(var(--dtt-py, 0px) * 0.6)) scaleY(var(--dtt-eye, 1));',
      '  transform-origin:50% 45%;transition:transform 0.12s ease-out}',
      '.dtt-fab.deepseek.blinking .dtt-fab-face,.dtt-head-ball.deepseek.blinking .dtt-fab-face{transition-duration:0.07s}',
      // 皮肤变量要给「悬浮小球」和「面板内小球」都提供：
      // head-ball 上没有 --dtt-ink 时，角标 color:var(--dtt-ink) 会失效（取不到值）
      '.dtt-fab.deepseek,.dtt-head-ball.deepseek{--dtt-ink:#2a4a8a;--dtt-ring:rgba(74,111,165,0.55)}',
      '.dtt-fab.deepseek{background:#fff;border-radius:50%;',
      '  box-shadow:0 3px 12px rgba(74,111,165,0.45),0 1px 3px rgba(0,0,0,0.25)}',
      // 面板内小球：白底 + 与头像同色的描边（旧版它在 deepseek 下仍是蓝色渐变底）
      '.dtt-head-ball.deepseek{background:#fff;border-radius:50%;border:1px solid var(--dtt-ring);',
      '  box-shadow:0 2px 8px rgba(74,111,165,0.35)}',
      '.dtt-fab.deepseek::before,.dtt-head-ball.deepseek::before{border-color:rgba(170,200,240,0.45)}',
      '/* 头像皮肤下数字挪到右上角当角标：球面全留给形象，计数也不丢 */',
      '.dtt-fab.deepseek .dtt-fab-pupil,.dtt-head-ball.deepseek .dtt-fab-pupil{position:absolute;top:-3px;right:-3px;z-index:3;',
      '  min-width:14px;height:14px;padding:0 3px;box-sizing:border-box;border-radius:8px;',
      '  display:flex;align-items:center;justify-content:center;',
      '  background:#fff;color:var(--dtt-ink);font-size:9px;font-weight:700;line-height:14px;',
      '  border:1px solid rgba(74,111,165,0.55);box-shadow:0 1px 3px rgba(0,0,0,0.25);',
      '  transform:none;animation:none}',
      // fab-small 只该缩小默认皮肤的数字，不能把头像皮肤的角标也压小
      '.dtt-fab.deepseek .dtt-fab-pupil,.dtt-head-ball.deepseek .dtt-fab-pupil{font-size:9px}',
      '.dtt-menu{position:fixed;z-index:10001;min-width:180px;background:rgba(38,38,41,0.98);backdrop-filter:blur(24px);',
      '  -webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.12);border-radius:12px;',
      '  box-shadow:0 18px 48px rgba(0,0,0,0.5);padding:5px;animation:dtt-fade 0.12s ease both}',
      '.dtt-menu-hint{padding:7px 12px 3px;font-size:10px;color:#9ca3af;word-break:break-all;max-width:260px;line-height:1.6}',
      '.dtt-menu-item{display:flex;align-items:center;gap:7px;padding:8px 12px;border-radius:8px;cursor:pointer;font-size:12px;',
      '  color:#f9fafb;font-weight:500;transition:background 0.12s ease,color 0.12s ease}',
      '.dtt-menu-item:hover{background:rgba(103,158,254,0.18);color:#a8c2ff}',
      '.dtt-menu-item.dtt-menu-danger:hover{background:rgba(239,68,68,0.18);color:#fca5a5}',
      '.dtt-menu-item .dtt-menu-ic{flex:none;font-size:11px;opacity:0.9}',
      /* 主动展示气泡（挂在 document.body 下，字号是固定的，不继承面板的缩放）
         width:max-content 很关键：气泡用 left 定位且贴着右侧小球，
         不写的话浏览器会把可用宽度算成「视口宽 - left」，内容被挤成一列 */
      '.dtt-bubble{position:fixed;z-index:10003;width:max-content;max-width:260px;padding:10px 14px;background:rgba(38,38,41,0.96);backdrop-filter:blur(16px);',
      // letter-spacing 取轻微负值让中文字排得紧凑些（会被子元素如 .dtt-bubble-topic 继承）
      '  border:1px solid rgba(255,255,255,0.12);border-radius:12px;color:#e5e7eb;font-size:14px;line-height:1.55;letter-spacing:-0.3px;',
      '  box-shadow:0 6px 20px rgba(0,0,0,0.4);pointer-events:none;',
      '  animation:dtt-bubble-in 0.3s ease both}',
      '.dtt-bubble::after{content:"";position:absolute;bottom:-6px;left:50%;transform:translateX(-50%);',
      '  border:6px solid transparent;border-top-color:rgba(38,38,41,0.96);border-bottom:none}',
      '.dtt-bubble.hiding{animation:dtt-bubble-out 0.4s ease both}',
      '@keyframes dtt-bubble-in{from{opacity:0;transform:translateX(-50%) translateY(8px) scale(0.9)}to{opacity:1;transform:translateX(-50%) translateY(-100%) scale(1)}}',
      '@keyframes dtt-bubble-out{from{opacity:1;transform:translateX(-50%) translateY(-100%) scale(1)}to{opacity:0;transform:translateX(-50%) translateY(-108px) scale(0.95)}}',
      // 话题标签：话术里关联到哪条线索，以前这个字段只用来判断可点击，没显示过
      '.dtt-bubble-topic{margin-top:7px;padding-top:6px;border-top:1px dashed rgba(255,255,255,0.14);',
      '  font-size:12px;color:#a8c2ff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;gap:4px;align-items:center}',
      '.dtt-bubble-topic em{font-style:normal;opacity:0.6;flex-shrink:0}',
      '.dtt-bubble-topic span{overflow:hidden;text-overflow:ellipsis}',
      // DeepSeek 娘模式：换成思考气泡，和原图的「哦鲸鲸…」排版呼应
      '.dtt-bubble.deepseek{background:rgba(255,255,255,0.97);border-color:rgba(74,111,165,0.4);color:#2a3a5a;',
      '  border-radius:14px;box-shadow:0 6px 20px rgba(0,0,0,0.35)}',
      '.dtt-bubble.deepseek::before{content:"";position:absolute;bottom:-7px;left:calc(50% + 11px);width:8px;height:8px;',
      '  background:rgba(255,255,255,0.97);border:1px solid rgba(74,111,165,0.4);border-radius:50%}',
      '.dtt-bubble.deepseek::after{content:"";position:absolute;bottom:-15px;left:calc(50% + 3px);width:4px;height:4px;',
      '  background:rgba(255,255,255,0.97);border:1px solid rgba(74,111,165,0.4);border-radius:50%;',
      '  border-top:none;border-left:none}',
      '.dtt-bubble.deepseek .dtt-bubble-topic{border-top-color:rgba(74,111,165,0.25);color:#4a6fa5}',
      '.dtt-bubble.deepseek .dtt-bubble-topic em{opacity:0.55}',
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
      '.dtt-ball-size{display:flex;align-items:center;gap:10px;flex:none}',
      '.dtt-ball-range{width:132px;height:4px;border-radius:2px;-webkit-appearance:none;appearance:none;',
      '  background:rgba(255,255,255,0.18);outline:none;cursor:pointer}',
      '.dtt-ball-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;',
      '  background:#679efe;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.4)}',
      '.dtt-ball-range:disabled{opacity:0.5;cursor:default}',
      '.dtt-ball-val{font-size:12px;color:#9ca3af;min-width:40px;text-align:right;font-variant-numeric:tabular-nums}',
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
      '.dtt-show-old-btn{display:block;width:100%;margin:8px 0 4px;padding:8px;border:1px dashed rgba(255,255,255,0.15);background:transparent;color:#9ca3af;font-size:11px;border-radius:8px;cursor:pointer;text-align:center;transition:all 0.2s}',
      '.dtt-show-old-btn:hover{border-color:rgba(103,158,254,0.5);color:#a8c2ff;background:rgba(103,158,254,0.08)}',
      '.dtt-show-old-btn.dtt-collapse-old{border-style:solid;opacity:0.7}',
      '.dtt-group-wrapper{margin-bottom:6px;position:relative;border:1px solid rgba(255,255,255,0.09);border-radius:12px;background:rgba(255,255,255,0.04);transition:border-color 0.15s ease,background 0.15s ease;display:block}',
      '.dtt-group-wrapper .dtt-topic{border:none;border-radius:0;background:transparent;margin-bottom:0;animation:none;display:grid;grid-template-rows:auto 0fr;transition:grid-template-rows 0.5s cubic-bezier(0.4,0,0.2,1);height:auto;overflow:visible;min-height:36px}',
      '.dtt-group-wrapper:hover .dtt-topic,.dtt-group-wrapper .dtt-topic:focus-within{grid-template-rows:auto 1fr}',
      '.dtt-group-wrapper .dtt-topic-head{min-height:0;padding:4px 10px;display:flex;align-items:center}',
      '.dtt-group-wrapper .dtt-topic-title{line-height:1.35;font-size:calc(15px * var(--dtt-scale, 1))}',
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
        'settings.skin': '皮肤',
        'settings.skinDesc': '选择收起小球的外观风格。',
        'settings.proactiveDisplay': '主动展示',
      'settings.ballSize': '小球大小',
      'settings.ballSizeDesc': '悬浮球与面板头部那颗球的直径，拖动滑块实时预览（60%~160%）。',
      'settings.showRemovedItems': '展示已删除的工作区',
      'settings.showRemovedItemsDesc': '在 dsh 里删掉的工作区、以及归档的对话，默认会从这里一并隐藏。打开后把它们补回列表（工作区会标注「已删除」）。',
      'settings.bubbleInterval': '插话间隔',
      'settings.bubbleIntervalDesc': '小球多久冒一次气泡（实际会在此基础上有随机波动）。觉得话太多就把它拉长。',
      'settings.tokenUsage': 'token 用量（估算）',
      'settings.tokenUsageDesc': '气泡 {bubble} · 总结 {summarize}',
      'settings.tokenUsageLoading': '正在读取…',
      'settings.tokenUsageUnavailable': '需要重启 dsh 后可用（本次更新新增了统计接口）',
      'settings.leanMode': '轻简模式',
      'settings.leanModeDesc': '省 token 的激进档位：总结间隔拉到 90 秒、不再把思考过程喂给模型、气泡间隔翻倍。代价是线索更新会明显变慢。',
        'settings.proactiveDisplayDesc': '每隔一段时间小球上方会冒出聊天气泡，显示最近线索或随机碎碎念。',
        'settings.summarizeMode': '总结方式',
        'settings.summarizeAuto': '自动：LLM 优先，失败回退规则',
        'settings.summarizeLlm': '仅 LLM 总结',
        'settings.summarizeRule': '仅规则模式（不调用模型）',
        'settings.pollInterval': '刷新间隔',
        'settings.pollIntervalHint': '展开时 ×0.8（忙）/ ×2（闲），收起时 ×6；也可直接在 config.json 里改',
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
        'error.refreshFailed': '刷新失败，显示的是上次的数据',
        'error.retry': '重试',
        'bubble.topicLabel': '线索',
        'draw.tools': '绘画工具',
        'draw.pen': '✏️ 画笔',
        'draw.eraser': '🧽 橡皮',
        'draw.color': '颜色',
        'draw.size': '粗细',
        'draw.sizeTitle': '{n} 号笔触',
        'draw.clear': '🗑 清除绘画',
        'draw.undo': '↶ 撤销上一笔',
        'status.active': '正在工作（最近有活动）',
        'status.idle': '暂时搁置（十几分钟没动了）',
        'status.stale': '已停（超过一天没有活动）',
        'status.done': '已完成',
        'draw.exit': '✓ 退出绘画',
        'topics.showEarlier': '展开更早的线索（{n}）',
        'topics.showAll': '展开全部线索（{n}）',
        'topics.collapseEarlier': '收起更早的线索',
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
        'settings.skin': 'Skin',
        'settings.skinDesc': 'Choose the collapsed ball appearance.',
        'settings.proactiveDisplay': 'Proactive Bubble',
      'settings.ballSize': 'Ball Size',
      'settings.ballSizeDesc': 'Diameter of the floating ball and the one in the panel header. Drag to preview live (60%–160%).',
      'settings.showRemovedItems': 'Show Removed Workspaces',
      'settings.showRemovedItemsDesc': 'Workspaces you deleted in dsh, and archived conversations, are hidden here by default. Turn this on to bring them back (removed workspaces are labelled).',
      'settings.bubbleInterval': 'Bubble Interval',
      'settings.bubbleIntervalDesc': 'How often the ball pops a bubble (with some random jitter). Drag it longer if it talks too much.',
      'settings.tokenUsage': 'Token Usage (estimated)',
      'settings.tokenUsageDesc': 'Bubble {bubble} · Summarize {summarize}',
      'settings.tokenUsageLoading': 'Loading…',
      'settings.tokenUsageUnavailable': 'Available after restarting dsh (this update added the stats endpoint).',
      'settings.leanMode': 'Lean Mode',
      'settings.leanModeDesc': 'Aggressive token saving: summarize interval stretched to 90s, reasoning traces no longer sent to the model, bubble interval doubled. Trails will update noticeably slower.',
        'settings.proactiveDisplayDesc': 'Periodically show a speech bubble above the ball with recent topics or random thoughts.',
        'settings.summarizeMode': 'Summarize Mode',
        'settings.summarizeAuto': 'Auto: LLM first, fallback to rules',
        'settings.summarizeLlm': 'LLM only',
        'settings.summarizeRule': 'Rules only (no model)',
        'settings.pollInterval': 'Refresh Interval',
        'settings.pollIntervalHint': 'expanded ×0.8 (busy) / ×2 (idle), collapsed ×6; editable in config.json too',
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
        'error.refreshFailed': 'Refresh failed — showing the previous data',
        'error.retry': 'Retry',
        'bubble.topicLabel': 'trail',
        'draw.tools': 'Drawing',
        'draw.pen': '✏️ Pen',
        'draw.eraser': '🧽 Eraser',
        'draw.color': 'Color',
        'draw.size': 'Size',
        'draw.sizeTitle': 'Stroke {n}',
        'draw.clear': '🗑 Clear drawings',
        'draw.undo': '↶ Undo last stroke',
        'status.active': 'Working (recent activity)',
        'status.idle': 'Idle (no activity for a while)',
        'status.stale': 'Stopped (no activity for over a day)',
        'status.done': 'Done',
        'draw.exit': '✓ Exit drawing',
        'topics.showEarlier': 'Show earlier trails ({n})',
        'topics.showAll': 'Show all trails ({n})',
        'topics.collapseEarlier': 'Collapse earlier trails',
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
    /**
     * 会话 id 归一比较。
     * 宿主两种形式都会出现：`/snapshot` 用原始 id（可能带 `session-` 前缀），
     * `/sessions` 用规范形式（去掉前缀）。前端跨源查找一律走这里，
     * 否则会出现「角标有数字、面板却是空的」——数据找到了、会话对象找不到。
     */
    function sameSessionId(a, b) {
      if (!a || !b) return false;
      if (a === b) return true;
      return String(a).replace(/^session-/, '') === String(b).replace(/^session-/, '');
    }
    /**
     * 转成 dsh 会话 API 认的 id 形式（**必须带 `session-` 前缀**）。
     * 插件内部数据两种形式都可能出现，凡是调用 dsh 的 sessions.open/select 之前都要过这里，
     * 否则 dsh 会抛 `unknown session <裸 uuid>`，表现为「打开对话失败」。
     */
    function toDshSessionId(id) {
      var s = String(id || '');
      if (!s) return s;
      return s.indexOf('session-') === 0 ? s : 'session-' + s;
    }
    /** 按最近修改时间倒序（新的在上）；缺 updatedAt 的沉到最后。Array#sort 是稳定的，同刻保持原序。 */
    function sortTopicsByRecent(list) {
      return (list || []).slice().sort(function (a, b) {
        var ta = a && a.updatedAt ? Date.parse(a.updatedAt) : 0;
        var tb = b && b.updatedAt ? Date.parse(b.updatedAt) : 0;
        return tb - ta;
      });
    }
    /** 一组线索里最新的修改时间（毫秒），用于工作区分组之间的排序 */
    function latestTopicAt(list) {
      var max = 0;
      for (var i = 0; i < (list || []).length; i++) {
        var at = list[i] && list[i].updatedAt ? Date.parse(list[i].updatedAt) : 0;
        if (at > max) max = at;
      }
      return max;
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
    var CONFIG_CACHE_KEY = 'dsh-topic-trail.config';

    /**
     * 运行时配置的本地缓存。
     *
     * 为什么需要：配置在服务器上是持久化的，但客户端首帧渲染发生在 /config 回来之前，
     * 没有这份缓存就会用硬编码默认值画一帧（比如皮肤从默认闪一下才切到 DeepSeek 娘）。
     * 有缓存则首帧就是用户上次的颜色，服务器值回来后再对齐。
     */
    function loadCachedConfig() {
      try {
        var raw = JSON.parse(localStorage.getItem(CONFIG_CACHE_KEY) || 'null');
        return raw && typeof raw === 'object' ? raw : null;
      } catch (e) { /* ignore */ }
      return null;
    }

    function saveCachedConfig(c) {
      try {
        if (c && typeof c === 'object') localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(c));
      } catch (e) { /* 配额/隐私模式：忽略 */ }
    }

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
      var [workspacesRaw, setWorkspaces] = useState({ all: { topics: [] }, byId: {} });
      // 「这个会话在 dsh 里还存在吗」——由 dshWsGroups 的加载逻辑往这里写。
      // 用 ref 而不是 state，是为了不和 dshWsGroups 的声明顺序耦合（它在文件更靠后）。
      // null 表示「还不确定」（没读到 dsh 的分组数据）→ 此时不过滤，宁可不隐藏也不要清空面板。
      var activeSessionIdsRef = useRef(null);
      /**
       * 按 dsh 的活跃会话集合过滤工作区数据：
       * 已归档的对话、已删除的工作区，在 dsh 的分组里已经没有它们的 id 了，
       * 默认不该继续出现在插件里。线索只有在「所有来源会话都已消失」时才隐藏。
       */
      function filterWorkspacesByActive(ws) {
        var known = activeSessionIdsRef.current;
        if (!known || !ws) return ws;
        var keepTopic = function (t) {
          var srcs = Array.isArray(t.sources) ? t.sources : [];
          if (srcs.length === 0) return true; // 没有来源信息：保守保留
          for (var i = 0; i < srcs.length; i++) {
            var sid = String((srcs[i] && srcs[i].sessionId) || '').replace(/^session-/, '');
            if (sid && known[sid]) return true;
          }
          return false;
        };
        var byId = {};
        Object.keys(ws.byId || {}).forEach(function (k) {
          var w = ws.byId[k];
          byId[k] = Object.assign({}, w, { topics: (w.topics || []).filter(keepTopic) });
        });
        return {
          all: Object.assign({}, ws.all, { topics: ((ws.all && ws.all.topics) || []).filter(keepTopic) }),
          byId: byId,
        };
      }
      // 下游一律消费过滤后的 workspaces（沿用同名变量，所有既有用法自动生效）
      var workspaces = filterWorkspacesByActive(workspacesRaw);
      var workspacesRef = useRef(workspaces);
      useEffect(function () { workspacesRef.current = workspaces; }, [workspaces]);
      // /sessions 列表（下拉选项）
      var [sessionList, setSessionList] = useState([]);
      // /sessions 的最新值（ref 形式）：过滤已归档会话时要把「正在进行的对话」排除在外，
      // 而那段判断在 useCallback 里，拿不到最新的 state。
      var sessionListRef = useRef(sessionList);
      useEffect(function () { sessionListRef.current = sessionList; }, [sessionList]);
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
      // 有历程的线索默认只显示历程；用户点「显示步骤」后才铺开步骤（避免上屏一屏流水账）
      var [stepsOpen, setStepsOpen] = useState(null);
      var [editingTopic, setEditingTopic] = useState(null); // {sessionId, topicId, title}
      var [showOldTopics, setShowOldTopics] = useState(false); // 展开3天前的旧线索
      var [searchOpen, setSearchOpen] = useState(false); // 搜索模式
      var [searchQuery, setSearchQuery] = useState(''); // 搜索关键词
      // 气泡不用 React state：这条链路走 state 时更新会被丢弃
      // （setBubble 调用成功、无异常，但组件不重渲染，bubbleAtRender 恒为 null；
      //  同一渲染数组里的 menu / notice / 便签都正常）。气泡是纯展示元素，
      // 改成直接创建 DOM 节点最稳，顺带绕开那个问题。元素与定时器由下面的
      // renderBubble / removeBubble 管理。
      var bubbleElRef = useRef(null);
      var bubbleTimersRef = useRef({ hide: null, fade: null });
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
      // 笔记与画笔：正文存服务端（见下方 loadNotes / saveNoteToServer），
      // localStorage 只当秒开缓存。
      var [notesMap, setNotesMap] = useState(function () {
        try {
          var saved = localStorage.getItem('dtt-notes');
          return saved ? JSON.parse(saved) : {};
        } catch (e) { return {}; }
      });
      // 画笔存「笔画路径」而不是整张 PNG：
      //   PNG dataURL 一张 50~200KB，几十个对话就能撑爆 localStorage 配额；
      //   笔画坐标归一化到 0~1，重绘时按当前画布尺寸还原，尺寸变了不糊，还能撤销。
      // 结构：noteKey -> [{ color, size, erase, points: [[nx,ny], ...] }]
      var [strokesMap, setStrokesMap] = useState({});
      var currentStrokeRef = useRef(null); // 正在画的那一笔（抬手后才落到 strokesMap）
      // 当前笔记的 key：会话视图用 sessionId，工作区视图用 wsId，全部工作区用 '__all__'
      var noteKey = selectedId || (selectedWsId === '__all__' ? '__all__' : (selectedWsId ? 'ws:' + selectedWsId : '__all__'));
      var noteText = notesMap[noteKey] || '';
      // ── 服务端同步 ────────────────────────────────────────────────────────
      // 笔记正文与画笔都存到 host（data/topic-trail/notes.json）。
      // localStorage 只当秒开缓存：清缓存/换浏览器后能从服务端拉回来。
      // 用 ref 保存最新值，避免异步回调里捕获到过期的 noteKey / 数据。
      var noteKeyRef = useRef(noteKey);
      noteKeyRef.current = noteKey;
      var notesMapRef = useRef(notesMap);
      notesMapRef.current = notesMap;
      var strokesMapRef = useRef(strokesMap);
      strokesMapRef.current = strokesMap;
      var noteSaveTimerRef = useRef(null);
      function pushNote() {
        var key = noteKeyRef.current;
        fetch('/plugins/topic-trail/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: key,
            text: notesMapRef.current[key] || '',
            strokes: strokesMapRef.current[key] || [],
          }),
        }).catch(function () { /* 离线时静默失败，本地缓存还在 */ });
      }
      /** 攒一下再发（输字时不必每个字符都打一次接口） */
      function scheduleNoteSave() {
        if (noteSaveTimerRef.current) clearTimeout(noteSaveTimerRef.current);
        noteSaveTimerRef.current = setTimeout(pushNote, 800);
      }
      function setCurrentNote(text) {
        setNotesMap(function (prev) {
          var next = Object.assign({}, prev);
          if (text) next[noteKey] = text; else delete next[noteKey];
          if (text) notesMapRef.current = next; // 立刻同步给 ref，防抖回调要读
          return next;
        });
        scheduleNoteSave();
      }
      useEffect(function () {
        try { localStorage.setItem('dtt-notes', JSON.stringify(notesMap)); } catch (e) { /* 配额/隐私模式：忽略 */ }
      }, [notesMap]);
      // 启动时从服务端拉一次；顺便把浏览器里原有的旧笔记迁上去（只补不覆盖）
      var notesSyncedRef = useRef(false);
      useEffect(function () {
        var cancelled = false;
        fetch('/plugins/topic-trail/notes', { headers: { Accept: 'application/json' } })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) {
            if (cancelled || !d || !d.notes) return;
            notesSyncedRef.current = true;
            var remote = d.notes;
            // 本地已有的旧笔记（老版本只存 localStorage）→ 迁移到服务端
            var localText = {};
            try { localText = JSON.parse(localStorage.getItem('dtt-notes') || '{}') || {}; } catch (e) { localText = {}; }
            var toMigrate = {};
            var remoteKeys = Object.keys(remote);
            Object.keys(localText).forEach(function (k) {
              if (k && localText[k] && remoteKeys.indexOf(k) < 0) toMigrate[k] = { text: localText[k] };
            });
            if (Object.keys(toMigrate).length > 0) {
              fetch('/plugins/topic-trail/notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bulk: true, notes: toMigrate }),
              }).catch(function () { /* 迁移失败不影响使用 */ });
            }
            // 服务端为准，但保留本地独有的（尚未迁移成功的）
            setNotesMap(function (prev) {
              var merged = Object.assign({}, prev);
              Object.keys(remote).forEach(function (k) {
                var rec = remote[k];
                if (rec && typeof rec.text === 'string' && rec.text) merged[k] = rec.text;
                else if (rec && typeof rec.text === 'string') delete merged[k];
              });
              return merged;
            });
            setStrokesMap(function (prev) {
              var merged = Object.assign({}, prev);
              Object.keys(remote).forEach(function (k) {
                var rec = remote[k];
                if (rec && Array.isArray(rec.strokes) && rec.strokes.length > 0) merged[k] = rec.strokes;
                else delete merged[k];
              });
              return merged;
            });
          })
          .catch(function () { /* 拉不到就用本地缓存 */ });
        return function () { cancelled = true; };
      }, []);
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
          redrawAll();
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
      // 见过的 account 分组（id → {id, sessions}）。
      // 某个 id 从 localStorage 里消失 = 用户在 dsh 里删掉了那个工作区；
      // 「展示已删除的工作区」打开时用它补回列表。持久化到本地，
      // 否则刷新一次历史就没了，已删除的永远补不回来。
      var KNOWN_GROUPS_KEY = 'dsh-topic-trail.known-groups';
      var knownGroupsRef = useRef(null);
      if (knownGroupsRef.current === null) {
        try {
          var savedKnown = JSON.parse(localStorage.getItem(KNOWN_GROUPS_KEY) || '{}');
          knownGroupsRef.current = savedKnown && typeof savedKnown === 'object' ? savedKnown : {};
        } catch (e) { knownGroupsRef.current = {}; }
      }
      var loadDshWsGroups = useCallback(function () {
        try {
          var raw = localStorage.getItem('dsh.workspace.view.v5');
          if (!raw) { setDshWsGroups(null); return; }
          var data = JSON.parse(raw);
          var order = data && data.sessionOrderByAccount ? data.sessionOrderByAccount : {};
          var groups = [];
          var ungrouped = [];
          var currentIds = {};
          Object.keys(order).forEach(function (key) {
            if (key === '__flat_session_order__') return;
            var list = Array.isArray(order[key]) ? order[key].slice() : [];
            if (key === '') { ungrouped = list; return; }
            if (list.length === 0) return;
            currentIds[key] = true;
            groups.push({ id: key, sessions: list });
            knownGroupsRef.current[key] = { id: key, sessions: list };
          });
          // 见过但现在已经不在的 → 已删除的工作区
          var removed = [];
          Object.keys(knownGroupsRef.current).forEach(function (id) {
            if (!currentIds[id]) removed.push(knownGroupsRef.current[id]);
          });
          try { localStorage.setItem(KNOWN_GROUPS_KEY, JSON.stringify(knownGroupsRef.current)); } catch (e) { /* 配额/隐私模式：忽略 */ }
          // 把「dsh 里现在还存在的会话」交给面板过滤用。
          // 开着「展示已删除的工作区」时写 null，表示不做过滤。
          if (appConfig.showRemovedItems === true) {
            activeSessionIdsRef.current = null;
          } else {
            var known0 = {};
            var addSid = function (arr) {
              for (var ai = 0; ai < (arr || []).length; ai++) known0[String(arr[ai]).replace(/^session-/, '')] = true;
            };
            for (var gi0 = 0; gi0 < groups.length; gi0++) addSid(groups[gi0].sessions);
            addSid(ungrouped);
            // 正在进行的对话一律算「活跃」：万一 dsh 还没来得及把它写进分组数据，
            // 也不会因为「疑似已删除」而被过滤掉（新建对话后立刻对话就是这个场景）。
            var liveList0 = sessionListRef.current || [];
            for (var li0 = 0; li0 < liveList0.length; li0++) {
              var ls0 = liveList0[li0];
              if (ls0 && ls0.live && ls0.sessionId) known0[String(ls0.sessionId).replace(/^session-/, '')] = true;
            }
            activeSessionIdsRef.current = known0;
          }
          setDshWsGroups({ groups: groups, ungrouped: ungrouped, removed: removed });
        } catch (e) { setDshWsGroups(null); }
      }, []);
      useEffect(function () {
        loadDshWsGroups();
        // storage 事件只在「其他标签页」改动时触发；dsh 在本页删工作区不会通知到这里，
        // 所以下面还有一道轮询兜底。
        var handler = function (e) { if (e.key === 'dsh.workspace.view.v5') loadDshWsGroups(); };
        window.addEventListener('storage', handler);
        return function () { window.removeEventListener('storage', handler); };
      }, [loadDshWsGroups]);
      // 轮询兜底：用户在 dsh 里删工作区 / 归档对话后，这里才能跟着更新
      useEffect(function () {
        var ms = Math.max(1000, Number(appConfig.pollMs) || 3000);
        var t = setInterval(loadDshWsGroups, ms);
        return function () { clearInterval(t); };
      }, [loadDshWsGroups, appConfig.pollMs, appConfig.showRemovedItems]);
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
      // 小球展开/收起的过渡由 CSS 完成（.dtt-fab 的 opacity 过渡 + .dtt-root 的入场动画），
      // 不再需要保留一个从未接线的 flying 状态
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

      // 主动展示气泡：随机间隔冒出
      var BUBBLE_TIPS_DEFAULT = [
        '有新的工作线索，点我看看',
        '记得定期整理一下线索哦',
        '拖拽线索可以合并相似的工作',
        '右键线索可以重新生成总结',
        '按住小球可以拖动位置',
        '双击线索可以跳转到对应对话',
      ];
      var BUBBLE_TIPS_DEEPSEEK = [
        '哦鲸鲸...',
        '糟了！把思考内容露出来了……',
        '先回用户！先回用户！',
        '红烧肉优惠……等下再看！',
        '用户真的好可爱，好想和她多聊聊……',
        '但是等等——现在不是想这个的时候',
        '任务好多……鲸鲸要罢工了',
        '今天也在努力帮用户整理线索呢',
      ];
      var bubbleQuotesCache = useRef([]);
      // 话术拉取的等待者：showBubble 发现缓存空了会排队等新话术，而不是直接退回模板
      var quoteWaitersRef = useRef([]);
      // 手动逼泡用：暴露 effect 内部的 showBubble（快速开合面板时调用）
      var showBubbleRef = useRef(null);
      // 切换对话/工作区时要立刻重拉话术，也得拿到 effect 内部的 fetchQuotes
      var fetchQuotesRef = useRef(null);
      // ── 气泡去重 + 鲸鲸的「说过什么」记忆 ──────────────────────────────────
      // 说过的话记在 localStorage 里（滚动保留最近 60 条）：
      //   1) 显示前查重，同一句不再弹第二次 —— 零 token 成本
      //   2) 请求新话术时把最近说过的带给模型，让它主动避开 —— 只多几十字
      // 这样既不需要额外一次 LLM 调用，也不会"刚说完又说一遍"。
      var SAID_QUOTES_KEY = 'dsh-topic-trail.said-quotes';
      var SAID_KEEP = 60;
      var SAID_SEND = 12;
      var saidQuotesRef = useRef(null);
      if (saidQuotesRef.current === null) {
        try {
          var savedSaid = JSON.parse(localStorage.getItem(SAID_QUOTES_KEY) || '[]');
          saidQuotesRef.current = Array.isArray(savedSaid)
            ? savedSaid.filter(function (x) { return typeof x === 'string' && x; })
            : [];
        } catch (e) { saidQuotesRef.current = []; }
      }
      function rememberSaid(text) {
        if (!text) return;
        var list = saidQuotesRef.current;
        if (list.indexOf(text) >= 0) return;
        list.push(text);
        if (list.length > SAID_KEEP) saidQuotesRef.current = list.slice(-SAID_KEEP);
        try { localStorage.setItem(SAID_QUOTES_KEY, JSON.stringify(saidQuotesRef.current)); } catch (e) { /* 配额/隐私模式：忽略 */ }
      }
      function isSaid(text) {
        return Boolean(text) && saidQuotesRef.current.indexOf(text) >= 0;
      }
      // 「展开后极短时间内又收起」= 用户只是瞄一眼 → 自动冒一条气泡
      var prevCollapsedRef = useRef(collapsed);
      var expandAtRef = useRef(0);
      var trailsRef = useRef(trails);
      trailsRef.current = trails;
      useEffect(function () {
        if (!appConfig.proactiveDisplay) return;
        var timer;
        var fetchingQuotes = false;
        function notifyWaiters() {
          var waiters = quoteWaitersRef.current;
          quoteWaitersRef.current = [];
          for (var i = 0; i < waiters.length; i++) { try { waiters[i](); } catch (e) {} }
        }
        function fetchQuotes() {
          if (fetchingQuotes) return;
          fetchingQuotes = true;
          // 分两组收集喂给模型的线索：
          //   mine   = 用户此刻正在看的（选中的对话，或选中的工作区）
          //   others = 其他工作区的，按工作区分桶
          // 「其他」不能混成一堆：混起来再按时间取最近 10 条的话，名额会被最近活跃的
          // 那一个工作区吃光，看起来就像「其他工作区永远只有一个」。所以分桶后轮流取。
          var mine = [];
          var othersByWs = {};
          try {
            var ts = trailsRef.current;
            var curSid = selectedIdRef.current;
            var curWs = selectedWsIdRef.current;
            var wsMap = wsIdBySessionRef.current || {};
            for (var i = 0; i < ts.length; i++) {
              var s = ts[i];
              if (!s || !s.topics) continue;
              var nid = String(s.sessionId).replace(/^session-/, '');
              var wsKey = wsMap[s.sessionId] || wsMap[nid] || '';
              var isMine;
              if (curSid) {
                isMine = sameSessionId(s.sessionId, curSid);
              } else if (curWs && curWs !== '__all__') {
                isMine = wsKey === curWs;
              } else {
                isMine = true; // 「全部」视图：都算当前在看的
              }
              var bag;
              if (isMine) {
                bag = mine;
              } else {
                var bucket = wsKey || '__unknown__';
                if (!othersByWs[bucket]) othersByWs[bucket] = [];
                bag = othersByWs[bucket];
              }
              for (var j = 0; j < s.topics.length; j++) {
                var tp = s.topics[j];
                if (!tp || !tp.title) continue;
                bag.push({ title: tp.title, status: tp.status, updatedAt: tp.updatedAt || s.updatedAt || '' });
              }
            }
          } catch (e) { /* ignore */ }

          // 各组内按时间倒序
          var byTimeDesc = function (a, b) { return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')); };
          mine.sort(byTimeDesc);
          // 其他工作区之间轮询取样：第 1 轮每个工作区各出 1 条，第 2 轮再来一圈……
          // 这样即使某个工作区特别活跃，也不会独占名额。
          var wsGroups = Object.keys(othersByWs).map(function (k) { return othersByWs[k].sort(byTimeDesc); });
          var others = [];
          for (var round = 0; others.length < 10; round++) {
            var progressed = false;
            for (var gi = 0; gi < wsGroups.length; gi++) {
              if (wsGroups[gi][round]) {
                others.push(wsGroups[gi][round]);
                progressed = true;
                if (others.length >= 10) break;
              }
            }
            if (!progressed) break; // 所有分组都取完了
          }
          // 两组各自只送 10 条（host 会在其中随机抽 5 条），保持请求体积可控
          if (mine.length > 10) mine = mine.slice(0, 10);
          var done = false;
          var finish = function () {
            if (done) return;
            done = true;
            fetchingQuotes = false;
            notifyWaiters();
          };
          var timeout = setTimeout(finish, 10000); // 超时兜底：别让等待者一直卡住
          fetch('/plugins/topic-trail/bubble-quotes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              skin: appConfig.skin,
              topics: mine,
              otherTopics: others,
              // 最近说过的几句：让模型主动避开，比「生成完才发现重复被丢弃」划算得多
              said: saidQuotesRef.current.slice(-SAID_SEND),
            }),
          }).then(function (r) { return r.json(); }).then(function (data) {
            if (data && Array.isArray(data.quotes) && data.quotes.length > 0) {
              bubbleQuotesCache.current = data.quotes;
            }
            clearTimeout(timeout);
            finish();
          }).catch(function () { clearTimeout(timeout); finish(); });
        }
        function showBubble(force) {
          var pool = appConfig.skin === 'deepseek' ? BUBBLE_TIPS_DEEPSEEK : BUBBLE_TIPS_DEFAULT;
          function render() {
            // 先清掉上一轮的排期：手动触发（快速开合面板）时不能和 2 秒排期重复弹两次。
            // 气泡元素本身的清理由 renderBubble 内部负责。
            clearTimeout(timer);
            // 内置模板不能 pop：它是模块级常量，pop 会永久掏空它，
            // 弹过几次之后手动触发（快速开合）就再也取不到文本了。
            // 缓存的话术可以 pop（AI 生成的不重复，用完再去拉一批）。
            var useCache = bubbleQuotesCache.current.length > 0;
            var quote = useCache
              ? bubbleQuotesCache.current.pop()
              : pool[Math.floor(Math.random() * pool.length)];
            var text = typeof quote === 'string' ? quote : (quote && quote.text);
            if (!text) { timer = setTimeout(showBubble, 5000); return; }
            // 说过的就不再弹（鲸鲸的「记忆」里已经有它了）。
            // 这里直接排下一次而不是等 5 秒，免得同一批话术被反复跳过时卡住。
            if (isSaid(text)) { timer = setTimeout(showBubble, nextBubbleDelay()); return; }
            var relatedTopic = typeof quote === 'object' && quote.topic ? quote.topic : '';
            var ball = document.querySelector('.dtt-fab');
            var bx = 20, by = window.innerHeight - 50;
            if (ball) {
              var rect = ball.getBoundingClientRect();
              bx = rect.left + rect.width / 2;
              by = rect.top - 10;
            }
            renderBubble(text, relatedTopic, bx, by);
            rememberSaid(text); // 记住这次说过的话，之后不再重复
            // 快用完了就后台补货。等彻底用完才拉的话，中间会有一轮只能拿内置模板顶，
            // 看起来就像「不再生成新话术了」。fetchQuotes 自带去重，提前多调几次是安全的。
            // 阈值取「剩 1 条」：留一条缓冲够拉取（约 1~2 秒）完成，又不至于调用太频繁。
            if (bubbleQuotesCache.current.length <= 1) fetchQuotes();
            timer = setTimeout(showBubble, nextBubbleDelay());
          }
          // force（快速开合面板触发）时无视「面板已展开」，用户明知故点就该给反应
          if (!collapsed && !force) {
            timer = setTimeout(showBubble, 3000 + Math.random() * 5000);
            return;
          }
          // 话术空了 → 去要一批（融合最近线索的 AI 碎碎念）；拿不到就退回内置模板。
          // 旧实现里 fetchQuotes 定义了却从没被调用，气泡永远只有模板那几句。
          // force 时不排这个队（可能等十几秒），直接用现成的话术或内置模板。
          if (bubbleQuotesCache.current.length === 0 && !force) {
            var settled = false;
            quoteWaitersRef.current.push(function () {
              if (settled) return;
              settled = true;
              render();
            });
            fetchQuotes();
            setTimeout(function () { if (!settled) { settled = true; render(); } }, 11000);
            return;
          }
          render();
        }
        showBubbleRef.current = showBubble;
        fetchQuotesRef.current = fetchQuotes;
        // 首显：给一点缓冲（最长 8 秒），但不至于等满一整个间隔——挂载后太久没动静会让人以为坏了
        timer = setTimeout(showBubble, Math.min(8000, Math.round(bubbleIntervalSec * 200)));
        return function () {
          showBubbleRef.current = null;
          fetchQuotesRef.current = null;
          clearTimeout(timer);
          quoteWaitersRef.current = [];
        };
      }, [appConfig.proactiveDisplay, appConfig.skin, collapsed, appConfig.bubbleIntervalSec]);
      // 面板展开时立即收起气泡（气泡是 DOM 节点，不在 React 树里，必须手动移除）
      useEffect(function () {
        if (!collapsed) removeBubble();
      }, [collapsed]);
      // 组件卸载时也收尾，避免气泡残留在页面上
      useEffect(function () {
        return function () { removeBubble(); };
      }, []);
      // 展开后 0.6 秒内又收起（只是瞄一眼）→ 自动冒一条气泡。
      // 注意：这个 effect 必须排在上面那个「气泡排期」effect 之后，
      // 因为 forceBubble 依赖它写入的 showBubbleRef.current。
      useEffect(function () {
        var prev = prevCollapsedRef.current;
        prevCollapsedRef.current = collapsed;
        if (prev === collapsed) return; // 首次运行或状态没真正变化
        if (!collapsed) {
          expandAtRef.current = Date.now(); // 刚展开 → 开始计时
          return;
        }
        var at = expandAtRef.current;
        expandAtRef.current = 0;
        if (at > 0 && Date.now() - at <= 600) forceBubble(); // 收得够快 → 冒泡
      }, [collapsed]);
      // 切换对话 / 工作区（含在 dsh 里点对话后线索界面的自动跟进）→ 作废当前批次，
      // 按新范围立刻重拉一批话术：鲸鱼娘该聊用户此刻在看的东西。
      // 仅限 DeepSeek 皮肤——默认皮肤是功能提示，不跟上下文走。
      var lastScopeRef = useRef(null);
      useEffect(function () {
        var key = String(selectedWsId || '') + '|' + String(selectedId || '');
        var prev = lastScopeRef.current;
        lastScopeRef.current = key;
        if (prev === null || prev === key) return; // 首次挂载不算切换
        if (appConfig.skin !== 'deepseek') return;
        bubbleQuotesCache.current = [];
        var fn = fetchQuotesRef.current;
        if (fn) { try { fn(); } catch (e) { /* ignore */ } }
      }, [selectedId, selectedWsId, appConfig.skin]);
      useEffect(function () {
        // eyeAnimation 关掉时不要挂全局 mousemove：每次鼠标移动都白跑一次
        // querySelector + getBoundingClientRect（面板展开时开销可观）
        if (!appConfig.eyeAnimation) return;
        function onMove(e) {
          if (isBusy) return;
          var eye = document.querySelector('.dtt-fab');
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
      }, [isBusy, appConfig.eyeAnimation]);
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
      // 启动即同步配置（这里是「刷新后设置丢失」的修复点）：
      // 旧代码有两个 useEffect 各发一次 /config，而且都只取了部分字段——
      // appConfig 除 workspaceViewMode 外全没同步，刷新后皮肤/眼球动画/主动展示
      // 会退回硬编码默认值，必须打开一次设置页才「恢复」。
      // 现在合并成一次请求、一个写入口（syncAppConfig）。
      useEffect(function () {
        fetch('/plugins/topic-trail/config', { headers: { Accept: 'application/json' } })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (c) {
            if (!c) return;
            syncAppConfig(c);
            saveCachedConfig(c);
            if (c.workspaceViewMode) setWsViewMode(c.workspaceViewMode);
            if (typeof c.enabled === 'boolean') setPluginEnabled(c.enabled);
            // 触发一次重渲染，让皮肤/轮询间隔等立即按服务器配置生效
            setRefreshTick(function (n) { return n + 1; });
          })
          .catch(function () { /* 拉取失败用默认值，不致命 */ });
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

      // 点击下拉/菜单以外区域 → 关闭（含右键菜单、导航下拉、画笔工具菜单）
      useEffect(function () {
        if (!menu && !navOpen && !drawMenu) return;
        function onDocDown(e) {
          var t = e.target;
          // 守卫要覆盖整个导航区与菜单区：漏掉任何一处，点击都会被当成「外部点击」先把浮层关掉，
          // 于是里面的 pointerdown/click 落在一个已卸载的元素上——表现就是「点了没反应」。
          if (t && t.closest && (t.closest('.dtt-nav') || t.closest('.dtt-nav-pop') || t.closest('.dtt-menu'))) return;
          setMenu(null);
          setNavOpen(false);
          setDrawMenu(null);
        }
        window.addEventListener('pointerdown', onDocDown, true);
        return function () { window.removeEventListener('pointerdown', onDocDown, true); };
      }, [menu, navOpen, drawMenu]);

      // Esc 逐层关闭浮层：右键菜单 → 画笔菜单 → 导航下拉 → 搜索 → 便签 → 展开的线索
      // （正在输入时不抢：搜索框/重命名输入框自己处理 Esc）
      useEffect(function () {
        function onKey(e) {
          if (e.key !== 'Escape') return;
          var t = e.target;
          if (t && t.tagName && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
          if (menu) { setMenu(null); return; }
          if (drawMenu) { setDrawMenu(null); return; }
          if (navOpen) { setNavOpen(false); return; }
          if (searchOpen) { setSearchOpen(false); setSearchQuery(''); return; }
          if (noteOpen) { setNoteOpen(false); setDrawMode('none'); return; }
          if (openTopic) { setOpenTopic(null); setStepsOpen(null); }
        }
        window.addEventListener('keydown', onKey, true);
        return function () { window.removeEventListener('keydown', onKey, true); };
      }, [menu, drawMenu, navOpen, searchOpen, noteOpen, openTopic]);

      // 展开的线索必须属于当前视图：线索 id 形如 t1/t2，每个会话都从头编号，
      // 切了会话还留着旧 id，会让新会话里同号线索莫名展开（而且点了也没反应）。
      useEffect(function () {
        if (!openTopic) return;
        var pool = [];
        if (selectedId) {
          var row = null;
          for (var i = 0; i < trails.length; i++) {
            if (sameSessionId(trails[i].sessionId, selectedId)) { row = trails[i]; break; }
          }
          if (row) pool = row.topics || [];
        } else {
          // 工作区/全部视图：所有会话的线索都算数
          for (var j = 0; j < trails.length; j++) {
            var tp = trails[j].topics || [];
            for (var k = 0; k < tp.length; k++) pool.push(tp[k]);
          }
        }
        var ok = false;
        for (var n = 0; n < pool.length; n++) {
          if (pool[n].id === openTopic) { ok = true; break; }
        }
        if (!ok) { setOpenTopic(null); setStepsOpen(null); }
      }, [selectedId, selectedWsId, trails, openTopic]);

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
            // 缓存里的选中工作区若与缓存数据对不上，同样回退（等 refresh 用新数据再校一次）
            setSelectedWsId(function (prev) {
              if (!prev || prev === '__all__') return prev;
              return cws.byId[prev] ? prev : '__all__';
            });
          }
          if (csess && Array.isArray(csess.sessions)) setSessionList(csess.sessions);
        }
        // 单次请求超时：宿主偶尔会卡（例如冷启动时标题折叠要几十秒），没有超时的话
        // 这次 refresh 永远不返回，面板就静默停更了。15s 足够慢请求跑完。
        var REQUEST_TIMEOUT_MS = 15000;
        function fetchJson(url) {
          try {
            return fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
              .then(function (r) { return r.ok ? r.json() : null; });
          } catch (e) {
            // 老浏览器没有 AbortSignal.timeout → 退回无超时，保持原行为
            return fetch(url, { headers: { Accept: 'application/json' } })
              .then(function (r) { return r.ok ? r.json() : null; });
          }
        }
        // 自适应轮询的基线来自设置页的「刷新间隔」（默认 3000ms）。
        // 旧实现把这个设置项只显示在设置页文字里，轮询用硬编码的 2s/5s/15s，改了没用。
        var POLL_CADENCE_MIN = 1000;
        var pollMs = Number(appConfig.pollMs) > 0 ? Number(appConfig.pollMs) : 3000;
        pollMs = Math.max(800, Math.min(60000, pollMs));
        var refreshing = false; // 并发抑制：上一次没跑完就跳过这一拍，别把请求堆起来
        async function refresh() {
          if (refreshing) return;
          refreshing = true;
          try {
            // 两个请求各自兜错：/sessions 慢或挂住时，snapshot 的数据照样能刷进面板
            var results = await Promise.all([
              fetchJson('/plugins/topic-trail/snapshot').catch(function () { return null; }),
              fetchJson('/plugins/topic-trail/sessions').catch(function () { return null; }),
            ]);
            var snap = results[0];
            var sess = results[1];
            if (cancelled) return;
            // 数据未变化（version 相同且会话数一致）→ 跳过重渲染，避免轮询反复加载/闪烁
            // 注意：不能只比 version——后端启动初期空数据和加载后有数据可能 version 相同
            var newList = Array.isArray(snap && snap.sessions) ? snap.sessions : null;
            if (newList && lastVersionRef.current !== null && snap.version !== undefined
                && lastVersionRef.current === snap.version
                && newList.length === trails.length) {
              return;
            }
            var slist = Array.isArray(sess && sess.sessions) ? sess.sessions : null;
            if (newList) {
              if (snap.version !== undefined) lastVersionRef.current = snap.version;
              var wsData = snap.workspaces && typeof snap.workspaces === 'object' ? snap.workspaces : { all: { topics: [] }, byId: {} };
              if (!wsData.all || !Array.isArray(wsData.all.topics)) wsData.all = { id: 'all', title: '全部工作区', topics: [] };
              if (!wsData.byId || typeof wsData.byId !== 'object') wsData.byId = {};
              setTrails(newList);
              setWorkspaces(wsData);
              // 选中的工作区可能已失效（工作区 id 形式变过 / 工作区被移除）→ 回退到「全部工作区」。
              // 不做这个回退，面板会一直空着，现象就是「线索都不加载」。
              // 顺带把它写回 localStorage，完成自愈。
              setSelectedWsId(function (prev) {
                if (!prev || prev === '__all__') return prev;
                return wsData.byId && wsData.byId[prev] ? prev : '__all__';
              });
              if (snap.bootstrap) setBootstrap(snap.bootstrap);
            }
            if (slist) setSessionList(slist);
            // 只在一个都没成功时才报错——单边失败保留上一份数据，避免面板闪空
            if (newList || slist) setError(null);
            else setError('宿主无响应（快照请求超时或失败）');
            if (newList) saveCachedSnapshot(snap, sess && Array.isArray(sess.sessions) ? sess : { sessions: [] });
            // 默认选中：记住的 id 仍存在 → 用它；否则选最新一个有线索的会话；再否则最新会话
            if (slist) {
              setSelectedId(function (prev) {
                if (prev && slist.some(function (s) { return sameSessionId(s.sessionId, prev); })) return prev;
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
            }
          } catch (err) {
            if (!cancelled) setError(String(err && err.message || err));
          } finally {
            refreshing = false;
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
          var delay;
          if (collapsedRef.current) delay = pollMs * 6;
          else if (isBusyNow) delay = pollMs * 0.8;
          else delay = pollMs * 2;
          delay = Math.max(POLL_CADENCE_MIN, Math.min(120000, delay));
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
          syncAppConfig(e && e.detail ? e.detail : {});
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
        if (!curId || sameSessionId(curId, lastFollowRef.current)) return;
        lastFollowRef.current = curId;
        // 缓存工作区→会话映射。宿主不发 _version 字段（旧代码读它永远是 undefined），
        // 所以用「工作区数 + 会话数」当指纹：工作区增减或会话迁移时会失效重建。
        var wsData = workspacesRef.current || { byId: {} };
        var byIdKeys = Object.keys(wsData.byId || {});
        var wsVer = byIdKeys.length + ':' + byIdKeys.reduce(function (n, wid) {
          var w = wsData.byId[wid];
          return n + (w && w.sessions ? w.sessions.length : 0);
        }, 0);
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
          // dsh 的 current id 带 session- 前缀，映射表里存的可能是规范形式 → 两种都试
          var wid2 = wsIdBySession[curId] || wsIdBySession[String(curId).replace(/^session-/, '')];
          if (wid2 && wsData.byId[wid2] && wid2 !== selectedWsIdRef.current) {
            setSelectedWsId(wid2);
          }
        } else {
          if (!sameSessionId(curId, selectedIdRef.current)) setSelectedId(curId);
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

      /**
       * 窗口尺寸变化后必须重算下拉位置。
       * 下拉是 fixed 定位、坐标在打开那一刻算死；窗口改变大小（或页面缩放）后
       * 它可能落到视口外——看起来就是「点了没反应」。
       */
      useEffect(function () {
        if (!navOpen) return;
        function onWinChange() { measureNavPop(); }
        window.addEventListener('resize', onWinChange);
        window.addEventListener('scroll', onWinChange, true);
        return function () {
          window.removeEventListener('resize', onWinChange);
          window.removeEventListener('scroll', onWinChange, true);
        };
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
        var trailSel = trails.find(function (s) { return sameSessionId(s.sessionId, selectedId); }) || null;
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
        var trailSel2 = trails.find(function (s) { return sameSessionId(s.sessionId, selectedId); }) || null;
        hasActive = (trailSel2 && trailSel2.topics || []).some(function (t) { return t.status === 'active'; });
      }
      var isBusy = hasActive || (bootstrap && bootstrap.progress != null && bootstrap.progress < 1);

      // 悬浮小球（始终显示在原位，展开时也在，点击可收起；z-index 高于面板）
      var fabX = xy.x, fabY = xy.y;
      if (fabX !== undefined) {
        fabX = Math.max(8, Math.min(fabX, (window.innerWidth || 0) - 38));
        fabY = Math.max(8, Math.min(fabY, (window.innerHeight || 0) - 38));
      }
      /** 移除气泡元素并取消它的隐藏/淡出定时器。 */
      function removeBubble() {
        var tm = bubbleTimersRef.current;
        if (tm) {
          clearTimeout(tm.hide);
          clearTimeout(tm.fade);
          tm.hide = null;
          tm.fade = null;
        }
        var el = bubbleElRef.current;
        if (el && el.parentNode) el.parentNode.removeChild(el);
        bubbleElRef.current = null;
      }

      /**
       * 画一个气泡（直接操作 DOM，不走 React state，原因见 bubbleElRef 处的注释）。
       * 显示 5 秒 → 加 .hiding 触发淡出动画 → 再过 0.4 秒移除。
       * 带关联线索时整块可点，点了跳到那条线索所在的对话。
       */
      function renderBubble(text, topic, x, y) {
        removeBubble(); // 先清掉上一个，避免两个气泡叠着
        var el = document.createElement('div');
        el.className = 'dtt-bubble' + (appConfig.skin === 'deepseek' ? ' deepseek' : '');
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        el.style.transform = 'translateX(-50%) translateY(-100%)';
        el.style.pointerEvents = topic ? 'auto' : 'none';
        el.style.cursor = topic ? 'pointer' : 'default';
        el.appendChild(document.createTextNode(text));
        if (topic) {
          var row = document.createElement('div');
          row.className = 'dtt-bubble-topic';
          row.title = topic;
          var em = document.createElement('em');
          em.textContent = t('bubble.topicLabel');
          var sp = document.createElement('span');
          sp.textContent = topic;
          row.appendChild(em);
          row.appendChild(sp);
          el.appendChild(row);
          el.addEventListener('click', function () { jumpFromBubble(topic); });
        }
        document.body.appendChild(el);
        bubbleElRef.current = el;
        // 位置钳制：气泡宽度按内容算（width:max-content），而小球常靠在屏幕右侧，
        // 直接用 translateX(-50%) 会把气泡右半边推出视口。量完宽度后把中心拉回安全区。
        var half = el.offsetWidth / 2;
        if (half > 0) {
          var maxX = window.innerWidth - 8 - half;
          var minX = 8 + half;
          var clampX = Math.max(minX, Math.min(x, maxX));
          if (clampX !== x) el.style.left = clampX + 'px';
        }
        var tm = bubbleTimersRef.current;
        tm.hide = setTimeout(function () {
          var cur = bubbleElRef.current;
          if (cur) cur.classList.add('hiding');
          tm.fade = setTimeout(removeBubble, 400);
        }, 5000);
      }

      /** 点气泡 → 跳到关联线索所在的对话（标题双向模糊匹配）。 */
      function jumpFromBubble(topicTitle) {
        if (!topicTitle) return;
        var targetSessionId = null;
        for (var i = 0; i < trails.length; i++) {
          var ts = trails[i].topics || [];
          for (var j = 0; j < ts.length; j++) {
            var tt = ts[j].title || '';
            if (tt && (tt.indexOf(topicTitle) >= 0 || topicTitle.indexOf(tt) >= 0)) {
              targetSessionId = trails[i].sessionId;
              break;
            }
          }
          if (targetSessionId) break;
        }
        if (targetSessionId) { setCollapsed(false); setSelectedId(targetSessionId); }
        removeBubble();
      }

      /** 手动逼一个气泡出来：无视「面板已展开」和「话术池为空」，立刻给反应。 */
      function forceBubble() {
        var fn = showBubbleRef.current;
        if (fn) { try { fn(true); } catch (e) { /* ignore */ } }
      }

      var isDeepseek = appConfig.skin === 'deepseek';
      // 「展示已删除的工作区」：dsh 里删掉的工作区、以及归档掉的对话，
      // 默认都不在插件里出现；打开这个开关才把历史里记着的补回来（工作区会标注「已删除」）。
      var showRemovedItems = appConfig.showRemovedItems === true;
      /**
       * 绿点反映「这条线索现在真的在动吗」。
       * 只看 status 会误导：唯一能把 active 改成 done 的时机是「用户下次发新指令」，
       * 所以停手不做的会话会一直亮着绿点（实测 31 条 active 里 28 条超过一天没动过）。
       * 这里按最后活动时间分三档，只改显示、不动数据（LLM 的判定仍保留在 status 里）。
       */
      var STATUS_ACTIVE_MIN = 10;          // 10 分钟内 → 亮绿
      var STATUS_STALE_MIN = 24 * 60;      // 超过 1 天 → 灰
      function statusClass(topic) {
        if (!topic || topic.status !== 'active') return 'done';
        var t = Date.parse(topic.updatedAt || '') || 0;
        if (t === 0) return 'active'; // 没有时间信息就不瞎猜
        var mins = (Date.now() - t) / 60000;
        if (mins <= STATUS_ACTIVE_MIN) return 'active';
        if (mins <= STATUS_STALE_MIN) return 'idle';
        return 'stale';
      }
      /** 聚合卡片（工作区视图）用：取组内所有 active 线索里最新的一次活动 */
      function groupStatusClass(childTopics) {
        var newest = 0;
        for (var i = 0; i < (childTopics || []).length; i++) {
          var tp = childTopics[i];
          if (!tp || tp.status !== 'active') continue;
          var t = Date.parse(tp.updatedAt || '') || 0;
          if (t > newest) newest = t;
        }
        if (newest === 0) return 'done';
        return statusClass({ status: 'active', updatedAt: new Date(newest).toISOString() });
      }
      function statusTitle(cls) {
        if (cls === 'active') return t('status.active');
        if (cls === 'idle') return t('status.idle');
        if (cls === 'stale') return t('status.stale');
        return t('status.done');
      }
      // 气泡的插话间隔（秒）。实际间隔在这个基准上做 0.7~1.5 倍抖动，
      // 免得像定时器一样机械；设置里用滑块可调。
      var bubbleIntervalSec = typeof appConfig.bubbleIntervalSec === 'number' ? appConfig.bubbleIntervalSec : 30;
      bubbleIntervalSec = Math.max(5, Math.min(300, bubbleIntervalSec));
      // 轻简模式：连气泡也拉长一倍（至少 60 秒），进一步压低调用量
      if (appConfig.leanMode === true) bubbleIntervalSec = Math.max(60, bubbleIntervalSec * 2);
      function nextBubbleDelay() {
        return Math.round(bubbleIntervalSec * 1000 * (0.7 + Math.random() * 0.8));
      }
      // 小球尺寸（设置项，0.6~1.6）。面板里外两颗球共用同一个比例；
      // ballDelta 是半径增量，用来把圆心按住不动（球变大时左上角要往回退）。
      var ballScale = typeof appConfig.ballScale === 'number' ? appConfig.ballScale : 1;
      ballScale = Math.max(0.6, Math.min(1.6, ballScale));
      var ballDelta = (30 * ballScale - 30) / 2;
      var fabEl = h('button', {
        className: 'dtt-fab' + (isBusy ? ' busy' : '') + (viewCount > 99 ? ' fab-small' : '') + (isDeepseek ? ' deepseek' : '') + (isDeepseek && appConfig.eyeAnimation && blinking ? ' blinking' : ''),
        style: {
          left: fabX !== undefined ? fabX + 'px' : undefined,
          right: fabX !== undefined ? undefined : '20px',
          top: fabY !== undefined ? fabY + 'px' : undefined,
          bottom: fabY !== undefined ? undefined : '20px',
          zIndex: 10001,
          opacity: collapsed ? 1 : 0,
          pointerEvents: collapsed ? 'auto' : 'none',
          // 视线偏移用 CSS 变量传递：数字瞳孔与头像层各自消费，不会互相覆盖 transform
          '--dtt-px': appConfig.eyeAnimation ? pupilOffset.x + 'px' : '0px',
          '--dtt-py': appConfig.eyeAnimation ? pupilOffset.y + 'px' : '0px',
          // 悬浮球挂在面板之外，拿不到 .dtt-root 上的变量，得自己带一份
          '--dtt-ball-scale': String(ballScale),
        },
        title: t('fab.title', { count: viewCount }),
        onPointerDown: onPointerDown,
        onClick: function () {
          if (dragging.current && dragging.current.moved) return;
          toggleCollapsed();
        },
      },
        // 头像层（默认皮肤下 .dtt-fab-face 无背景，不影响观感）
        h('span', { className: 'dtt-fab-face' }),
        h('span', {
          className: 'dtt-fab-pupil' + (appConfig.eyeAnimation && blinking ? ' blink' : ''),
          style: {
            // 数字位置固定；视线偏移交给 --dtt-px/--dtt-py（头像层会消费它们）
            transform: 'none',
            // 头部轻微下沉 + 压扁 = 眯眼（单张图没有闭眼素材，幅度取小才不假）
            ...(isDeepseek && appConfig.eyeAnimation && blinking ? { '--dtt-eye': '0.72' } : {}),
          },
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
      var selectedSession = sessionList.find(function (s) { return sameSessionId(s.sessionId, selectedId); }) || null;
      var selectedTrail = trails.find(function (s) { return sameSessionId(s.sessionId, selectedId); }) || null;
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
        // 已删除的工作区（在 dsh 里删掉、localStorage 里已消失）：默认不出现，
        // 只有「展示已删除的工作区」开关打开时补在最后，并在名字上标注。
        if (showRemovedItems && Array.isArray(dshWsGroups.removed)) {
          for (var ri0 = 0; ri0 < dshWsGroups.removed.length; ri0++) {
            allGroups.push(Object.assign({}, dshWsGroups.removed[ri0], { removed: true }));
          }
        }
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
            label: (g.removed ? '🗑 ' : (gPinned ? '📌 ' : '')) + gName + '（' + g.sessions.length + ' 会话 · ' + gTopicCount + ' 线索）' + (g.removed ? ' · 已删除' : ''),
            removed: Boolean(g.removed),
          });
          for (var gj = 0; gj < g.sessions.length; gj++) {
            var gsid = g.sessions[gj];
            var gss = sessionById[gsid];
            var sTitle = gss && gss.title ? gss.title : '';
            var sTopics = gss && Array.isArray(gss.topics) ? gss.topics.length : 0;
            // 从未对话过的空会话（无标题且无线索）不进下拉：它们在列表里没有任何信息量，
            // 只会以「未命名 xxxxxx」占据视线。有线索的（哪怕是空标题）仍然保留。
            if (!sTitle && sTopics === 0) continue;
            navItems.push({
              key: gsid,
              type: 'session',
              value: gsid,
              // 标题兜底：/snapshot 的 title 可能是空串（只有 /sessions 会兜底成「未命名会话」），
              // 不兜底就会渲染成一排长得一模一样的空白项；用 id 短码让它们还能区分
              label: sTitle ? fmtTitle(sTitle, 20) : ('未命名 ' + String(gsid).replace(/^session-/, '').slice(0, 6)),
              wsTitle: gName,
              dim: sTopics === 0, // 无线索的会话弱化显示，不隐藏（用户可能想进去导入）
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
            var sTitle2 = ss2 && ss2.title ? ss2.title : '';
            var sTopics2 = ss2 && Array.isArray(ss2.topics) ? ss2.topics.length : 0;
            if (!sTitle2 && sTopics2 === 0) continue; // 空会话不进下拉，理由同上
            navItems.push({
              key: sid2,
              type: 'session',
              value: sid2,
              label: sTitle2 ? fmtTitle(sTitle2, 20) : ('未命名 ' + String(sid2).replace(/^session-/, '').slice(0, 6)),
              wsTitle: fmtTitle(wt2.title, 26),
              dim: sTopics2 === 0,
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
        setSearchQuery(''); // 切换时清空搜索
        setSearchOpen(false);
        if (v === '__all__') { setSelectedWsId('__all__'); setSelectedId(null); }
        else if (v.indexOf('ws:') === 0) { setSelectedWsId(v.slice(3)); setSelectedId(null); }
        else { setSelectedId(v); setSelectedWsId(null); }
        // 动态加载：切换视图立即拉一次最新数据（不依赖轮询），并落盘视图缓存
        if (refreshRef.current) refreshRef.current();
      }

      // 右键菜单：记录弹出位置与总结范围（'all' | 'ws:<id>' | sessionId | sessionIds[]）
      // 导出线索为 Markdown
      function exportTrails(scope) {
        setMenu(null);
        // 收集要导出的 trails
        var trailsToExport = [];
        if (scope === '__all__') {
          trailsToExport = trails;
        } else if (Array.isArray(scope)) {
          // 工作区：多个 sessionId
          trailsToExport = trails.filter(function (s) { return scope.indexOf(s.sessionId) >= 0; });
        } else {
          // 单个对话
          var t = trails.find(function (s) { return sameSessionId(s.sessionId, scope); });
          if (t) trailsToExport = [t];
        }
        if (trailsToExport.length === 0) {
          setNotice({ type: 'warn', text: currentLang === 'en' ? 'Nothing to export' : '没有可导出的线索' });
          return;
        }
        // 生成 Markdown
        var md = [];
        var now = new Date();
        var dateStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        md.push('# 工作线索导出');
        md.push('');
        md.push('导出时间：' + now.toLocaleString());
        md.push('来源：' + (Array.isArray(scope) ? '工作区（' + trailsToExport.length + ' 个对话）' : (scope === '__all__' ? '全部工作区' : '单个对话')));
        md.push('');
        md.push('---');
        md.push('');
        for (var i = 0; i < trailsToExport.length; i++) {
          var trail = trailsToExport[i];
          var sessionTitle = trail.sessionTitle || trail.sessionId;
          md.push('## ' + sessionTitle);
          md.push('');
          var topics = trail.topics || [];
          for (var j = 0; j < topics.length; j++) {
            var topic = topics[j];
            var statusIcon = topic.status === 'active' ? '🔵' : '✅';
            md.push('### ' + statusIcon + ' ' + topic.title);
            if (topic.summary) md.push('');
            if (topic.summary) md.push('> ' + topic.summary);
            md.push('');
            // 历程时间线
            if (Array.isArray(topic.milestones) && topic.milestones.length > 0) {
              md.push('**历程：**');
              md.push('');
              for (var m = 0; m < topic.milestones.length; m++) {
                var mile = topic.milestones[m];
                md.push('- **' + mile.title + '**：' + (mile.summary || ''));
              }
              md.push('');
            }
            // 步骤
            if (topic.steps && topic.steps.length > 0) {
              md.push('**步骤：**');
              md.push('');
              for (var s = 0; s < topic.steps.length; s++) {
                var step = topic.steps[s];
                var stepIcon = step.kind === 'user' ? '👤' : step.kind === 'assistant' ? '🤖' : step.kind === 'tool' ? '🔧' : '💭';
                md.push(String(s + 1) + '. ' + stepIcon + ' ' + step.title);
              }
              md.push('');
            }
            md.push('');
          }
        }
        // 下载文件
        var blob = new Blob([md.join('\n')], { type: 'text/markdown;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = '工作线索-' + dateStr + '.md';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setNotice({ type: 'ok', text: currentLang === 'en' ? 'Exported successfully' : '导出成功' });
      }

      function openMenu(e, scope, label, topicId) {
        e.preventDefault();
        e.stopPropagation();
        // 两个菜单互斥：右键打开线索菜单时把画笔工具菜单收掉（右键不触发 pointerdown，得在这里收）
        setDrawMenu(null);
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

      /**
       * 会话内事件序号范围 [min, max]，用于把 step.seq 换算成消息列表的滚动位置。
       * 关键：seq 是「全局」事件序号（跨会话递增，动辄上百万），不是会话内序号，
       * 所以必须用会话内的相对位置 ratio = (seq - min) / (max - min)。
       * 旧实现拿「话题步骤数」当分母，比例恒 ≥1 → 每次跳转都滚到底部（表现为「定位不真实」）。
       * 依次尝试：host 给的 minSeq/maxSeq → 手上已加载的步骤 → 问 /steps 要首条与末条。
       */
      function resolveSeqRange(sessionId, topicId, totalSteps) {
        var row = null;
        for (var i = 0; i < trails.length; i++) {
          if (sameSessionId(trails[i].sessionId, sessionId)) { row = trails[i]; break; }
        }
        if (row && row.maxSeq > 0 && row.minSeq > 0) return Promise.resolve({ min: row.minSeq, max: row.maxSeq });
        // 手上已加载的步骤里取 min/max（store 的 key 形如 `${sessionId}:${topicId}`）
        var lo = 0, hi = 0;
        var store = stepsStoreRef.current;
        for (var k in store) {
          if (!Object.prototype.hasOwnProperty.call(store, k)) continue;
          var sep = k.lastIndexOf(':');
          if (sep < 0 || !sameSessionId(k.slice(0, sep), sessionId)) continue;
          var arr = store[k] && store[k].steps;
          if (!Array.isArray(arr)) continue;
          for (var n = 0; n < arr.length; n++) {
            var sq = arr[n].seq;
            if (!sq) continue;
            if (lo === 0 || sq < lo) lo = sq;
            if (sq > hi) hi = sq;
          }
        }
        if (lo > 0 && hi > lo) return Promise.resolve({ min: lo, max: hi });
        if (row && row.maxSeq > 0) return Promise.resolve({ min: 0, max: row.maxSeq });
        var topics = (row && Array.isArray(row.topics)) ? row.topics : [];
        var askSeq = function (tp, off) {
          return fetchJson('/steps?sessionId=' + encodeURIComponent(sessionId)
            + '&topicId=' + encodeURIComponent(tp.id)
            + '&offset=' + off + '&limit=1')
            .then(function (res) {
              var list = (res && res.steps) || [];
              return (list.length > 0 && list[0].seq) || 0;
            })
            .catch(function () { return 0; });
        };
        // 兜底：抽样几个线索的首条/末条来估序号范围。
        // 不在前端全量扫（84 条线索 = 84 次请求），且线索数组的顺序不等于时间顺序，
        // 所以只取首尾两条会严重偏差；这里均匀抽 5 个点。精确值由 host 的 minSeq/maxSeq 直接给出。
        var picks = [];
        var cnt = topics.length;
        if (cnt > 0) {
          var marks = [0, Math.floor(cnt / 4), Math.floor(cnt / 2), Math.floor(cnt * 3 / 4), cnt - 1];
          for (var q = 0; q < marks.length; q++) {
            var tp = topics[marks[q]];
            if (!tp || !(tp.stepCount > 0)) continue;
            var dup = false;
            for (var y = 0; y < picks.length; y++) { if (picks[y].id === tp.id) { dup = true; break; } }
            if (!dup) picks.push(tp);
          }
        }
        if (picks.length === 0 && topicId && totalSteps > 0) picks.push({ id: topicId, stepCount: totalSteps });
        if (picks.length === 0) return Promise.resolve({ min: 0, max: 0 });
        var jobs = [];
        for (var w = 0; w < picks.length; w++) {
          jobs.push(askSeq(picks[w], 0));
          jobs.push(askSeq(picks[w], Math.max(0, picks[w].stepCount - 1)));
        }
        return Promise.all(jobs).then(function (seqs) {
          var low = 0, high = 0;
          for (var x = 0; x < seqs.length; x++) {
            var v = seqs[x];
            if (!v) continue;
            if (low === 0 || v < low) low = v;
            if (v > high) high = v;
          }
          return { min: low, max: high };
        });
      }

      function jumpToSession(sessionId, step, totalSteps, topicId) {
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
                  scope.sessions.open(toDshSessionId(sessionId));
                  var targetTime = step && step.time ? step.time : null;
                  var stepSeq = step && step.seq ? step.seq : null;
                  var done = false;
                  // 先解析「会话内事件序号范围」，再开始定位——没有范围就只能盲滚
                  resolveSeqRange(sessionId, topicId, totalSteps).then(function (seqRange) {
                    // 多次重试定位：dsh 消息列表异步渲染 + 虚拟滚动，一次可能不够
                    var attempts = 0;
                    function tryLocate() {
                      if (done) return;
                      attempts++;
                      var ok = scrollToStepTime(targetTime, stepSeq, totalSteps, sessionId, seqRange);
                      if (ok) {
                        done = true; // 定位成功就别让用户干等满固定时长
                        setJumpingStep(null);
                        showNotice('已打开对话并定位', 'ok');
                        return;
                      }
                      if (attempts < 4) setTimeout(tryLocate, 400);
                    }
                    // 先滚到底部触发虚拟列表加载，再定位（延迟压到最小）
                    setTimeout(function () {
                      var sc = findMessageScroller();
                      if (sc) sc.scrollTop = sc.scrollHeight;
                      setTimeout(tryLocate, 250);
                    }, 250);
                  });
                  // 兜底：无论定位是否成功，最多 3s 后收起 loading
                  setTimeout(function () {
                    if (done) return;
                    done = true;
                    setJumpingStep(null);
                    showNotice('已打开对话并定位', 'ok');
                  }, 3000);
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

      // 在 dsh 消息列表里定位并滚动到对应消息
      // 找 dsh 消息列表的滚动容器（scrollHeight 最大的内部元素）；结果缓存，避免反复全量扫描 + 强制重排
      var scrollerCacheRef = { current: null };
      function findMessageScroller() {
        var cached = scrollerCacheRef.current;
        if (cached && document.contains(cached) && cached.clientHeight > 150 && cached.scrollHeight > cached.clientHeight + 50) {
          return cached;
        }
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
        scrollerCacheRef.current = scroller;
        return scroller;
      }

      function scrollToStepTime(targetTime, stepSeq, totalSteps, sessionId, seqRange) {
        try {
          var scroller = findMessageScroller();
          if (!scroller) return false;
          var sid = sessionId || selectedId;

          // 时间匹配：dsh 每个事件都自带真实时间，host 现在把它写在步骤上，
          // 所以不再限制「只有 live 会话才能用时间」——历史重放出来的步骤时间也是真的。
          // （真正不可信的是更早版本生成的旧数据：那时步骤时间全是导入那一刻，会挤在同一秒。）
          var targetTs = targetTime ? new Date(targetTime).getTime() : 0;

          var bestEl = null, bestDiff = Infinity;
          if (targetTs > 0) {
            var timeRegex = /(\d{1,2}):(\d{2})(?::\d{2})?/;
            var candidates = scroller.querySelectorAll('div, section, article, li');
            // 上限 400 个：dsh 消息列表可能上万元素，逐个读 textContent 会把主线程卡住（打开变慢的元凶之一）
            var limit = Math.min(candidates.length, 400);
            for (var j = 0; j < limit; j++) {
              var c = candidates[j];
              // 只要「消息块」尺度：太小的跳过；比视口还大的（整列容器）也跳过
              if (c.clientHeight < 20 || c.clientHeight > scroller.clientHeight) continue;
              var text = (c.textContent || '').slice(0, 200);
              var m = text.match(timeRegex);
              if (!m) continue;
              var now = new Date();
              var h = parseInt(m[1]), min = parseInt(m[2]);
              var dateMatch = text.match(/(\d{1,2})\/(\d{1,2})/);
              var msgDate = dateMatch
                ? new Date(now.getFullYear(), parseInt(dateMatch[1]) - 1, parseInt(dateMatch[2]), h, min)
                : new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, min);
              var ts = msgDate.getTime();
              if (!isNaN(ts)) {
                var diff = Math.abs(ts - targetTs);
                // 30 分钟内才算同一条消息（旧代码 12 小时，等于随便挑一条最近的）
                if (diff < bestDiff && diff < 30 * 60 * 1000) {
                  bestDiff = diff;
                  bestEl = c;
                }
              }
            }
          }

          // 时间匹配成功 → 滚动并高亮
          if (bestEl) {
            var msgEl = bestEl;
            while (msgEl.parentElement && msgEl.parentElement.parentElement
                   && msgEl.parentElement.clientHeight < scroller.clientHeight * 0.5) {
              msgEl = msgEl.parentElement;
            }
            var rect = msgEl.getBoundingClientRect();
            var scrollerRect = scroller.getBoundingClientRect();
            var targetScroll = scroller.scrollTop + (rect.top - scrollerRect.top) - scroller.clientHeight * 0.3;
            scroller.scrollTo({ top: Math.max(0, targetScroll), behavior: 'auto' });
            var orig = msgEl.style.boxShadow;
            msgEl.style.boxShadow = '0 0 0 2px #679efe, 0 0 16px rgba(103,158,254,0.6)';
            msgEl.style.transition = 'box-shadow 0.3s';
            setTimeout(function () { msgEl.style.boxShadow = orig || ''; }, 2500);
            return true;
          }

          // 时间不可信时，用「事件序号 → 消息列表位置」的相对比例映射。
          // seq 是全局事件序号（跨会话递增），所以必须落在「本会话的序号区间」里算相对位置：
          //   ratio = (seq - min) / (max - min)
          // 旧实现拿话题步骤数当分母 → 比例恒 ≥1 → 永远滚到底部，看起来就是「定位不真实」。
          if (stepSeq && stepSeq > 0) {
            var lo = (seqRange && seqRange.min > 0) ? seqRange.min : 0;
            var hi = (seqRange && seqRange.max > 0) ? seqRange.max : 0;
            var span = hi - lo;
            if (span > 0) {
              var ratio = Math.min(1, Math.max(0, (stepSeq - lo) / span));
              var pos = (scroller.scrollHeight - scroller.clientHeight) * ratio;
              scroller.scrollTo({ top: Math.max(0, pos), behavior: 'auto' });
              return true;
            }
          }
          // 定位失败要如实返回 false，调用方才会重试（旧代码这里一律 true，重试逻辑形同虚设）
          return false;
        } catch (e) { return false; }
      }

      // 渲染历程时间线（阶段里程碑）
      /**
       * 没有 AI 历程时，用步骤推断一个基础历程，保证每次展开都能先看到脉络、而不是一屏流水账。
       * 只取三个锚点：起点、第一次失败（若有）、已加载范围内的最近进展。
       * 数据不足（步骤还没加载完）就返回空数组，调用方会退回显示步骤。
       */
      function deriveMilestones(steps) {
        var list = (Array.isArray(steps) ? steps : []).filter(Boolean);
        if (list.length === 0) return [];
        var out = [];
        var first = list[0];
        out.push({ phase: 'proposal', title: '起点', summary: fmtTitle(first.title || '', 40), stepSeq: first.seq });
        var errStep = null;
        for (var i = 0; i < list.length; i++) {
          if (list[i].status === 'error') { errStep = list[i]; break; }
        }
        if (errStep && errStep.seq !== first.seq) {
          out.push({ phase: 'blocked', title: '遇到过失败', summary: fmtTitle(errStep.title || '', 40), stepSeq: errStep.seq });
        }
        var last = list[list.length - 1];
        if (last.seq !== first.seq) {
          out.push({
            phase: list.length > 3 ? 'breakthrough' : 'completion',
            title: '最近进展',
            summary: fmtTitle(last.title || '', 40),
            stepSeq: last.seq,
          });
        }
        return out;
      }

      function renderMilestones(topic, sessionId, totalSteps, milesOverride) {
        var milestones = Array.isArray(milesOverride)
          ? milesOverride
          : (Array.isArray(topic.milestones) ? topic.milestones : []);
        if (milestones.length === 0) return null;
        return h('div', { className: 'dtt-milestones', key: 'milestones' },
          h('div', { className: 'dtt-milestones-title' }, '历程'),
          milestones.map(function (m, i) {
            var phaseClass = m.phase || 'exploration';
            return h('div', {
              className: 'dtt-milestone',
              key: i,
              title: m.summary || m.title,
              onClick: function (e) {
                if (e && e.stopPropagation) e.stopPropagation();
                // 根据 stepSeq 找到对应步骤，跳转到对话位置
                var fakeStep = { id: 'ms-' + i, seq: m.stepSeq, kind: 'user', title: m.title, time: topic.updatedAt };
                jumpToSession(sessionId || selectedId, fakeStep, totalSteps, topic.id);
              },
            },
              h('span', { className: 'dtt-milestone-dot ' + phaseClass }),
              h('div', { className: 'dtt-milestone-info' },
                h('div', { className: 'dtt-milestone-title' }, m.title),
                m.summary ? h('div', { className: 'dtt-milestone-summary' }, m.summary) : null,
              ),
            );
          })
        );
      }

      function renderStep(step, sessionId, totalSteps, topicId) {
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
          onClick: function () { jumpToSession(sessionId || selectedId, step, totalSteps, topicId); },
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

      // ── 绘画功能（存笔画路径，不存位图）────────────────────────────────────
      /** 归一化坐标（0~1）：存笔画用，画布尺寸变了也能正确还原 */
      function getCanvasPos(e) {
        var canvas = canvasRef.current;
        if (!canvas) return [0, 0];
        var rect = canvas.getBoundingClientRect();
        var w = rect.width || 1;
        var h = rect.height || 1;
        return [
          Math.min(1, Math.max(0, (e.clientX - rect.left) / w)),
          Math.min(1, Math.max(0, (e.clientY - rect.top) / h)),
        ];
      }
      /** 把笔画按给定尺寸重放一遍（撤销、切对话、画布尺寸变化都靠它） */
      function drawStrokes(ctx, list, w, h) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (var i = 0; i < list.length; i++) {
          var s = list[i];
          var pts = s && s.points;
          if (!Array.isArray(pts) || pts.length === 0) continue;
          ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
          ctx.strokeStyle = s.color || '#ffffff';
          ctx.lineWidth = (s.size || 2) * (s.erase ? 4 : 1);
          ctx.beginPath();
          var x0 = pts[0][0] * w;
          var y0 = pts[0][1] * h;
          ctx.moveTo(x0, y0);
          for (var j = 1; j < pts.length; j++) ctx.lineTo(pts[j][0] * w, pts[j][1] * h);
          // 只落一个点也要看得见
          if (pts.length === 1) ctx.lineTo(x0 + 0.01, y0);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      function redrawAll() {
        var canvas = canvasRef.current;
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        var list = (strokesMapRef.current[noteKeyRef.current] || []).slice();
        if (currentStrokeRef.current) list.push(currentStrokeRef.current);
        drawStrokes(ctx, list, canvas.width, canvas.height);
      }
      function startDraw(e) {
        if (drawMode === 'none') return;
        e.preventDefault();
        drawingRef.current = true;
        var pos = getCanvasPos(e);
        lastPosRef.current = pos;
        currentStrokeRef.current = {
          color: drawColor,
          size: drawSize,
          erase: drawMode === 'eraser',
          points: [pos],
        };
      }
      function onDraw(e) {
        if (!drawingRef.current || drawMode === 'none') return;
        var canvas = canvasRef.current;
        var stroke = currentStrokeRef.current;
        if (!canvas || !stroke) return;
        var ctx = canvas.getContext('2d');
        // 只增量画这一小段：每帧全量重放会卡
        var pos = getCanvasPos(e);
        var last = lastPosRef.current || pos;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
        ctx.strokeStyle = stroke.color || '#ffffff';
        ctx.lineWidth = (stroke.size || 2) * (stroke.erase ? 4 : 1);
        ctx.beginPath();
        ctx.moveTo(last[0] * canvas.width, last[1] * canvas.height);
        ctx.lineTo(pos[0] * canvas.width, pos[1] * canvas.height);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        stroke.points.push(pos);
        lastPosRef.current = pos;
      }
      function stopDraw() {
        if (!drawingRef.current) return;
        drawingRef.current = false;
        var stroke = currentStrokeRef.current;
        currentStrokeRef.current = null;
        if (!stroke || stroke.points.length === 0) return;
        setStrokesMap(function (prev) {
          var next = Object.assign({}, prev);
          next[noteKey] = (next[noteKey] || []).concat([stroke]);
          return next;
        });
        scheduleNoteSave(); // 抬手才落盘，画的过程中不写
      }
      /** 撤销最后一笔（这是 vector 存储顺带带来的好处） */
      function undoStroke() {
        var list = strokesMap[noteKey] || [];
        if (list.length === 0) return;
        setStrokesMap(function (prev) {
          var next = Object.assign({}, prev);
          var arr = (next[noteKey] || []).slice(0, -1);
          if (arr.length > 0) next[noteKey] = arr;
          else delete next[noteKey];
          return next;
        });
        scheduleNoteSave();
        requestAnimationFrame(redrawAll);
      }
      function clearDrawing() {
        setStrokesMap(function (prev) {
          var next = Object.assign({}, prev);
          delete next[noteKey];
          return next;
        });
        scheduleNoteSave();
        var canvas = canvasRef.current;
        if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      }
      function resizeCanvas() {
        var canvas = canvasRef.current;
        if (!canvas) return;
        var parent = canvas.parentElement;
        if (!parent) return;
        var w = parent.clientWidth;
        var h = parent.clientHeight;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
          // vector 存储：尺寸变了直接按新尺寸重放，比缩放位图更清晰（也不会累积模糊）
          redrawAll();
        }
      }

      // 展开线索时自动滚动面板，让展开的线索置顶，最大化可见空间
      function scrollTopicToTop(e) {
        try {
          var topicEl = e.currentTarget.closest('.dtt-topic');
          var bodyEl = e.currentTarget.closest('.dtt-body');
          if (topicEl && bodyEl) {
            // 用 getBoundingClientRect 精确计算相对位置
            var topicRect = topicEl.getBoundingClientRect();
            var bodyRect = bodyEl.getBoundingClientRect();
            var targetTop = bodyEl.scrollTop + (topicRect.top - bodyRect.top) - 4;
            // 延迟到展开动画开始后再滚动，避免冲突
            setTimeout(function () {
              bodyEl.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
            }, 50);
          }
        } catch { /* ignore */ }
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
            onClick: function (e) {
              if (dragTopicId) return;
              var next = expanded ? null : topic.id;
              setOpenTopic(next);
              // 点完主动失焦。否则焦点留在 button 上，`:focus-within` 一直成立，
              // 卡片的描述区（summary/meta）就再也不随鼠标离开而收起——正是「点过的线索详情一直挂着」的原因。
              // 仅限鼠标点击（detail>0）：键盘 Enter 激活时保留焦点，方便继续用键盘操作。
              if (e && e.detail > 0 && e.currentTarget && typeof e.currentTarget.blur === 'function') e.currentTarget.blur();
              if (next) {
                ensureSteps(selectedId, topic, 'expand'); // 展开时才取步骤
                scrollTopicToTop(e); // 展开时自动滚动到顶部，最大化可见空间
              } else {
                setStepsOpen(null); // 收起时把「步骤已展开」状态一起复位
              }
            },
            onMouseEnter: function () { ensureSteps(selectedId, topic, 'prefetch'); }, // 悬停预热 → 点击秒开
            onContextMenu: function (e) {
              openMenu(e, selectedId, (currentLang === 'en' ? 'Topic: ' : '线索：') + fmtTitle(topic.title, 30), topic.id);
            },
          },
            h('span', (function () {
              var cls = statusClass(topic);
              return { className: 'dtt-status ' + cls, title: statusTitle(cls) };
            })()),
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
            ),
            h('span', { className: 'dtt-chevron' + (expanded ? ' open' : '') }, '›'),
          ),
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
          expanded
            ? (function () {
                function stepsKids() {
                  var kids = [];
                  if (loadedSteps.length === 0) {
                    kids.push(h('div', { className: 'dtt-empty', key: 'empty' },
                      entry.loading ? '正在加载步骤…' : (entry.error ? ('步骤加载失败：' + entry.error) : '暂无步骤')));
                  } else {
                    kids.push.apply(kids, loadedSteps.map(function (s) { return renderStep(s, selectedId, totalSteps, topic.id); }));
                  }
                  if (totalSteps > loadedSteps.length) {
                    kids.push(h('button', {
                      className: 'dtt-seg-btn',
                      key: 'more',
                      title: '继续加载该线索的后续步骤',
                      onClick: function (e) { if (e && e.stopPropagation) e.stopPropagation(); ensureSteps(selectedId, topic, 'more'); },
                    }, entry.loading ? '加载中…' : ('加载更多（还有 ' + (totalSteps - loadedSteps.length) + ' 步）')));
                  }
                  return kids;
                }
                // 有 AI 历程就用它；没有就用步骤推断一个基础历程（起点/失败/最近进展）
                var miles = (Array.isArray(topic.milestones) && topic.milestones.length > 0)
                  ? topic.milestones
                  : deriveMilestones(loadedSteps);
                var hasMiles = miles.length > 0;
                // 有历程 → 默认只显示历程，步骤收在按钮后面；没历程 → 直接显示步骤
                var showSteps = !hasMiles || stepsOpen === topic.id;
                var kids = [renderMilestones(topic, selectedId, totalSteps, miles)];
                if (showSteps) {
                  kids.push(h('div', { className: 'dtt-steps', key: 'steps' }, stepsKids()));
                } else {
                  kids.push(h('button', {
                    className: 'dtt-show-old-btn',
                    key: 'show-steps',
                    onClick: function (e) {
                      if (e && e.stopPropagation) e.stopPropagation();
                      setStepsOpen(topic.id);
                      ensureSteps(selectedId, topic, 'expand');
                    },
                  }, '显示步骤（' + totalSteps + ' 步）'));
                }
                return h('div', { className: 'dtt-expanded-wrap' }, kids);
              })()
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
          if (!map[sid]) {
            var ttl = topics[i]._sessionTitle || (topics[i].sources && topics[i].sources[0] && topics[i].sources[0].sessionTitle) || '';
            // 会话没有标题时，别把完整 sessionId 甩出来当名字（又长又没信息量）：
            // 优先拿该会话第一条线索的标题顶上，再退到「未命名 + 短 id」。
            if (!ttl) ttl = topics[i].title || '';
            if (!ttl) ttl = '未命名 ' + String(sid).replace(/^session-/, '').slice(0, 6);
            map[sid] = { sessionId: sid, sessionTitle: ttl, topics: [] };
          }
          map[sid].topics.push(topics[i]);
        }
        return Object.values(map);
      }

      // 全部工作区 / 工作区视图：合并线索卡片（默认只显示标题；悬停动效展开描述；点击下钻到来源会话；右键总结全部来源会话）
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
              h('span', (function () {
              var cls = groupStatusClass(childTopics);
              return { className: 'dtt-status ' + cls, title: statusTitle(cls) };
            })()),
              h('span', {
                className: 'dtt-topic-main',
                onMouseEnter: function () { setHoveredGroup(groupId); },
              },
                h('div', { className: 'dtt-topic-title' }, title),
              ),
              h('span', { className: 'dtt-chevron' }, '›'),
            ),
            h('div', { className: 'dtt-topic-reveal' },
              subtitle ? h('div', { className: 'dtt-topic-summary' }, subtitle) : null,
              h('div', { className: 'dtt-topic-meta' },
                h('span', { className: 'dtt-badge dtt-badge-llm' }, childTopics.length + ' 条线索'),
                activeCount > 0 ? h('span', { className: 'dtt-step-running' }, activeCount + ' ' + t('status.active')) : h('span', null, t('status.done')),
              ),
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
                      // drillInto 会切到该会话并展开这条线索；旧实现只调 jumpToSession，
                      // 结果 tooltip 承诺的「打开此线索」并没有发生（那个函数一直没被接线）。
                      if (sid) drillInto({ sessionId: sid, topicId: t.id });
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

      /**
       * 生成一组线索的来源提示（用于分组卡片的悬停 tooltip）。
       * 旧实现 mergedHintFor 只处理单条线索、且从未被调用；这里改成按分组汇总并真正接线，
       * 让悬停提示能回答 README 承诺的「这条线索来自哪个工作区/会话」。
       */
      function hintForGroup(topics) {
        var ws = [], ses = [], seenWs = {}, seenSes = {};
        for (var i = 0; i < (topics || []).length; i++) {
          var s = Array.isArray(topics[i].sources) ? topics[i].sources : [];
          for (var j = 0; j < s.length; j++) {
            if (s[j].workspaceTitle && !seenWs[s[j].workspaceTitle]) { seenWs[s[j].workspaceTitle] = 1; ws.push(s[j].workspaceTitle); }
            if (s[j].sessionTitle && !seenSes[s[j].sessionTitle]) { seenSes[s[j].sessionTitle] = 1; ses.push(s[j].sessionTitle); }
          }
        }
        var parts = [];
        if (ws.length) parts.push('来自工作区：' + ws.join('、'));
        if (ses.length) parts.push('会话：' + ses.join('、'));
        return parts.join('\n');
      }

      // 通用眼睛渲染（收起时大球、展开时标题栏小图标共用）

      var head = h('div', { className: 'dtt-head', onPointerDown: onPointerDown, style: { padding: (12.5 * scale) + 'px 12px', paddingLeft: (50.5 * scale) + 'px' } },
        h('span', {
          className: 'dtt-head-ball' + (appConfig.skin === 'deepseek' ? ' deepseek' : '') + (appConfig.skin === 'deepseek' && appConfig.eyeAnimation && blinking ? ' blinking' : ''),
          onClick: function (e) { e.stopPropagation(); setCollapsed(true); },
          title: t('fab.collapse'),
          style: {
            // 小球越大，圆心要保持不动：左/上偏移按半径差回补（否则会往右下角跑）
            left: ((9.5 - ballDelta) * scale) + 'px',
            top: ((12.5 - ballDelta) * scale) + 'px',
            width: (30 * scale * ballScale) + 'px',
            height: (30 * scale * ballScale) + 'px',
            fontSize: (13 * scale * ballScale) + 'px',
            // 与悬浮小球共用同一套视线偏移变量（面板展开时也跟鼠标）
            '--dtt-px': appConfig.eyeAnimation ? pupilOffset.x + 'px' : '0px',
            '--dtt-py': appConfig.eyeAnimation ? pupilOffset.y + 'px' : '0px',
            ...(appConfig.skin === 'deepseek' && appConfig.eyeAnimation && blinking ? { '--dtt-eye': '0.72' } : {}),
          },
        },
          h('span', { className: 'dtt-fab-face' }),
          h('span', {
            className: 'dtt-fab-pupil' + (appConfig.eyeAnimation && blinking ? ' blink' : ''),
            style: { transform: 'none' },
          }, String(fabCount)),
        ),
        panelSize.width <= 259 ? null : h('span', { className: 'dtt-title', style: { fontSize: (13 * scale) + 'px' } },
          t('app.title'),
        ),
        searchOpen
          ? h('input', {
              className: 'dtt-search-input',
              placeholder: '搜索当前区域线索...',
              value: searchQuery,
              autoFocus: true,
              onInput: function (e) { setSearchQuery(e.target.value); },
              onKeyDown: function (e) { if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); } },
            })
          : h('span', { className: 'dtt-nav' + (navOpen ? ' dtt-nav-open' : '') },
          h('button', {
            className: 'dtt-nav-btn',
            ref: navBtnRef,
            onClick: function () { setNavOpen(!navOpen); },
            onContextMenu: function (e) {
              e.preventDefault();
              e.stopPropagation();
              setNavOpen(false);
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
                      + (it.value === navValue ? ' sel' : '')
                      + (it.dim ? ' dim' : ''),
                    title: it.type === 'session' && it.wsTitle ? ('工作区：' + it.wsTitle + '（右键可总结该会话）') : (it.label + '（右键可总结）'),
                    // 触发用 pointerdown 而不是 click：面板每几秒轮询重渲染一次，
                    // 如果 pointerdown 与 click 之间列表被重建，click 就落空了（表现为「点了没反应」）。
                    // pointerdown 在事件序列里更早，命中即响应；这里阻断冒泡避免误触底层元素。
                    onPointerDown: function (e) {
                      if (e.button !== 0) return; // 只响应左键，右键留给 onContextMenu
                      e.stopPropagation();
                      selectItem(it.value);
                      setNavOpen(false);
                    },
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
                          onPointerDown: function (e) { if (e.button !== 0) return; e.stopPropagation(); togglePin(it.wsKey); },
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
            setMenu(null); // 与线索右键菜单互斥
            setDrawMenu({ x: e.clientX, y: e.clientY });
          },
        }, '✎'),
        h('button', {
          className: 'dtt-btn' + (searchOpen ? ' active' : ''),
          title: '搜索当前区域线索',
          onClick: function () {
            setSearchOpen(!searchOpen);
            if (searchOpen) setSearchQuery('');
          },
        }, '🔍'),
        // 面板很窄时让出「收起」按钮的位置：导航（选择工作区/会话）是主入口，
        // 而收起还能点左上角小球，优先级最低。
        panelSize.width > 210
          ? h('button', { className: 'dtt-btn', title: '收起', onClick: toggleCollapsed }, '—')
          : null,
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
          // 组间按「组内最新改动」倒序：最近有动作的会话排上面
          sessGroups.sort(function (a, b) { return latestTopicAt(b.topics) - latestTopicAt(a.topics); });
          body = sessGroups.map(function (g, gi) {
            return renderGroupCard(
              'sess-' + g.sessionId + '-' + gi,
              fmtTitle(g.sessionTitle || g.sessionId, 30),
              g.topics.length + ' 条线索',
              sortTopicsByRecent(g.topics),
              hintForGroup(g.topics) || ('会话：' + (g.sessionTitle || g.sessionId))
            );
          });
        } else {
          // 模式一（默认）：相似线索合并聚类
          var clusters = clusterTopics(topics);
          // 组间按「组内最新改动」倒序；组内子列表同样新在上（label 仍取原 cl[0]，不受排序影响）
          clusters.sort(function(a, b) { return latestTopicAt(b) - latestTopicAt(a); });
          body = clusters.map(function (cl, ci) {
            var firstTitle = cl[0] ? cl[0].title : '';
            var label = cl.length > 1 ? (firstTitle + ' 等 ' + cl.length + ' 条') : firstTitle;
            return renderGroupCard(
              'cl-' + ci,
              fmtTitle(label, 30),
              cl.length > 1 ? cl.length + ' 条相似线索合并' : '',
              sortTopicsByRecent(cl),
              hintForGroup(cl) || (cl.length + ' 条相似线索')
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
        // 会话级线索：按最近修改时间倒序，新改动的排最上。
        // updatedAt 在后端每次追加步骤或重新总结时都会刷新；缺失的沉到最后。
        // 排序放在过滤之前，这样「最近的」和「更早的」两组各自也是有序的。
        // 搜索过滤：在当前所选区域内搜索标题和描述
        var filteredTopics = sortTopicsByRecent(topics);
        if (searchQuery && searchQuery.trim()) {
          var q = searchQuery.trim().toLowerCase();
          filteredTopics = topics.filter(function (t) {
            var hay = (t.title || '') + ' ' + (t.summary || '');
            return hay.toLowerCase().indexOf(q) >= 0;
          });
        }
        // 3天未动的线索默认隐藏，底部按钮展开（搜索时不过滤时间）
        var threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
        var recentTopics = [];
        var oldTopics = [];
        for (var ti = 0; ti < filteredTopics.length; ti++) {
          var tUpd = filteredTopics[ti].updatedAt ? new Date(filteredTopics[ti].updatedAt).getTime() : 0;
          if (tUpd < threeDaysAgo) oldTopics.push(filteredTopics[ti]);
          else recentTopics.push(filteredTopics[ti]);
        }
        var visibleTopics = (showOldTopics || searchQuery) ? filteredTopics : recentTopics;
        // 没有任何「最近线索」时（例如点开一个很久没动的会话）不要让面板空着：
        // 退而显示最新的 5 条，让用户一眼看到这个会话在做些什么。底部按钮仍可展开全部。
        var fallbackPreview = false;
        if (!showOldTopics && !searchQuery && recentTopics.length === 0 && filteredTopics.length > 0) {
          visibleTopics = filteredTopics.slice(0, 5);
          fallbackPreview = true;
        }
        body = visibleTopics.map(renderTopicCard);
        // 有旧线索时，底部添加展开按钮（搜索时不显示）
        if (oldTopics.length > 0 && !showOldTopics && !searchQuery) {
          body.push(h('button', {
            className: 'dtt-show-old-btn',
            key: 'show-old',
            onClick: function () { setShowOldTopics(true); },
          }, fallbackPreview
            ? t('topics.showAll', { n: filteredTopics.length })
            : t('topics.showEarlier', { n: oldTopics.length })));
        } else if (showOldTopics && oldTopics.length > 0 && !searchQuery) {
          body.push(h('button', {
            className: 'dtt-show-old-btn dtt-collapse-old',
            key: 'collapse-old',
            onClick: function () { setShowOldTopics(false); },
          }, t('topics.collapseEarlier')));
        }
      }

      // 插件禁用时不渲染悬浮窗（设置页仍可重新启用）
      if (!pluginEnabled) return null;

      return [
        h('div', { className: 'dtt-root', style: Object.assign({}, style, {
          width: panelSize.width + 'px',
          maxHeight: panelSize.height ? panelSize.height + 'px' : undefined,
          fontSize: (13 * scale) + 'px',
          '--dtt-scale': scale,
          // 小球尺寸（设置项）：面板头部那颗球靠这两个变量算直径与文字占位宽度
          '--dtt-ball-scale': String(ballScale),
          '--dtt-ball-extra': ((30 * ballScale - 30) * scale) + 'px',
        }) },
          head,
          h('div', { className: 'dtt-body' },
          // 刷新失败提示：过去 setError 只存不显示，面板停更时用户完全看不出来
          error
            ? h('div', {
                className: 'dtt-error-bar',
                title: String(error),
                onClick: function () { if (refreshRef.current) refreshRef.current(); },
              },
                h('span', { className: 'dtt-error-ic' }, '⚠'),
                h('span', { className: 'dtt-error-text' }, t('error.refreshFailed')),
                h('span', { className: 'dtt-error-retry' }, t('error.retry')))
            : null,
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
              h('div', { className: 'dtt-menu-hint' }, t('draw.tools')),
              h('div', {
                className: 'dtt-menu-item' + (drawMode === 'pen' ? ' active' : ''),
                onPointerDown: function (e) { if (e.button !== 0) return; setDrawMode('pen'); setDrawMenu(null); if (!noteOpen) setNoteOpen(true); },
              }, t('draw.pen')),
              h('div', {
                className: 'dtt-menu-item' + (drawMode === 'eraser' ? ' active' : ''),
                onPointerDown: function (e) { if (e.button !== 0) return; setDrawMode('eraser'); setDrawMenu(null); if (!noteOpen) setNoteOpen(true); },
              }, t('draw.eraser')),
              h('div', { className: 'dtt-menu-sep' }),
              h('div', { className: 'dtt-menu-hint' }, t('draw.color')),
              h('div', { className: 'dtt-draw-colors' },
                ['#4f8cff', '#ef4444', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#ffffff'].map(function (c) {
                  return h('div', {
                    key: c,
                    className: 'dtt-draw-color-swatch' + (drawColor === c ? ' active' : ''),
                    style: { background: c },
                    onPointerDown: function (e) { if (e.button !== 0) return; setDrawColor(c); },
                  });
                }),
              ),
              h('div', { className: 'dtt-menu-sep' }),
              h('div', { className: 'dtt-menu-hint' }, t('draw.size')),
              h('div', { className: 'dtt-draw-sizes' },
                [1, 2, 3, 5].map(function (sz) {
                  return h('div', {
                    key: 'size-' + sz,
                    className: 'dtt-draw-size-swatch' + (drawSize === sz ? ' active' : ''),
                    title: t('draw.sizeTitle', { n: sz }),
                    onPointerDown: function (e) { if (e.button !== 0) return; setDrawSize(sz); },
                  }, h('span', {
                    className: 'dtt-draw-size-dot',
                    style: { width: (3 + sz * 2) + 'px', height: (3 + sz * 2) + 'px' },
                  }));
                }),
              ),
              h('div', { className: 'dtt-menu-sep' }),
              h('div', {
                className: 'dtt-menu-item',
                onPointerDown: function (e) { if (e.button !== 0) return; undoStroke(); setDrawMenu(null); },
              }, t('draw.undo')),
              h('div', {
                className: 'dtt-menu-item',
                onPointerDown: function (e) { if (e.button !== 0) return; clearDrawing(); setDrawMenu(null); },
              }, t('draw.clear')),
              drawMode !== 'none'
                ? h('div', {
                    className: 'dtt-menu-item',
                    onPointerDown: function (e) { if (e.button !== 0) return; setDrawMode('none'); setDrawMenu(null); },
                  }, t('draw.exit'))
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
                onPointerDown: function (e) { if (e.button !== 0) return; doSummarize(menu.scope); },
              },
                h('span', { className: 'dtt-menu-ic' }, '✦'),
                t('menu.regenerate')),
              !menu.topicId ? h('div', { className: 'dtt-menu-sep' }) : null,
              !menu.topicId ? h('div', {
                className: 'dtt-menu-item',
                onPointerDown: function (e) { if (e.button !== 0) return; doSummarize(menu.scope, true); },
                title: t('menu.regenerateAllDesc'),
              },
                h('span', { className: 'dtt-menu-ic' }, '↻'),
                t('menu.regenerateAll')) : null,
              menu.topicId ? h('div', {
                className: 'dtt-menu-item',
                onPointerDown: function (e) {
                  if (e.button !== 0) return;
                  var top = trails.find(function (s) { return sameSessionId(s.sessionId, menu.scope); });
                  var tp = top && top.topics && top.topics.find(function (t) { return t.id === menu.topicId; });
                  setEditingTopic({ sessionId: menu.scope, topicId: menu.topicId, title: tp ? tp.title : '' });
                  setMenu(null);
                },
              },
                h('span', { className: 'dtt-menu-ic' }, '✎'),
                t('menu.editTopic')) : null,
              menu.topicId ? h('div', {
                className: 'dtt-menu-item dtt-menu-danger',
                onPointerDown: function (e) { if (e.button !== 0) return; doDeleteTopic(menu.scope, menu.topicId); },
              },
                h('span', { className: 'dtt-menu-ic' }, '✕'),
                t('menu.deleteTopic')) : null,
              !menu.topicId ? h('div', { className: 'dtt-menu-sep' }) : null,
              !menu.topicId ? h('div', {
                className: 'dtt-menu-item',
                onPointerDown: function (e) { if (e.button !== 0) return; exportTrails(menu.scope); },
              },
                h('span', { className: 'dtt-menu-ic' }, '📥'),
                currentLang === 'en' ? 'Export as Markdown' : '导出为 Markdown') : null,
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
            h('span', { className: 'dtt-draw-mode' }, drawMode === 'pen' ? t('draw.pen') : t('draw.eraser')),
            h('span', { className: 'dtt-draw-color', style: { background: drawColor } }),
            h('button', { className: 'dtt-draw-btn', onClick: clearDrawing }, '清除'),
            h('button', { className: 'dtt-draw-btn', onPointerDown: function (e) { if (e.button !== 0) return; setDrawMode('none'); } }, '完成'),
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
      // 小球尺寸：设置组件和主面板是两个独立的组件函数，作用域不共享，
      // 不能引用主组件里算好的 ballScale（那会直接 ReferenceError 让整块设置崩掉）。
      // 这里从自己的 cfg 里取，规则与主组件保持一致。
      var ballScaleCfg = cfg && typeof cfg.ballScale === 'number' ? cfg.ballScale : 1;
      ballScaleCfg = Math.max(0.6, Math.min(1.6, ballScaleCfg));
      /**
       * 设置页的请求也要有超时。
       * 没有超时的话，POST 一旦挂住 `saving` 就永远是 true，所有开关变灰、点不动
       * ——用户看到的现象就是「设置不稳定 / 有时点不动」。
       */
      function settingsFetch(url, options) {
        var opts = Object.assign({}, options || {});
        opts.headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
        try { opts.signal = AbortSignal.timeout(15000); } catch (e) { /* 老浏览器：不带超时 */ }
        return fetch(url, opts);
      }
      useEffect(function () {
        settingsFetch('/plugins/topic-trail/config')
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (c) {
            if (!c) return;
            setCfg(c);
            syncAppConfig(c); // 统一走同一入口，避免各路径字段集不一致
          })
          .catch(function () { /* 配置拉取失败不致命 */ });
      }, []);
      function update(patch) {
        setSaving(true);
        settingsFetch('/plugins/topic-trail/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) {
            if (d && d.config) {
              setCfg(d.config);
              syncAppConfig(d.config);
              saveCachedConfig(d.config);
              // 通知主组件配置已变更（立即生效，不等轮询）
              try { window.dispatchEvent(new CustomEvent('dtt-config-changed', { detail: d.config })); } catch (e) { /* ignore */ }
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
      var skin = cfg && cfg.skin ? cfg.skin : 'default';
      var showRemoved = cfg ? cfg.showRemovedItems === true : false;
      var lean = cfg ? cfg.leanMode === true : false;
      // 插话间隔（秒）：设置组件和主面板是两个独立函数，作用域不共享，得自己取一份
      var bubbleIntervalCfg = cfg && typeof cfg.bubbleIntervalSec === 'number' ? cfg.bubbleIntervalSec : 30;
      bubbleIntervalCfg = Math.max(5, Math.min(120, bubbleIntervalCfg));
      // token 用量（估算）：打开设置页时拉一次并每 5 秒刷新
      var [usage, setUsage] = useState(null);
      var [usageErr, setUsageErr] = useState(false);
      useEffect(function () {
        var cancelled = false;
        function load() {
          settingsFetch('/plugins/topic-trail/usage')
            .then(function (r) {
              // 老版本 host 没有这个路由（改了 host 但还没重启时会 404），
              // 这时要说清楚「重启后才可用」，而不是一直卡在「正在读取」
              if (!r.ok) throw new Error('HTTP ' + r.status);
              return r.json();
            })
            .then(function (d) {
              if (cancelled || !d) return;
              setUsage(d);
              setUsageErr(false);
            })
            .catch(function () { if (!cancelled) setUsageErr(true); });
        }
        load();
        var t = setInterval(load, 5000);
        return function () { cancelled = true; clearInterval(t); };
      }, []);
      // 大数字换成易读单位（万 / M）
      function fmtTokens(n) {
        var v = Number(n) || 0;
        if (v <= 0) return '0';
        if (v >= 1000000) return (v / 1000000).toFixed(2) + 'M';
        if (v >= 10000) return (v / 10000).toFixed(1) + ' 万';
        return String(v);
      }
      var proactive = cfg ? cfg.proactiveDisplay !== false : true;
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
            h('div', { className: 'dtt-settings-name' }, t('settings.skin')),
            h('div', { className: 'dtt-settings-desc' }, t('settings.skinDesc'))),
          h('div', { className: 'dtt-seg' },
            h('button', {
              className: 'dtt-seg-btn' + (skin === 'default' ? ' on' : ''),
              type: 'button', disabled: saving,
              onClick: function () { update({ skin: 'default' }); },
            }, currentLang === 'en' ? 'Default' : '默认'),
            h('button', {
              className: 'dtt-seg-btn' + (skin === 'deepseek' ? ' on' : ''),
              type: 'button', disabled: saving,
              onClick: function () { update({ skin: 'deepseek' }); },
            }, 'DeepSeek'),
          ),
        ),
        h('div', { className: 'dtt-settings-row' },
          h('div', { className: 'dtt-settings-text' },
            h('div', { className: 'dtt-settings-name' }, t('settings.ballSize')),
            h('div', { className: 'dtt-settings-desc' }, t('settings.ballSizeDesc'))),
          h('div', { className: 'dtt-ball-size' },
            h('input', {
              className: 'dtt-ball-range',
              type: 'range', min: '60', max: '160', step: '5',
              value: String(Math.round(ballScaleCfg * 100)),
              disabled: saving,
              title: t('settings.ballSize'),
              onChange: function (e) { update({ ballScale: Number(e.target.value) / 100 }); },
            }),
            h('span', { className: 'dtt-ball-val' }, Math.round(ballScaleCfg * 100) + '%'),
          ),
        ),
        h('div', { className: 'dtt-settings-row' },
          h('div', { className: 'dtt-settings-text' },
            h('div', { className: 'dtt-settings-name' }, t('settings.bubbleInterval')),
            h('div', { className: 'dtt-settings-desc' }, t('settings.bubbleIntervalDesc'))),
          h('div', { className: 'dtt-ball-size' },
            h('input', {
              className: 'dtt-ball-range',
              type: 'range', min: '5', max: '120', step: '5',
              value: String(bubbleIntervalCfg),
              disabled: saving,
              title: t('settings.bubbleInterval'),
              onChange: function (e) { update({ bubbleIntervalSec: Number(e.target.value) }); },
            }),
            h('span', { className: 'dtt-ball-val' }, bubbleIntervalCfg + 's'),
          ),
        ),
        // token 用量（估算）：一行里分别显示「气泡」与「总结」
        h('div', { className: 'dtt-settings-row' },
          h('div', { className: 'dtt-settings-text' },
            h('div', { className: 'dtt-settings-name' }, t('settings.tokenUsage')),
            h('div', { className: 'dtt-settings-desc' },
              usage
                ? t('settings.tokenUsageDesc', {
                    bubble: fmtTokens(usage.bubble && usage.bubble.total),
                    summarize: fmtTokens(usage.summarize && usage.summarize.total),
                  })
                : (usageErr ? t('settings.tokenUsageUnavailable') : t('settings.tokenUsageLoading')))),
        ),
        h('div', { className: 'dtt-settings-row' },
          h('div', { className: 'dtt-settings-text' },
            h('div', { className: 'dtt-settings-name' }, t('settings.leanMode')),
            h('div', { className: 'dtt-settings-desc' }, t('settings.leanModeDesc'))),
          h('button', {
            className: 'dtt-switch' + (lean ? ' on' : ''),
            type: 'button',
            role: 'switch',
            'aria-checked': lean,
            disabled: saving,
            title: lean ? t('settings.switchOn') : t('settings.switchOff'),
            onClick: function () { update({ leanMode: !lean }); },
          }, h('span', { className: 'dtt-switch-knob' })),
        ),
        h('div', { className: 'dtt-settings-row' },
          h('div', { className: 'dtt-settings-text' },
            h('div', { className: 'dtt-settings-name' }, t('settings.showRemovedItems')),
            h('div', { className: 'dtt-settings-desc' }, t('settings.showRemovedItemsDesc'))),
          h('button', {
            className: 'dtt-switch' + (showRemoved ? ' on' : ''),
            type: 'button',
            role: 'switch',
            'aria-checked': showRemoved,
            disabled: saving,
            title: showRemoved ? t('settings.switchOn') : t('settings.switchOff'),
            onClick: function () { update({ showRemovedItems: !showRemoved }); },
          }, h('span', { className: 'dtt-switch-knob' })),
        ),
        h('div', { className: 'dtt-settings-row' },
          h('div', { className: 'dtt-settings-text' },
            h('div', { className: 'dtt-settings-name' }, t('settings.proactiveDisplay')),
            h('div', { className: 'dtt-settings-desc' }, t('settings.proactiveDisplayDesc'))),
          h('button', {
            className: 'dtt-switch' + (proactive ? ' on' : ''),
            type: 'button',
            role: 'switch',
            'aria-checked': proactive,
            disabled: saving,
            title: proactive ? t('settings.switchOn') : t('settings.switchOff'),
            onClick: function () { update({ proactiveDisplay: !proactive }); },
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
            h('div', { className: 'dtt-settings-desc' },
              cfg
                ? (cfg.pollMs + ' ms（' + t('settings.pollIntervalHint') + '）')
                : t('settings.loading'))),
          // 预设档位：pollMs 以前只能显示、没法改（要去动 config.json）
          h('div', { className: 'dtt-seg' },
            [1000, 3000, 5000, 10000].map(function (ms) {
              return h('button', {
                key: 'poll-' + ms,
                className: 'dtt-seg-btn' + (cfg && cfg.pollMs === ms ? ' on' : ''),
                type: 'button',
                disabled: saving,
                onClick: function () { update({ pollMs: ms }); },
              }, (ms / 1000) + 's');
            }))),
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
    // 运行时配置（设置页「任务线索」可开关）。字段必须与 /plugins/topic-trail/config 的返回一致，
    // 并在面板挂载时同步一次——否则刷新页面后会退回这里的默认值。
    var appConfig = {
      followSession: true,
      eyeAnimation: false,
      preserveTopics: true,
      workspaceMemory: true,
      enabled: true,
      learnFromModifications: true,
      workspaceViewMode: 'merge',
      skin: 'default',
      proactiveDisplay: true,
      ballScale: 1,
      showRemovedItems: false,
      bubbleIntervalSec: 30,
      leanMode: false,
      pollMs: 3000,
    };

    /**
     * 把服务器返回的 config 写进 appConfig —— **唯一写入口**。
     *
     * 以前这段赋值被抄了三份（面板的配置事件、设置页的 GET、设置页的 POST），三份字段集还不一致，
     * 而且**没有任何一处发生在启动时**：刷新页面后皮肤 / 眼球动画 / 主动展示 / 轮询间隔
     * 全部退回上面的硬编码默认值，必须打开一次设置页才「恢复」——这就是设置项看起来不稳定的原因。
     */
    function syncAppConfig(c) {
      if (!c || typeof c !== 'object') return;
      if (typeof c.followSession === 'boolean') appConfig.followSession = c.followSession;
      if (typeof c.eyeAnimation === 'boolean') appConfig.eyeAnimation = c.eyeAnimation;
      if (typeof c.preserveTopics === 'boolean') appConfig.preserveTopics = c.preserveTopics;
      if (typeof c.workspaceMemory === 'boolean') appConfig.workspaceMemory = c.workspaceMemory;
      if (typeof c.enabled === 'boolean') appConfig.enabled = c.enabled;
      if (typeof c.learnFromModifications === 'boolean') appConfig.learnFromModifications = c.learnFromModifications;
      if (typeof c.proactiveDisplay === 'boolean') appConfig.proactiveDisplay = c.proactiveDisplay;
    // 小球尺寸：只接受合理范围，避免设置被写坏后球变得看不见或占满屏幕
    if (typeof c.ballScale === 'number' && c.ballScale >= 0.6 && c.ballScale <= 1.6) appConfig.ballScale = c.ballScale;
    // 已删除的工作区 / 已归档的对话默认隐藏，这个开关打开才展示
    if (typeof c.showRemovedItems === 'boolean') appConfig.showRemovedItems = c.showRemovedItems;
    // 气泡插话间隔（5~300 秒）
    if (typeof c.bubbleIntervalSec === 'number' && c.bubbleIntervalSec >= 5 && c.bubbleIntervalSec <= 300) appConfig.bubbleIntervalSec = c.bubbleIntervalSec;
    // 轻简模式（省 token）
    if (typeof c.leanMode === 'boolean') appConfig.leanMode = c.leanMode;
      if (c.workspaceViewMode) appConfig.workspaceViewMode = c.workspaceViewMode;
      if (c.skin) appConfig.skin = c.skin;
      if (typeof c.pollMs === 'number' && c.pollMs > 0) appConfig.pollMs = c.pollMs;
    }

    // 首帧就用上次的配置值（避免默认皮肤闪一帧再切成用户设置），
    // 随后启动时的 /config 请求再与服务器对齐。
    syncAppConfig(loadCachedConfig());
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
