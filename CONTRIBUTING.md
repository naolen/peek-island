# 参与贡献

感谢你愿意帮忙！提 Issue、改文档、修 bug、加功能都欢迎。

## 提 Issue

- **Bug**：用 Bug 模板，写清楚 Windows 版本、余光版本、怎么复现。最好附上日志 `%APPDATA%/peek-island/logs/main.log` 的相关部分（先检查里面没有你不想公开的内容，比如通知或邮件标题）。
- **新功能**：先开一个 Issue 聊聊想法，再动手写代码，免得白做。余光的方向是“安静、不打扰”：会弹窗、会抢焦点、会让人分心的功能一般不会加。
- **安全问题**：不要公开提 Issue，按 [SECURITY.md](SECURITY.md) 私下报告。

## 开发环境

- Windows 10 / 11（功能完整），或 Linux / macOS（只能跑单元测试和截图自测）
- Node.js 20 或更新版本
- .NET 8 SDK（可选，编译原生小助手用：音乐、系统通知、剪贴板变化监听）

```bash
git clone https://github.com/naolen/peek-island.git
cd peek-island
npm install
npm run native   # Windows，可选
npm start
```

## 提交之前

```bash
npm test         # 单元测试，必须全部通过
npm run e2e      # 端到端：真实的主进程和界面 + 假的行情服务器，检查各种数据情况下都不报错
npm run smoke    # 用假数据截图，输出到 ./shots，改了界面请看一眼
```

`e2e` 和 `smoke` 在 Linux 上需要 xvfb；Windows 上直接运行：

```bash
npx electron scripts/e2e.js
```

- 行情解析、交易时段、预警判断、盈亏计算都是纯函数（`src/quotes.js`、`session.js`、`alerts.js`、`pnl.js`），改这些地方请补上对应的测试。
- 改了界面，请在 PR 里贴前后截图。`npm run smoke` 生成的截图就可以，需要新状态的话在 `scripts/smoke.js` 里加一步。
- 改了 `native/PeekNative`，CI 会在 Windows 上编译并检查它能正常启动。
- 行情接口的返回格式写在 `scripts/fake-market.js` 里。发现真实接口有它没覆盖的情况（某个字段为空、格式变了），请先在那里加上，再改解析代码。
- 网络请求一律用 `src/http.js` 的 `getText`（走系统代理、不缓存），不要直接用 `fetch`。

## 代码风格

- 纯 JavaScript（CommonJS），不引入构建步骤；界面是原生 DOM，不引入框架。
- 2 空格缩进、单引号、分号，见 [.editorconfig](.editorconfig)。
- 注释和界面文字用中文。界面文字要短、口语化，说清楚“会发生什么”，不要写术语。
- 新增依赖要慎重：余光常驻后台，每多一个依赖都会多占内存。只在某个功能里用到的大库，请在第一次用到时才 `require`（参考 `src/mail.js`）。
- 渲染进程开着 `contextIsolation` 和 `sandbox`，只能通过 `src/preload.js` 暴露的接口和主进程通信；新接口请同时在 `scripts/mock-preload.js` 里加上假实现。

## 提交信息与 PR

- 提交信息用中文，一行说清做了什么，例如 `预警：支持北交所 30% 涨跌停`。
- 一个 PR 只做一件事；改动较大时先开 Draft PR。
- PR 描述里写清楚：改了什么、为什么、怎么验证的。

## 发布（维护者）

1. 修改 `package.json` 的 `version`，在 [CHANGELOG.md](CHANGELOG.md) 里写好这一版的变化。
2. 打标签并推送：`git tag v0.3.0 && git push origin v0.3.0`。
3. CI 会在 Windows 上打包，并把安装版和免安装版发布到 Releases。

## 行为准则

参与本项目即表示同意遵守 [行为准则](CODE_OF_CONDUCT.md)。
