import {
  OpenAiCompatibleResponsesAdapter,
  type OpenAiCompatibleAdapterOptions,
} from './openai-compatible.js';

type BaiAdapterOptions = Omit<OpenAiCompatibleAdapterOptions, 'provider'>;

export class BaiAdapter extends OpenAiCompatibleResponsesAdapter {
  constructor(options: BaiAdapterOptions) {
    super({ ...options, provider: 'bai' });
  }
}
