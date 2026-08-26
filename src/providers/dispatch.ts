import { analyzeAnthropicMessages, listAnthropicMessagesModels } from './anthropic-messages.js'
import { analyzeOpenAIChatCompletions, listOpenAIChatCompletionsModels } from './openai-chat-completions.js'
import { analyzeOpenAIResponses, listOpenAIResponsesModels } from './openai-responses.js'
import type { AdapterModelsRequest, AdapterRequest, AdapterResult } from './types.js'

/** Keep protocol selection explicit while each adapter owns its exact wire contract. */
export async function dispatchAdapter(request: AdapterRequest): Promise<AdapterResult> {
  switch (request.provider.protocol) {
    case 'openai-responses':
      return analyzeOpenAIResponses(request)
    case 'openai-chat-completions':
      return analyzeOpenAIChatCompletions(request)
    case 'anthropic-messages':
      return analyzeAnthropicMessages(request)
  }
}

/** Keep model-discovery protocol selection explicit for the same reason as analysis dispatch. */
export async function dispatchModelDiscovery(request: AdapterModelsRequest): Promise<readonly string[]> {
  switch (request.provider.protocol) {
    case 'openai-responses':
      return listOpenAIResponsesModels(request)
    case 'openai-chat-completions':
      return listOpenAIChatCompletionsModels(request)
    case 'anthropic-messages':
      return listAnthropicMessagesModels(request)
  }
}
