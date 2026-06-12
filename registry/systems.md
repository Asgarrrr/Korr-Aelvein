# Game systems

> This document holds the high-level system sketches. Full design documents:
> - Combat system → `registry/combat.md`
> - Métier system (all 12 professions) → `registry/métiers.md`
> - Bestiary and creature AI → `registry/bestiary.md`
> - Chain and inheritance rules → `registry/inheritance.md`

## Progression — no XP, no levels

Three axes, all diegetic, no numbers.

### 1. Métier mastery

No progress bar. **Named affordances** the player acquires through practice. Binary: you can do it, or you can't (yet).

Examples:

- Blacksmith: *You can now spot a flawed ingot by eye. You can sharpen a blade enough to cut through bone.*
- Herbalist: *You know how to prepare the grey root so it keeps for a year.*
- Scout: *You can recognize the sound of sick earth.*

> [TBD] How acquisition manifests mechanically — time spent doing the action, observing a master, ritual, failure-then-success?

### 2. Knowledge / Names / Glyphs

**Literal vocabulary.** Not a stat — acquired lexicon.

- Learning the name of a thing in the abyss → you can name it, bind it, address it
- Recognizing a glyph → you know what grows behind a door
- Memorizing a chant → certain things stop hurting you when you sing it

Connects directly to the "Abyss-as-language" kernel on the idea board.

### 3. Marks

What the abyss has done to you. **Always ambivalent** — cost and gift, indivisible.

Examples:

- *You descended too deep once. You hear stones speak. But sleep no longer comes.*
- *You touched the grey blood. You can pass sealed doors. But your shadow no longer follows you.*

You do not *farm* marks. The abyss leaves them on you — it has *noticed* you. A mark is not a wound, it is the trace of a brief negotiation with something that almost has a will (see `world.md` § Almost an entity).

## Chain rules

When a villager dies, the next one **does not inherit automatically**. The town retains a fraction depending on what you did before dying.

| Axis | Survives if... | Lost if... |
|---|---|---|
| Métier mastery | You had an apprentice, or you wrote it down (book, recipe) | You die alone and silent |
| Knowledge / Names | Written down (journal, wall carving, parchment) | Stayed in your head |
| Marks | Never — they die with the body | Always |

Consequence: the *town* is what accumulates across generations. The player (mortal) is the vehicle. Every journal written, every apprentice trained, every book shelved is an act of **inheritance**.

## Métiers

> [TBD] Definitive list of métiers and their starting affordances.

Candidates: blacksmith, herbalist, hunter, carpenter, weaver, scout, midwife, storyteller, gravedigger, priest, beggar, child.

Each métier must:

- Have a daily role in the town (what to do in peacetime)
- Have a distinct mode of engaging with the abyss (what to do facing the threat)

> [QUESTION] Does the métier change across the chain? The previous player was a blacksmith — can the next one be something else? Probably yes — each villager has *their own* métier. This implies métier-specific affordances mostly die with the body, unless the dead villager had time to train an apprentice in the same métier.

## Abyss simulation (separate progression)

The abyss has its **own** progression, mechanically distinct from the player's. In lore terms, this is not ecology — it is **metabolism** (see `world.md` § Almost an entity). The creatures are not independent dwellers; they are organs, antibodies, excretions. The sim layer is the body of a thing.

In design terms, it is still a tick loop:

- Creatures have actual stats (HP, damage, etc.) — abstracted, this is the sim layer
- Hunting/predation events resolve server-side
- A winner gains stats, possibly traits, possibly form
- A creature strong enough begins to migrate upward

> [TBD] Granularity of the sim — does the server tick combat between every pair of NPCs in the abyss, or are populations modeled at a more abstract faction/density level? Performance and emergent behavior trade-off.

> [TBD] Does the abyss-as-entity have **moods** that bias the sim? E.g. a "restless" abyss spawns more aggressive antibodies; a "dormant" one barely moves. This is where the entity-ness manifests mechanically without us needing to claim it is sentient.

The player's progression (mastery / knowledge / marks) does not feed the abyss's progression, and vice versa. They evolve in parallel and meet only when the player descends or when something surfaces.
