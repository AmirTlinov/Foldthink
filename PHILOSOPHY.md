# Foldthink Philosophy

## The short form

**Less interface, less noise, and less unnecessary distance between a plausible
user intent and its fulfillment.**

Foldthink does not measure minimalism by the number of buttons or the amount of
empty space. It measures minimalism by the distance between thought and action.
When a person has already expressed intent through context, the application should
help fulfill that intent directly.

```text
intent -> necessary choice -> action -> visible result
```

Every additional screen, mode, question, and panel must shorten this path more than
it lengthens it. Interface earns its place when it helps someone make a meaningful
choice or understand the consequence of an action.

## Plausible intent

A plausible intent is an action already indicated by observable context. Foldthink
follows evidence instead of inventing desires for the person.

| Observable context | Plausible intent | Foldthink's direct response |
|---|---|---|
| Pencil touches an empty surface | Write or draw | Ink appears immediately beneath the Pencil |
| A person double-taps text | Edit that text | The source for that exact block opens |
| Two fingers change their distance on the board | Scale around those fingers | The camera follows the gesture continuously |
| A person taps a notebook | Work with that notebook | The notebook becomes the current target of actions |
| A person asks the agent to inspect a page | Continue a shared thought | The agent reads the current surface and responds in its context |

When two intents truly lead to different consequences, Foldthink presents one
short, clear choice. When the consequence is the same, the application acts
immediately.

## The surface comes before the shell

The board, notebook, and document are the product. Panels and menus serve them. The
first frame shows the working surface; anonymous identity, loading, and
synchronization arrange themselves around it without a separate ritual.

Content receives the primary space and attention. Controls appear beside the
selected object, remain for as long as a choice is needed, and then return that
space to the surface. A frequent action gets a direct gesture. A rare action
remains available in context.

## Direct action

The result should happen where the person acts:

- Apple Pencil leaves a line beneath its tip.
- A moving notebook follows the hand together with the drawing on its cover.
- A pinch changes one camera around a stable focal point.
- Erasing changes visible geometry and persists as a durable action.
- An agent command changes the same surface the person sees.

Feedback therefore becomes an explanation. The person does not need to remember
hidden state or guess whether an action took effect.

## Calm and power

Foldthink keeps complexity inside the mechanism and reveals it only where it helps
thought. Reliable synchronization, CRDTs, backups, and anonymous identity may be
complex internally; externally, they appear as continuity of work and an honest
delivery state.

The product's power lives in its content. A document may contain mathematics, a
diagram, or an interactive element created by an agent while remaining a calm
page. A rich thought does not require a permanently elaborate control frame around
it.

## A person and an agent think in the same place

The agent is another participant on the shared surface, not a separate application
beside it. It sees the current context, uses the same semantic commands, and
returns a verifiable result. A person can continue the agent's drawing, and the
agent can continue the person's handwritten thought.

This shortens Foldthink's central path:

```text
human thought <-> shared surface <-> agent action
```

Explanation, drawing, and change remain in one place. Carrying context among chat,
files, editors, and boards becomes the system's work rather than the person's.

## The test for every decision

Before adding an element, step, or mode, we answer four questions:

| Question | The answer that justifies the decision |
|---|---|
| Which observable intent owns this element? | A concrete user context is named |
| Which path does it shorten? | It removes an action, a wait, or the need to remember state |
| How does the person see the result? | The consequence appears nearby, immediately, and unambiguously |
| What happens after a mistake? | The action can be understood, undone, or safely repeated |

An element without a clear owner merges with an existing action or gives its space
back to content. If two designs fulfill the same intent equally well, Foldthink
chooses the one that asks less, shows less unrelated material, reveals the result
sooner, and makes the way back easier.

## Conclusion

Foldthink aims to be a short extension of thought rather than merely look
minimalist. A good interface here feels like the absence of an intermediary: a
person sees a place for thought, acts, and immediately recognizes their intent in
the result.
