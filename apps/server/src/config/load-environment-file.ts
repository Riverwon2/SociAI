import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

type EnvironmentFileDependencies = Readonly<{
  workingDirectory?: string
  exists?: (path: string) => boolean
  load?: (path: string) => void
}>

/** Loads the workspace .env file when the server is started from apps/server. */
export function loadWorkspaceEnvironmentFile({
  workingDirectory = process.cwd(),
  exists = existsSync,
  load = process.loadEnvFile
}: EnvironmentFileDependencies = {}): void {
  const path = resolve(workingDirectory, '../../.env')
  if (exists(path)) load(path)
}
