export interface PublicDatabaseConfig {
  publishableKey: string;
  url: string;
}

export interface ServerDatabaseConfig extends PublicDatabaseConfig {
  serviceRoleKey: string;
}

export type DatabaseClientFactory<TClient, TConfig extends PublicDatabaseConfig> = (
  config: Readonly<TConfig>,
) => TClient;

export const DB_PACKAGE_BOUNDARY = '@yuristim/db';
