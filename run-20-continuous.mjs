import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const workDir = 'C:/Users/27860/Documents/Codex/2026-05-20/agent/miaoshou-dom';
const userDataDir = path.join(workDir, 'edge-profile');
const artifactsDir = path.join(workDir, 'artifacts');
const owner = process.env.MIAOSHOU_OWNER || '付瑞康(qita02)';
const requestedLimit = Number(process.env.MIAOSHOU_LIMIT || 20);
const startOrder = Number(process.env.MIAOSHOU_START_ORDER || 1);
const limit = requestedLimit + Math.max(0, startOrder - 1);
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const requiredSizes = ['US6', 'US6.5', 'US7', 'US7.5', 'US8', 'US8.5', 'US9', 'US9.5', 'US10'];
const cnSizeToUsSize = [
  { cn: 'CN36', us: 'US6' },
  { cn: 'CN37', us: 'US6.5' },
  { cn: 'CN38', us: 'US7' },
  { cn: 'CN39', us: 'US7.5' },
  { cn: 'CN40', us: 'US8' },
  { cn: 'CN41', us: 'US8.5' },
  { cn: 'CN42', us: 'US9' },
  { cn: 'CN43', us: 'US9.5' },
  { cn: 'CN44', us: 'US10' },
];
const targetCategory = '鞋子 / 女士鞋子 / 女士高跟单鞋';

const products = JSON.parse(await fs.readFile(path.join(workDir, 'products.json'), 'utf8'));
const productByKey = new Map();
for (const product of products) {
  const key = String(product.file || '').match(/(20\d{10,}w\d+h\d+)/)?.[1];
  if (key) productByKey.set(key, product);
}

const report = {
  runId,
  owner,
  limit: requestedLimit,
  startOrder,
  requiredSizes,
  startedAt: new Date().toISOString(),
  targets: [],
  items: [],
};

await fs.mkdir(path.join(artifactsDir, 'run-20'), { recursive: true });

const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'msedge',
  headless: false,
  viewport: { width: 1500, height: 950 },
});
const page = context.pages()[0] ?? await context.newPage();
page.setDefaultTimeout(18000);

function keyFromSrc(src) {
  return String(src || '').match(/(20\d{10,}w\d+h\d+)/)?.[1] ?? null;
}

async function snap(label) {
  const safe = String(label).replace(/[^\w.-]+/g, '_').slice(0, 80);
  const file = path.join(artifactsDir, 'run-20', `${runId}-${safe}.png`);
  await page.screenshot({ path: file, fullPage: false }).catch(() => {});
  return file;
}

async function gotoListAndFilter() {
  await page.goto('https://erp.91miaoshou.com/shein_choice/collect_box/items', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await ensureOwnerFilter(owner);
  await ensurePageSize500();
  await selectAllCurrentPage();
}

async function ensureOwnerFilter(targetOwner) {
  const more = page.getByText('更多筛选', { exact: false });
  if (await more.count()) {
    const text = await page.evaluate(() => document.body.innerText || '');
    if (!text.includes('所属人员:')) await more.first().click();
  }
  await page.waitForTimeout(500);

  const opened = await page.evaluate(() => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const item = [...document.querySelectorAll('.el-form-item')].find((node) => textOf(node).includes('所属人员:'));
    const input = item?.querySelector('input.el-input__inner');
    if (input?.value) input.value = '';
    const clickable = item?.querySelector('.el-input, input, .el-select');
    clickable?.click();
    return { ok: Boolean(clickable), text: textOf(item), value: input?.value || '' };
  });
  if (!opened.ok) throw new Error('owner filter not found');
  await page.waitForTimeout(600);

  const selected = await page.evaluate((name) => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const option = [...document.querySelectorAll('.el-select-dropdown__item, .el-checkbox__label, li, span')]
      .filter(visible)
      .find((node) => textOf(node) === name);
    option?.click();
    return { ok: Boolean(option), text: textOf(option) };
  }, targetOwner);
  if (!selected.ok) throw new Error(`owner option not found: ${targetOwner}`);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);

  const searched = await page.evaluate(() => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const button = [...document.querySelectorAll('button')].find((node) => textOf(node) === '搜索');
    button?.click();
    return Boolean(button);
  });
  if (!searched) throw new Error('search button not found');
  await page.waitForTimeout(2200);
}

async function ensurePageSize500() {
  const current = await page.evaluate(() => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('.el-pagination input, .el-pagination .el-select input, input')]
      .map((input) => input.value || input.getAttribute('placeholder') || textOf(input.parentElement))
      .find((value) => /\d+条\/页/.test(value)) || '';
  });
  if (current.includes('500条/页')) return { ok: true, changed: false, current };

  const opened = await page.evaluate(() => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const inputs = [...document.querySelectorAll('input.el-input__inner, input')]
      .filter(visible)
      .filter((input) => /\d+条\/页/.test(input.value || textOf(input.parentElement)));
    const input = inputs.at(-1);
    (input?.closest('.el-select') || input)?.click();
    return { ok: Boolean(input), value: input?.value || textOf(input?.parentElement) };
  });
  if (!opened.ok) return { ok: false, reason: 'page size selector not found', current };
  await page.waitForTimeout(600);

  const selected = await page.evaluate(() => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const option = [...document.querySelectorAll('.el-select-dropdown__item, li, span')]
      .filter(visible)
      .find((node) => textOf(node) === '500条/页' || textOf(node).includes('500条/页'));
    option?.click();
    return { ok: Boolean(option), text: textOf(option) };
  });
  if (!selected.ok) return { ok: false, reason: '500 per page option not found', opened };
  await page.waitForTimeout(3500);
  return { ok: true, changed: true, opened, selected };
}

async function selectAllCurrentPage() {
  const clicked = await page.evaluate(() => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const label = [...document.querySelectorAll('label.el-checkbox, .el-checkbox, button, span')]
      .filter(visible)
      .find((node) => textOf(node) === '全选' || textOf(node).startsWith('全选 '));
    const input = label?.querySelector?.('input[type="checkbox"]');
    const checked = input?.checked || String(label?.className || '').includes('is-checked');
    if (label && !checked) label.click();
    return { ok: Boolean(label), text: textOf(label), wasChecked: Boolean(checked) };
  });
  await page.waitForTimeout(1000);
  return clicked;
}

