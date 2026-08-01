import { expect, test } from '@playwright/test'

test('첫 후보 수락은 추가 질문 없이 fully matched로 끝난다', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /이 요청으로 실행하기/ }).click()

  await expect(page.getByRole('heading', { name: '오늘 어떤 도움이 필요하세요?' })).toHaveCount(0)
  await expect(page.getByText('신청자 화면', { exact: true })).toBeVisible()
  await expect(page.getByText('도움 수락자 화면', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '우리 동네에 도움이 필요해요' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '모든 도움이 연결됐어요' })).toHaveCount(0)
  await page.getByRole('button', { name: '수락', exact: true }).click()
  await expect(page.getByRole('heading', { name: '모든 도움이 연결됐어요' })).toBeVisible()
  await expect(page.getByText(/가상 이웃 하나님이 도움을 수락했어요/)).toBeVisible()
  await expect(page.getByRole('button', { name: '미션 완료' })).toBeVisible()
  await page.getByRole('button', { name: '미션 완료' }).click()
  await expect(page.getByRole('heading', { name: '도움을 완료했어요' })).toBeVisible()

  await page.getByText('진행 과정 자세히 보기', { exact: true }).click()
  await expect(page.locator('[data-event-type="request.completed"]')).toBeVisible()
  await expect(page.getByText(/현재 화면은 replay이며/)).toBeVisible()
})

test('거절과 timeout 뒤 plan.updated가 다음 섭외보다 먼저 온다', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /거절과 무응답 뒤 재섭외/ }).click()
  await page.getByRole('button', { name: /이 요청으로 실행하기/ }).click()

  await expect(page.getByText(/거절을 눌러 1번째 응답/)).toBeVisible()
  await page.getByRole('button', { name: '거절', exact: true }).click()
  await expect(page.getByRole('button', { name: '응답하지 않고 시간 보내기' })).toBeVisible()
  await page.getByRole('button', { name: '응답하지 않고 시간 보내기' }).click()
  await expect(page.getByText(/수락을 눌러 3번째 응답/)).toBeVisible()
  await page.getByRole('button', { name: '수락', exact: true }).click()
  await expect(page.getByRole('heading', { name: '모든 도움이 연결됐어요' })).toBeVisible()
  await page.getByText('진행 과정 자세히 보기', { exact: true }).click()
  const eventTypes = await page
    .locator('[data-event-type]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-event-type')))
  const firstPlan = eventTypes.indexOf('plan.updated')
  const secondPlan = eventTypes.indexOf('plan.updated', firstPlan + 1)

  expect(firstPlan).toBeGreaterThan(0)
  expect(secondPlan).toBeGreaterThan(firstPlan)
  expect(eventTypes[firstPlan + 1]).toBe('outreach.sent')
  expect(eventTypes[secondPlan + 1]).toBe('outreach.sent')
  await expect(page.getByText('3번째 섭외 · 수락')).toBeVisible()
})

test('혼합 위험 요청은 안전한 작업의 성공을 보존한다', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /위험한 일만 안전하게 제외/ }).click()
  await page.getByRole('button', { name: /이 요청으로 실행하기/ }).click()

  await expect(page.getByText(/수락을 눌러 1번째 응답/)).toBeVisible()
  await page.getByRole('button', { name: '수락', exact: true }).click()
  await expect(page.getByRole('heading', { name: '안전한 도움만 연결됐어요' })).toBeVisible()
  await page.getByText('진행 과정 자세히 보기', { exact: true }).click()
  await expect(page.getByRole('heading', { name: '문서봉투 전달' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '처방약 복용 보조' })).toBeVisible()
  await expect(page.locator('[data-event-type="task.blocked"]')).toBeVisible()
  await expect(page.locator('[data-event-type="match.confirmed"]')).toBeVisible()
})

test('replay raw 화면은 실제 provider payload를 가장하지 않는다', async ({ page }) => {
  await page.goto('/raw?mode=replay&runId=run_demo')

  await expect(page.getByRole('heading', { name: 'Raw tool events' })).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Replay에는 raw 로그를 만들지 않습니다.' })
  ).toBeVisible()
  await expect(page.getByText('REPLAY', { exact: true })).toBeVisible()
})
