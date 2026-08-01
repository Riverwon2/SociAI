import { describe, expect, it } from 'vitest'

import { loadOpenAIConfig } from '../src/config/openai-config.js'

describe('loadOpenAIConfig', () => {
  it.each([
    [{ OPENAI_MODEL: 'gpt-5-mini' }, 'OPENAI_API_KEY'],
    [{ OPENAI_API_KEY: 'test-key' }, 'OPENAI_MODEL']
  ])('reports the missing %s variable', (environment, missingVariable) => {
    expect(() => loadOpenAIConfig(environment)).toThrow(
      `Missing required environment variable: ${missingVariable}`
    )
  })

  it('returns the configured API key and model without logging secrets', () => {
    expect(loadOpenAIConfig({ OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'gpt-5-mini' })).toEqual({
      apiKey: 'test-key',
      model: 'gpt-5-mini'
    })
  })
})
