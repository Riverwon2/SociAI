import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test('one-shot request and completed workspace have no serious automated accessibility violations', async ({
  page
}) => {
  await page.goto('/')

  const requestResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(seriousViolations(requestResults.violations)).toEqual([])

  await page.getByRole('button', { name: /이 요청으로 실행하기/ }).click()
  await expect(page.getByRole('heading', { name: '모든 도움이 연결됐어요' })).toBeVisible()

  const resultResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(seriousViolations(resultResults.violations)).toEqual([])
})

test('scenario controls are reachable in a predictable keyboard order', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /첫 이웃이 바로 수락/ }).focus()

  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: /거절과 무응답 뒤 재섭외/ })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: /첫 이웃이 바로 수락/ })).toBeFocused()
})

test('one-shot request remains usable on a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  await expect(page.getByRole('heading', { name: '오늘 어떤 도움이 필요하세요?' })).toBeVisible()
  await expect(page.getByRole('button', { name: /이 요청으로 실행하기/ })).toBeVisible()
  await page.getByRole('button', { name: /이 요청으로 실행하기/ }).click()

  await expect(page.getByRole('heading', { name: '모든 도움이 연결됐어요' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  )
})

function seriousViolations<TViolation extends { impact: string | null }>(
  violations: readonly TViolation[]
) {
  return violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')
}
