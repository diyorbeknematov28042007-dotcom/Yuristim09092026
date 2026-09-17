import {
  OpenAiCompatibleResponsesAdapter,
  type OpenAiCompatibleAdapterOptions,
} from './openai-compatible.js';

type OpenAiAdapterOptions = Omit<OpenAiCompatibleAdapterOptions, 'baseUrl' | 'provider'>;

export class OpenAiAdapter extends OpenAiCompatibleResponsesAdapter {
  constructor(options: OpenAiAdapterOptions) {
    super({ ...options, baseUrl: 'https://api.openai.com/v1', provider: 'openai' });
  }
}
