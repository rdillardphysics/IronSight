const { spawnSync, spawn } = require('child_process')
const fs = require('fs')
const http = require('http')
const puppeteer = require('puppeteer')
const axeCore = require('axe-core')

function runCommand(cmd, args, opts = {}) {
  console.log('> ' + [cmd].concat(args || []).join(' '))
  const res = spawnSync(cmd, args || [], Object.assign({ stdio: 'inherit', shell: true }, opts))
  if (res.status !== 0) throw new Error(`${cmd} ${args ? args.join(' ') : ''} failed with ${res.status}`)
}

async function waitForServer(url, timeout = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      await new Promise((res, rej) => {
        const req = http.get(url, (r) => { res() })
        req.on('error', rej)
        req.setTimeout(2000, () => req.destroy(new Error('timeout')))
      })
      return
    } catch (e) {
      await new Promise(r => setTimeout(r, 500))
    }
  }
  throw new Error('Server did not respond in time: ' + url)
}

;(async () => {
  try {
    // Build the app
    runCommand('npm', ['run', 'build'])

    // Start a simple static server serving ./dist on port 5173
    console.log('Starting static server on http://localhost:5173')
    const serverProc = spawn('npx', ['http-server', './dist', '-p', '5173', '-c-1'], { stdio: 'inherit', shell: true })

    // ensure we kill serverProc on exit
    const killServer = () => {
      try { serverProc.kill('SIGTERM') } catch (e) { }
    }
    process.on('exit', killServer)
    process.on('SIGINT', () => { killServer(); process.exit(130) })
    process.on('uncaughtException', (err) => { console.error(err); killServer(); process.exit(1) })

    // wait for server to respond
    await waitForServer('http://localhost:5173/')

    // Launch puppeteer
    console.log('Launching headless Chromium...')
    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] })
    const page = await browser.newPage()
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 60000 })

    // Inject axe-core and run
    console.log('Injecting axe-core...')
    await page.evaluate(axeCore.source)
    console.log('Running axe...')
    const results = await page.evaluate(async () => await axe.run())

    // save JSON report
    const outJson = './a11y-axe.json'
    fs.writeFileSync(outJson, JSON.stringify(results, null, 2))
    console.log('Wrote axe JSON report to', outJson)

    // simple HTML summary
    const outHtml = './a11y-axe.html'
    const title = `Axe Report - ${new Date().toISOString()}`
    let html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial;margin:20px}h1{font-size:18px}pre{white-space:pre-wrap;background:#f6f8fa;padding:12px;border-radius:6px}</style></head><body>`
    html += `<h1>${title}</h1>`
    html += `<p>Violations: <strong>${results.violations.length}</strong>, Needs review: <strong>${results.incomplete.length}</strong></p>`
    results.violations.forEach(v => {
      html += `<section><h2>${v.id} — ${v.impact || 'N/A'} — ${v.help}</h2>`
      html += `<p>${v.description}</p>`
      html += `<pre>${JSON.stringify(v.nodes.map(n => ({ html: n.html, target: n.target, failureSummary: n.failureSummary })), null, 2)}</pre>`
      html += `</section>`
    })
    html += `</body></html>`
    fs.writeFileSync(outHtml, html)
    console.log('Wrote axe HTML summary to', outHtml)

    await browser.close()
    killServer()
    process.exit(0)
  } catch (err) {
    console.error('run-axe failed:', err)
    process.exit(1)
  }
})()
