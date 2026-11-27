// "Add an offer": one plain-language form that creates what used to take three forms (a category, a package, a billing option). The catalogue still has those three levels underneath
// (lib/db.ts), so nothing about how members buy or how checkout works changes: this only builds the same three requests the existing forms send. Pure, so the rules are tested once.
//
// Four kinds of offer, in the words an owner uses:
//   membership    a monthly (or every 3 months, or yearly) membership: unlimited classes or a set number a period
//   class_pack    a pack of classes paid for once ("10 classes")
//   trial_pass    the new-member "try us" pass: paid once, once per person, only before they have a membership
//   single_class  one class, paid for once
export type OfferKind = "membership" | "class_pack" | "trial_pass" | "single_class";
export type OfferRenews = "monthly" | "quarterly" | "annual";

export interface OfferInput {
  kind: OfferKind;
  name: string;
  description: string;
  /** Membership only: unlimited, or a set number a period. Packs and trial passes always have a number; a single class is one. */
  unlimited: boolean;
  classCount: string;
  priceEur: string;
  renews: OfferRenews;
  /** Class type slugs this offer can book; empty = all. */
  eligibleSlugs: string[];
  visible: boolean;
}

export const OFFER_KIND_LABEL: Record<OfferKind, string> = {
  membership: "Membership",
  class_pack: "Class pack",
  trial_pass: "Trial pass",
  single_class: "Single class",
};

export const OFFER_KIND_HELP: Record<OfferKind, string> = {
  membership: "Members pay every month (or every 3 months, or yearly) and it renews until they cancel.",
  class_pack: "A set number of classes, paid for once.",
  trial_pass: "A one-off pass for someone new to try the gym. Each person can buy it once, and only before they have a membership.",
  single_class: "One class, paid for once.",
};

const RENEWS_LABEL: Record<OfferRenews, string> = { monthly: "every month", quarterly: "every 3 months", annual: "every year" };

export const emptyOffer = (kind: OfferKind = "membership"): OfferInput => ({
  kind,
  name: "",
  description: "",
  unlimited: kind === "membership",
  classCount: kind === "trial_pass" ? "3" : kind === "class_pack" ? "10" : "",
  priceEur: "",
  renews: "monthly",
  eligibleSlugs: [],
  visible: true,
});

function count(i: OfferInput): number | null {
  if (i.kind === "single_class") return 1;
  if (i.kind === "membership" && i.unlimited) return null;
  const n = Number(i.classCount);
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : NaN;
}

/** The first problem with the form in plain words, or null when it can be created. */
export function validateOffer(i: OfferInput): string | null {
  if (!i.name.trim()) return "Give the offer a name, for example “10 class pack”.";
  const c = count(i);
  if (typeof c === "number" && Number.isNaN(c)) return "Enter how many classes it includes (a whole number from 1 to 1000).";
  const price = Number(i.priceEur);
  if (i.priceEur.trim() === "" || !Number.isFinite(price) || price < 0) return "Enter the price in euros, for example 49.00.";
  if (price > 0 && price < 0.5) return "The lowest card payment is €0.50.";
  return null;
}

const money = (eur: number) => `€${Number.isInteger(eur) ? eur : eur.toFixed(2)}`;

/** One sentence that says exactly what members will get and pay, shown while the owner fills the form in. */
export function describeOffer(i: OfferInput, classTypeNames: string[] = []): string {
  const price = Number(i.priceEur);
  const priceText = Number.isFinite(price) && i.priceEur.trim() !== "" ? money(price) : "€?";
  const c = count(i);
  const classes = typeof c === "number" && !Number.isNaN(c) ? (c === 1 ? "1 class" : `${c} classes`) : c === null ? "unlimited classes" : "classes";
  const types = i.eligibleSlugs.length > 0 && classTypeNames.length > 0 ? ` (${classTypeNames.join(", ")} only)` : "";
  const shown = i.visible ? "Members can see and buy it." : "Hidden from members until you show it.";
  switch (i.kind) {
    case "membership":
      return `Members pay ${priceText} ${RENEWS_LABEL[i.renews]} for ${i.unlimited ? "unlimited classes" : `${classes} each period`}${types}, until they cancel. ${shown}`;
    case "class_pack":
      return `Members pay ${priceText} once for ${classes}${types}. ${shown}`;
    case "trial_pass":
      return `New members pay ${priceText} once for ${classes}${types}. Each person can buy it once, and only before they have a membership; it then disappears from their account. ${shown}`;
    case "single_class":
      return `Members pay ${priceText} once for 1 class${types}. ${shown}`;
  }
}

/** The body for POST /api/staff/catalog/packages. */
export function offerPackagePayload(i: OfferInput, categoryId: string, sortOrder = 0): Record<string, unknown> {
  const c = count(i);
  const recurring = i.kind === "membership";
  return {
    categoryId,
    name: i.name.trim(),
    shortDescription: i.description.trim() || null,
    packageType: recurring ? "membership" : "pass",
    sessionAllowanceType: i.kind === "single_class" ? "single_use" : c === null ? "unlimited" : "fixed_count",
    sessionAllowanceCount: typeof c === "number" && !Number.isNaN(c) && i.kind !== "single_class" ? c : null,
    eligibleClassTypes: i.eligibleSlugs,
    visible: i.visible,
    sortOrder,
    deliveryChannel: "in_person",
    billingChannel: "stripe_web",
    accessType: recurring ? "membership" : "pass",
    introOnly: i.kind === "trial_pass",
  };
}

/** The body for POST /api/staff/catalog/billing-options. */
export function offerOptionPayload(i: OfferInput, packageId: string): Record<string, unknown> {
  const recurring = i.kind === "membership";
  const cadence = i.renews === "annual" ? { intervalUnit: "year", intervalCount: 1 } : i.renews === "quarterly" ? { intervalUnit: "month", intervalCount: 3 } : { intervalUnit: "month", intervalCount: 1 };
  return {
    packageId,
    name: recurring ? (i.renews === "annual" ? "Yearly" : i.renews === "quarterly" ? "Every 3 months" : "Monthly") : "One-off payment",
    billingType: recurring ? "recurring" : "one_time",
    ...(recurring ? cadence : { intervalUnit: null, intervalCount: null }),
    priceEur: Number(i.priceEur).toFixed(2),
    currency: "eur",
    visible: true,
    sortOrder: 0,
    stripePriceId: null,
  };
}
