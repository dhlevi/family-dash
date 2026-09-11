/**
 * Ingredient arithmetic for the shopping list.
 *
 * A week of meals routinely calls for flour three times, and a list that
 * says "flour" three times is worse than useless in a supermarket. Merging
 * them means parsing the quantities recipes are actually written with like
 * "2", "1/2", "1 1/2", "½", "a pinch",  adding the ones that can be added,
 * and leaving alone the ones that cannot.
 */

export interface Ingredient {
  quantity: string | null
  unit: string | null
  item: string
}

export interface MergedIngredient extends Ingredient {
  /** The recipes this line came from, for "why is this on my list?". */
  sources: string[]
}

/** Unicode fractions that appear in recipes copied from the web. */
const UNICODE_FRACTIONS: Record<string, number> = {
  '¼': 0.25,
  '½': 0.5,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅕': 0.2,
  '⅖': 0.4,
  '⅗': 0.6,
  '⅘': 0.8,
  '⅙': 1 / 6,
  '⅚': 5 / 6,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875
}

/**
 * A quantity as a number, or null when it is not really a number at all
 * ("a pinch", "to taste"). Null quantities are never merged.
 */
export function parseQuantity(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null

  const text = raw.trim().toLowerCase()
  if (text.length === 0) return null

  // "1 1/2" or "1 ½"
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(text)
  if (mixed) {
    const denominator = Number(mixed[3])
    if (denominator === 0) return null
    return Number(mixed[1]) + Number(mixed[2]) / denominator
  }

  const mixedUnicode = /^(\d+)\s*([¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])$/.exec(text)
  if (mixedUnicode?.[2]) return Number(mixedUnicode[1]) + (UNICODE_FRACTIONS[mixedUnicode[2]] ?? 0)

  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(text)
  if (fraction) {
    const denominator = Number(fraction[2])
    if (denominator === 0) return null
    return Number(fraction[1]) / denominator
  }

  if (text.length === 1 && UNICODE_FRACTIONS[text] !== undefined) return UNICODE_FRACTIONS[text]!

  const decimal = /^\d*\.?\d+$/.exec(text)
  if (decimal) return Number(text)

  return null
}

const NICE_FRACTIONS: Array<[number, string]> = [
  [0.125, '1/8'],
  [0.25, '1/4'],
  [1 / 3, '1/3'],
  [0.375, '3/8'],
  [0.5, '1/2'],
  [0.625, '5/8'],
  [2 / 3, '2/3'],
  [0.75, '3/4'],
  [0.875, '7/8']
]

/**
 * A number back as something a person would write on a list: "3", "1 1/2",
 * "2/3". Recipes are written in fractions, so a list saying "0.6666667 cup
 * sugar" reads as a bug even though it is arithmetically fine.
 */
export function formatQuantity(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return ''

  const whole = Math.floor(value)
  const remainder = value - whole

  if (remainder < 0.01) return String(whole)

  for (const [fraction, label] of NICE_FRACTIONS) {
    if (Math.abs(remainder - fraction) < 0.02) {
      return whole > 0 ? `${whole} ${label}` : label
    }
  }

  // Not close to a common fraction, so a decimal is the honest answer.
  return String(Math.round(value * 100) / 100)
}

/** Units that mean the same thing, so "2 tbsp" and "2 tablespoon" combine. */
const UNIT_ALIASES: Record<string, string> = {
  tsp: 'tsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  tbsp: 'tbsp',
  tbs: 'tbsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  cup: 'cup',
  cups: 'cup',
  g: 'g',
  gram: 'g',
  grams: 'g',
  kg: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  ml: 'ml',
  millilitre: 'ml',
  milliliter: 'ml',
  l: 'l',
  litre: 'l',
  liter: 'l',
  litres: 'l',
  liters: 'l',
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  clove: 'clove',
  cloves: 'clove',
  tin: 'tin',
  tins: 'tin',
  can: 'tin',
  cans: 'tin',
  pack: 'pack',
  packs: 'pack',
  packet: 'pack',
  packets: 'pack'
}

export function normaliseUnit(unit: string | null | undefined): string | null {
  if (!unit) return null

  const key = unit.trim().toLowerCase().replace(/\.$/, '')
  if (key.length === 0) return null

  return UNIT_ALIASES[key] ?? key
}

/**
 * The key two ingredient lines have to share to be added together.
 *
 * Deliberately conservative: name and unit must match after normalising
 * case and whitespace, and nothing else. Plurals are *not* folded together.
 */
function mergeKey(item: string, unit: string | null): string {
  return `${item.trim().toLowerCase().replace(/\s+/g, ' ')}|${unit ?? ''}`
}

/**
 * Combines ingredient lines from several recipes into one list.
 *
 * Lines with the same name and unit are added together. Lines whose
 * quantity is not a number, or whose units differ, stay as separate lines
 * rather than being guessed at.
 */
