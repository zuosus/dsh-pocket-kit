# dsh-pocket-kit

[English](README.md) · 简体中文

Pocket Kit（口袋工具箱）— 一组彼此独立的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 小功能，每个功能都能在插件设置页单独开关（默认全部开启）。

![Pocket Kit 图标](icon.svg)

## 功能

### 固定目录选择器为应用内浏览 —— `pinBrowsePicker`

让 *添加工作区* 始终使用应用内目录浏览器，而不是 macOS 系统文件选择器（系统自动选择器可能因代理或启动环境在不同启动之间切换）。修改这个开关需要重启 DSH；关闭后，下次启动会恢复系统默认。

### 找回被吞掉的输入 —— `inputRecovery`

当某一轮在失败（error / interrupted / aborted）前已经吞掉了你发出的提示时，文字会被保存，并以「放回输入框」横幅重新显示在对话里。

[![输入框上方的找回输入横幅](lib/assets/lost-input.png)](lib/assets/lost-input.png)

### 更换左上角 Logo —— `customLogo`

把侧边栏左上角的鲸鱼图标换成插件自带的鲸鱼娘插画，图片位于 `lib/assets/whale-girl.png`。图片随包分发，且刻意不可配置——DSH 不要求 SVG，因为这个 Logo 是一个可接收任意元素的插槽，而不是文件路径。

[![鲸鱼娘 Logo](lib/assets/whale-girl.png)](lib/assets/whale-girl.png)

更多细节、HTTP 接口和「工作原理」说明见 [docs/DETAIL.md](docs/DETAIL.md)。

## 安装

插件是一个链接到本地 profile 的 npm 包（无需发布到 npm）：

```jsonc
// ~/.dsh/profiles/<profile>/package.json
{
  "dependencies": {
    "dsh-pocket-kit": "link:/path/to/dsh-pocket-kit"
  },
  "dsh": { "profile": { "bundles": [ "dsh-pocket-kit", /* ... */ ] } }
}
```

然后在该 profile 目录运行 `npm install`（或在 profile 的 `node_modules/` 中放一个指向本仓库的符号链接），并重启 DSH。随包提供的 `cordis.patch.yml` 会在启动时固定目录选择器。大多数功能开关会在配置变更后立即生效，但 `pinBrowsePicker` 是例外：目录选择器是启动时挂载的 Host 后端 + Client 界面组合，切换后需要重启 DSH 才会生效（设置页中对应行也会提示这一点）。

## 开发

```sh
npm test   # 九个测试套件：host、config、client、render、banner、pin-switch、logo、logo-client、resolve
```

新增功能：在 `lib/features/index.js` 中注册，在 `lib/index.js` 中声明配置键（`z.boolean().default(true).volatile()`），并把文案键加入客户端的字典。详见 [docs/DETAIL.md](docs/DETAIL.md#adding-a-feature)。

## 许可证

MIT
