const express = require('express');
const puppeteer = require('puppeteer-core');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json({ limit: '10mb' }));

// In-memory image store — keeps last 24 hours of renders
const imageStore = new Map();

setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, data] of imageStore.entries()) {
    if (data.createdAt < cutoff) imageStore.delete(id);
  }
}, 60 * 60 * 1000);

// Serve rendered images by ID
app.get('/images/:id', (req, res) => {
  const data = imageStore.get(req.params.id);
  if (!data) return res.status(404).json({ error: 'Image not found or expired' });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(data.buffer);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', images_in_memory: imageStore.size });
});

let browser = null;

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  });
  return browser;
}

// Render endpoint — matches HCTI API format exactly
// Accepts: { html, css, selector, device_scale }
// Returns: { url, id }
app.post('/render', async (req, res) => {
  const { html, css = '', selector = 'body', device_scale = 1 } = req.body;

  if (!html) return res.status(400).json({ error: 'html is required' });

  let page = null;
  try {
    const b = await getBrowser();
    page = await b.newPage();

    await page.setViewport({
      width: 1080,
      height: 1080,
      deviceScaleFactor: Number(device_scale)
    });

    const fullHtml = css
      ? html.replace('</head>', `<style>${css}</style></head>`)
      : html;

    await page.setContent(fullHtml, { waitUntil: 'networkidle0', timeout: 30000 });

    // Wait for web fonts (Noto Sans Lao) to fully load
    await page.evaluate(() => document.fonts.ready);
    // Small buffer for CSS background images to paint
    await new Promise(r => setTimeout(r, 400));

    const element = await page.$(selector);
    if (!element) throw new Error(`Selector "${selector}" not found in HTML`);

    const screenshot = await element.screenshot({ type: 'png' });
    await page.close();
    page = null;

    const id = uuidv4();
    imageStore.set(id, { buffer: screenshot, createdAt: Date.now() });

    const host = process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : `http://localhost:${process.env.PORT || 3000}`;

    console.log(`Rendered card: ${id} (store size: ${imageStore.size})`);
    res.json({ url: `${host}/images/${id}`, id });

  } catch (err) {
    console.error('Render error:', err.message);
    if (page) await page.close().catch(() => {});
    if (browser) {
      await browser.close().catch(() => {});
      browser = null;
    }
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Renderer listening on port ${PORT}`));
