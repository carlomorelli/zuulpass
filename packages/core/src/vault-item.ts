// Decrypted vault item payload (docs/architecture.md §5). This is what gets
// AES-GCM encrypted under the USK before it ever leaves the device.

export type UrlMatch = "host" | "domain" | "exact" | "never";

export interface VaultItemUrl {
  url: string;
  match: UrlMatch;
}

export interface VaultItemField {
  name: string;
  value: string;
  hidden: boolean;
}

export interface VaultItemPayload {
  type: "login" | "note";
  name: string;
  username: string;
  password: string;
  urls: VaultItemUrl[];
  totp: string | null;
  notes: string;
  fields: VaultItemField[];
  folder: string;
  favorite: boolean;
}

// Local item = server sync id (metadata) + encrypted payload. The id stays
// outside the payload so it can be reused verbatim when server vault sync lands.
export interface LocalVaultItem {
  id: string;
  payload: VaultItemPayload;
}

export interface LoginItemInput {
  name: string;
  username?: string;
  password?: string;
  urls?: VaultItemUrl[];
  notes?: string;
  folder?: string;
}

export function createLoginItem(input: LoginItemInput): VaultItemPayload {
  return {
    type: "login",
    name: input.name,
    username: input.username ?? "",
    password: input.password ?? "",
    urls: input.urls ?? [],
    totp: null,
    notes: input.notes ?? "",
    fields: [],
    folder: input.folder ?? "",
    favorite: false,
  };
}
