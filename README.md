# dsh-chat-wallpaper

给 DSH Web 的**聊天对话区**加一张背景图片，并且保证正文始终看得清：插件按当前主题自动校正亮度（曝光）和对比度，再按正文颜色反解出不透明度，使估算对比度不低于 4.5:1。

- 入口：侧边栏「设置 → 聊天背景」
- 只画在对话正文区：不覆盖消息气泡、输入框、侧边栏和标题栏
- 深浅主题自动适配，切换主题立刻重算
- 图片只存在本机 `localStorage`，不上传、不发网络请求

<!-- 待补：docs/setup.png（设置页）、docs/background.png（带背景的会话），补好后在这里引用 -->

## 安装

```sh
# 从 GitHub（推荐先这样试）
dsh plugin --profile web add github:wangjiaxi/dsh-chat-wallpaper

# 从本地目录（开发时用，link 方式，改文件即时生效）
dsh plugin --profile web add /path/to/dsh-chat-wallpaper

# 从 npm（发布之后）
dsh plugin --profile web add dsh-chat-wallpaper@latest
```

装完刷新一次页面，`设置 → 聊天背景` 就会出现。

> 注意：包声明了 `dsh.bundle.patch`，所以 `dsh plugin add` 会自动把它写进 `dsh.profile.bundles`，不需要手改 `cordis.patch.yml`。
>
> 在 Web UI 的插件页里安装时，`dsh-web` 进程的 `PATH` 里必须有 `pnpm`；如果报 `spawn pnpm ENOENT`，就用上面的命令行方式（在你自己 shell 里带好 `PATH`）装。

## 用法

1. 打开 `设置 → 聊天背景`
2. `选择图片`（PNG / JPEG / WebP，12MB 以内；超过 1800px 会先缩小再存）
3. 默认开着「自动校正」，五个滑杆显示的就是解出来的值
4. 觉得还差一点就关掉自动，自己调；页面会实时显示「估算正文对比度 x.x:1」
5. `清除背景` 一键回到默认

## 为什么不是「只调曝光」或「只调对比度」

影响阅读的不是某一个参数，而是**背景与文字的相对亮度**。插件因此分三层，朝同一个方向收敛：

| 参数 | 通俗叫法 | 作用 |
| --- | --- | --- |
| `brightness` | 曝光 | 把整张图的平均亮度移到当前主题底色附近，让壁纸和界面「响度」一致 |
| `contrast` | 对比度 | 压缩明暗跨度。壁纸只需要氛围，不需要满幅细节 |
| `opacity` | 不透明度 | 兜底：解出「最坏像素」仍满足 4.5:1 所需的最大不透明度 |
| `blur` / `saturate` | 模糊 / 饱和度 | 降低高频细节和高饱和色块对字迹的干扰 |

自动模式的算法：

1. 图片缩到 1800px 以内，取 72×72 采样算亮度直方图（`p01` / `p50` / `p99` / 均值），透明像素按「露出底色」跳过。
2. 从主题令牌 `--dsw-alias-bg-base`（底色）和 `--dsw-alias-label-primary`（正文色）**实时解析**真实的 WCAG 相对亮度——不写死深浅色，也不猜。
3. 用底色亮度解出 `brightness`，用目标跨度解出 `contrast`（只压不涨）。
4. 换算最坏像素（暗色主题取最亮、亮色主题取最暗），穿过 `brightness` + `contrast` 后反解不透明度上限，令估算对比度 ≥ 4.5:1，再留 8% 余量。
5. 主题切换由 `MutationObserver` 监听（比对解析出的颜色，不是比对类名），命中就重算重绘。

## 实现要点

- 背景画在 `[data-conversation-region="chat"]::before`：这是会话正文区的稳定 `data-` 属性，不依赖打包后的哈希类名。
- 该区域加 `isolation: isolate` 得到独立堆叠上下文，伪元素 `z-index: -1` 正好落在面板底色之上、所有消息行与文字之下；不碰布局，`pointer-events: none` 也不吃点击。
- 颜色全部走主题令牌，深浅主题一套代码。
- 一个 `<style data-dshwp-style>` 注入 + 一组 `--dshwp-*` 自定义属性；状态（图片 + 五个参数）写 `localStorage['dsh-chat-wallpaper/v1']`。
- Client 半边手写为 `window.__ModuleLoader__.load({ id, factory })`，**不需要构建步骤**，仓库里提交的就是运行产物。

## 目录

| 文件 | 作用 |
| --- | --- |
| `package.json` | 清单：`dsh.bundle.patch` + `dsh.client`（web 平台、`immediately`）+ 兼容性 `peerDependencies` |
| `cordis.patch.yml` | 挂载一行 `chat-wallpaper` |
| `index.js` | Host 半边，空实现（功能全在浏览器端） |
| `client.js` | 设置页 + 样式 + 自动校正算法 |
| `scripts/validate.mjs` | 清单/补丁/导出/注册 id 的自检，可离线跑 |

## 兼容性

`peerDependencies` 里声明了三个 DSH Client 包（`@deepseek-ai/dsh-client-ui-slots`、`dsh-client-locale`、`dsh-client-ui-conversation`），当前对应 **dsh 0.2.0-rc.2**。

DSH 在装载 bundle 时会用运行时版本校验这些 peer 范围；**不匹配会直接跳过整个 bundle**（不会报一堆错，只是插件静默不出现）。所以 DSH 升到 0.3 之前请一并更新这里：

```json
"peerDependencies": {
  "@deepseek-ai/dsh-client-locale": "^0.3.0",
  "@deepseek-ai/dsh-client-ui-slots": "^0.3.0",
  "@deepseek-ai/dsh-client-ui-conversation": "^0.3.0"
}
```

## 已知限制

- 依赖 `data-conversation-region="chat"`。如果上游改名，背景会**静默失效**（不报错）；`设置 → 聊天背景` 里有「已检测到聊天区域」提示，可以用来判断。
- 标题栏和输入框保持不透明，这是刻意的：可读性优先。
- 视觉与交互没有自动化测试（无浏览器环境），只做了清单、bundle 分发和插槽注册的验证。

## 开发

```sh
node --check client.js
node --check index.js
npm run validate        # 清单 / patch / exports / 注册 id
```

插件装成 `link:` 时，改 `client.js` 保存即可，页面侧 HMR 会重新拉取；改 `package.json` 的 `dsh.client` 段通常要重启 `dsh-web`。

## English

DSH Web plugin: an uploaded image as the conversation-area wallpaper. The image is auto-corrected for the active theme — brightness moves its mean luminance onto the theme surface, contrast compresses its range, and opacity is solved so the worst pixel still leaves 4.5:1 against the body text colour. Theme tokens only; no network, no upload, `localStorage` only. Hand-written client module, no build step. Requires `@deepseek-ai/dsh-client-ui-slots` / `dsh-client-locale` / `dsh-client-ui-conversation` peer `^0.2.0-rc.2`.

## 许可

MIT，见 [LICENSE](LICENSE)。
