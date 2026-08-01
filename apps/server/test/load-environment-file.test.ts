import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { loadWorkspaceEnvironmentFile } from '../src/config/load-environment-file.js'

describe('loadWorkspaceEnvironmentFile', () => {
  it('loads the workspace .env file only when it is present', () => {
    const load = vi.fn()
    loadWorkspaceEnvironmentFile({
      workingDirectory: 'C:/workspace/apps/server',
      exists: () => true,
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
