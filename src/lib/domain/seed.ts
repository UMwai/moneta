import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { categories } from "@/db/schema";

/**
 * System category taxonomy. Ids are stable slugs (not random) so that seeding is
 * idempotent, rules can reference categories by constant, and a re-seed after an
 * upgrade updates the existing rows instead of duplicating them.
 *
 * `discretionary` marks spend the user could plausibly cut — it drives the spike,
 * large-transaction and subscription insights. Essentials (rent, utilities,
 * insurance, groceries, health) and non-spend flows (income, transfers, savings)
 * are deliberately non-discretionary.
 */

export interface SeedCategory {
  id: string;
  name: string;
  icon: string;
  discretionary?: boolean;
  children?: SeedCategory[];
}

export const CATEGORY_TREE: SeedCategory[] = [
  {
    id: "cat_income",
    name: "Income",
    icon: "trending-up",
    children: [
      { id: "cat_salary", name: "Salary", icon: "banknote" },
      { id: "cat_bonus", name: "Bonus", icon: "gift" },
      { id: "cat_freelance", name: "Freelance", icon: "briefcase" },
      { id: "cat_interest_income", name: "Interest & Dividends", icon: "percent" },
      { id: "cat_refunds", name: "Refunds", icon: "undo-2" },
      { id: "cat_other_income", name: "Other Income", icon: "circle-dollar-sign" },
    ],
  },
  {
    id: "cat_housing",
    name: "Housing",
    icon: "home",
    children: [
      { id: "cat_rent", name: "Rent", icon: "key" },
      { id: "cat_mortgage", name: "Mortgage", icon: "landmark" },
      { id: "cat_home_maintenance", name: "Home Maintenance", icon: "wrench" },
      { id: "cat_home_insurance", name: "Home Insurance", icon: "shield" },
      { id: "cat_utilities", name: "Utilities", icon: "zap" },
      { id: "cat_internet_phone", name: "Internet & Phone", icon: "wifi" },
    ],
  },
  {
    id: "cat_transportation",
    name: "Transportation",
    icon: "car",
    children: [
      { id: "cat_gas", name: "Gas & Fuel", icon: "fuel" },
      { id: "cat_public_transit", name: "Public Transit", icon: "train-front" },
      { id: "cat_rideshare", name: "Rideshare & Taxi", icon: "car-taxi-front", discretionary: true },
      { id: "cat_parking_tolls", name: "Parking & Tolls", icon: "circle-parking" },
      { id: "cat_auto_insurance", name: "Auto Insurance", icon: "shield-check" },
      { id: "cat_auto_maintenance", name: "Auto Maintenance", icon: "wrench" },
      { id: "cat_auto_payment", name: "Auto Payment", icon: "receipt" },
    ],
  },
  {
    id: "cat_food",
    name: "Food & Dining",
    icon: "utensils",
    children: [
      { id: "cat_groceries", name: "Groceries", icon: "shopping-basket" },
      { id: "cat_restaurants", name: "Restaurants", icon: "utensils-crossed", discretionary: true },
      { id: "cat_coffee", name: "Coffee Shops", icon: "coffee", discretionary: true },
      { id: "cat_delivery", name: "Food Delivery", icon: "bike", discretionary: true },
      { id: "cat_bars", name: "Bars & Alcohol", icon: "beer", discretionary: true },
    ],
  },
  {
    id: "cat_shopping",
    name: "Shopping",
    icon: "shopping-bag",
    discretionary: true,
    children: [
      { id: "cat_clothing", name: "Clothing", icon: "shirt", discretionary: true },
      { id: "cat_electronics", name: "Electronics", icon: "smartphone", discretionary: true },
      { id: "cat_household", name: "Household Goods", icon: "lamp", discretionary: true },
      { id: "cat_gifts", name: "Gifts", icon: "gift", discretionary: true },
      { id: "cat_general_merch", name: "General Merchandise", icon: "package", discretionary: true },
    ],
  },
  {
    id: "cat_subscriptions",
    name: "Subscriptions",
    icon: "repeat",
    discretionary: true,
    children: [
      { id: "cat_streaming", name: "Streaming", icon: "clapperboard", discretionary: true },
      { id: "cat_software", name: "Software & Cloud", icon: "cloud", discretionary: true },
      { id: "cat_memberships", name: "Memberships", icon: "id-card", discretionary: true },
      { id: "cat_news", name: "News & Media", icon: "newspaper", discretionary: true },
    ],
  },
  {
    id: "cat_health",
    name: "Health",
    icon: "heart-pulse",
    children: [
      { id: "cat_doctor", name: "Doctor & Dentist", icon: "stethoscope" },
      { id: "cat_pharmacy", name: "Pharmacy", icon: "pill" },
      { id: "cat_health_insurance", name: "Health Insurance", icon: "shield-plus" },
      { id: "cat_fitness", name: "Fitness", icon: "dumbbell", discretionary: true },
    ],
  },
  {
    id: "cat_travel",
    name: "Travel",
    icon: "plane",
    discretionary: true,
    children: [
      { id: "cat_flights", name: "Flights", icon: "plane-takeoff", discretionary: true },
      { id: "cat_lodging", name: "Lodging", icon: "bed", discretionary: true },
      { id: "cat_car_rental", name: "Car Rental", icon: "car-front", discretionary: true },
      { id: "cat_travel_other", name: "Travel Other", icon: "luggage", discretionary: true },
    ],
  },
  {
    id: "cat_entertainment",
    name: "Entertainment",
    icon: "party-popper",
    discretionary: true,
    children: [
      { id: "cat_events", name: "Events & Tickets", icon: "ticket", discretionary: true },
      { id: "cat_hobbies", name: "Hobbies", icon: "palette", discretionary: true },
      { id: "cat_games", name: "Games", icon: "gamepad-2", discretionary: true },
      { id: "cat_sports", name: "Sports & Outdoors", icon: "bike", discretionary: true },
    ],
  },
  {
    id: "cat_personal_care",
    name: "Personal Care",
    icon: "sparkles",
    discretionary: true,
    children: [
      { id: "cat_hair_beauty", name: "Hair & Beauty", icon: "scissors", discretionary: true },
      { id: "cat_spa", name: "Spa & Massage", icon: "flower-2", discretionary: true },
    ],
  },
  {
    id: "cat_pets",
    name: "Pets",
    icon: "paw-print",
    children: [
      { id: "cat_pet_food", name: "Pet Food & Supplies", icon: "bone" },
      { id: "cat_vet", name: "Veterinary", icon: "syringe" },
    ],
  },
  {
    id: "cat_education",
    name: "Education",
    icon: "graduation-cap",
    children: [
      { id: "cat_tuition", name: "Tuition", icon: "school" },
      { id: "cat_books_courses", name: "Books & Courses", icon: "book-open" },
      { id: "cat_student_loan", name: "Student Loan", icon: "receipt" },
    ],
  },
  {
    id: "cat_fees",
    name: "Fees & Charges",
    icon: "circle-alert",
    children: [
      { id: "cat_bank_fees", name: "Bank Fees", icon: "landmark" },
      { id: "cat_atm_fees", name: "ATM Fees", icon: "banknote" },
      { id: "cat_interest_charge", name: "Interest Charges", icon: "percent" },
      { id: "cat_late_fees", name: "Late Fees", icon: "alarm-clock" },
      { id: "cat_service_fees", name: "Service Fees", icon: "receipt-text" },
    ],
  },
  {
    id: "cat_taxes",
    name: "Taxes",
    icon: "file-text",
    children: [
      { id: "cat_income_tax", name: "Income Tax", icon: "file-text" },
      { id: "cat_property_tax", name: "Property Tax", icon: "home" },
    ],
  },
  {
    id: "cat_charity",
    name: "Charity & Giving",
    icon: "hand-heart",
    children: [{ id: "cat_donations", name: "Donations", icon: "heart" }],
  },
  {
    id: "cat_savings",
    name: "Savings & Investments",
    icon: "piggy-bank",
    children: [
      { id: "cat_savings_contribution", name: "Savings Contribution", icon: "piggy-bank" },
      { id: "cat_investment_contribution", name: "Investment Contribution", icon: "chart-line" },
      { id: "cat_retirement", name: "Retirement", icon: "umbrella" },
    ],
  },
  {
    id: "cat_transfers",
    name: "Transfers",
    icon: "arrow-left-right",
    children: [
      { id: "cat_transfer_in", name: "Transfer In", icon: "arrow-down-left" },
      { id: "cat_transfer_out", name: "Transfer Out", icon: "arrow-up-right" },
      { id: "cat_credit_card_payment", name: "Credit Card Payment", icon: "credit-card" },
    ],
  },
  { id: "cat_uncategorized", name: "Uncategorized", icon: "circle-help" },
];

