export interface BotRuntimeConfig {
  adminTelegramId?: number;
  privacyUrl?: string;
  publicOfferUrl?: string;
  supportUsername?: string;
  termsVersion: string;
  marketplaceChannelId: number;
  marketplaceChannelUrl: string;
  miniAppUrl?: string;
  aiFastStickerFileId?: string;
  aiExpertStickerFileId?: string;
  aiDocumentStickerFileId?: string;
}
