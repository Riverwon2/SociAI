import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { loadWorkspaceEnvironmentFile } from '../src/config/load-environment-file.js'

describe('loadWorkspaceEnvironmentFile', () => {
  it('loads the workspace root .env file when the server is started from the workspace', () => {
    const load = vi.fn()
    loadWorkspaceEnvironmentFile({
      workingDirectory: 'C:/workspace',
      exists: (path) => path === resolve('C:/workspace', '.env'),
      load
    })

    expect(load).toHaveBeenCalledWith(resolve('C:/workspace', '.env'))
  })

  it('loads the workspace .env file only when it is present', () => {
    const load = vi.fn()
    loadWorkspaceEnvironmentFile({
      workingDirectory: 'C:/workspace/apps/server',
      exists: (path) => path === resolve('C:/workspace/apps/server', '../../.env'),
      load
    })

    expect(load).toHaveBeenCalledWith(resolve('C:/workspace/apps/server', '../../.env'))
  })

  it('does not fail when the optional .env file is absent', () => {
    const load = vi.fn()
    loadWorkspaceEnvironmentFile({
      workingDirectory: 'C:/workspace/apps/server',
      exists: () => false,
      load
    })

    expect(load).not.toHaveBeenCalled()
  })
})