/** Category ids the rules engine and repos reference directly. */
export const CAT = {
  INCOME: "cat_income",
  TRANSFERS: "cat_transfers",
  SAVINGS: "cat_savings",
  SUBSCRIPTIONS: "cat_subscriptions",
  ENTERTAINMENT: "cat_entertainment",
  FEES: "cat_fees",
  UNCATEGORIZED: "cat_uncategorized",
} as const;

/** Roots whose spend is excluded from cash-flow, spike and runway math. */
export const NON_SPEND_ROOTS: readonly string[] = [
  CAT.TRANSFERS,
  CAT.SAVINGS,
  CAT.INCOME,
];

/**
 * Roots whose inflows are not income. Salary lives under Income and must count;
 * a transfer in from another account or a withdrawal from savings is the same
 * money arriving twice.
 */
export const NON_INCOME_ROOTS: readonly string[] = [CAT.TRANSFERS, CAT.SAVINGS];

export function flattenCategories(
  tree: SeedCategory[] = CATEGORY_TREE,
): Array<{
  id: string;
  name: string;
  parentId: string | null;
  icon: string;
  discretionary: boolean;
  system: boolean;
}> {
  const out: Array<{
    id: string;
    name: string;
    parentId: string | null;
    icon: string;
    discretionary: boolean;
    system: boolean;
  }> = [];
  for (const node of tree) {
    out.push({
      id: node.id,
      name: node.name,
      parentId: null,
      icon: node.icon,
      discretionary: node.discretionary ?? false,
      system: true,
    });
    for (const child of node.children ?? []) {
      out.push({
        id: child.id,
        name: child.name,
        parentId: node.id,
        icon: child.icon,
        discretionary: child.discretionary ?? node.discretionary ?? false,
        system: true,
      });
    }
  }
  return out;
}

/**
 * Idempotent: inserts missing system categories and refreshes the taxonomy fields
 * of ones that already exist. User-created categories are never touched.
 */
export function seedCategories(db: Db): void {
  const rows = flattenCategories();
  const parents = rows.filter((r) => r.parentId === null);
  const children = rows.filter((r) => r.parentId !== null);
  db.transaction((tx) => {
    for (const batch of [parents, children]) {
      if (batch.length === 0) continue;
      tx.insert(categories)
        .values(batch)
        .onConflictDoUpdate({
          target: categories.id,
          set: {
            name: excluded("name"),
            parentId: excluded("parent_id"),
            icon: excluded("icon"),
            discretionary: excluded("discretionary"),
            system: excluded("system"),
          },
        })
        .run();
    }
  });
}

/** "take the value I was inserting" in an ON CONFLICT DO UPDATE clause. */
function excluded(column: string) {
  return sql.raw(`excluded."${column}"`);
}
