import { constants, realpathSync } from "node:fs";
import { chmod, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const TEXT_MODEL = "HY-Image-3.0-Plus-4090-Tob-v1.0";
const REFERENCE_MODEL = "HY-Image-v3.0-I2I-ToB-v1.0.1";
const required = ["envId", "secretId", "secretKey"];

export function configPath(env = process.env) {
  return join(env.HUNYUAN_CONFIG_HOME ||
    join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "hunyuan-image"), "credentials.json");
}

function environmentConfig(env) {
  return {
    envId: env.CLOUDBASE_ENV_ID || env.ENV_ID,
    secretId: env.TENCENTCLOUD_SECRETID || env.CLOUDBASE_SECRET_ID,
    secretKey: env.TENCENTCLOUD_SECRETKEY || env.CLOUDBASE_SECRET_KEY,
    sessionToken: env.TENCENTCLOUD_SESSIONTOKEN || env.CLOUDBASE_SESSION_TOKEN,
  };
}

function cleanConfig(value) {
  const config = {};
  for (const key of [...required, "sessionToken"]) {
    if (typeof value[key] === "string" && value[key].trim()) config[key] = value[key].trim();
  }
  return config;
}

function missingFields(config) {
  return required.filter((key) => !config[key]);
}

export async function loadConfig(env = process.env) {
  let stored = {};
  try {
    stored = cleanConfig(JSON.parse(await readFile(configPath(env), "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("Cannot read local configuration. Run configure to replace it.");
  }
  const supplied = cleanConfig(environmentConfig(env));
  if (Boolean(supplied.secretId) !== Boolean(supplied.secretKey)) {
    throw new Error("Set SecretId and SecretKey together in the environment.");
  }
  // Replacing a credential pair must not retain an old temporary session token.
  const config = supplied.secretId ? {
    envId: supplied.envId || stored.envId,
    secretId: supplied.secretId,
    secretKey: supplied.secretKey,
    ...(supplied.sessionToken ? { sessionToken: supplied.sessionToken } : {}),
  } : { ...stored, ...supplied };
  return cleanConfig(config);
}

export async function saveConfig(value, env = process.env) {
  const config = cleanConfig(value);
  const missing = missingFields(config);
  if (missing.length) throw new Error(`Missing credentials: ${missing.join(", ")}. Run configure.`);
  const path = configPath(env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    const file = await open(temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      await file.writeFile(`${JSON.stringify(config, null, 2)}\n`);
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function status(config, env = process.env) {
  const missing = missingFields(config);
  const setupCommand = [process.execPath, fileURLToPath(import.meta.url), "configure"];
  return {
    configured: !missing.length,
    checkedOnline: false,
    configFile: configPath(env),
    missing,
    sessionTokenSet: Boolean(config.sessionToken),
    setupCommand,
    next: missing.length ? `Run in your own terminal: node ${JSON.stringify(setupCommand[1])} configure` :
      "Ready locally; credentials and service access are checked on the next requested generation.",
  };
}

export function buildInput({ prompt, size, seed, footnote, revise, images, imageUrls } = {}) {
  if (!prompt?.trim()) throw new Error("Missing prompt. Pass --prompt.");
  if (images?.length && imageUrls?.length) throw new Error("Use either a local image or an image URL.");
  if (images?.length > 1 || imageUrls?.length > 1) throw new Error("Use one reference image.");
  if (size && !/^\d{2,5}x\d{2,5}$/.test(size)) throw new Error("Invalid size; use WIDTHxHEIGHT.");
  if (seed !== undefined && (!/^\d+$/.test(String(seed)) ||
      !Number.isSafeInteger(Number(seed)) || Number(seed) > 4294967295)) {
    throw new Error("Invalid seed; use an integer between 0 and 4294967295.");
  }
  if (footnote !== undefined && [...footnote].length > 16) throw new Error("Footnote must be at most 16 characters.");
  const reference = Boolean(images?.length || imageUrls?.length);
  return {
    model: reference ? REFERENCE_MODEL : TEXT_MODEL,
    prompt: prompt.trim(),
    revise: { value: revise !== false },
    footnote: footnote ?? " ",
    ...(!reference || size ? { size: size || "1024x1024" } : {}),
    ...(images?.length ? { images } : {}),
    ...(imageUrls?.length ? { image_urls: imageUrls } : {}),
    ...(seed !== undefined ? { seed: Number(seed) } : {}),
  };
}

async function createCloudbaseImage(config, input) {
  let cloudbase;
  try {
    ({ default: cloudbase } = await import("@cloudbase/js-sdk"));
  } catch {
    throw new Error("SDK unavailable. Run npm ci --ignore-scripts in the skill directory.");
  }
  try {
    const app = cloudbase.init({
      env: config.envId, secretId: config.secretId, secretKey: config.secretKey,
      ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
    });
    const model = app.ai().createImageModel("hunyuan-image");
    model.generateImageSubUrlConfig["hunyuan-image"][TEXT_MODEL] = "images/ar/generations";
    return await model.generateImage(input);
  } catch (error) {
    // SDK errors can contain signed URLs, request headers, and credential material.
    const details = `${error.code || ""} ${error.message || ""}`;
    if (/INVALID_CREDENTIALS|Unauthorized|AuthFailure|InvalidSecret|expired.*token/i.test(details)) {
      throw new Error("Authentication failed. Run configure; refresh all three fields for temporary credentials.");
    }
    throw new Error("CloudBase generation failed. Check service activation, quota, network, and parameters. No automatic retry was made.");
  }
}

function imageMime(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return undefined;
}

function httpUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") return url.href;
  } catch { /* Report a fixed message without reproducing a signed URL. */ }
  throw new Error("Image URL must use HTTP or HTTPS.");
}

export async function generate(args, config, {
  createImage = createCloudbaseImage,
  fetchImage = fetch,
} = {}) {
  const missing = missingFields(config);
  if (missing.length) throw new Error(`Missing credentials: ${missing.join(", ")}. Run configure.`);
  if (!args.output) throw new Error("Missing output. Pass --output with a local file path.");
  const output = resolve(args.output);
  try {
    await stat(output);
    throw new Error("Output file already exists. Choose a new path.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let images;
  if (args.inputImage) {
    const path = resolve(args.inputImage);
    if ((await stat(path)).size > 10 * 1024 * 1024) throw new Error("Reference image exceeds 10 MB.");
    const bytes = await readFile(path);
    if (!["image/png", "image/jpeg"].includes(imageMime(bytes))) throw new Error("Reference image must be PNG or JPEG.");
    images = [bytes.toString("base64")];
  }
  const imageUrls = args.inputImageUrl ? [httpUrl(args.inputImageUrl)] : undefined;
  const input = buildInput({ ...args, images, imageUrls });
  const result = await createImage(config, input);
  const image = result?.data?.[0];
  if (!image?.url) throw new Error("No image URL returned. Check service access, quota, and model parameters.");
  let response;
  try {
    response = await fetchImage(httpUrl(image.url), { signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new Error("Image download failed. The generation may already be billed; no automatic retry was made.");
  }
  if (!response.ok) throw new Error(`Image download failed (HTTP ${response.status}); generation may already be billed.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const mimeType = imageMime(bytes);
  if (!mimeType) throw new Error("Download did not contain a supported image.");
  await mkdir(dirname(output), { recursive: true });
  const file = await open(output, "wx");
  try {
    await file.writeFile(bytes);
  } catch (error) {
    await rm(output, { force: true });
    throw error;
  } finally {
    await file.close();
  }
  return {
    output, mimeType, bytes: bytes.length, model: input.model,
    ...(image.revised_prompt ? { revisedPrompt: image.revised_prompt } : {}),
  };
}

export async function configure({ fromEnv = false } = {}) {
  if (fromEnv) {
    await saveConfig(environmentConfig(process.env));
    console.log(JSON.stringify({ saved: true, configFile: configPath(), checkedOnline: false }));
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Open your own terminal and run configure. Required: CloudBase Env ID, SecretId, SecretKey; optional: SessionToken. Do not paste secrets into chat. For existing environment variables use configure --from-env.");
  }
  console.log("Hunyuan Image setup / 混元生图配置");
  console.log("Use a CloudBase environment with Hunyuan image service access.");
  console.log("Required: Env ID, SecretId, SecretKey. A token alone is not sufficient.");
  console.log("Temporary credentials also require SessionToken; refresh the complete set when expired.");
  console.log(`Stored locally as plaintext (owner-only permissions on POSIX): ${configPath()}`);
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const terminal = createInterface({ input: process.stdin, output, terminal: true });
  const controller = new AbortController();
  terminal.on("SIGINT", () => controller.abort());
  const ask = async (label, secret = false) => {
    process.stdout.write(label);
    muted = secret;
    try {
      return (await terminal.question("", { signal: controller.signal })).trim();
    } finally {
      muted = false;
      if (secret) process.stdout.write("\n");
    }
  };
  try {
    const config = {
      envId: await ask("CloudBase Env ID: "),
      secretId: await ask("SecretId (hidden): ", true),
      secretKey: await ask("SecretKey (hidden): ", true),
      sessionToken: await ask("SessionToken (optional, hidden; Enter to skip): ", true),
    };
    await saveConfig(config);
    console.log("Configuration saved. No image was generated. You can now ask your agent to generate an image.");
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Configuration cancelled; no changes saved.");
    throw error;
  } finally {
    terminal.close();
  }
}

function help() {
  const script = JSON.stringify(fileURLToPath(import.meta.url));
  console.log(`Hunyuan Image (Node.js 20+)
  node ${script} status
  node ${script} configure
  node ${script} configure --from-env
  node ${script} generate --prompt "..." --output /absolute/path/image.png

Generation options:
  --input-image PATH       One local PNG/JPEG, up to 10 MB
  --input-image-url URL    One HTTP(S) reference; exclusive with --input-image
  --size WIDTHxHEIGHT     Text default 1024x1024; I2I default unspecified
  --seed INTEGER          Optional seed; does not guarantee identical results
  --revise=false          Disable prompt rewriting
  --footnote TEXT         Optional watermark text (default: one space)

Configuration: ~/.config/hunyuan-image/credentials.json
Overrides: HUNYUAN_CONFIG_HOME (directory), XDG_CONFIG_HOME
Environment: CLOUDBASE_ENV_ID, TENCENTCLOUD_SECRETID,
             TENCENTCLOUD_SECRETKEY, TENCENTCLOUD_SESSIONTOKEN (optional)
status is local only: exit 0 = configured, 2 = setup needed.
Output is JSON. Existing image files are never overwritten.`);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      "from-env": { type: "boolean" },
      prompt: { type: "string" }, output: { type: "string" },
      size: { type: "string" }, seed: { type: "string" }, footnote: { type: "string" },
      revise: { type: "string" },
      "input-image": { type: "string" }, "input-image-url": { type: "string" },
    },
  });
  if (values.help) return help();
  const command = positionals[0];
  if (positionals.length !== 1 || !["status", "configure", "generate"].includes(command)) {
    throw new Error("Choose status, configure, or generate. Run --help for usage.");
  }
  const allowed = command === "generate" ?
    ["prompt", "output", "size", "seed", "footnote", "revise", "input-image", "input-image-url"] :
    command === "configure" ? ["from-env"] : [];
  if (Object.keys(values).some((key) => !allowed.includes(key))) {
    throw new Error(`An option does not apply to ${command}. Run --help.`);
  }
  if (command === "configure") return configure({ fromEnv: values["from-env"] });
  const config = await loadConfig();
  if (command === "status") {
    const report = status(config);
    console.log(JSON.stringify(report));
    process.exitCode = report.configured ? 0 : 2;
    return;
  }
  if (values.revise !== undefined && !["true", "false"].includes(values.revise)) {
    throw new Error("Use --revise=true or --revise=false.");
  }
  const result = await generate({
    ...values, revise: values.revise !== "false",
    inputImage: values["input-image"], inputImageUrl: values["input-image-url"],
  }, config);
  console.log(JSON.stringify(result));
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Node argument-parser errors echo untrusted option values.
    console.error(error.code?.startsWith("ERR_PARSE_ARGS") ?
      "Unknown option or invalid arguments. Run --help." : error.message);
    process.exitCode = 2;
  });
}
