export interface KeyMeta { id: string; label: string; prefix: string; createdAt?: unknown; }
export interface MintedKey extends KeyMeta { key: string; }
