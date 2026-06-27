// Khởi chạy Electron an toàn: xoá ELECTRON_RUN_AS_NODE nếu bị set sẵn
// (nếu không, require('electron') trả về path string -> app undefined).
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronPath = require('electron') // ngoài electron => đường dẫn tới binary

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env })
child.on('close', (code) => process.exit(code ?? 0))
