import fs from "node:fs";
import path from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith("--")) continue;
  const key = arg.slice(2);
  const value = process.argv[index + 1]?.startsWith("--") ? "true" : process.argv[index + 1] ?? "true";
  args.set(key, value);
  if (value !== "true") index += 1;
}

const url = args.get("url") ?? "http://127.0.0.1:5173";
const preset = args.get("preset") ?? "u3";
const outDir = path.resolve(args.get("out") ?? `.rig-validation-${preset}`);
const timeout = Number(args.get("timeout") ?? 90000);

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    console.error("Missing Playwright. Install it once with:");
    console.error("  npm install --save-dev playwright");
    console.error("Then run:");
    console.error(`  npm run validate:ui -- --url ${url} --preset ${preset} --out ${outDir}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function safeName(value) {
  return value.replace(/[\\/:*?"<>|\s]+/g, "-");
}

async function setSlider(page, label, value) {
  await page.evaluate(
    ({ label, value }) => {
      const rows = Array.from(document.querySelectorAll(".slider-row"));
      const row = rows.find((item) => item.textContent?.trim().startsWith(label));
      const input = row?.querySelector("input");
      if (!input) throw new Error(`Missing slider: ${label}`);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, String(value));
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(value) }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { label, value }
  );
}

async function sliderBounds(page, label) {
  return page.evaluate((label) => {
    const rows = Array.from(document.querySelectorAll(".slider-row"));
    const row = rows.find((item) => item.textContent?.trim().startsWith(label));
    const input = row?.querySelector("input");
    if (!input) throw new Error(`Missing slider: ${label}`);
    return { min: Number(input.min), max: Number(input.max), value: Number(input.value) };
  }, label);
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(outDir, `${safeName(name)}.png`), fullPage: true });
}

async function clickSingle(page, selector, description) {
  const target = page.locator(selector);
  const count = await target.count();
  if (count !== 1) throw new Error(`Expected one ${description}, found ${count}`);
  await target.click();
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout });
    await page.locator(".preset-select select").selectOption(preset);
    await clickSingle(page, 'button:has-text("加载示例 PSD")', "load sample button");
    await page.waitForSelector("text=自动上限", { timeout });

    const reportTexts = await page.$$eval(".report", (nodes) => nodes.map((node) => node.innerText));
    const report = reportTexts.find((text) => text.includes("自动上限")) ?? "";
    if (!report.includes("0 个未识别图层")) throw new Error(`Import report did not show 0 unknown layers:\n${report}`);
    if (!report.includes("自动上限")) throw new Error(`Import report did not show auto limits:\n${report}`);
    await screenshot(page, `${preset}-00-neutral`);

    const expressions = ["默认", "开心", "生气", "睡着", "左看", "右看", "惊讶"];
    for (const expression of expressions) {
      await clickSingle(page, `button:has-text("${expression}")`, `expression ${expression}`);
      await page.waitForTimeout(180);
      await screenshot(page, `${preset}-preset-${expression}`);
    }

    const axes = ["头部 X", "头部 Y", "头部 Z", "身体 X", "身体 Y", "身体 Z", "眼球 X", "眼球 Y"];
    for (const label of axes) {
      const bounds = await sliderBounds(page, label);
      await setSlider(page, label, bounds.min);
      await page.waitForTimeout(180);
      await screenshot(page, `${preset}-${label}-min`);
      await setSlider(page, label, bounds.max);
      await page.waitForTimeout(180);
      await screenshot(page, `${preset}-${label}-max`);
      await setSlider(page, label, 0);
    }

    const mouthLimit = await sliderBounds(page, "嘴张开上限");
    if (mouthLimit.max < 2.4) throw new Error(`Mouth open limit max is too low: ${mouthLimit.max}`);
    await setSlider(page, "嘴张开上限", mouthLimit.max);
    await setSlider(page, "嘴开合", (await sliderBounds(page, "嘴开合")).max);
    await page.waitForTimeout(180);
    await screenshot(page, `${preset}-mouth-open-max`);
    await setSlider(page, "嘴开合", 0);

    await setSlider(page, "左臂抬起", 1);
    await setSlider(page, "右臂抬起", 1);
    await page.waitForTimeout(200);
    await screenshot(page, `${preset}-arms-up`);
    await setSlider(page, "左臂抬起", 0);
    await setSlider(page, "右臂抬起", 0);

    await clickSingle(page, 'button:has-text("头模代理")', "proxy head button");
    await page.waitForTimeout(250);
    await setSlider(page, "头部 X", (await sliderBounds(page, "头部 X")).max);
    await screenshot(page, `${preset}-proxy-head-x-max`);

    console.log(`Rig UI validation screenshots written to ${outDir}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