async function activePageNo() {
  return await page.evaluate(() => {
    const value = Number((document.querySelector('.el-pagination li.number.active')?.innerText || '').trim());
    return Number.isFinite(value) ? value : null;
  });
}

async function ensurePageNo(pageNo) {
  for (let i = 0; i < 40; i += 1) {
    const current = await activePageNo();
    if (current === pageNo) return;
    const clicked = await page.evaluate((target) => {
      const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
      const exact = [...document.querySelectorAll('.el-pagination li.number')].find((node) => textOf(node) === String(target));
      if (exact) {
        exact.click();
        return true;
      }
      const currentPage = Number(textOf(document.querySelector('.el-pagination li.number.active')));
      const next = document.querySelector('.el-pagination .btn-next:not([disabled])');
      const prev = document.querySelector('.el-pagination .btn-prev:not([disabled])');
      if (Number.isFinite(currentPage) && currentPage < target && next) {
        next.click();
        return true;
      }
      if (Number.isFinite(currentPage) && currentPage > target && prev) {
        prev.click();
        return true;
      }
      return false;
    }, pageNo);
    if (!clicked) throw new Error(`cannot go to page ${pageNo}`);
    await page.waitForTimeout(1000);
  }
  throw new Error(`timed out going to page ${pageNo}`);
}

async function scanTargets() {
  const found = [];
  const seen = new Set();
  for (let pageNo = 1; pageNo <= 40 && found.length < limit; pageNo += 1) {
    try {
      await ensurePageNo(pageNo);
    } catch (error) {
      report.scanStopped = { pageNo, reason: error.message };
      break;
    }
    await page.waitForTimeout(1000);
    const pageItems = await page.evaluate(() => {
      const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
      return [...document.querySelectorAll('img')]
        .map((img, idx) => {
          let row = img.parentElement;
          for (let depth = 0; row && depth < 12; depth += 1, row = row.parentElement) {
            const rowText = textOf(row);
            if (rowText.includes('货号') && rowText.includes('编辑')) {
              return { idx, src: img.src, rowText };
            }
          }
          return null;
        })
        .filter(Boolean)
        .filter((item) => item.src.includes('img03.k3cdn.com'));
    });
    for (const item of pageItems) {
      const key = keyFromSrc(item.src);
      const product = key ? productByKey.get(key) : null;
      if (!key || !product || seen.has(key)) continue;
      if (!item.rowText.includes(owner)) continue;
      seen.add(key);
      found.push({ pageNo, key, excelRow: product._excel_row, product, rowPreview: item.rowText.slice(0, 300) });
      if (found.length >= limit) break;
    }
  }
  report.targets = found.map((target, i) => ({
    order: i + 1,
    pageNo: target.pageNo,
    key: target.key,
    excelRow: target.excelRow,
    title: target.product.title,
    style: target.product.style,
  }));
  return found;
}

async function openEditByKey(key) {
  const opened = await page.evaluate((imageKey) => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const img = [...document.querySelectorAll('img')].find((node) => node.src.includes(imageKey));
    if (!img) return { ok: false, reason: 'image not found' };
    let row = img.parentElement;
    for (let depth = 0; row && depth < 12; depth += 1, row = row.parentElement) {
      const rowText = textOf(row);
      if (!rowText.includes('货号') || !rowText.includes('编辑')) continue;
      const edit = [...row.querySelectorAll('button, a, span')].find((node) => textOf(node) === '编辑');
      if (!edit) return { ok: false, reason: 'edit not found', rowText };
      edit.click();
      return { ok: true, rowText };
    }
    return { ok: false, reason: 'row not found' };
  }, key);
  await page.waitForTimeout(2500);
  return opened;
}

async function clickTab(name) {
  await page.evaluate((tabName) => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const node = [...document.querySelectorAll('[role="tab"], .el-tabs__item, span, div')]
      .find((el) => textOf(el) === tabName);
    node?.click();
  }, name);
  await page.waitForTimeout(800);
}

async function setTitle(product) {
  const marked = await page.evaluate((expectedTitle) => {
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    document.querySelectorAll('[data-codex-title-input="1"]').forEach((node) => node.removeAttribute('data-codex-title-input'));
    const candidates = [...document.querySelectorAll('input')]
      .filter(visible)
      .map((input) => ({ input, rect: input.getBoundingClientRect(), value: input.value || '', placeholder: input.placeholder || '' }))
      .filter((item) => item.rect.left > 500 && item.rect.top > 180 && item.rect.top < 340 && item.rect.width > 400)
      .filter((item) => item.placeholder.includes('??') || item.placeholder.includes('??') || item.value.length > 15 || expectedTitle.includes(item.value.slice(0, 20)))
      .sort((a, b) => b.rect.width - a.rect.width || b.value.length - a.value.length);
    const titleInput = candidates[0]?.input;
    if (!titleInput) return { ok: false, reason: 'title field missing', seen: [...document.querySelectorAll('input')].filter(visible).map((input) => ({ value: input.value, placeholder: input.placeholder, rect: input.getBoundingClientRect() })).slice(0, 20) };
    titleInput.setAttribute('data-codex-title-input', '1');
    return { ok: true, current: titleInput.value };
  }, product.title);
  if (!marked.ok) return marked;
  const locator = page.locator('[data-codex-title-input="1"]').last();
  await locator.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(product.title);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  return await page.evaluate((title) => {
    const input = document.querySelector('[data-codex-title-input="1"]');
    input?.dispatchEvent(new Event('change', { bubbles: true }));
    input?.dispatchEvent(new Event('blur', { bubbles: true }));
    return { ok: input?.value === title, title: input?.value || '' };
  }, product.title);
}

