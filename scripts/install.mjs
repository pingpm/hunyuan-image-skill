import { spawnSync } from "node:child_process";
import { copyFile, mkdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { configure, loadConfig } from "./hunyuan-image.mjs";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  "SKILL.md", "README.md", "LICENSE", ".gitignore", "package.json", "package-lock.json",
  "agents/openai.yaml", "scripts/hunyuan-image.mjs", "scripts/install.mjs",
  "tests/hunyuan-image.test.mjs",
];

async function main() {
  const { values } = parseArgs({
    options: {
      "skills-dir": { type: "string" },
      force: { type: "boolean" },
      "skip-deps": { type: "boolean" },
      "no-configure": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(`Install: node scripts/install.mjs [--skills-dir DIRECTORY] [--force]
Default: \${CODEX_HOME:-~/.codex}/skills/hunyuan-image
--skip-deps     Copy files only (offline); run npm ci in the installed skill later
--no-configure  Print onboarding instructions without starting the wizard`);
    return;
  }
  if (Number(process.versions.node.split(".")[0]) < 20) throw new Error("Node.js 20 or newer is required.");
  const parent = resolve(values["skills-dir"] ||
    join(process.env.CODEX_HOME || join(homedir(), ".codex"), "skills"));
  const target = join(parent, "hunyuan-image");
  let sameDirectory = false;
  try {
    await stat(target);
    sameDirectory = await realpath(target) === await realpath(source);
    if (!sameDirectory && !values.force) throw new Error("Installation exists. Use --force to update the skill files.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!sameDirectory) {
    // Copy only shipped files; never recursively include credentials or node_modules.
    for (const relative of files) {
      await stat(join(source, relative));
    }
    await mkdir(target, { recursive: true });
    for (const relative of files) {
      const destination = join(target, relative);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(join(source, relative), destination);
    }
  }
  if (!values["skip-deps"]) {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const result = spawnSync(npm, ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: target, stdio: "inherit",
      ...(process.platform === "win32" ? { shell: true } : {}),
    });
    if (result.error || result.status !== 0) throw new Error(`Dependency installation failed. Run npm ci --ignore-scripts in ${target}.`);
  }
  console.log(`Installed: ${target}`);
  let configured = false;
  try {
    const config = await loadConfig();
    configured = Boolean(config.envId && config.secretId && config.secretKey);
  } catch { /* The user can repair stale configuration with the same wizard. */ }
  if (configured) {
    console.log("Local credentials are present. Online access will be checked on the next requested generation.");
    return;
  }
  console.log("First-use setup / 首次配置");
  console.log("Required: CloudBase Env ID, SecretId, SecretKey. Temporary credentials also need SessionToken.");
  console.log("请在自己的终端完成配置，不需要将凭证发到聊天里。");
  // JSON quoting here is display-only, never executable shell interpolation.
  console.log(`Run in your terminal: node ${JSON.stringify(join(target, "scripts/hunyuan-image.mjs"))} configure`);
  console.log("Agent: guide the user through setup, then run status before the next generation.");
  if (!values["no-configure"] && process.stdin.isTTY && process.stdout.isTTY) {
    await configure();
  }
}

main().catch((error) => {
  console.error(error.code?.startsWith("ERR_PARSE_ARGS") ? "Invalid installer arguments. Run --help." : error.message);
  process.exitCode = 2;
});
