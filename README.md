# SupOS-monitor

> supOS 测点监控告警 · Windows 桌面常驻应用
>
> 从 supOS 平台常驻订阅测点实时值，按可配置规则判断，命中后弹窗 + 邮件告警。
>
> 支持表格规则 + 画布节点（参考米家自动化极客版）+ 环境变量系统。

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows-blue" alt="platform">
  <img src="https://img.shields.io/badge/electron-v31-brightgreen" alt="electron">
  <img src="https://img.shields.io/badge/node-%3E%3D18-green" alt="node">
  <img src="https://img.shields.io/badge/license-MIT-lightgrey" alt="license">
</p>

---

## 功能特性

### 数据接入
- **登录**：`POST /inter-api/auth/login`（`userName` 字段），支持 `needForceLogin` 二次登录
- **实时值**：WebSocket 常驻订阅，1 秒 1 帧，先认证后订阅
- **保活**：心跳 30 秒、断线 3 秒重连、`ticket` 30 分钟续期
- **失效处理**：`auth:"0"` 或 HTTP 401/480 自动重新登录
- **二次核对**：推送 `status` 非 `0` 时不判断，等质量恢复

### 报警规则
- **四级阈值**：HH / H / L / LL，可分别留空表示不判断
- **持续时间**：超限需连续满足 N 秒才报警（0 = 立即）
- **独立冷却**：每点位单独计时，默认 10 分钟
- **不做迟滞回差**
- **防抖**：冷却期内反复横跳不清零

### 界面
- **实时点位**：卡片式，按装置分组，可拖动排序
- **装置独立暂停**：单个装置临时停发报警（30/60/分钟或手动恢复）
- **全局暂停**：整体暂停监控 30 分钟 / 1 小时 / 手动恢复
- **表格规则**：每行一个点位，直填阈值
- **装置分类**：按位号关键字自动归类
- **环境变量**：可提前创建变量名，画布节点读写
- **画布节点**：18 种节点，参考米家自动化极客版风格
  - 数据源：位号取值 / 布尔位号 / 位号质量
  - 判断：比较 / 区间 / 偏差 / 变化率
  - 逻辑：逻辑与或 / 非 / 异或
  - 流程：条件分支（if/else） / 合并分支
  - 时间：持续时间 / 延时 / 时间段
  - 变量：读变量 / 写变量
  - 触发：触发报警

### 报警推送
- **置顶弹窗**：汇总所有处于报警状态的测点
- **合并**：1~2 秒内多点到期合并为一个窗口
- **临时调整设定值**：弹窗内可改阈值，2 小时或数值回落 30 秒后自动还原
- **邮件**：QQ 邮箱 SMTP，多点命中合并一封，失败重试 3 次
- **邮件指令**：回复邮件含"关闭/停止/静音"等关键字可停发报警邮件，回复"开启/恢复"重新启用

### 系统
- **托盘运行**：关闭主窗口不退出，双击托盘恢复
- **单实例**：防止重复启动
- **开机自启**（可关）
- **日志**：保留 8 小时滚动
- **配置加密**：密码用 DPAPI 加密，绑定当前 Windows 用户
- **配置迁移**：导出不含密码，导入后手输一次
- **自动更新**：基于 GitHub Release

---

## 技术栈

| 项 | 说明 |
|---|---|
| 运行时 | Electron 31 |
| 主进程 | Node.js 20（HTTP / WS / IMAP / SMTP / 规则引擎） |
| 渲染进程 | 原生 HTML / CSS / JavaScript（无框架） |
| 通信 | contextBridge + IPC |
| 打包 | electron-builder（zip / nsis） |
| 依赖 | `ws`、`nodemailer`、`imapflow`、`mailparser`、`xlsx`、`electron-updater` |

---

## 目录结构

```
SupOS-monitor/
├─ package.json
├─ .gitignore
├─ README.md
├─ build/
│  └─ icon.ico                    # 托盘 + 应用图标（256×256）
├─ scripts/
│  └─ before-pack-check.js        # 打包前校验敏感残留（可选）
└─ src/
   ├─ main/                       # 主进程
   │  ├─ index.js                 # 入口：窗口 / 托盘 / IPC
   │  ├─ config.js                # 配置读写（DPAPI 加密）
   │  ├─ auth.js                  # 登录 + ticket 续期
   │  ├─ tags.js                  # 位号清单
   │  ├─ vars.js                  # 环境变量
   │  ├─ logger.js                # 8 小时滚动日志
   │  ├─ ws-client.js             # WebSocket 订阅
   │  ├─ rules-engine.js          # 规则引擎
   │  ├─ canvas-engine.js         # 画布节点求值
   │  ├─ mailer.js                # SMTP 发送
   │  ├─ mail-watcher.js          # IMAP 邮件指令监听
   │  ├─ alert-window.js          # 置顶报警弹窗
   │  ├─ tray.js                  # 托盘
   │  ├─ config-io.js             # 配置导出/导入
   │  └─ updater.js               # 自动更新
   ├─ preload/
   │  ├─ main.js                  # 主窗口 IPC 桥
   │  └─ alert.js                 # 报警窗口 IPC 桥
   └─ renderer/
      ├─ main/
      │  ├─ index.html            # 主窗口
      │  ├─ style.css
      │  ├─ app.js                # 页面逻辑
      │  └─ canvas.js             # 画布编辑器
      └─ alert/
         ├─ index.html            # 报警弹窗
         ├─ alert.css
         └─ alert.js
```

---

## 安装运行

### 前置条件

- Node.js ≥ 18
- Windows 10 及以上

### 开发运行

```bash
git clone https://github.com/shangcanyang/SupOS-monitor.git
cd SupOS-monitor
npm install
npm start
```

### 首次使用