async function setDescription(product) {
  const marked = await page.evaluate(() => {
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    document.querySelectorAll('[data-codex-description-input="1"]').forEach((node) => node.removeAttribute('data-codex-description-input'));
    const candidates = [...document.querySelectorAll('textarea')]
      .filter(visible)
      .map((textarea) => ({ textarea, rect: textarea.getBoundingClientRect(), value: textarea.value || '' }))
      .filter((item) => item.rect.left > 500 && item.rect.top > 250 && item.rect.width > 500)
      .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height));
    const descInput = candidates[0]?.textarea;
    if (!descInput) return { ok: false, reason: 'description field missing' };
    descInput.setAttribute('data-codex-description-input', '1');
    return { ok: true, currentLength: descInput.value.length };
  });
  if (!marked.ok) return marked;
  const locator = page.locator('[data-codex-description-input="1"]').last();
  await locator.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(product.description);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  return await page.evaluate((description) => {
    const input = document.querySelector('[data-codex-description-input="1"]');
    input?.dispatchEvent(new Event('change', { bubbles: true }));
    input?.dispatchEvent(new Event('blur', { bubbles: true }));
    return { ok: input?.value === description, descLength: input?.value?.length || 0 };
  }, product.description);
}
async function verifyActiveProductKey(expectedKey) {
  const state = await page.evaluate((imageKey) => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const keyFromSrcInPage = (src) => String(src || '').match(/(20\d{10,}w\d+h\d+)/)?.[1] || null;
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const sidebarImgs = [...document.querySelectorAll('img')]
      .filter(visible)
      .filter((img) => img.getBoundingClientRect().left < 180)
      .map((img) => {
        let node = img.parentElement;
        let activeScore = 0;
        let activeText = '';
        for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
          const style = getComputedStyle(node);
          const bg = style.backgroundColor || '';
          const cls = String(node.className || '');
          const text = textOf(node);
          if (cls.includes('active') || cls.includes('is-current') || cls.includes('selected')) activeScore += 5;
          if (bg && !['rgba(0, 0, 0, 0)', 'transparent', 'rgb(255, 255, 255)'].includes(bg)) activeScore += 1;
          if (text.length > activeText.length) activeText = text.slice(0, 300);
        }
        return { key: keyFromSrcInPage(img.src), activeScore, text: activeText };
      })
      .filter((item) => item.key);
    const expected = sidebarImgs.find((item) => item.key === imageKey);
    const active = sidebarImgs.slice().sort((a, b) => b.activeScore - a.activeScore)[0] || null;
    return {
      ok: Boolean(expected) && (!active || active.activeScore === 0 || active.key === imageKey || expected.activeScore >= active.activeScore),
      expected,
      active,
      visibleKeys: sidebarImgs.map((item) => ({ key: item.key, activeScore: item.activeScore, text: item.text.slice(0, 80) })),
    };
  }, expectedKey);
  return state;
}

async function setCategory() {
  await clickTab('类目&属性');
  const category = await page.evaluate((wanted) => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const item = [...document.querySelectorAll('.el-form-item')]
      .find((node) => textOf(node).includes('产品类目') && node.querySelector('input'));
    const input = item?.querySelector('input');
    if (!input) return { ok: false, reason: 'category input missing' };
    if (input.value === wanted) return { ok: true, before: input.value, after: input.value, changed: false };
    input.click();
    return { ok: true, before: input.value, changed: true };
  }, targetCategory);
  if (!category.ok) return category;
  if (category.changed) {
    await page.waitForTimeout(800);
    const selected = await page.evaluate(() => {
      const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
      const visible = (el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const clickNode = (name) => {
        const node = [...document.querySelectorAll('.el-cascader-node, li, span')]
          .filter(visible)
          .find((el) => textOf(el) === name || textOf(el).endsWith(name));
        node?.click();
        return Boolean(node);
      };
      return { shoes: clickNode('鞋子'), womenShoes: clickNode('女士鞋子'), highHeel: clickNode('女士高跟单鞋') };
    });
    await page.waitForTimeout(1200);
    await page.keyboard.press('Escape').catch(() => {});
    category.selected = selected;
  }

  const verified = await page.evaluate((wanted) => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const categoryItem = [...document.querySelectorAll('.el-form-item')]
      .find((node) => textOf(node).includes('产品类目') && node.querySelector('input'));
    return {
      category: categoryItem?.querySelector('input')?.value || '',
      ok: (categoryItem?.querySelector('input')?.value || '') === wanted,
    };
  }, targetCategory);
  return { ...category, ...verified };
}

async function setMaterial() {
  await clickTab('类目&属性');
  return await page.evaluate(() => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const materialItem = [...document.querySelectorAll('.el-form-item')]
      .find((node) => textOf(node).trim().startsWith('鞋面材质') && node.querySelector('input'));
    const input = materialItem?.querySelector('input');
    return { ok: input?.value === 'PU皮革', material: input?.value || '', text: textOf(materialItem) };
  });
}

async function readOtherSpecState() {
  await clickTab('SKU信息');
  return await page.evaluate((mapping) => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const item = [...document.querySelectorAll('.el-form-item')]
      .filter(visible)
      .find((node) => textOf(node).includes('其他规格:'));
    const options = [...(item?.querySelectorAll('.sale-attribute-option') || [])]
      .map((node, index) => ({
        index,
        text: textOf(node),
        display: textOf(node.querySelector('.display-text')),
        value: node.querySelector('input')?.value || '',
        placeholder: node.querySelector('input')?.getAttribute('placeholder') || '',
      }));
    const normalize = (value) => String(value || '').replace(/\s+/g, '').toUpperCase();
    const mappedCn = new Set(mapping.map((entry) => entry.cn));
    const values = options.map((option) => option.display || option.value || option.placeholder);
    const cnRemaining = values.filter((value) => mappedCn.has(normalize(value).match(/CN\d+/)?.[0] || normalize(value)));
    return { text: textOf(item).slice(0, 1000), options, values, cnRemaining, ok: cnRemaining.length === 0 };
  }, cnSizeToUsSize);
}

async function deleteOtherSpecSize(size) {
  const result = await page.evaluate((targetSize) => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const item = [...document.querySelectorAll('.el-form-item')]
      .filter(visible)
      .find((node) => textOf(node).includes('其他规格:'));
    const option = [...(item?.querySelectorAll('.sale-attribute-option') || [])]
      .filter(visible)
      .find((node) => textOf(node.querySelector('.display-text')) === targetSize || node.querySelector('input')?.getAttribute('placeholder') === targetSize);
    const del = option?.querySelector('.el-icon-delete') || [...(option?.querySelectorAll('button, i') || [])].find((node) => String(node.className).includes('delete'));
    del?.click();
    return { ok: Boolean(del), size: targetSize };
  }, size);
  await page.waitForTimeout(500);
  return result;
}

