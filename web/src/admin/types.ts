export interface AdminUser { uid: string; email?: string; isAllowed: boolean; isAdmin: boolean; }
export interface AccessRequest { uid: string; email?: string; note?: string; status: string; }