1. 打开「设置 / 日志」页 → 填平台地址、用户名、密码 → 点「保存并重连」
2. 切到「规则配置」页 → 点「批量导入位号」或「Excel 导入」导入位号
3. 填 HH / H / L / LL 阈值、持续时间、冷却时间
4. 点「保存规则」
5. 切回「实时点位」页 → 看到实时值刷新
6. （可选）「邮件设置」页 → 填 QQ 邮箱授权码 → 测试
7. （可选）「环境变量」页 → 创建变量
8. （可选）「高级规则」页 → 拖拽节点搭建复杂规则

---

## 配置存储

所有配置存放在 `%APPDATA%\SupOS-monitor\`：

| 文件 | 内容 |
|---|---|
| `config.json` | 服务器、用户名、密码（DPAPI 密文）、邮件配置、装置分类、画布规则 |
| `tags.json` | 位号清单 + 阈值 + 描述 + 单位（明文） |
| `vars.json` | 环境变量定义（明文） |
| `runtime.log` | 运行日志（8 小时滚动） |

> **密码加密**：使用 Electron 的 `safeStorage`（底层 DPAPI），绑定当前 Windows 用户。换用户或换机器后无法解密，需重填。
>
> **安全提示**：`config.json` 中密码虽然加密，但仍建议不要把 `%APPDATA%\SupOS-monitor\` 整个目录共享。

---

## 打包发布

### 构建绿色版

```bash
npm run pack
```

产物：`release/SupOS-monitor-1.0.0-win-x64.zip`，解压即用。

### 发布到 GitHub Release

1. 修改 `package.json` 的 `version`
2. `npm run pack`
3. GitHub 仓库 → Releases → Create a new release
4. Tag 填 `v1.0.1`，上传 `release/SupOS-monitor-1.0.1-win-x64.zip`
5. Publish release

用户端会在启动 30 秒后自动检查更新。

---

## 使用说明

### 规则逻辑

| 项 | 说明 |
|---|---|
| HH / H | 上限，值 ≥ 阈值触发 |
| L / LL | 下限，值 ≤ 阈值触发 |
| 留空 | 不判断该级别 |
| 持续时间 | 超限需连续满足 N 秒才报警（0 = 立即） |
| 冷却时间 | 触发报警后的静默时间，期间不再弹窗 |

### 报警冷却机制

- **首次报警**：立即弹窗，开始计时
- **冷却期内**：无论是否恢复正常都不弹、不清零
- **冷却到期时**：
  - 仍超限 → 弹窗，重新计时
  - 已恢复 → 不弹，计时清零；下次报警重新算"首次"

### 画布节点

参考米家自动化极客版，节点式编辑器：

- **拖拽创建**：从左侧面板拖拽节点到画布，或点击直接创建到画布中心
- **拖拽连线**：按住节点右侧圆点，拖到目标节点左侧圆点松开
- **删除连线**：鼠标移到线上点击
- **删除节点**：节点右上角 ×
- **分支节点**：`if` 节点有真/假两个出口（右侧上绿下红）

### 环境变量

在「环境变量」页创建，供画布节点读写：

- **读变量**：节点输出变量当前值
- **写变量**：
  - 模式「由输入决定」→ 把输入端口值写入变量，并继续往后传
  - 模式「固定值」→ 条件触发时直接赋固定值（如 `1` 或 `报警`）

变量运行时值在「环境变量」页每 2 秒刷新。

### 邮件指令

1. 在「邮件设置」页勾选「启用邮件指令」
2. 收到报警邮件后**回复**，正文包含：
   - 关闭 / 停用 / 停止 / 静音 / 暂停 / stop / mute / disable → 停发报警邮件
   - 开启 / 启动 / 启用 / 恢复 / start / unmute / enable → 恢复
3. 程序每 60 秒检查一次收件箱
4. 处理后会回执确认邮件

> IMAP 需要 QQ 邮箱开启 IMAP 服务，用同一授权码。

---

## 开发说明

### 主进程 vs 渲染进程

- **主进程**（`src/main/`）：负责所有系统级操作、网络、规则引擎
- **渲染进程**（`src/renderer/`）：只负责 UI 展示，通过 `window.api.*` 调用主进程
- **IPC 桥**（`src/preload/`）：用 `contextBridge` 暴露白名单 API

### 数据流

```
supOS 平台
  ↓ WebSocket
WSClient（主进程）
  ↓ onData
RulesEngine（主进程）
  ↓ 每秒 tick 判断
  ├─ 报警 → AlertWindow 弹窗 + Mailer 发邮件
  └─ 实时值 → IPC → 渲染进程更新卡片

画布规则（RuleEngine 每秒 tick）：
  1. 从 trigger 节点反向追踪
  2. 递归求值每个节点
  3. 命中 → onAlarm
```

### 添加新节点类型

1. `src/renderer/main/canvas.js` 的 `NODE_META` 加类型定义
2. `nodeHtml()` 加对应 UI
3. `makeNodeObj()` 加默认值
4. `src/main/canvas-engine.js` 的 `evalNode()` 加求值逻辑
5. `src/renderer/main/index.html` 左侧面板加 `.side-item`
6. `src/renderer/main/style.css` 加节点着色

---

## 已知限制

- 密码明文存储于 `%APPDATA%`，虽然 DPAPI 加密但换用户后不可用
- 画布变量是内存运行时，重启后恢复初始值
- 邮件指令仅支持 QQ 邮箱 IMAP
- 平台 `X-Supos-Client` 头暂未加，如遇登录失败需从前端抓包补齐

---

## 许可证

MIT License

---

## 致谢

- 平台接口参考：[supOS](http://www.supos.com/)
- 画布节点设计参考：米家自动化极客版
- 技术栈：[Electron](https://www.electronjs.org/)
```