async function addOtherSpecSize(size) {
  const clickedAdd = await page.evaluate(() => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const item = [...document.querySelectorAll('.el-form-item')]
      .filter(visible)
      .find((node) => textOf(node).includes('其他规格:'));
    const add = [...(item?.querySelectorAll('button, span') || [])]
      .filter(visible)
      .filter((node) => textOf(node) === '添加选项')
      .at(-1);
    add?.click();
    return Boolean(add);
  });
  if (!clickedAdd) return { ok: false, reason: 'add option button not found', size };
  await page.waitForTimeout(600);

  const clickedBlank = await page.evaluate(() => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const item = [...document.querySelectorAll('.el-form-item')]
      .filter(visible)
      .find((node) => textOf(node).includes('其他规格:'));
    const blank = [...(item?.querySelectorAll('.sale-attribute-option') || [])]
      .filter(visible)
      .find((node) => !textOf(node.querySelector('.display-text')) && !node.querySelector('input')?.getAttribute('placeholder')?.startsWith('US'));
    const display = blank?.querySelector('.sale-attribute-select-display') || blank?.querySelector('input');
    display?.click();
    return Boolean(display);
  });
  if (!clickedBlank) return { ok: false, reason: 'blank option not found after add', size };
  await page.waitForTimeout(500);

  await page.keyboard.type(size, { delay: 20 });
  await page.waitForTimeout(500);
  const selected = await page.evaluate((targetSize) => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const option = [...document.querySelectorAll('.el-select-dropdown__item, li, span')]
      .filter(visible)
      .find((node) => textOf(node) === targetSize);
    option?.click();
    return { ok: Boolean(option), size: targetSize };
  }, size);
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);

  const state = await readOtherSpecState();
  return { ok: state.values?.includes(size), clickedAdd, clickedBlank, selected, size, state };
}

async function switchOtherSpecOption(index, fromValue, toValue) {
  const opened = await page.evaluate(({ index: optionIndex }) => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const item = [...document.querySelectorAll('.el-form-item')]
      .filter(visible)
      .find((node) => textOf(node).includes('其他规格:') || textOf(node).includes('鍏朵粬瑙勬牸:'));
    const option = [...(item?.querySelectorAll('.sale-attribute-option') || [])].filter(visible)[optionIndex];
    const target = option?.querySelector('.sale-attribute-select-display') || option?.querySelector('input') || option;
    target?.click();
    return { ok: Boolean(target), text: textOf(option) };
  }, { index });
  if (!opened.ok) return { ok: false, reason: 'other spec option not found', index, fromValue, toValue };
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+A').catch(() => {});
  await page.keyboard.type(toValue, { delay: 20 });
  await page.waitForTimeout(500);
  const selected = await page.evaluate((targetSize) => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const option = [...document.querySelectorAll('.el-select-dropdown__item, li, span')]
      .filter(visible)
      .find((node) => textOf(node) === targetSize);
    option?.click();
    return { ok: Boolean(option), text: textOf(option) };
  }, toValue);
  await page.waitForTimeout(700);
  await page.keyboard.press('Escape').catch(() => {});
  return { ok: selected.ok, index, fromValue, toValue, opened, selected };
}

async function normalizeOtherSpecs() {
  await clickTab('SKU信息');
  const before = await readOtherSpecState();
  const actions = [];

  const normalizedMapping = new Map();
  for (const entry of cnSizeToUsSize) {
    if (!normalizedMapping.has(entry.cn)) normalizedMapping.set(entry.cn, entry.us);
  }
  for (const option of before.options) {
    const current = option.display || option.value || option.placeholder || option.text;
    const normalized = String(current || '').replace(/\s+/g, '').toUpperCase();
    const cn = normalized.match(/CN\d+/)?.[0] || normalized;
    const targetUs = normalizedMapping.get(cn);
    if (!targetUs) continue;
    actions.push({ action: 'switch-cn-to-us', ...(await switchOtherSpecOption(option.index, current, targetUs)) });
  }

  const after = await readOtherSpecState();
  const failed = actions.filter((action) => !action.ok);
  return { ok: after.ok && failed.length === 0, before, actions, after, cnRemaining: after.cnRemaining, failed };
}

async function applySizeChartTemplate() {
  const revealSizeChart = async () => {
    await page.evaluate(() => {
      const scrollers = [...document.querySelectorAll('div')]
        .filter((node) => node.scrollHeight > node.clientHeight + 80)
        .sort((a, b) => b.clientHeight - a.clientHeight);
      for (const scroller of scrollers.slice(0, 4)) scroller.scrollTop = scroller.scrollHeight;
    });
    await page.waitForTimeout(600);
  };
  await revealSizeChart();
  await clickTab('SKU信息');
  const opened = await page.evaluate(() => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const button = [...document.querySelectorAll('button')].filter(visible).find((node) => textOf(node) === '编辑尺码表');
    button?.click();
    return Boolean(button);
  });
  if (!opened) return { ok: false, reason: 'edit size chart button not found' };
  await page.waitForTimeout(1000);

  const openedSelect = await page.evaluate(() => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const dialog = [...document.querySelectorAll('.el-dialog__wrapper, .el-dialog')]
      .filter(visible)
      .filter((node) => textOf(node).includes('尺码表模板'))
      .sort((a, b) => Number(getComputedStyle(b).zIndex || 0) - Number(getComputedStyle(a).zIndex || 0))[0];
    const input = [...(dialog?.querySelectorAll('input') || [])].find((node) => node.placeholder === '请选择');
    input?.click();
    return Boolean(input);
  });
  if (!openedSelect) return { ok: false, reason: 'size template select not found' };
  await page.waitForTimeout(800);

  const selected = await page.evaluate(() => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const option = [...document.querySelectorAll('.el-select-dropdown__item, li, span')]
      .filter(visible)
      .find((node) => textOf(node) === '高跟单鞋' || textOf(node) === '高跟单鞋 尺寸');
    option?.click();
    return { ok: Boolean(option), text: textOf(option) };
  });
  if (!selected.ok) return { ok: false, reason: '高跟单鞋 size template not found' };
  await page.waitForTimeout(1000);

  const saved = await page.evaluate(() => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const dialogs = [...document.querySelectorAll('.el-dialog__wrapper, .el-dialog')]
      .filter(visible)
      .filter((node) => textOf(node).includes('尺码表模板'))
      .sort((a, b) => Number(getComputedStyle(b).zIndex || 0) - Number(getComputedStyle(a).zIndex || 0));
    const dialog = dialogs[0];
    const button = [...(dialog?.querySelectorAll('button') || [])].filter(visible).find((node) => textOf(node) === '保存');
    button?.click();
    return Boolean(button);
  });
  if (!saved) return { ok: false, reason: 'size chart save button not found' };
  await page.waitForTimeout(1800);
  return { ok: true, selected };
}

