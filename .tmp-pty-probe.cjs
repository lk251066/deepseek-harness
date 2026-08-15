const path = 'D:/jyrh/jyrh/deepseekharness/node_modules/.pnpm/node-pty@1.1.0_patch_hash=7_101a28b17db9b9156cf314f57eaa9c18/node_modules/node-pty/lib/index.js'
const pty = require(path)
;(async () => {
  for (const extra of [[], ['--patch', '.tmp-smoke-patch.yml']]) {
    const t = pty.spawn('node.exe', ['apps/cli/lib/bin.js', '--profile', 'tui', ...extra, '--dump-config'], {
      name: 'xterm-256color', cols: 100, rows: 30, cwd: 'D:/jyrh/jyrh/deepseekharness', env: process.env,
    })
    let out = ''
    t.onData(d => { out += d })
    await new Promise(res => { t.onExit(res); setTimeout(res, 12000) })
    console.log(JSON.stringify(extra), '=> len', out.length, 'ok:', out.includes('agent-loop'))
    try { t.kill() } catch {}
  }
  process.exit(0)
})()
