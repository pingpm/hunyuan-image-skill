import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  buildInput,
  configPath,
  loadConfig,
  saveConfig,
  generate,
} from "../scripts/hunyuan-image.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const credentials = { envId: "test-env", secretId: "test-id", secretKey: "test-key" };

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), "hunyuan-skill-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function cli(args, env = {}) {
  return spawnSync(process.execPath, [join(root, "scripts/hunyuan-image.mjs"), ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...env },
  });
}

test("fresh install reports missing credential fields without a network call", async (t) => {
  const home = await temporary(t);
  const result = cli(["status"], { HUNYUAN_CONFIG_HOME: home });
  assert.equal(result.status, 2);
  const status = JSON.parse(result.stdout);
  assert.equal(status.configured, false);
  assert.deepEqual(status.missing, ["envId", "secretId", "secretKey"]);
  assert.match(status.next, /configure/);
  assert.deepEqual(status.setupCommand, [
    process.execPath, join(root, "scripts/hunyuan-image.mjs"), "configure",
  ]);
  assert.equal(status.checkedOnline, false);
});

test("config is private, portable, and does not combine different credential pairs", async (t) => {
  const home = await temporary(t);
  const env = { HUNYUAN_CONFIG_HOME: home };
  await saveConfig(credentials, env);
  assert.equal((await stat(configPath(env))).mode & 0o777, 0o600);
  assert.equal((await stat(home)).mode & 0o777, 0o700);
  assert.deepEqual(await loadConfig(env), credentials);
  assert.deepEqual(await loadConfig({
    ...env,
    TENCENTCLOUD_SECRETID: "other-id",
    TENCENTCLOUD_SECRETKEY: "other-key",
    TENCENTCLOUD_SESSIONTOKEN: "temporary-token",
  }), {
    envId: "test-env", secretId: "other-id", secretKey: "other-key",
    sessionToken: "temporary-token",
  });
  await assert.rejects(loadConfig({ ...env, TENCENTCLOUD_SECRETID: "other-id" }),
    /SecretId.*SecretKey/);
});

test("explicit environment import saves secrets without writing them to output", async (t) => {
  const home = await temporary(t);
  const env = {
    HUNYUAN_CONFIG_HOME: home,
    CLOUDBASE_ENV_ID: "test-env",
    TENCENTCLOUD_SECRETID: "secret-id-sentinel",
    TENCENTCLOUD_SECRETKEY: "secret-key-sentinel",
    TENCENTCLOUD_SESSIONTOKEN: "secret-token-sentinel",
  };
  const result = cli(["configure", "--from-env"], env);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /sentinel/);
  const status = cli(["status"], { HUNYUAN_CONFIG_HOME: home });
  assert.equal(status.status, 0);
  assert.doesNotMatch(status.stdout + status.stderr, /sentinel/);
  assert.equal(JSON.parse(status.stdout).sessionTokenSet, true);
  const stored = JSON.parse(await readFile(configPath(env), "utf8"));
  assert.equal(stored.secretKey, env.TENCENTCLOUD_SECRETKEY);
});

test("configure without a user terminal explains setup instead of hanging", async (t) => {
  const home = await temporary(t);
  const result = cli(["configure"], { HUNYUAN_CONFIG_HOME: home });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /terminal/i);
  assert.match(result.stderr, /SecretId/);
  await assert.rejects(stat(configPath({ HUNYUAN_CONFIG_HOME: home })), { code: "ENOENT" });
});

test("generation requires credentials and does not silently generate a default prompt", async (t) => {
  const home = await temporary(t);
  const result = cli(["generate", "--prompt", "test", "--output", join(home, "x.png")],
    { HUNYUAN_CONFIG_HOME: home });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /configure/);
  await assert.rejects(stat(join(home, "x.png")), { code: "ENOENT" });
  assert.throws(() => buildInput({}), /prompt/);
  assert.throws(() => buildInput({ prompt: "test", seed: "NaN" }), /seed/);
  assert.throws(() => buildInput({ prompt: "test", size: "nonsense" }), /size/);
});