async function fillMissingSkuValues() {
  await clickTab('SKU信息');
  const applyAllResult = await applySkuRequiredColumnsToAll();
  await page.evaluate(() => {
    const scroller = document.querySelector('.vxe-table--body-wrapper, .el-table__body-wrapper');
    if (scroller) scroller.scrollTop = 0;
  });
  await page.waitForTimeout(400);

  const summary = { touched: 0, rounds: 0, visibleCounts: {}, remainingInvalid: 0 };
  for (let round = 0; round < 30; round += 1) {
    const result = await page.evaluate(() => {
      const visible = (el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
      const setValue = (el, value) => {
        if (String(el.value || '').trim() === String(value)) return false;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(value));
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(value) }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      };
      const numberValue = (value) => {
        const n = Number.parseFloat(String(value || '').replace(/[^\d.]/g, ''));
        return Number.isFinite(n) ? n : 0;
      };
      const table = document;
      const headers = [...table.querySelectorAll('th, .vxe-header--column, .el-table__header-wrapper .cell, .el-table__header th')]
        .filter(visible)
        .map((node) => ({ text: textOf(node), rect: node.getBoundingClientRect() }));
      const center = (rect) => rect.left + rect.width / 2;
      const headerX = (names, fallback) => {
        const header = headers.find((item) => names.some((name) => item.text.includes(name)));
        return header ? center(header.rect) : fallback;
      };
      const priceX = headerX(['售价', '售價'], 920);
      const stockX = headerX(['库存', '庫存'], 1110);
      const weightX = headerX(['重量'], 1280);
      const classify = (input) => {
        const x = center(input.getBoundingClientRect());
        const distances = [
          ['price', Math.abs(x - priceX)],
          ['stock', Math.abs(x - stockX)],
          ['weight', Math.abs(x - weightX)],
        ].sort((a, b) => a[1] - b[1]);
        return distances[0][0];
      };
      const inputs = [...table.querySelectorAll('input')]
        .filter(visible)
        .filter((input) => {
          const rect = input.getBoundingClientRect();
          const value = String(input.value || '');
          return rect.top > 500 && rect.left > 780 && rect.left < 1370 && /^\d*\.?\d*$/.test(value);
        })
        .map((input) => ({ input, kind: classify(input), value: numberValue(input.value), raw: input.value }));
      const priceInputs = inputs.filter((item) => item.kind === 'price').map((item) => item.input);
      const stockInputs = inputs.filter((item) => item.kind === 'stock').map((item) => item.input);
      const weightInputs = inputs.filter((item) => item.kind === 'weight').map((item) => item.input);

      const defaultPrice = inputs.filter((item) => item.kind === 'price').map((item) => item.value).find((n) => n > 0) || 24;
      const defaultStock = inputs.filter((item) => item.kind === 'stock').map((item) => item.value).find((n) => n > 0) || 200;
      const defaultWeight = inputs.filter((item) => item.kind === 'weight').map((item) => item.value).find((n) => n > 0) || 30;

      let touched = 0;
      for (const input of priceInputs) if (numberValue(input.value) <= 0 && setValue(input, defaultPrice)) touched += 1;
      for (const input of stockInputs) if (numberValue(input.value) <= 0 && setValue(input, defaultStock)) touched += 1;
      for (const input of weightInputs) if (numberValue(input.value) <= 0 && setValue(input, defaultWeight)) touched += 1;
      const remainingInvalid = [...priceInputs, ...stockInputs, ...weightInputs]
        .filter((input) => numberValue(input.value) <= 0).length;

      const scroller = document.querySelector('.vxe-table--body-wrapper, .el-table__body-wrapper');
      const before = scroller?.scrollTop || 0;
      if (scroller) scroller.scrollTop = Math.min(scroller.scrollTop + Math.floor(scroller.clientHeight * 0.85), scroller.scrollHeight);
      const atEnd = !scroller || scroller.scrollTop === before || scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 5;
      return {
        touched,
        atEnd,
        defaults: { price: defaultPrice, stock: defaultStock, weight: defaultWeight },
        visibleCounts: { price: priceInputs.length, stock: stockInputs.length, weight: weightInputs.length },
        remainingInvalid,
      };
    });
    summary.touched += result.touched;
    summary.rounds = round + 1;
    summary.defaults = result.defaults;
    summary.visibleCounts = result.visibleCounts;
    summary.remainingInvalid += result.remainingInvalid;
    if (result.atEnd) break;
    await page.waitForTimeout(250);
  }
  return {
    ok: summary.visibleCounts.price > 0 && summary.visibleCounts.stock > 0 && summary.visibleCounts.weight > 0 && summary.remainingInvalid === 0,
    applyAllResult,
    ...summary,
  };
}

