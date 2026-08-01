import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const serverDirectory = resolve(scriptDirectory, '..')
const source = resolve(serverDirectory, 'src/fixtures/helper-users.json')
const destination = resolve(serverDirectory, 'dist/fixtures/helper-users.json')

mkdirSync(dirname(destination), { recursive: true })
copyFileSync(source, destination)