export function mergeIngredients(entries: Array<{ ingredient: Ingredient; source: string }>): MergedIngredient[] {
  const merged = new Map<string, MergedIngredient & { total: number | null }>()
  const unmergeable: MergedIngredient[] = []

  for (const { ingredient, source } of entries) {
    const item = ingredient.item.trim()
    if (item.length === 0) continue

    const unit = normaliseUnit(ingredient.unit)
    const amount = parseQuantity(ingredient.quantity)

    if (amount === null) {
      // "a pinch of salt" from two recipes is still a pinch of salt, so
      // fold identical unquantified lines together rather than repeating.
      const existing = unmergeable.find(
        candidate =>
          mergeKey(candidate.item, normaliseUnit(candidate.unit)) === mergeKey(item, unit) &&
          candidate.quantity === (ingredient.quantity?.trim() || null)
      )

      if (existing) {
        if (!existing.sources.includes(source)) existing.sources.push(source)
      } else {
        unmergeable.push({
          quantity: ingredient.quantity?.trim() || null,
          unit: ingredient.unit?.trim() || null,
          item,
          sources: [source]
        })
      }
      continue
    }

    const key = mergeKey(item, unit)
    const existing = merged.get(key)

    if (existing && existing.total !== null) {
      existing.total += amount
      existing.quantity = formatQuantity(existing.total)
      if (!existing.sources.includes(source)) existing.sources.push(source)
    } else {
      merged.set(key, {
        quantity: formatQuantity(amount),
        // Keep the unit as the first recipe wrote it, so the list reads
        // naturally rather than in normalised shorthand.
        unit: ingredient.unit?.trim() || null,
        item,
        sources: [source],
        total: amount
      })
    }
  }

  return [...[...merged.values()].map(({ total: _total, ...line }) => line), ...unmergeable]
}

/** Multiplies quantities, for cooking a recipe at a different number of servings. */
export function scaleIngredients(ingredients: Ingredient[], factor: number): Ingredient[] {
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return ingredients.map(item => ({ ...item }))

  return ingredients.map(ingredient => {
    const amount = parseQuantity(ingredient.quantity)

    // An unquantified line ("a pinch") scales to itself.
    return amount === null ? { ...ingredient } : { ...ingredient, quantity: formatQuantity(amount * factor) }
  })
}

/**
 * A rough supermarket aisle for an ingredient, so the list groups the way a
 * shop is laid out instead of by the order recipes happened to be added.
 *
 * Keyword matching, not a food database: it is right often enough to be
 * useful and every line stays editable, which is the correct trade for
 * something running on a Raspberry Pi in a kitchen.
 */
const CATEGORY_KEYWORDS: Array<[string, string[]]> = [
  [
    'Produce',
    [
      'apple',
      'banana',
      'lemon',
      'lime',
      'orange',
      'berry',
      'berries',
      'grape',
      'melon',
      'onion',
      'garlic',
      'potato',
      'carrot',
      'celery',
      'pepper',
      'tomato',
      'lettuce',
      'spinach',
      'kale',
      'broccoli',
      'cauliflower',
      'cucumber',
      'courgette',
      'zucchini',
      'mushroom',
      'avocado',
      'ginger',
      'herb',
      'parsley',
      'coriander',
      'cilantro',
      'basil',
      'thyme',
      'rosemary',
      'salad',
      'cabbage',
      'leek',
      'pea',
      'bean sprout',
      'squash',
      'corn'
    ]
  ],
  [
    'Dairy and eggs',
    [
      'milk',
      'cream',
      'butter',
      'cheese',
      'cheddar',
      'mozzarella',
      'parmesan',
      'yoghurt',
      'yogurt',
      'egg',
      'creme fraiche',
      'sour cream'
    ]
  ],
  [
    'Meat and fish',
    [
      'chicken',
      'beef',
      'mince',
      'pork',
      'lamb',
      'bacon',
      'sausage',
      'ham',
      'turkey',
      'steak',
      'salmon',
      'tuna',
      'cod',
      'prawn',
      'shrimp',
      'fish'
    ]
  ],
  ['Bakery', ['bread', 'roll', 'bun', 'bagel', 'tortilla', 'wrap', 'pitta', 'pita', 'baguette', 'croissant', 'naan']],
  ['Frozen', ['frozen', 'ice cream', 'peas frozen']],
  [
    'Pantry',
    [
      'flour',
      'sugar',
      'salt',
      'pepper',
      'oil',
      'vinegar',
      'rice',
      'pasta',
      'noodle',
      'spaghetti',
      'lentil',
      'chickpea',
      'bean',
      'stock',
      'broth',
      'sauce',
      'ketchup',
      'mustard',
      'mayonnaise',
      'honey',
      'syrup',
      'tin',
      'tinned',
      'canned',
      'spice',
      'cumin',
      'paprika',
      'cinnamon',
      'oat',
      'cereal',
      'baking',
      'yeast',
      'cocoa',
      'chocolate',
      'nut',
      'seed',
      'soy'
    ]
  ],
  [
    'Household',
    [
      'foil',
      'cling film',
      'kitchen roll',
      'kitchen towel',
      'washing up',
      'bin bag',
      'detergent',
      'soap',
      'toilet roll',
      'tin foil'
    ]
  ]
]

/**
 * Every keyword flattened and sorted longest-first.
 *
 * Order matters more than it looks: "kitchen roll" has to beat "roll", or
 * kitchen paper is filed under Bakery. Same for "ice cream" over "cream",
 * and "bean sprout" over "bean". Checking the most specific match first is
 * what makes a keyword list behave sensibly.
 */
const SORTED_KEYWORDS: Array<[keyword: string, category: string]> = CATEGORY_KEYWORDS.flatMap(([category, keywords]) =>
  keywords.map(keyword => [keyword, category] as [string, string])
).sort(([a], [b]) => b.length - a.length)

export function categoriseIngredient(item: string): string | null {
  const text = item.trim().toLowerCase()
  if (text.length === 0) return null

  for (const [keyword, category] of SORTED_KEYWORDS) {
    if (text.includes(keyword)) return category
  }

  return null
}

/** A shopping line as a single string: "2 cup flour". */
export function describeIngredient(ingredient: Ingredient): string {
  return [ingredient.quantity, ingredient.unit, ingredient.item]
    .map(part => part?.trim())
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join(' ')
}
