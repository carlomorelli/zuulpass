/**
 * Decrypted vault item payload (docs/architecture.md §5). This is what gets
 * AES-GCM encrypted under the USK before it ever leaves the device.
 */

/** URL match strategy for autofill matching. */
export type UrlMatch = "host" | "domain" | "exact" | "never";

/** A single URL associated with a vault item. */
export interface VaultItemUrl {
  url: string;
  match: UrlMatch;
}

/** A user-defined custom field on a vault item. */
export interface VaultItemField {
  name: string;
  value: string;
  hidden: boolean;
}

/** The decrypted payload of a vault item. */
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

/**
 * Local item = server sync id (metadata) + encrypted payload. The id stays
 * outside the payload so it can be reused verbatim when server vault sync lands.
 */
export interface LocalVaultItem {
  id: string;
  payload: VaultItemPayload;
}

/** Inputs for constructing a new login item. */
export interface LoginItemInput {
  name: string;
  username?: string;
  password?: string;
  urls?: VaultItemUrl[];
  notes?: string;
  folder?: string;
}

/**
 * Create a login-type vault payload from user input.
 * @param input - The login item fields.
 * @returns A complete login `VaultItemPayload`.
 */
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
