import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { transactions } from "@/db/schema";
import { nowISO } from "@/lib/domain/dates";
import { haystack, normalizeText } from "@/lib/domain/merchants";

export { haystack, normalizeText };

/**
 * Rules-based auto-categorization.
 *
 * Deliberately deterministic and inspectable: a user can look at a transaction
 * and understand why it landed where it did. The one hard rule is that a
 * human decision outranks the engine forever — see `categorySource`.
 */

export interface CategoryRule {
  categoryId: string;
  /** matched against a normalized "merchant name" haystack */
  patterns: RegExp[];
  /** restrict the rule to money going one way */
  direction?: "outflow" | "inflow";
}

/**
 * Order matters: the first matching rule wins, so specific merchants precede
 * generic keywords and transfer/payment detection precedes everything else
 * (a "payment" that is really a credit-card payment must not look like spend).
 */
export const DEFAULT_RULES: CategoryRule[] = [
  // --- Transfers & internal movement -------------------------------------
  {
    categoryId: "cat_credit_card_payment",
    patterns: [
      /\bpayment thank you\b/,
      /\bcredit card (payment|pmt)\b/,
      /\bcard payment\b/,
      /\bautopay\b/,
      /\bamex epayment\b/,
      /\bchase credit crd\b/,
    ],
  },
  {
    categoryId: "cat_transfer_out",
    patterns: [
      /\btransfer to\b/,
      /\bxfer to\b/,
      /\bwithdrawal transfer\b/,
      /\bzelle (payment )?to\b/,
      /\bvenmo (payment|cashout)?\b/,
    ],
    direction: "outflow",
  },
  {
    categoryId: "cat_transfer_in",
    patterns: [/\btransfer from\b/, /\bxfer from\b/, /\bzelle (payment )?from\b/],
    direction: "inflow",
  },
  {
    categoryId: "cat_savings_contribution",
    patterns: [/\bto savings\b/, /\bsavings transfer\b/, /\bemergency fund\b/],
    direction: "outflow",
  },
  {
    categoryId: "cat_investment_contribution",
    patterns: [
      /\bvanguard\b/,
      /\bfidelity\b/,
      /\bschwab\b/,
      /\bbetterment\b/,
      /\bwealthfront\b/,
      /\brobinhood\b/,
      /\bcoinbase\b/,
    ],
  },
  { categoryId: "cat_retirement", patterns: [/\b401k\b/, /\bira contribution\b/] },

  // --- Income --------------------------------------------------------------
  {
    categoryId: "cat_salary",
    patterns: [/\bpayroll\b/, /\bdirect dep\b/, /\bdirdep\b/, /\bsalary\b/, /\bgusto\b/, /\badp\b/],
    direction: "inflow",
  },
  { categoryId: "cat_bonus", patterns: [/\bbonus\b/], direction: "inflow" },
  {
    categoryId: "cat_interest_income",
    patterns: [/\binterest (paid|earned|payment)\b/, /\bdividend\b/],
    direction: "inflow",
  },
  {
    categoryId: "cat_refunds",
    patterns: [/\brefund\b/, /\breturn credit\b/, /\breversal\b/],
    direction: "inflow",
  },

  // --- Housing -------------------------------------------------------------
  { categoryId: "cat_rent", patterns: [/\brent\b/, /\bapartments?\b/, /\bproperty mgmt\b/, /\bleasing\b/] },
  { categoryId: "cat_mortgage", patterns: [/\bmortgage\b/, /\bloan servicing\b/] },
  {
    categoryId: "cat_utilities",
    patterns: [
      /\b(electric|power|energy|gas company|water|sewer|utility|utilities)\b/,
      /\bcon ?edison\b/,
      /\bpg e\b/,
      /\bduke energy\b/,
      /\bnational grid\b/,
      /\bwaste management\b/,
    ],
  },
  {
    categoryId: "cat_internet_phone",
    patterns: [
      /\bcomcast\b/, /\bxfinity\b/, /\bverizon\b/, /\bat t\b/, /\bt ?mobile\b/,
      /\bspectrum\b/, /\bgoogle fi\b/, /\bmint mobile\b/, /\bstarlink\b/,
    ],
  },
  { categoryId: "cat_home_insurance", patterns: [/\bhome ?owners? ins\b/, /\brenters ins\b/] },
  {
    categoryId: "cat_home_maintenance",
    patterns: [/\bhome depot\b/, /\blowe ?s\b/, /\bace hardware\b/, /\bplumb(ing|er)\b/, /\bhandyman\b/],
  },

  // --- Transportation ------------------------------------------------------
  {
    categoryId: "cat_gas",
    patterns: [
      /\bshell\b/, /\bchevron\b/, /\bexxon\b/, /\bmobil\b/, /\bbp\b/, /\bsunoco\b/,
      /\bcitgo\b/, /\bspeedway\b/, /\bwawa\b/, /\bgas station\b/, /\bfuel\b/,
    ],
  },
  {
    categoryId: "cat_rideshare",
    patterns: [/\buber\b(?!\s*eats)/, /\blyft\b/, /\btaxi\b/, /\bcab co\b/],
  },
  {
    categoryId: "cat_public_transit",
    patterns: [/\bmta\b/, /\bbart\b/, /\bmetro(card| transit)?\b/, /\bamtrak\b/, /\btransit\b/, /\bsubway fare\b/],
  },
  { categoryId: "cat_parking_tolls", patterns: [/\bparking\b/, /\btoll\b/, /\bez ?pass\b/, /\bspothero\b/] },
  {
    categoryId: "cat_auto_insurance",
    patterns: [/\bgeico\b/, /\bprogressive\b/, /\bstate farm\b/, /\ballstate\b/, /\bauto ins\b/],
  },
  {
    categoryId: "cat_auto_maintenance",
    patterns: [/\bjiffy lube\b/, /\bautozone\b/, /\bpep boys\b/, /\btire\b/, /\bcar wash\b/, /\bauto repair\b/],
  },

  // --- Food ----------------------------------------------------------------
  {
    categoryId: "cat_groceries",
    patterns: [
      /\bwhole foods\b/, /\btrader joe/, /\bsafeway\b/, /\bkroger\b/, /\baldi\b/,
      /\bpublix\b/, /\bwegmans\b/, /\bsprouts\b/, /\bfood lion\b/, /\bheb\b|\bh e b\b/,
      /\bgiant eagle\b/, /\bstop shop\b/, /\bralphs\b/, /\bmeijer\b/,
      /\bgrocery\b/, /\bsupermarket\b/, /\bmarket basket\b/,
    ],
  },
  {
    categoryId: "cat_delivery",
    patterns: [/\bdoordash\b/, /\buber ?eats\b/, /\bgrubhub\b/, /\bpostmates\b/, /\bseamless\b/, /\binstacart\b/, /\bcaviar\b/],
  },
  {
    categoryId: "cat_coffee",
    patterns: [/\bstarbucks\b/, /\bdunkin\b/, /\bpeet ?s\b/, /\bblue bottle\b/, /\bcaribou coffee\b/, /\bcoffee\b/, /\bcafe\b/, /\bespresso\b/],
  },
  {
    categoryId: "cat_bars",
    patterns: [/\bbar grill\b/, /\btavern\b/, /\bbrewing\b/, /\bbrewery\b/, /\bpub\b/, /\bliquor\b/, /\bwine spirits\b/, /\btotal wine\b/],
  },
  {
    categoryId: "cat_restaurants",
    patterns: [
      /\brestaurant\b/, /\bchipotle\b/, /\bmcdonald/, /\bburger king\b/, /\bwendy ?s\b/,
      /\btaco bell\b/, /\bsubway\b/, /\bpanera\b/, /\bshake shack\b/, /\bsweetgreen\b/,
      /\bpizza\b/, /\bsushi\b/, /\bramen\b/, /\bdiner\b/, /\bgrill\b/, /\bkitchen\b/,
      /\bbistro\b/, /\btaqueria\b/, /\bnoodle\b/, /\bbbq\b/,
    ],
  },

  // --- Subscriptions -------------------------------------------------------
  {
    categoryId: "cat_streaming",
    patterns: [
      /\bnetflix\b/, /\bspotify\b/, /\bhulu\b/, /\bdisney\b/, /\bhbo ?max\b/,
      /\bmax com\b/, /\bparamount\b/, /\bpeacock\b/, /\bapple ?tv\b/,
      /\byoutube ?(premium|tv)\b/, /\baudible\b/, /\bpandora\b/, /\btidal\b/, /\bcrunchyroll\b/,
    ],
  },
  {
    categoryId: "cat_software",
    patterns: [
      /\badobe\b/, /\bdropbox\b/, /\bgoogle (storage|one|workspace)\b/, /\bicloud\b/,
      /\bmicrosoft ?365\b/, /\bnotion\b/, /\bfigma\b/, /\bgithub\b/, /\bopenai\b/,
      /\banthropic\b/, /\bclaude ai\b/, /\baws\b/, /\bdigitalocean\b/, /\bheroku\b/,
      /\bvercel\b/, /\b1password\b/, /\bnordvpn\b/, /\bexpressvpn\b/,
    ],
  },
  {
    categoryId: "cat_memberships",
    patterns: [/\bamazon prime\b/, /\bcostco (membership|wholesale)\b/, /\bsam ?s club\b/, /\baaa\b/, /\bmembership\b/],
  },
  {
    categoryId: "cat_news",
    patterns: [/\bny ?times\b/, /\bwashington post\b/, /\bwall st(reet)? journal\b/, /\bwsj\b/, /\bmedium\b/, /\bsubstack\b/, /\beconomist\b/],
  },

  // --- Health --------------------------------------------------------------
  { categoryId: "cat_pharmacy", patterns: [/\bcvs\b/, /\bwalgreens\b/, /\brite aid\b/, /\bpharmacy\b/, /\bgoodrx\b/] },
  { categoryId: "cat_doctor", patterns: [/\bdental\b/, /\bdentist\b/, /\bmedical\b/, /\bclinic\b/, /\bhospital\b/, /\bhealth (center|partners)\b/, /\boptometr/] },
  { categoryId: "cat_health_insurance", patterns: [/\bblue cross\b/, /\baetna\b/, /\bcigna\b/, /\bunitedhealth\b/, /\bkaiser\b/, /\bhealth ins\b/] },
  { categoryId: "cat_fitness", patterns: [/\bgym\b/, /\bplanet fitness\b/, /\bequinox\b/, /\bcrossfit\b/, /\bpeloton\b/, /\bclasspass\b/, /\byoga\b/, /\bstrava\b/] },

  // --- Travel --------------------------------------------------------------
  {
    categoryId: "cat_flights",
    patterns: [/\bairlines?\b/, /\bdelta air\b/, /\bunited air\b/, /\bsouthwest\b/, /\bjetblue\b/, /\balaska air\b/, /\bryanair\b/, /\bexpedia\b/, /\bkayak\b/],
  },
  { categoryId: "cat_lodging", patterns: [/\bairbnb\b/, /\bhotel\b/, /\bmarriott\b/, /\bhilton\b/, /\bhyatt\b/, /\bvrbo\b/, /\bbooking com\b/, /\bmotel\b/] },
  { categoryId: "cat_car_rental", patterns: [/\bhertz\b/, /\bavis\b/, /\benterprise rent\b/, /\bbudget rent\b/, /\bturo\b/] },

  // --- Entertainment & shopping -------------------------------------------
  { categoryId: "cat_events", patterns: [/\bticketmaster\b/, /\bstubhub\b/, /\beventbrite\b/, /\bcinema\b/, /\bamc\b/, /\bregal\b/, /\btheat(re|er)\b/] },
  { categoryId: "cat_games", patterns: [/\bsteam(games|powered)?\b/, /\bplaystation\b/, /\bxbox\b/, /\bnintendo\b/, /\bepic games\b/, /\broblox\b/] },
  { categoryId: "cat_hobbies", patterns: [/\bmichaels\b/, /\bjoann\b/, /\bhobby lobby\b/, /\bguitar center\b/, /\bart supply\b/] },
  { categoryId: "cat_sports", patterns: [/\brei\b/, /\bdick ?s sporting\b/, /\bbass pro\b/, /\bpatagonia\b/] },
  { categoryId: "cat_clothing", patterns: [/\bnike\b/, /\badidas\b/, /\bzara\b/, /\bh m\b/, /\buniqlo\b/, /\bnordstrom\b/, /\bgap\b/, /\bold navy\b/, /\blululemon\b/, /\bmacy ?s\b/] },
  { categoryId: "cat_electronics", patterns: [/\bbest buy\b/, /\bapple store\b/, /\bmicro center\b/, /\bnewegg\b/, /\bb h photo\b/] },
  { categoryId: "cat_household", patterns: [/\bikea\b/, /\bwayfair\b/, /\bbed bath\b/, /\bcontainer store\b/, /\bcrate barrel\b/] },
  { categoryId: "cat_general_merch", patterns: [/\bamazon\b/, /\bamzn\b/, /\bwalmart\b/, /\btarget\b/, /\bcostco\b/, /\betsy\b/, /\bebay\b/, /\btemu\b/, /\bshein\b/] },

  // --- Personal care, pets, education -------------------------------------
  { categoryId: "cat_hair_beauty", patterns: [/\bsalon\b/, /\bbarber\b/, /\bsephora\b/, /\bulta\b/, /\bnails?\b/] },
  { categoryId: "cat_spa", patterns: [/\bspa\b/, /\bmassage\b/] },
  { categoryId: "cat_pet_food", patterns: [/\bchewy\b/, /\bpetco\b/, /\bpetsmart\b/, /\bpet supplies\b/] },
  { categoryId: "cat_vet", patterns: [/\bvet(erinary)?\b/, /\banimal hospital\b/] },
  { categoryId: "cat_books_courses", patterns: [/\bbarnes noble\b/, /\bcoursera\b/, /\budemy\b/, /\bmasterclass\b/, /\bbookstore\b/] },
  { categoryId: "cat_tuition", patterns: [/\btuition\b/, /\buniversity\b/, /\bcollege\b/] },
  { categoryId: "cat_student_loan", patterns: [/\bnelnet\b/, /\bsallie mae\b/, /\bstudent l(oa)?n\b/, /\bmohela\b/] },

  // --- Fees, taxes, giving -------------------------------------------------
  { categoryId: "cat_atm_fees", patterns: [/\batm (fee|surcharge|withdrawal fee)\b/, /\bnon ?network fee\b/] },
  { categoryId: "cat_interest_charge", patterns: [/\binterest charge(d)?\b/, /\bfinance charge\b/, /\bpurchase interest\b/] },
  { categoryId: "cat_late_fees", patterns: [/\blate fee\b/, /\bpast due fee\b/] },
  { categoryId: "cat_bank_fees", patterns: [/\bmonthly (service|maintenance) fee\b/, /\boverdraft\b/, /\bnsf fee\b/, /\bwire fee\b/, /\bforeign transaction fee\b/] },
  { categoryId: "cat_service_fees", patterns: [/\bservice (fee|charge)\b/, /\bconvenience fee\b/, /\bprocessing fee\b/] },
  { categoryId: "cat_income_tax", patterns: [/\birs\b/, /\btax pymt\b/, /\bfranchise tax\b/, /\bturbotax\b/] },
  { categoryId: "cat_property_tax", patterns: [/\bproperty tax\b/, /\bcounty tax\b/] },
  { categoryId: "cat_donations", patterns: [/\bdonation\b/, /\bred cross\b/, /\bgofundme\b/, /\bcharity\b/, /\bunicef\b/, /\bwikimedia\b/] },
];

