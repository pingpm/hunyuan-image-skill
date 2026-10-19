---
name: hunyuan-image
description: Use when an agent needs Tencent Hunyuan or 混元生图 through CloudBase, including first-use credential setup, text-to-image, or editing one reference image.
---

# Hunyuan Image

Use the bundled Node.js 20+ CLI. Resolve commands relative to this skill's directory,
not the user's project. The implementation is self-contained; no original project
or machine-specific path is needed.

## Installation and First Use

For installation through agent tools, run
`node /absolute/path/to/source/scripts/install.mjs --no-configure`
(optionally `--skills-dir /path/to/agent/skills`). This avoids starting a
secret-entry wizard in an agent-owned PTY; continue with the guidance below.

After installation, or before generating, run:

```bash
node scripts/hunyuan-image.mjs status
```

This prints redacted JSON without contacting the service. Exit 2 means setup is
needed. Exit 0 means the required values are present, not that they are valid online.

When setup is needed, guide the user in their language:

> 请在你自己的终端运行下面的配置命令，依次填写 CloudBase 环境 ID、
> SecretId、SecretKey。使用临时凭证时还需填写 SessionToken。
> 密钥输入不会回显，不需要发到聊天里；配置会保存在本机供后续调用。

Give the user the command with this skill's **actual absolute path**:

```bash
node /absolute/path/to/hunyuan-image/scripts/hunyuan-image.mjs configure
```

Let the user run this in their own terminal. An agent-controlled terminal would
require secrets to pass through agent tools. If no terminal is available, have
the user configure the supported environment variables through their agent
host's secret settings. Only when those variables are already supplied and the
user wants them saved locally, run `configure --from-env`.

Required: `CLOUDBASE_ENV_ID`, `TENCENTCLOUD_SECRETID`, `TENCENTCLOUD_SECRETKEY`.
Optional: `TENCENTCLOUD_SESSIONTOKEN`. A token alone is insufficient for this
CloudBase integration; do not invent a Bearer-token endpoint.

Re-run `status` after the user confirms setup. Keep the task pending while
credentials are missing. Do not read or display the credential file, copy
credentials from another project, or embed credentials in commands.
For obtaining credentials and installation targets, see [README.md](README.md).

## Generation

If the SDK is missing, run `npm ci --ignore-scripts --no-audit --no-fund`
in this skill directory. Then:

```bash
node scripts/hunyuan-image.mjs generate \
  --prompt "A watercolor mountain landscape with a clear foreground" \
  --size 1280x720 --revise=false \
  --output /absolute/path/to/project/out/landscape.png
```

For reference editing, add `--input-image /absolute/path/reference.png` or
`--input-image-url https://example.com/reference.png`, never both.
One PNG/JPEG reference, at most 10 MB. I2I leaves size unspecified by default.
Use short, specific prompts; aim for fewer than 500 Chinese characters.
Use `--revise=false` when exact layout constraints matter.
Run `--help` for seed and footnote options.

Use explicit output paths in the user's project. Existing files are refused;
choose a new filename. The CLI downloads the temporary result immediately,
prints JSON with the local path and detected MIME type, and does not transcode.
Use MIME type to choose the final extension when needed.

Show the saved image and inspect it for the requested subject and composition.
Installation and configuration do not generate a test image. Generate only for
an actual image request, and do not automatically retry a failed paid request.
Authentication failures require renewed setup; temporary credentials must be
replaced as a complete set.
