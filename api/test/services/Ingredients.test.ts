import { describe, expect, it } from 'vitest'
import {
  categoriseIngredient,
  describeIngredient,
  formatQuantity,
  mergeIngredients,
  normaliseUnit,
  parseQuantity,
  scaleIngredients,
  type Ingredient
} from '../../lib/services/Ingredients'

/**
 * The shopping list is the one part of this app that gets used standing in a
 * supermarket, where a wrong quantity is an actual problem. These tests
 * mostly guard against being too clever — merging things that only look
 * alike is worse than a slightly longer list.
 */
const ingredient = (quantity: string | null, unit: string | null, item: string): Ingredient => ({
  quantity,
  unit,
  item
})

const from = (source: string, ...items: Ingredient[]) => items.map(item => ({ ingredient: item, source }))

describe('parseQuantity', () => {
  it('reads plain numbers', () => {
    expect(parseQuantity('2')).toBe(2)
    expect(parseQuantity('2.5')).toBe(2.5)
    expect(parseQuantity('0.25')).toBe(0.25)
  })

  it('reads the fractions recipes are written in', () => {
    expect(parseQuantity('1/2')).toBe(0.5)
    expect(parseQuantity('3/4')).toBe(0.75)
    expect(parseQuantity('1 1/2')).toBe(1.5)
    expect(parseQuantity('2 3/4')).toBe(2.75)
  })

  it('reads unicode fractions, which is what pasting from the web gives you', () => {
    expect(parseQuantity('½')).toBe(0.5)
    expect(parseQuantity('¼')).toBe(0.25)
    expect(parseQuantity('1½')).toBe(1.5)
    expect(parseQuantity('2 ¾')).toBe(2.75)
  })

  it('tolerates spacing and case', () => {
    expect(parseQuantity(' 1 / 2 ')).toBe(0.5)
    expect(parseQuantity('  3  ')).toBe(3)
  })

  it('returns null for quantities that are not numbers', () => {
    // "two pinches" is not arithmetic, and pretending otherwise puts a wrong
    // number on a list somebody is shopping from.
    expect(parseQuantity('a pinch')).toBeNull()
    expect(parseQuantity('to taste')).toBeNull()
    expect(parseQuantity('')).toBeNull()
    expect(parseQuantity(null)).toBeNull()
    expect(parseQuantity(undefined)).toBeNull()
  })

  it('does not divide by zero', () => {
    expect(parseQuantity('1/0')).toBeNull()
  })
})

describe('formatQuantity', () => {
  it('writes whole numbers plainly', () => {
    expect(formatQuantity(3)).toBe('3')
    expect(formatQuantity(1)).toBe('1')
  })

  it('writes common fractions the way a person would', () => {
    expect(formatQuantity(0.5)).toBe('1/2')
    expect(formatQuantity(0.25)).toBe('1/4')
    expect(formatQuantity(1.5)).toBe('1 1/2')
    expect(formatQuantity(2.75)).toBe('2 3/4')
  })

  it('rounds a repeating fraction to a readable one', () => {
    // 1/3 + 1/3 must not read as "0.6666666666666666 cup".
    expect(formatQuantity(1 / 3)).toBe('1/3')
    expect(formatQuantity(2 / 3)).toBe('2/3')
  })

  it('falls back to a decimal when nothing fits', () => {
    expect(formatQuantity(1.7)).toBe('1.7')
  })

  it('returns nothing for a non-quantity', () => {
    expect(formatQuantity(0)).toBe('')
    expect(formatQuantity(Number.NaN)).toBe('')
  })
})

describe('normaliseUnit', () => {
  it('folds the spellings of the same unit together', () => {
    expect(normaliseUnit('tbsp')).toBe('tbsp')
    expect(normaliseUnit('Tablespoon')).toBe('tbsp')
    expect(normaliseUnit('tablespoons')).toBe('tbsp')
    expect(normaliseUnit('grams')).toBe('g')
    expect(normaliseUnit('cans')).toBe('tin')
  })

  it('passes an unknown unit through, lowercased', () => {
    expect(normaliseUnit('bunch')).toBe('bunch')
  })

  it('treats a missing unit as no unit', () => {
    expect(normaliseUnit(null)).toBeNull()
    expect(normaliseUnit('  ')).toBeNull()
  })
})