export interface CategorizableTransaction {
  name: string;
  merchant?: string | null;
  amount: number;
}

/** The category a rule would assign, or null when nothing matches. */
export function matchCategory(
  tx: CategorizableTransaction,
  rules: CategoryRule[] = DEFAULT_RULES,
): string | null {
  const text = haystack(tx);
  if (!text) return null;
  for (const rule of rules) {
    if (rule.direction === "outflow" && tx.amount >= 0) continue;
    if (rule.direction === "inflow" && tx.amount <= 0) continue;
    if (rule.patterns.some((p) => p.test(text))) return rule.categoryId;
  }
  return null;
}

/**
 * Assigns a category to one transaction. Returns false when the row does not
 * exist or a human already decided — a user override is never overwritten by
 * the engine, at any confidence.
 */
export function applyCategory(
  db: Db,
  transactionId: string,
  categoryId: string,
  source: "auto" | "user" = "auto",
): boolean {
  const where =
    source === "user"
      ? eq(transactions.id, transactionId)
      : and(
          eq(transactions.id, transactionId),
          or(
            isNull(transactions.categorySource),
            eq(transactions.categorySource, "auto"),
          ),
        );
  const res = db
    .update(transactions)
    .set({ categoryId, categorySource: source, updatedAt: nowISO() })
    .where(where)
    .run();
  return res.changes > 0;
}

