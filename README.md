# 混元生图 Agent Skill

让 AI Agent 通过腾讯云 CloudBase 调用混元，生成图片或编辑一张参考图。
代码与安装方式独立于任何业务项目，开源协议为 [MIT](LICENSE)。

**把本仓库链接发给 AI Agent，让它按本文说明自行安装，并引导你在本机填写凭证。**
适用于能读取网页、执行本地命令并加载 skill 的 Agent；只有聊天能力的网页助手无法直接安装。
安装只准备工具和引导配置，不会自动调用收费生图接口。

## 把这句话发给 AI Agent

```text
请安装这个混元生图 skill：
https://github.com/pingpm/hunyuan-image-skill

先阅读 README 的 “Instructions for AI Agents” 和 SKILL.md，
根据你当前的 Agent 环境选择正确的技能目录，完成安装和本地检查，
再引导我在自己的终端填写凭证。不要让我把密钥发到聊天里。
这次只安装和配置，不生成图片。
```

如果 Agent 不能直接读取 GitHub 页面，可让它读取
[原始 README](https://raw.githubusercontent.com/pingpm/hunyuan-image-skill/main/README.md)
和 [原始 SKILL.md](https://raw.githubusercontent.com/pingpm/hunyuan-image-skill/main/SKILL.md)。
Agent 的命令执行仍受其宿主权限和网络设置约束。

## 能做什么

| 用途 | 行为 |
| --- | --- |
| 文生图 | 根据文字提示生成图片，支持尺寸、种子、提示词改写等参数 |
| 参考图编辑 | 输入一张本地 PNG/JPEG 或图片 URL，配合文字修改 |
| 首次配置 | 缺少凭证时引导用户配置，密钥输入不回显 |
| 重复调用 | 复用本机配置或宿主注入的环境变量 |
| 保存结果 | 下载到指定本地路径，输出 JSON，拒绝覆盖已有图片 |

本项目是 **Skill + CLI**，没有 MCP Server。支持 `SKILL.md` 且能执行 Node.js
命令的 Agent 可按自己的技能目录安装；不支持 skill 但能执行命令的 Agent 可直接调用 CLI。
各 Agent 的技能发现机制可能不同，不代表已经在所有客户端逐一测试。

## 自己安装

需要 Git、Node.js 20+ 和 npm。下面的命令适用于 macOS / Linux 终端；
Windows 安装流程尚未验证。

```bash
git clone https://github.com/pingpm/hunyuan-image-skill.git
cd hunyuan-image-skill
node scripts/install.mjs
```

默认安装到 `${CODEX_HOME:-~/.codex}/skills/hunyuan-image`，
自动安装锁定版本的依赖，并在你的终端启动配置向导。
已有同名目录时默认停止，不会直接覆盖。

其他目标目录示例：

```bash
# Claude Code
node scripts/install.mjs --skills-dir ~/.claude/skills

# 使用 ~/.agents/skills 的 Agent
node scripts/install.mjs --skills-dir ~/.agents/skills

# 自定义 Agent 的实际技能目录
node scripts/install.mjs --skills-dir /absolute/path/to/agent/skills
```

`--skills-dir` 是**技能父目录**，安装器会在其中创建 `hunyuan-image/`。
请选择当前 Agent 实际读取的目录，不要因为默认值是 Codex 就装错位置。
安装后按宿主要求刷新技能或开始新会话。

## Instructions for AI Agents

Use this section when a user gives you this repository URL and asks you to install
the skill. The repository is standalone: `SKILL.md`, `package.json`, and `scripts/`
are at its root. No original project, private file, or machine-specific path is needed.

1. Read this README, [SKILL.md](SKILL.md), and [scripts/install.mjs](scripts/install.mjs).
   Confirm that your host allows local file operations, command execution, and network access.
   Check `git --version`, `node --version`, and `npm --version`; Node.js must be 20+.
   If a prerequisite is unavailable, report it and follow the host's normal setup process.
2. Identify **your current Agent's actual skill discovery directory** from its
   configuration or documentation. Examples: Codex `${CODEX_HOME:-~/.codex}/skills`,
   Claude Code `~/.claude/skills`, or `~/.agents/skills` for a host configured to use it.
   If the directory cannot be determined, ask only which Agent or directory the user wants.
   Do not silently use the Codex default for another Agent.
3. Clone `https://github.com/pingpm/hunyuan-image-skill.git` into a new working or
   temporary directory. If you already have a checkout, inspect its origin and local
   changes before reusing it. Do not overwrite an unrelated directory or discard edits.
4. From the repository root, run:

   ```bash
   node scripts/install.mjs --skills-dir /absolute/path/to/agent/skills --no-configure
   ```

   Replace the placeholder with the chosen absolute path. `--no-configure` keeps
   secret entry out of agent-controlled terminals. The installer copies the skill
   and runs `npm ci --ignore-scripts --no-audit --no-fund` at the destination.
   Do not use `--skip-deps` for a normal installation. If an installation already
   exists, inspect it; use `--force` only for a user-authorized update.
5. Let `INSTALLED` be the **absolute `hunyuan-image` directory printed by the installer**.
   Run these commands with the actual absolute path:

   ```bash
   node "$INSTALLED/scripts/hunyuan-image.mjs" --help
   npm --prefix "$INSTALLED" test
   node "$INSTALLED/scripts/hunyuan-image.mjs" status
   ```

   `INSTALLED` is notation here; assign it before executing these examples.
   The tests use fake credentials and injected image responses, not paid API calls.
   `status` exit 0 means required fields are present; exit 2 with JSON `missing`
   means installation succeeded but credential setup is still pending.
   Other errors need investigation. Presence does not establish online validity.
6. If setup is needed, tell the user, in their language:

   > 安装已完成。请在你自己的终端运行下面的配置命令，依次填写 CloudBase
   > 环境 ID、SecretId、SecretKey；临时凭证还需 SessionToken。
   > 密钥输入不回显，不需要发到聊天里。

   Provide `node /ACTUAL/INSTALLED/PATH/scripts/hunyuan-image.mjs configure`,
   replacing the placeholder with the actual absolute path. Do not start the
   wizard in an agent-owned PTY or ask for secrets in chat. If the host uses
   managed secrets, have the user supply the variables documented below through
   that host instead. Do not print or inspect credential-file contents.
7. After the user confirms configuration, run absolute-path `status` again.
   Report the installed path and how to refresh discovery in this Agent.
   Distinguish **installed**, **configured locally**, and **verified online**;
   only an actual, user-requested generation verifies the image service.
   Do not generate a test image merely to finish installation.

If the host cannot load `SKILL.md` but can run commands, explain that the CLI can
still be used directly; do not claim native skill integration. A host that only
accepts MCP tools needs an additional MCP wrapper, which this repository does not provide.

## 准备并填写凭证

需要有权限调用混元图片服务的腾讯云 CloudBase 环境，以及该服务的可用额度。
从 [CloudBase 控制台](https://console.cloud.tencent.com/tcb) 和
[腾讯云 API 密钥管理](https://console.cloud.tencent.com/cam/capi) 准备以下字段：

| 字段 | 说明 |
| --- | --- |
| CloudBase Env ID | 目标环境 ID，不是 AppID |
| SecretId | 有目标环境与服务访问权限的腾讯云 API 凭证 |
| SecretKey | 与 SecretId 配套的密钥 |
| SessionToken | 使用 STS 临时凭证时填写，必须与同批临时 SecretId / SecretKey 配套 |

**只有一个 token 不能调用本集成。** 它不是仅接受 Bearer token 的通用图片 API。
还需在目标环境开通相应 AI / 混元图片服务并授予调用权限。

安装时没有配置，或以后需要更新凭证，可在自己的终端执行
安装器输出的配置命令。以默认目录为例：

```bash
node ~/.codex/skills/hunyuan-image/scripts/hunyuan-image.mjs configure
```

凭证以 JSON **明文**保存到 `~/.config/hunyuan-image/credentials.json`；
POSIX 系统目录权限为 `700`、文件为 `600`，不是加密存储。
同一用户、同一配置目录下的不同 Agent 可以复用它。
`XDG_CONFIG_HOME` 可改变配置根目录；`HUNYUAN_CONFIG_HOME`
可指定此工具的独立配置目录。不要把配置放在仓库或 skill 目录里。
临时凭证到期后重新运行配置，替换完整的临时密钥与 SessionToken。
按 Ctrl+C 取消时，原配置保留。

自动化环境可由宿主的密钥管理器注入以下变量，无需保存文件：

```text
CLOUDBASE_ENV_ID
TENCENTCLOUD_SECRETID
TENCENTCLOUD_SECRETKEY
TENCENTCLOUD_SESSIONTOKEN  # 使用临时凭证时必需
```

环境变量中的 SecretId / SecretKey 必须一起提供；它们优先于本地文件。
也兼容 `ENV_ID`、`CLOUDBASE_SECRET_ID`、`CLOUDBASE_SECRET_KEY`、
`CLOUDBASE_SESSION_TOKEN`。只有明确需要落盘时才执行 `configure --from-env`。
本工具不接受命令行密钥参数，不会读取其他项目里的凭证。

## 开始使用

安装并配置后，对 Agent 说：

```text
用混元生成一张 16:9 水彩山景图，远山和小屋在右侧，左侧留白。
```

也可以明确调用 `$hunyuan-image`。Agent 应先检查配置，再执行具体生图请求。
只有用户提出生图请求时才调用服务，安装和配置不自动生图。

直接使用 CLI 时，先进入安装目录，或将脚本路径改为绝对路径：

```bash
# 文生图
node scripts/hunyuan-image.mjs generate \
  --prompt '水彩山景，远山与小屋在右侧，清新配色，左侧留白' \
  --size 1280x720 --revise=false \
  --output /absolute/path/to/project/out/landscape.png

# 参考图编辑
node scripts/hunyuan-image.mjs generate \
  --prompt '保持主体和构图，把背景改为纯白' \
  --input-image /absolute/path/reference.png \
  --revise=false \
  --output /absolute/path/to/project/out/edited.png
```

也支持 `--input-image-url`，与本地参考图互斥。一次最多一张 PNG/JPEG，大小不超过 10 MB。
图生图未指定 `--size` 时不强制设定尺寸。提示词建议控制在 500 个中文字符内；
需要准确保持构图要求时使用 `--revise=false`。

输出 JSON 含本地文件路径、实际 MIME 类型、字节数和模型。
下载按服务返回字节保存，不转码；扩展名不代表实际编码，应参考 `mimeType`。
已有输出文件拒绝覆盖，换一个文件名即可。用 `--help` 查看种子和水印文字等选项。

| 任务 | 本集成使用的模型 |
| --- | --- |
| 文生图 | `HY-Image-3.0-Plus-4090-Tob-v1.0` |
| 图生图 | `HY-Image-v3.0-I2I-ToB-v1.0.1` |

Provider 是 `hunyuan-image`，不应把它当作模型 ID。
默认 `footnote` 发送一个空格，保持原 CLI 的行为；服务端水印效果以实际图片为准。

## 更新与排错

更新源码后，在仓库目录执行以下命令，技能父目录要与首次安装一致：

```bash
git pull --ff-only
node scripts/install.mjs --skills-dir /absolute/path/to/agent/skills --no-configure --force
```

确认源码目录无未保存的改动后再更新。`--force` 只更新列出的工具文件，
不会删除用户额外文件，也不修改独立的凭证配置。

| 情况 | 处理 |
| --- | --- |
| Agent 找不到 skill | 核对技能目录，并按宿主要求刷新或开启新会话 |
| `status` exit 2，JSON 提示字段缺失 | 工具已安装，继续引导本机配置 |
| `SDK unavailable` | 在安装目录执行 `npm ci --ignore-scripts --no-audit --no-fund` |
| 鉴权失败 | 核对环境、权限和密钥；临时凭证需更新完整三件套 |
| 返回无图片或生成失败 | 检查服务开通、额度、网络和模型参数 |
| 图片下载失败 | 生成可能已计费，先排查问题，不要自动连续重试 |
| 输出文件已存在 | 使用新路径，工具不会覆盖原图 |

`status` 只做本地检查。接口错误不会输出 SDK 原始请求、密钥或带签名的结果 URL；
工具不自动重新提交失败的生图请求。SDK 和依赖仍须按锁文件正常安装。

## 开发与验证

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

测试覆盖凭证缺失引导、配置保存权限、凭证不回显、参考图参数、
下载结果和防覆盖、独立安装、许可证保留，以及真实 SDK 加载。
测试不调用收费接口。真实鉴权、生成质量和在线下载需要用户配置后另行验证。

仓库根目录可直接作为 skill 来源；安装器只复制明确列出的文件。
`agents/openai.yaml` 仅为可选的 Codex 展示元数据，CLI 不依赖它。
本仓库使用 [MIT License](LICENSE)。腾讯云服务、SDK 和模型按各自的条款与许可使用；
这是社区工具，不是腾讯云官方产品。
