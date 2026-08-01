import { describe, expect, it } from 'vitest'

import { fixedInitialRequest } from '../src/fixtures/fixed-initial-request.js'
import { loadInitialRequestFromEnvironment } from '../src/config/initial-request-input.js'

describe('loadInitialRequestFromEnvironment', () => {
  it('parses and validates a contract-valid request from INITIAL_REQUEST_JSON', () => {
    expect(
      loadInitialRequestFromEnvironment({ INITIAL_REQUEST_JSON: JSON.stringify(fixedInitialRequest) })
    ).toEqual(fixedInitialRequest)
  })

  it('rejects a missing or malformed JSON input without exposing its contents', () => {
    expect(() => loadInitialRequestFromEnvironment({})).toThrow(/INITIAL_REQUEST_JSON/)
    expect(() => loadInitialRequestFromEnvironment({ INITIAL_REQUEST_JSON: '{' })).toThrow(
      /valid JSON/
    )
  })
})
