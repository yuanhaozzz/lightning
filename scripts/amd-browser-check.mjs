import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Run against a local preview server; PLAYWRIGHT_MODULE may point at an
// existing toolchain installation without adding browser tooling to production.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const url = process.env.AMD_URL || 'http://localhost:5173/map/amd'
const output = path.resolve('tmp/amd-acceptance')
await mkdir(output, { recursive: true })
const report = { url, passed: false, checks: [], errors: [], screenshots: [] }
const browser = await chromium.launch({
  channel: process.env.AMD_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
const check = (name) => {
  report.checks.push(name)
  console.log(`PASS ${name}`)
}
const settleScroll = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const started = performance.now()
        let previous = scrollY
        let stable = 0
        const tick = () => {
          stable = Math.abs(scrollY - previous) < 0.5 ? stable + 1 : 0
          previous = scrollY
          if (stable >= 6 && performance.now() - started > 200) resolve()
          else if (performance.now() - started > 8000) reject(new Error('Scroll did not settle'))
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
  )
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  })
  const requests = []
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('request', (request) => requests.push(request.url()))
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90_000 })
  await page.getByRole('heading', { level: 1 }).waitFor()
  await page.getByText('移动指针 · 探索视角', { exact: true }).waitFor()
  assert.equal(await page.title(), 'AMD Ryzen 9000 系列 | 生而强悍，不止于快')
  assert.equal(await page.locator('.hero-visual .processor-canvas').count(), 1)
  assert.ok(!requests.some((request) => /cesium|AirportOverview|monitor\.css/i.test(request)))
  check('Direct /map/amd load, title, WebGL render and isolated route bundle')
  if (process.env.AMD_PRODUCTION === '1') {
    assert.ok(
      !requests.some((request) => /@vite\/client|__vue-devtools|__open-in-editor/.test(request)),
    )
    assert.equal(await page.locator('vite-plugin-vue-devtools').count(), 0)
    check('Production preview loads without development client or toolbar')
  }
  await page.screenshot({ path: path.join(output, 'desktop.png') })
  await page.screenshot({ path: path.join(output, 'desktop-full.png'), fullPage: true })
  report.screenshots.push('desktop.png', 'desktop-full.png')
  const energy = page.getByRole('button', { name: '开启能量视效' })
  await energy.click()
  assert.equal(
    await page.getByRole('button', { name: '能量视效已开启' }).getAttribute('aria-pressed'),
    'true',
  )
  check('Energy effect toggle changes accessible state')
  const contextExtension = await page.evaluateHandle(() => {
    const canvas = document.querySelector('.processor-canvas')
    return canvas.getContext('webgl2').getExtension('WEBGL_lose_context')
  })
  await contextExtension.evaluate((extension) => extension.loseContext())
  await page.locator('.hero-visual .processor-fallback').waitFor()
  await contextExtension.evaluate((extension) => extension.restoreContext())
  await page.getByRole('button', { name: '能量视效已开启' }).waitFor()
  await page.locator('.hero-visual .processor-fallback').waitFor({ state: 'hidden' })
  await contextExtension.dispose()
  check('Temporary WebGL context loss restores the scene and controls')
  assert.ok(!requests.some((request) => /fonts\.(googleapis|gstatic)\.com/.test(request)))
  check('Typography loads locally without Google Fonts network requests')
  await page.locator('#anatomy-tab-layers').click()
  await page.waitForFunction(
    () => document.querySelector('#architecture').dataset.chapter === 'layers',
  )
  assert.ok(
    await page
      .locator('.anatomy-stage')
      .evaluate((el) => Math.abs(el.getBoundingClientRect().top - 82) < 3),
  )
  await page.locator('.anatomy-viewer .processor-canvas').waitFor()
  await page.waitForTimeout(900)
  await page.screenshot({ path: path.join(output, 'anatomy-exploded.png') })
  await page.locator('#anatomy-tab-compute').click()
  await page.waitForFunction(
    () => document.querySelector('#architecture').dataset.chapter === 'compute',
  )
  await page.waitForTimeout(900)
  await page.screenshot({ path: path.join(output, 'anatomy-core.png') })
  await page.locator('#anatomy-tab-compute').press('Home')
  await page.waitForFunction(
    () => document.querySelector('#architecture').dataset.chapter === 'precision',
  )
  report.screenshots.push('anatomy-exploded.png', 'anatomy-core.png')
  check('Pinned scroll narrative, exploded/core chapters and reverse keyboard navigation')
  await page.getByRole('tab', { name: '灵感创作' }).click()
  await page.getByRole('tabpanel').getByText('大胆想象。 尽情创造。', { exact: true }).waitFor()
  await page.getByText('FROM FORM TO FEELING', { exact: false }).waitFor()
  await page
    .locator('.experience-panel')
    .screenshot({ path: path.join(output, 'scenario-creation.png') })
  await page.getByRole('tab', { name: '灵感创作' }).press('ArrowRight')
  assert.equal(
    await page.getByRole('tab', { name: '高效进阶' }).getAttribute('aria-selected'),
    'true',
  )
  await page.getByText('IDEAS INTO MOTION', { exact: false }).waitFor()
  await page
    .locator('.experience-panel')
    .screenshot({ path: path.join(output, 'scenario-work.png') })
  await page.getByRole('tab', { name: '高效进阶' }).press('Home')
  assert.equal(
    await page.getByRole('tab', { name: '沉浸游戏' }).getAttribute('aria-selected'),
    'true',
  )
  await page.getByText('BEYOND THE HORIZON', { exact: false }).waitFor()
  await page
    .locator('.experience-panel')
    .screenshot({ path: path.join(output, 'scenario-gaming.png') })
  report.screenshots.push('scenario-creation.png', 'scenario-work.png', 'scenario-gaming.png')
  check('Scenario tabs respond to pointer and keyboard')
  const finder = page.locator('.product-finder')
  for (const [label, id] of [
    ['游戏与多任务', '9700x'],
    ['多线程创作', '9950x'],
    ['日常开发', '9600x'],
  ]) {
    await finder.getByText(label, { exact: true }).click()
    assert.equal(await page.locator('.product-card.is-recommended').count(), 1)
    assert.equal(
      await page.locator('.product-card.is-recommended').getAttribute('id'),
      `processor-${id}`,
    )
    assert.equal(
      await finder.getByRole('link', { name: /查看这款处理器/ }).getAttribute('href'),
      `#processor-${id}`,
    )
  }
  await finder.getByRole('link', { name: /查看这款处理器/ }).click()
  await settleScroll(page)
  assert.ok(
    await page.locator('#processor-9600x').evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return rect.top >= 78 && rect.top < innerHeight
    }),
  )
  await finder.getByRole('radio', { name: '日常开发' }).focus()
  await page.keyboard.press('ArrowLeft')
  assert.equal(await finder.getByRole('radio', { name: '多线程创作' }).isChecked(), true)
  assert.equal(
    await page.locator('.product-card.is-recommended').getAttribute('id'),
    'processor-9950x',
  )
  await page.locator('#products').screenshot({ path: path.join(output, 'products.png') })
  report.screenshots.push('products.png')
  await finder.getByText('查看全部', { exact: true }).click()
  assert.equal(await page.locator('.product-card.is-recommended').count(), 0)
  assert.equal(await finder.getByRole('link', { name: /查看这款处理器/ }).count(), 0)
  check('Use-case selector, native radio keyboard navigation, recommendation and product anchor')
  await page.getByRole('checkbox', { name: /9600X/ }).check()
  const compare = page.getByRole('button', { name: /对比已选处理器/ })
  await compare.click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ state: 'visible' })
  assert.equal(await dialog.locator('thead th').count(), 4)
  assert.ok((await dialog.innerText()).includes('5.7 GHz'))
  assert.ok((await dialog.innerText()).includes('80 MB'))
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden')
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await compare.evaluate((el) => el === document.activeElement), true)
  assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden')
  for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.uncheck()
  assert.equal(await compare.isDisabled(), true)
  await page.getByRole('checkbox', { name: /9950X/ }).check()
  await compare.click()
  assert.equal(await dialog.locator('thead th').count(), 2)
  await page.getByRole('button', { name: '关闭对比' }).click()
  check('Compare 3 / 0 / 1 selections, specs, escape close and restored focus/scroll')
  for (const width of [1920, 1024, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 900 })
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `Overflow at ${width}px`,
    )
    assert.ok(
      await page.locator('.product-specs').evaluateAll((lists) =>
        lists.every((list) => {
          const card = list.closest('.product-card').getBoundingClientRect()
          return [...list.querySelectorAll('dt, dd')].every((item) => {
            const rect = item.getBoundingClientRect()
            return (
              rect.left >= card.left &&
              rect.right <= card.right &&
              item.scrollWidth <= item.clientWidth + 1
            )
          })
        }),
      ),
      `Product specification overflow at ${width}px`,
    )
    if (width === 768 || width === 360) {
      await page
        .locator('#products')
        .screenshot({ path: path.join(output, `products-${width}.png`) })
      report.screenshots.push(`products-${width}.png`)
    }
  }
  await page.setViewportSize({ width: 901, height: 650 })
  await page.locator('#anatomy-tab-layers').click()
  await settleScroll(page)
  assert.ok(
    await page.locator('.anatomy-stage').evaluate((stage) => {
      const rect = stage.getBoundingClientRect()
      const controls = stage.querySelector('.anatomy-bottom').getBoundingClientRect()
      return (
        getComputedStyle(stage).boxSizing === 'border-box' &&
        rect.bottom <= innerHeight + 1 &&
        controls.bottom <= innerHeight
      )
    }),
    'Compact desktop story keeps chapter controls in view',
  )
  assert.equal(
    await page
      .locator('#architecture')
      .evaluate(
        (section) => section.offsetHeight - section.querySelector('.anatomy-stage').offsetHeight,
      ),
    700,
  )
  await page.screenshot({ path: path.join(output, 'anatomy-compact.png') })
  report.screenshots.push('anatomy-compact.png')
  check('Compact desktop chapter remains within viewport with 700px scroll travel')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
  await page.getByRole('button', { name: '打开导航' }).click()
  await page.getByRole('navigation', { name: '移动端导航' }).getByRole('link').first().focus()
  await page.keyboard.press('Escape')
  assert.equal(
    await page
      .getByRole('button', { name: '打开导航' })
      .evaluate((el) => el === document.activeElement),
    true,
  )
  await page.getByRole('button', { name: '打开导航' }).click()
  await page
    .getByRole('navigation', { name: '移动端导航' })
    .getByRole('link', { name: /处理器家族/ })
    .click()
  await settleScroll(page)
  assert.equal(
    await page.getByRole('button', { name: '打开导航' }).getAttribute('aria-expanded'),
    'false',
  )
  assert.ok(
    await page
      .locator('#products')
      .evaluate((el) => Math.abs(el.getBoundingClientRect().top - 78) < 5),
  )
  await compare.click()
  assert.ok(await dialog.isVisible())
  await page.getByRole('button', { name: '继续探索' }).click()
  await page.locator('#anatomy-tab-layers').scrollIntoViewIfNeeded()
  const mobileStoryScroll = await page.evaluate(() => window.scrollY)
  await page.locator('#anatomy-tab-layers').click()
  assert.equal(await page.locator('#architecture').getAttribute('data-chapter'), 'layers')
  assert.equal(
    await page.locator('.anatomy-stage').evaluate((el) => getComputedStyle(el).position),
    'relative',
  )
  assert.ok(Math.abs((await page.evaluate(() => window.scrollY)) - mobileStoryScroll) < 3)
  await page.waitForTimeout(900)
  await page.locator('#architecture').screenshot({ path: path.join(output, 'mobile-anatomy.png') })
  report.screenshots.push('mobile-anatomy.png')
  check('Mobile chapter selection updates the model without pinned scrolling')
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
  await page.screenshot({ path: path.join(output, 'mobile.png') })
  await page.screenshot({ path: path.join(output, 'mobile-full.png'), fullPage: true })
  report.screenshots.push('mobile.png', 'mobile-full.png')
  check('1920 / 1024 / 768 / 390 / 360 responsive layout, mobile menu and comparison')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByText('移动指针 · 探索视角', { exact: true }).waitFor({ state: 'attached' })
  check('Reduced-motion startup retains functional WebGL scene')
  assert.deepEqual(report.errors, [])
  check('No uncaught browser errors')
  await page.close()
  if (process.env.AMD_PRODUCTION === '1') {
    const resourceFailurePage = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await resourceFailurePage.route(/ProcessorScene.*\.js(?:\?|$)/, (route) => route.abort())
    await resourceFailurePage.goto(url, { waitUntil: 'networkidle' })
    await resourceFailurePage
      .locator('.hero-visual')
      .getByText('三维视图暂不可用，您仍可继续浏览产品。', { exact: true })
      .waitFor()
    await resourceFailurePage.getByRole('button', { name: /对比已选处理器/ }).click()
    assert.ok(await resourceFailurePage.getByRole('dialog').isVisible())
    await resourceFailurePage.close()
    check('Failed 3D resource retains product content and comparison')
  }
  const fallbackBrowser = await chromium.launch({
    channel: process.env.AMD_BROWSER_CHANNEL || 'msedge',
    headless: true,
    args: ['--disable-webgl'],
  })
  try {
    const fallbackPage = await fallbackBrowser.newPage({ viewport: { width: 390, height: 844 } })
    await fallbackPage.goto(url, { waitUntil: 'networkidle' })
    await fallbackPage.locator('.hero-visual .processor-fallback').waitFor()
    assert.equal(await fallbackPage.getByRole('button', { name: /能量视效/ }).count(), 0)
    await fallbackPage.getByRole('button', { name: /对比已选处理器/ }).click()
    assert.ok(await fallbackPage.getByRole('dialog').isVisible())
    check('WebGL unavailable: static visual fallback and working comparison')
  } finally {
    await fallbackBrowser.close()
  }
  report.passed = true
} finally {
  await browser.close()
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
}
