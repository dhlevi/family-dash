import { describe, expect, it } from 'vitest'
import { assignColours, normaliseName, PERSON_COLOURS } from '../../lib/services/people'

const HOUSEHOLD = ['Dylan', 'Megan', 'Willow', 'Skye', 'Leila']

describe('normaliseName', () => {
  it('ignores the case and spacing a name was typed with', () => {
    expect(normaliseName('  Skye ')).toBe('skye')
    expect(normaliseName('SKYE')).toBe(normaliseName('skye'))
  })
})

describe('assignColours', () => {
  it('gives everyone a colour', () => {
    const colours = assignColours(HOUSEHOLD)

    expect([...colours.keys()]).toEqual(HOUSEHOLD)
    for (const colour of colours.values()) expect(PERSON_COLOURS).toContain(colour)
  })

  it('gives everyone a different colour', () => {
    // Two identical columns defeat the entire point of colouring them.
    const colours = [...assignColours(HOUSEHOLD).values()]

    expect(new Set(colours).size).toBe(HOUSEHOLD.length)
  })

  it("keeps a person's colour when somebody else joins", () => {
    // "Skye is the green one" should survive a new sibling.
    const before = assignColours(HOUSEHOLD)
    const after = assignColours([...HOUSEHOLD, 'Robin'])

    for (const name of HOUSEHOLD) {
      // Only a name that actually collides with the newcomer may move, and a
      // newcomer never displaces someone already placed.
      expect(after.get(name)).toBe(before.get(name))
    }
  })

  it('is stable across calls, so nothing shuffles on a restart', () => {
    expect([...assignColours(HOUSEHOLD).values()]).toEqual([...assignColours(HOUSEHOLD).values()])
  })

  it('ignores the case a name was entered in', () => {
    expect(assignColours(['skye']).get('skye')).toBe(assignColours(['Skye']).get('Skye'))
  })

  it('lets an explicit choice win', () => {
    const colours = assignColours(HOUSEHOLD, { Skye: '#123456' })

    expect(colours.get('Skye')).toBe('#123456')
  })

  it('does not hand a derived colour to someone who has been given it explicitly', () => {
    const colours = assignColours(HOUSEHOLD, { Dylan: PERSON_COLOURS[0] })
    const others = HOUSEHOLD.filter(name => name !== 'Dylan').map(name => colours.get(name))

    expect(others).not.toContain(PERSON_COLOURS[0])
  })

  it('copes with more people than there are colours', () => {
    const many = Array.from({ length: PERSON_COLOURS.length + 3 }, (_, index) => `Person ${index}`)

    expect(assignColours(many).size).toBe(many.length)
  })

  it('has nothing to assign for an empty household', () => {
    expect(assignColours([]).size).toBe(0)
  })
})