describe('mergeIngredients', () => {
  it('adds quantities of the same ingredient across recipes', () => {
    const merged = mergeIngredients([
      ...from('Pancakes', ingredient('2', 'cup', 'flour')),
      ...from('Bread', ingredient('1', 'cup', 'flour'))
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ quantity: '3', unit: 'cup', item: 'flour' })
  })

  it('records which recipes a line came from', () => {
    const merged = mergeIngredients([
      ...from('Pancakes', ingredient('2', 'cup', 'flour')),
      ...from('Bread', ingredient('1', 'cup', 'flour'))
    ])

    expect(merged[0]?.sources).toEqual(['Pancakes', 'Bread'])
  })

  it('adds fractions correctly and formats the total readably', () => {
    const merged = mergeIngredients([
      ...from('A', ingredient('1/2', 'cup', 'sugar')),
      ...from('B', ingredient('1/4', 'cup', 'sugar'))
    ])

    expect(merged[0]?.quantity).toBe('3/4')
  })

  it('merges across different spellings of the same unit', () => {
    const merged = mergeIngredients([
      ...from('A', ingredient('1', 'tbsp', 'olive oil')),
      ...from('B', ingredient('2', 'tablespoons', 'olive oil'))
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.quantity).toBe('3')
  })

  it('keeps different units apart rather than guessing a conversion', () => {
    const merged = mergeIngredients([
      ...from('A', ingredient('200', 'g', 'butter')),
      ...from('B', ingredient('2', 'tbsp', 'butter'))
    ])

    expect(merged).toHaveLength(2)
  })

  it('ignores case and spacing when matching names', () => {
    const merged = mergeIngredients([
      ...from('A', ingredient('1', 'cup', 'Plain  Flour')),
      ...from('B', ingredient('1', 'cup', 'plain flour'))
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.quantity).toBe('2')
  })

  it('does not merge plurals, which would risk combining genuinely different things', () => {
    const merged = mergeIngredients([
      ...from('A', ingredient('2', null, 'tomato')),
      ...from('B', ingredient('3', null, 'tomatoes'))
    ])

    expect(merged).toHaveLength(2)
  })

  it('leaves unquantified lines alone instead of inventing a total', () => {
    const merged = mergeIngredients([
      ...from('A', ingredient('a pinch', null, 'salt')),
      ...from('B', ingredient('2', 'tsp', 'salt'))
    ])

    expect(merged).toHaveLength(2)
    expect(merged.find(line => line.quantity === 'a pinch')).toBeDefined()
  })

  it('folds identical unquantified lines together rather than repeating them', () => {
    const merged = mergeIngredients([
      ...from('A', ingredient('a pinch', null, 'salt')),
      ...from('B', ingredient('a pinch', null, 'salt'))
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.sources).toEqual(['A', 'B'])
  })

  it('keeps the unit as first written, so the list reads naturally', () => {
    const merged = mergeIngredients([
      ...from('A', ingredient('1', 'Tablespoon', 'oil')),
      ...from('B', ingredient('1', 'tbsp', 'oil'))
    ])

    expect(merged[0]?.unit).toBe('Tablespoon')
  })

  it('skips blank ingredient names', () => {
    expect(mergeIngredients(from('A', ingredient('1', 'cup', '   ')))).toHaveLength(0)
  })

  it('handles an empty list', () => {
    expect(mergeIngredients([])).toEqual([])
  })

  it('does not list the same recipe twice as a source', () => {
    const merged = mergeIngredients([...from('A', ingredient('1', 'cup', 'flour'), ingredient('1', 'cup', 'flour'))])

    expect(merged[0]?.sources).toEqual(['A'])
    expect(merged[0]?.quantity).toBe('2')
  })
})

describe('scaleIngredients', () => {
  it('multiplies numeric quantities', () => {
    const scaled = scaleIngredients([ingredient('2', 'cup', 'flour'), ingredient('1/2', 'tsp', 'salt')], 2)

    expect(scaled[0]?.quantity).toBe('4')
    expect(scaled[1]?.quantity).toBe('1')
  })

  it('halves correctly, producing fractions', () => {
    const scaled = scaleIngredients([ingredient('3', 'cup', 'flour')], 0.5)

    expect(scaled[0]?.quantity).toBe('1 1/2')
  })

  it('leaves unquantified lines untouched', () => {
    const scaled = scaleIngredients([ingredient('a pinch', null, 'salt')], 3)

    expect(scaled[0]?.quantity).toBe('a pinch')
  })

  it('is a no-op at a factor of one, or an invalid factor', () => {
    const original = [ingredient('2', 'cup', 'flour')]

    expect(scaleIngredients(original, 1)).toEqual(original)
    expect(scaleIngredients(original, 0)).toEqual(original)
    expect(scaleIngredients(original, -2)).toEqual(original)
  })
})

describe('categoriseIngredient', () => {
  it('sorts common items into supermarket aisles', () => {
    expect(categoriseIngredient('onions')).toBe('Produce')
    expect(categoriseIngredient('cheddar cheese')).toBe('Dairy and eggs')
    expect(categoriseIngredient('chicken thighs')).toBe('Meat and fish')
    expect(categoriseIngredient('sourdough bread')).toBe('Bakery')
    expect(categoriseIngredient('plain flour')).toBe('Pantry')
  })

  it('prefers the most specific keyword when several match', () => {
    // The bug this guards: "roll" is a Bakery word, so kitchen paper was
    // being filed with the bread. The longest match has to win.
    expect(categoriseIngredient('kitchen roll')).toBe('Household')
    expect(categoriseIngredient('tin foil')).toBe('Household')
    expect(categoriseIngredient('ice cream')).toBe('Frozen')
    expect(categoriseIngredient('bean sprouts')).toBe('Produce')
  })

  it('still matches the general word when nothing more specific applies', () => {
    expect(categoriseIngredient('bread rolls')).toBe('Bakery')
    expect(categoriseIngredient('double cream')).toBe('Dairy and eggs')
    expect(categoriseIngredient('kidney beans')).toBe('Pantry')
  })

  it('returns null when it does not know, rather than guessing', () => {
    expect(categoriseIngredient('gochujang')).toBeNull()
    expect(categoriseIngredient('  ')).toBeNull()
  })
})

describe('describeIngredient', () => {
  it('joins the parts that are present', () => {
    expect(describeIngredient(ingredient('2', 'cup', 'flour'))).toBe('2 cup flour')
    expect(describeIngredient(ingredient('3', null, 'eggs'))).toBe('3 eggs')
    expect(describeIngredient(ingredient(null, null, 'salt'))).toBe('salt')
  })
})