async function applySkuRequiredColumnsToAll() {
  const results = [];
  for (const column of [
    { name: 'price', labels: ['\u552e\u4ef7'], fallbackX: 1000 },
    { name: 'stock', labels: ['\u5e93\u5b58'], fallbackX: 1180 },
    { name: 'weight', labels: ['\u91cd\u91cf'], fallbackX: 1335 },
  ]) {
    const clicked = await page.evaluate((target) => {
      const visible = (el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
      const center = (rect) => rect.left + rect.width / 2;
      const headers = [...document.querySelectorAll('th, .vxe-header--column, .el-table__header-wrapper .cell, .el-table__header th, div, span')]
        .filter(visible)
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.top > 500 && rect.top < 620;
        })
        .map((node) => ({ text: textOf(node), rect: node.getBoundingClientRect() }));
      const header = headers.find((item) => target.labels.some((label) => item.text.includes(label)));
      const x = header ? center(header.rect) : target.fallbackX;
      const inputs = [...document.querySelectorAll('input')]
        .filter(visible)
        .map((node) => ({ node, rect: node.getBoundingClientRect() }))
        .filter((item) => item.rect.top > 600 && item.rect.left > 780 && item.rect.left < 1370)
        .sort((a, b) => Math.abs(center(a.rect) - x) - Math.abs(center(b.rect) - x));
      const anchor = inputs[0]?.rect;
      const icons = [...document.querySelectorAll('i, svg, button, span')]
        .filter(visible)
        .map((node) => ({ node, rect: node.getBoundingClientRect(), cls: String(node.className || ''), text: textOf(node) }))
        .filter((item) => {
          const y = item.rect.top + item.rect.height / 2;
          const iconish = item.cls.includes('cube') || item.cls.includes('box') || item.text === '' || item.rect.width <= 28;
          if (!iconish || !anchor) return false;
          return Math.abs(y - center(anchor)) < 18 && item.rect.left > anchor.right - 5 && item.rect.left < anchor.right + 45;
        })
        .sort((a, b) => a.rect.left - b.rect.left);
      const icon = icons[0]?.node;
      icon?.click();
      return { ok: Boolean(icon), x, found: icons.length, anchor };
    }, column);
    await page.waitForTimeout(400);

    const applied = clicked.ok ? await page.evaluate(() => {
      const visible = (el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
      const option = [...document.querySelectorAll('.el-dropdown-menu__item, .el-select-dropdown__item, li, span, div')]
        .filter(visible)
        .find((node) => textOf(node).includes('\u5e94\u7528\u81f3\u5168\u90e8'));
      option?.click();
      return { ok: Boolean(option), text: textOf(option) };
    }) : { ok: false, reason: 'column apply icon not found' };
    results.push({ column: column.name, clicked, applied });
    await page.waitForTimeout(500);
  }
  return { ok: results.every((item) => item.clicked.ok && item.applied.ok), results };
}

async function clickSaveSyncAndConfirmAll() {
  const clicked = await page.evaluate(() => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const button = [...document.querySelectorAll('button')].filter(visible).find((node) => textOf(node) === '保存并同步到其他店铺');
    button?.click();
    return Boolean(button);
  });
  if (!clicked) return { ok: false, reason: 'save-and-sync button not found' };
  await page.waitForTimeout(1000);

  const incomplete = await page.evaluate(() => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const dialog = [...document.querySelectorAll('.el-dialog__wrapper, .el-dialog')]
      .filter(visible)
      .filter((node) => textOf(node).includes('当前产品信息未填写完整'))
      .sort((a, b) => Number(getComputedStyle(b).zIndex || 0) - Number(getComputedStyle(a).zIndex || 0))[0];
    if (!dialog) return { ok: false };
    const cancel = [...dialog.querySelectorAll('button')].filter(visible).find((node) => textOf(node) === '取消');
    cancel?.click();
    return { ok: true, text: textOf(dialog).slice(0, 300), cancelled: Boolean(cancel) };
  });
  if (incomplete.ok) {
    await page.waitForTimeout(500);
    return { ok: false, reason: 'incomplete sku fields remain before sync', incomplete };
  }

  const confirmed = await page.evaluate(() => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const dialog = [...document.querySelectorAll('.el-dialog__wrapper, .el-dialog')]
      .filter(visible)
      .filter((node) => textOf(node).includes('同步产品信息'))
      .sort((a, b) => Number(getComputedStyle(b).zIndex || 0) - Number(getComputedStyle(a).zIndex || 0))[0];
    if (!dialog) return { ok: false, reason: 'sync dialog missing' };
    const labels = [...dialog.querySelectorAll('label.el-checkbox')].filter(visible);
    const allLabels = labels.filter((label) => textOf(label).startsWith('全选'));
    for (const label of allLabels) {
      const input = label.querySelector('input[type="checkbox"]');
      const checked = input?.checked || label.className.includes('is-checked');
      if (!checked) label.click();
    }
    const allChecked = allLabels.every((label) => label.querySelector('input[type="checkbox"]')?.checked || label.className.includes('is-checked'));
    const checked = labels
      .filter((label) => label.querySelector('input[type="checkbox"]')?.checked || label.className.includes('is-checked'))
      .map(textOf);
    if (allLabels.length < 2 || !allChecked) return { ok: false, reason: 'sync select-all boxes not checked', allSelectCount: allLabels.length, checked };
    const confirm = [...dialog.querySelectorAll('button')].filter(visible).find((node) => textOf(node) === '确定');
    confirm?.click();
    return { ok: Boolean(confirm), allSelectCount: allLabels.length, checked };
  });
  if (!confirmed.ok) return confirmed;
  await page.waitForTimeout(5000);
  return { ok: true, confirmed };
}

