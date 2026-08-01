export type OpenAIConfig = Readonly<{
  apiKey: string
  model: string
}>

type OpenAIEnvironment = Readonly<Record<string, string | undefined>>

export function loadOpenAIConfig(environment: OpenAIEnvironment): OpenAIConfig {
  return {
    apiKey: requireEnvironmentValue(environment, 'OPENAI_API_KEY'),
    model: requireEnvironmentValue(environment, 'OPENAI_MODEL')
  }
}

function requireEnvironmentValue(environment: OpenAIEnvironment, name: string): string {
  const value = environment[name]?.trim()

  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}