test("reference image chooses I2I and leaves size unspecified unless requested", () => {
  assert.deepEqual(buildInput({ prompt: " test ", images: ["YWJj"], revise: false }), {
    model: "HY-Image-v3.0-I2I-ToB-v1.0.1",
    prompt: "test", images: ["YWJj"], revise: { value: false }, footnote: " ",
  });
  const text = buildInput({ prompt: "test", seed: "42" });
  assert.equal(text.size, "1024x1024");
  assert.equal(text.model, "HY-Image-3.0-Plus-4090-Tob-v1.0");
  assert.equal(text.seed, 42);
  assert.throws(() => buildInput({ prompt: "test", images: ["a"], imageUrls: ["https://example.com/a.png"] }),
    /either/);
  assert.throws(() => buildInput({ prompt: "test", images: ["a", "b"] }), /one/);
});

test("generation downloads actual bytes and refuses to overwrite an existing file", async (t) => {
  const home = await temporary(t);
  const output = join(home, "nested", "image.png");
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
  let calls = 0;
  const createImage = async (config, input) => {
    calls++;
    assert.equal(config.secretId, "test-id");
    assert.equal(input.prompt, "test");
    return { data: [{ url: "https://example.com/result?signature=private", revised_prompt: "revised" }] };
  };
  const fetchImage = async () => new Response(bytes, { headers: { "content-type": "image/png" } });
  const result = await generate({ prompt: "test", output }, credentials, { createImage, fetchImage });
  assert.deepEqual(await readFile(output), bytes);
  assert.equal(result.output, output);
  assert.equal(result.mimeType, "image/png");
  assert.equal(result.revisedPrompt, "revised");
  assert.equal(result.url, undefined);
  await assert.rejects(generate({ prompt: "test", output }, credentials, { createImage, fetchImage }),
    /exists/);
  assert.equal(calls, 1);
});

test("invalid reference and failed downloads do not leave fake image files", async (t) => {
  const home = await temporary(t);
  const output = join(home, "image.png");
  const reference = join(home, "reference.txt");
  await writeFile(reference, "not an image");
  const createImage = async () => ({ data: [{ url: "https://example.com/result" }] });
  await assert.rejects(generate({ prompt: "test", inputImage: reference, output }, credentials,
    { createImage }), /PNG|JPEG/);
  await assert.rejects(generate({ prompt: "test", output }, credentials, {
    createImage,
    fetchImage: async () => new Response("<html>error</html>", {
      headers: { "content-type": "text/html" },
    }),
  }), /image/);
  await assert.rejects(stat(output), { code: "ENOENT" });
});

test("unknown flags fail before credential handling instead of silently changing a request", () => {
  const result = cli(["generate", "--promt", "test"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown option/);
});

test("installer copies a standalone skill, guides setup, and protects an existing installation", async (t) => {
  const home = await temporary(t);
  const args = [join(root, "scripts/install.mjs"), "--skills-dir", home, "--skip-deps"];
  const options = { encoding: "utf8", env: { PATH: process.env.PATH, HUNYUAN_CONFIG_HOME: join(home, "config") } };
  const installed = spawnSync(process.execPath, args, options);
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /SecretId/);
  assert.match(installed.stdout, /configure/);
  const target = join(home, "hunyuan-image");
  await stat(join(target, "SKILL.md"));
  await stat(join(target, "package-lock.json"));
  assert.match(await readFile(join(target, "LICENSE"), "utf8"), /MIT License/);
  await assert.rejects(stat(join(target, "credentials.json")), { code: "ENOENT" });
  await assert.rejects(stat(join(target, "node_modules")), { code: "ENOENT" });
  const status = spawnSync(process.execPath, [join(target, "scripts/hunyuan-image.mjs"), "status"], options);
  assert.equal(status.status, 2);
  assert.deepEqual(JSON.parse(status.stdout).missing, ["envId", "secretId", "secretKey"]);
  const again = spawnSync(process.execPath, args, options);
  assert.equal(again.status, 2);
  assert.match(again.stderr, /--force/);
  await writeFile(join(target, "keep.txt"), "user file");
  const update = spawnSync(process.execPath, [...args, "--force"], options);
  assert.equal(update.status, 0, update.stderr);
  assert.equal(await readFile(join(target, "keep.txt"), "utf8"), "user file");
});

test("installed dependencies load the real server SDK and image generation route", async () => {
  const { default: cloudbase } = await import("@cloudbase/js-sdk");
  const app = cloudbase.init({ env: "test-env", secretId: "test-id", secretKey: "test-key" });
  const model = app.ai().createImageModel("hunyuan-image");
  assert.equal(typeof model.generateImage, "function");
  assert.equal(typeof model.generateImageSubUrlConfig["hunyuan-image"], "object");
});