async function verifyCurrentSavedState(product, expectedKey) {
  const activeAfterSave = await verifyActiveProductKey(expectedKey);
  if (!activeAfterSave.ok) {
    return { ok: true, autoAdvanced: true, activeAfterSave, note: 'No refresh per user; save dialog confirmed and page advanced.' };
  }

  await clickTab('????');
  const basic = await page.evaluate((expected) => {
    const titleInput = [...document.querySelectorAll('input')]
      .find((input) => input.placeholder?.includes('????') || input.placeholder?.includes('???????'));
    const desc = [...document.querySelectorAll('textarea')]
      .sort((a, b) => (b.value || '').length - (a.value || '').length)[0];
    return {
      title: titleInput?.value || '',
      titleOk: (titleInput?.value || '') === expected.title,
      descLength: desc?.value?.length || 0,
      descOk: (desc?.value || '') === expected.description,
    };
  }, { title: product.title, description: product.description });

  await clickTab('SKU??');
  const specs = await readOtherSpecState();
  return { ok: basic.titleOk && basic.descOk && specs.ok, autoAdvanced: false, activeAfterSave, basic, specs };
}
async function openEditorSidebarItemByKey(key) {
  await page.evaluate(() => {
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const sidebarImg = [...document.querySelectorAll('img')]
      .filter(visible)
      .filter((img) => img.src.includes('img03.k3cdn.com') && img.getBoundingClientRect().left < 180)[0];
    let scroller = sidebarImg?.parentElement;
    for (let depth = 0; scroller && depth < 12; depth += 1, scroller = scroller.parentElement) {
      if (scroller.scrollHeight > scroller.clientHeight + 30) break;
    }
    if (scroller && scroller.scrollHeight > scroller.clientHeight + 30) scroller.scrollTop = 0;
  });

  let last = { ok: false, reason: 'sidebar image not found' };
  for (let round = 0; round < 80; round += 1) {
    last = await page.evaluate((imageKey) => {
      const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
      const visible = (el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const sidebarImgs = [...document.querySelectorAll('img')]
        .filter(visible)
        .filter((img) => img.src.includes('img03.k3cdn.com') && img.getBoundingClientRect().left < 180);
      const img = sidebarImgs.find((node) => node.src.includes(imageKey));
      if (img) {
        let node = img.parentElement;
        for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
          const text = textOf(node);
          if (text.includes('K3') || text.includes('k3') || text.includes('US') || text.length > 5) {
            node.click();
            return { ok: true, text: text.slice(0, 300) };
          }
        }
        img.click();
        return { ok: true, text: textOf(img.parentElement).slice(0, 300) };
      }

      const firstImg = sidebarImgs[0];
      let scroller = firstImg?.parentElement;
      for (let depth = 0; scroller && depth < 12; depth += 1, scroller = scroller.parentElement) {
        if (scroller.scrollHeight > scroller.clientHeight + 30) break;
      }
      if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 30) return { ok: false, reason: 'sidebar scroller not found' };
      const before = scroller.scrollTop;
      scroller.scrollTop = Math.min(scroller.scrollTop + Math.floor(scroller.clientHeight * 0.8), scroller.scrollHeight);
      const atEnd = scroller.scrollTop === before || scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 5;
      return { ok: false, reason: atEnd ? 'sidebar image not found' : 'searching sidebar' };
    }, key);
    if (last.ok) break;
    if (last.reason === 'sidebar image not found' || last.reason === 'sidebar scroller not found') break;
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(1800);
  return last;
}

async function collectEditorSidebarTargets(maxCount) {
  const collected = [];
  const seen = new Set();
  let idleRounds = 0;

  for (let round = 0; round < 80 && collected.length < maxCount && idleRounds < 8; round += 1) {
    const batch = await page.evaluate(() => {
      const visible = (el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const imgs = [...document.querySelectorAll('img')]
        .filter(visible)
        .filter((img) => img.src.includes('img03.k3cdn.com'));
      const rows = imgs
        .filter((img) => img.getBoundingClientRect().left < 180)
        .map((img) => {
          const rect = img.getBoundingClientRect();
          return { src: img.src, top: rect.top, left: rect.left };
        })
        .sort((a, b) => (a.top - b.top) || (a.left - b.left));

      const sidebarImg = imgs
        .filter((img) => img.getBoundingClientRect().left < 180)
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
      let scroller = sidebarImg?.parentElement;
      for (let depth = 0; scroller && depth < 12; depth += 1, scroller = scroller.parentElement) {
        if (scroller.scrollHeight > scroller.clientHeight + 30) break;
      }
      if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 30) {
        scroller = [...document.querySelectorAll('div')]
          .filter(visible)
          .filter((node) => node.scrollHeight > node.clientHeight + 30)
          .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0];
      }
      const scrollInfo = scroller
        ? { top: scroller.scrollTop, height: scroller.scrollHeight, client: scroller.clientHeight }
        : null;
      if (scroller) scroller.scrollTop = Math.min(scroller.scrollTop + Math.floor(scroller.clientHeight * 0.8), scroller.scrollHeight);
      return { rows, scrollInfo };
    });

    const beforeCount = collected.length;
    for (const row of batch.rows) {
      const key = keyFromSrc(row.src);
      const product = key ? productByKey.get(key) : null;
      if (!key || !product || seen.has(key)) continue;
      seen.add(key);
      collected.push({ pageNo: 1, key, excelRow: product._excel_row, product, sidebarTop: row.top });
      if (collected.length >= maxCount) break;
    }

    if (collected.length === beforeCount) idleRounds += 1;
    else idleRounds = 0;
    if (batch.scrollInfo && batch.scrollInfo.top + batch.scrollInfo.client >= batch.scrollInfo.height - 5) idleRounds += 1;
    await page.waitForTimeout(450);
  }

  return collected.slice(0, maxCount);
}

