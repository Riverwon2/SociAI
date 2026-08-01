import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import {
  appendNormalizedEvent,
  createNormalizedEventBuffer
} from '@30-minute-exchange/event-stream'

import { buildFixtureEvents } from '../src/demo/fixture-events.js'
import { getDemoScenario } from '../src/demo/scenarios.js'
import { EventTimeline } from '../src/timeline/EventTimeline.js'
import { deriveTimelineDisplayGroups } from '../src/timeline/timeline-groups.js'

describe('deriveTimelineDisplayGroups', () => {
  it('keeps the source sequence while labelling each event with its correlated bundle', () => {
    const events = buildFixtureEvents(getDemoScenario('multi_helper_split').fixture)
    const buffer = events.reduce(
      (current, event) => appendNormalizedEvent(current, event),
      createNormalizedEventBuffer({ runId: 'run_multi_001' })
    )

    const groups = deriveTimelineDisplayGroups(buffer.items)

    expect(groups.flatMap((group) => group.items.map((item) => item.sequence))).toEqual(
      events.map((event) => event.sequence)
    )
    expect(groups.find((group) => group.items.some((item) => item.sequence === 3))).toMatchObject({
      bundleIds: ['bundle_1']
    })
    expect(groups.find((group) => group.items.some((item) => item.sequence === 4))).toMatchObject({
      bundleIds: ['bundle_2']
    })
  })

  it('does not merge interleaved concurrent bundle activity into one display group', () => {
    const events = buildFixtureEvents(getDemoScenario('multi_helper_split').fixture)
    const buffer = events.reduce(
      (current, event) => appendNormalizedEvent(current, event),
      createNormalizedEventBuffer({ runId: 'run_multi_001' })
    )

    const groups = deriveTimelineDisplayGroups(buffer.items)
    const bundleGroups = groups.filter((group) => group.bundleIds.length === 1)

    expect(bundleGroups.map((group) => group.bundleIds[0])).toContain('bundle_1')
    expect(bundleGroups.map((group) => group.bundleIds[0])).toContain('bundle_2')
    expect(bundleGroups.map((group) => group.items[0]?.sequence)).toEqual(
      [...bundleGroups.map((group) => group.items[0]?.sequence)].sort((left, right) =>
        (left ?? 0) - (right ?? 0)
      )
    )
  })

  it('renders bundle headers while retaining the chronological event order', () => {
    const events = buildFixtureEvents(getDemoScenario('multi_helper_split').fixture)
    const buffer = events.reduce(
      (current, event) => appendNormalizedEvent(current, event),
      createNormalizedEventBuffer({ runId: 'run_multi_001' })
    )

    const { container } = render(createElement(EventTimeline, { items: buffer.items }))

    expect(container.querySelector('[data-bundle-ids="bundle_1"]')).not.toBeNull()
    expect(container.querySelector('[data-bundle-ids="bundle_2"]')).not.toBeNull()
    expect(
      [...container.querySelectorAll<HTMLElement>('[data-sequence]')].map(({ dataset }) =>
        Number(dataset.sequence)
      )
    ).toEqual(events.map((event) => event.sequence))
  })
})
