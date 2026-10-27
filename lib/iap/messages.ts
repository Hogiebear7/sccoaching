// Member-facing wording for refused store claims. Stable and non-sensitive on purpose: no ids, no provider detail, no dates.
// The code is the contract the mobile client depends on; the message is a default it may show as-is.

export type StoreConflictMessageCode = "other_store_active" | "subscription_already_active";

export const STORE_CONFLICT_MEMBER_MESSAGE: Record<StoreConflictMessageCode, string> = {
  other_store_active:
    "Your digital plan is already active through a different app store. Manage or cancel it there; you can subscribe here once it has ended.",
  subscription_already_active:
    "You already have an active digital plan on this account. Manage it in your store's subscription settings.",
};