export interface AutoCategorizeResult {
  scanned: number;
  categorized: number;
  /** rows the rules had no opinion about */
  unmatched: number;
}

/**
 * Categorizes rows that have no category yet and were not set by a user.
 * Safe to run after every sync and after every import.
 */
export function autoCategorize(
  db: Db,
  opts: { rules?: CategoryRule[]; from?: string; to?: string; limit?: number } = {},
): AutoCategorizeResult {
  const rules = opts.rules ?? DEFAULT_RULES;
  const conds = [
    isNull(transactions.categoryId),
    or(
      isNull(transactions.categorySource),
      eq(transactions.categorySource, "auto"),
    ),
  ];
  if (opts.from) conds.push(sql`${transactions.date} >= ${opts.from}`);
  if (opts.to) conds.push(sql`${transactions.date} <= ${opts.to}`);
  const rows = db
    .select({
      id: transactions.id,
      name: transactions.name,
      merchant: transactions.merchant,
      amount: transactions.amount,
    })
    .from(transactions)
    .where(and(...conds))
    .limit(opts.limit ?? 10_000)
    .all();

  let categorized = 0;
  db.transaction(() => {
    for (const row of rows) {
      const categoryId = matchCategory(row, rules);
      if (!categoryId) continue;
      db.update(transactions)
        .set({ categoryId, categorySource: "auto", updatedAt: nowISO() })
        .where(eq(transactions.id, row.id))
        .run();
      categorized++;
    }
  });
  return {
    scanned: rows.length,
    categorized,
    unmatched: rows.length - categorized,
  };
}

/** In-memory equivalent of autoCategorize, for previews and tests. */
export function categorizeAll(
  txs: CategorizableTransaction[],
  rules: CategoryRule[] = DEFAULT_RULES,
): Array<string | null> {
  return txs.map((t) => matchCategory(t, rules));
}

export function isUserCategorized(tx: {
  categorySource?: "auto" | "user" | null;
}): boolean {
  return tx.categorySource === "user";
}