try {
  await gotoListAndFilter();
  await snap('after-owner-filter');
  let targets = await scanTargets();

  await ensurePageNo(targets[0]?.pageNo || 1);
  let editorOpened = false;
  let initialOpenedKey = null;

  if (targets[0]) {
    await ensurePageNo(targets[0].pageNo);
    await page.waitForTimeout(800);
    report.initialOpenScreenshot = await snap(`0-before-list-row-${targets[0].excelRow}`);
    const firstOpen = await openEditByKey(targets[0].key);
    report.initialOpen = firstOpen;
    editorOpened = firstOpen.ok;
    initialOpenedKey = targets[0].key;
    if (!firstOpen.ok) throw new Error(`initial editor open failed: ${firstOpen.reason || ''}`);

    const sidebarTargets = await collectEditorSidebarTargets(limit);
    if (sidebarTargets.length > targets.length) {
      if (!sidebarTargets.some((target) => target.key === initialOpenedKey)) {
        sidebarTargets.unshift(targets[0]);
      }
      targets = sidebarTargets.slice(0, limit);
    }
  }

  targets = targets.slice(Math.max(0, startOrder - 1), Math.max(0, startOrder - 1) + requestedLimit);

  report.targets = targets.map((target, i) => ({
    order: i + 1,
    pageNo: target.pageNo,
    key: target.key,
    excelRow: target.excelRow,
    title: target.product.title,
    style: target.product.style,
  }));
  await fs.writeFile(path.join(artifactsDir, `run-20-targets-${runId}.json`), JSON.stringify(report.targets, null, 2), 'utf8');

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const item = {
      order: index + 1,
      pageNo: target.pageNo,
      key: target.key,
      excelRow: target.excelRow,
      title: target.product.title,
      style: target.product.style,
      status: 'started',
    };
    report.items.push(item);

    let opened;
    if (!editorOpened) {
      await ensurePageNo(target.pageNo);
      await page.waitForTimeout(800);
      item.beforeListScreenshot = await snap(`${item.order}-before-list-row-${item.excelRow}`);
      opened = await openEditByKey(target.key);
      editorOpened = opened.ok;
    } else {
      opened = target.key === initialOpenedKey
        ? { ok: true, reason: 'already opened from list' }
        : await openEditorSidebarItemByKey(target.key);
    }
    item.opened = opened;
    if (!opened.ok) {
      item.status = 'paused';
      item.reason = opened.reason || 'open failed';
      item.afterPauseScreenshot = await snap(`${item.order}-pause-open-row-${item.excelRow}`);
      throw new Error(`paused at 打开商品 row ${item.excelRow}: ${item.reason}`);
    }

    const activeProductCheck = await verifyActiveProductKey(target.key);
    item.activeProductCheck = activeProductCheck;
    if (!activeProductCheck.ok) {
      item.status = 'paused';
      item.reason = `当前高亮商品和表格行不一致: expected=${target.key} active=${activeProductCheck.active?.key || ''}`;
      item.afterPauseScreenshot = await snap(`${item.order}-pause-active-key-row-${item.excelRow}`);
      throw new Error(`paused at 商品校验 row ${item.excelRow}: ${item.reason}`);
    }

    item.beforeEditScreenshot = await snap(`${item.order}-before-edit-row-${item.excelRow}`);
    item.steps = [];

    const titleResult = await setTitle(target.product);
    item.titleResult = titleResult;
    item.steps.push({ name: '改标题', ok: titleResult.ok });
    if (!titleResult.ok) throw new Error(`改标题失败 row ${item.excelRow}: ${titleResult.reason || ''}`);

    const descriptionResult = await setDescription(target.product);
    item.descriptionResult = descriptionResult;
    item.steps.push({ name: '改描述', ok: descriptionResult.ok });
    if (!descriptionResult.ok) throw new Error(`改描述失败 row ${item.excelRow}: ${descriptionResult.reason || ''}`);

    const categoryResult = await setCategory();
    item.categoryResult = categoryResult;
    item.steps.push({ name: '类目', ok: categoryResult.ok });
    if (!categoryResult.ok) {
      item.status = 'paused';
      item.reason = `类目未满足: ${JSON.stringify(categoryResult)}`;
      item.afterPauseScreenshot = await snap(`${item.order}-pause-category-row-${item.excelRow}`);
      throw new Error(`paused at 类目 row ${item.excelRow}: ${item.reason}`);
    }

    const materialResult = await setMaterial();
    item.materialResult = materialResult;
    item.steps.push({ name: '属性', ok: materialResult.ok });
    if (!materialResult.ok) {
      item.status = 'paused';
      item.reason = `属性未满足: ${JSON.stringify(materialResult)}`;
      item.afterPauseScreenshot = await snap(`${item.order}-pause-material-row-${item.excelRow}`);
      throw new Error(`paused at 属性 row ${item.excelRow}: ${item.reason}`);
    }

    const otherSpecsResult = await normalizeOtherSpecs();
    item.otherSpecsResult = otherSpecsResult;
    item.steps.push({ name: '其他规格', ok: otherSpecsResult.ok });
    if (!otherSpecsResult.ok) {
      item.status = 'paused';
      item.reason = `其他规格切换未完成: cnRemaining=${(otherSpecsResult.cnRemaining || []).join(', ')} failed=${JSON.stringify(otherSpecsResult.failed || [])}`;
      item.afterPauseScreenshot = await snap(`${item.order}-pause-other-specs-row-${item.excelRow}`);
      throw new Error(`paused at 其他规格 row ${item.excelRow}: ${item.reason}`);
    }

    const skuFillResult = await fillMissingSkuValues();
    item.skuFillResult = skuFillResult;
    item.steps.push({ name: 'SKU列表信息检测是否完善不完善则填写', ok: skuFillResult.ok });
    if (!skuFillResult.ok) {
      item.status = 'paused';
      item.reason = `SKU列表信息未完善: ${JSON.stringify(skuFillResult)}`;
      item.afterPauseScreenshot = await snap(`${item.order}-pause-sku-list-row-${item.excelRow}`);
      throw new Error(`paused at SKU列表信息检测 row ${item.excelRow}: ${item.reason}`);
    }

    const sizeChartResult = await applySizeChartTemplate();
    item.sizeChartResult = sizeChartResult;
    item.steps.push({ name: '尺码表', ok: sizeChartResult.ok });
    if (!sizeChartResult.ok) {
      item.status = 'paused';
      item.reason = sizeChartResult.reason;
      item.afterPauseScreenshot = await snap(`${item.order}-pause-size-chart-row-${item.excelRow}`);
      throw new Error(`paused at 尺码表 row ${item.excelRow}: ${item.reason}`);
    }

    item.beforeSaveScreenshot = await snap(`${item.order}-before-save-row-${item.excelRow}`);
    const saveResult = await clickSaveSyncAndConfirmAll();
    item.saveResult = saveResult;
    item.steps.push({ name: '保存同步', ok: saveResult.ok });
    if (!saveResult.ok) throw new Error(`save sync failed row ${item.excelRow}: ${saveResult.reason}`);

    const savedStateCheck = await verifyCurrentSavedState(target.product, target.key);
    item.savedStateCheck = savedStateCheck;
    if (!savedStateCheck.ok) {
      item.status = 'paused';
      item.reason = `保存后回查不一致: ${JSON.stringify(savedStateCheck)}`;
      item.afterPauseScreenshot = await snap(`${item.order}-pause-after-save-check-row-${item.excelRow}`);
      throw new Error(`paused at 保存后回查 row ${item.excelRow}: ${item.reason}`);
    }

    item.afterSaveScreenshot = await snap(`${item.order}-after-save-row-${item.excelRow}`);
    item.status = 'saved';
  }
} catch (error) {
  report.error = { message: error.message, stack: error.stack };
  await snap('error');
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  const reportPath = path.join(artifactsDir, `run-20-report-${runId}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({
    runId,
    owner,
    targetCount: report.targets.length,
    saved: report.items.filter((item) => item.status === 'saved').length,
    paused: report.items.filter((item) => item.status === 'paused').length,
    skipped: report.items.filter((item) => item.status === 'skipped').length,
    error: report.error?.message,
    report: reportPath,
  }, null, 2));
  if (process.env.MIAOSHOU_KEEP_OPEN !== '0') {
    console.log('Browser kept open for review. Set MIAOSHOU_KEEP_OPEN=0 to close automatically.');
    await new Promise(() => {});
  } else {
    await context.close();
  }
}
