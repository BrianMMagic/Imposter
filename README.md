# Imposter — the party word game

A mobile-first web app for playing **Imposter** on one phone. Everyone sees the
same secret word — except the imposter, who has to bluff their way through.
No build step, no dependencies, no server: it's plain HTML, CSS and JavaScript,
and the setup is stored on the device in `localStorage`.

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000    # then visit http://localhost:8000
```

Serving over http(s) also enables the service worker, so the app works offline and
can be installed to a phone's home screen ("Add to Home Screen").

## How the game works

1. Add everyone's name, pick how many imposters (1, 2 or 3) and choose the
   categories the secret word can come from.
2. **Pass the phone around.** Each player's name comes up on a card. They press
   and hold it to see the secret word — or that they're the imposter — then let
   go and hand the phone on. The card closes the instant they release.
3. Once everyone has looked, the app picks a **random player to start**.
4. Go round the group, each saying **one word** about the secret word. The
   imposters have to blend in without knowing it. After a round or two, everyone
   votes on who's faking.

## The app

**Setup**

- **Players** — add, rename (tap a name) or remove. Up to 20.
- **Imposters** — 1, 2 or 3. The choice is capped at `players − 2`, so at least
  two people always share the word and there is something to work out.
- **Categories** — 15 built in (Animals, Food & Drink, Movies, Jobs, Places,
  Sports & Games, Around the House, Travel, Music, School, Tech, Magic,
  Transport, Nature, Celebrations), 38 words each. Pick any combination; the
  header shows how many words are in play.
- **Your own** — build a category from your own list of words, saved on the
  device. Edit or delete it later from the pencil on its chip.

**Passing the phone**

- Hold to reveal, release to hide. A card only opens after the finger has been
  down for a moment, so brushing the screen mid-handover can never show somebody
  else's card.
- **Next** stays disabled until the card has actually been opened, and it names
  who to pass to — so nobody gets skipped.
- Progress dots along the top show how far round the group you are.
- The screen is kept awake while cards are being passed.

**Starting the round**

- A random player is picked to start.
- **New round** deals a fresh word to the same players; **Change setup** goes back.
- At the bottom, **hold to reveal the answer** — the word and who the imposters
  were — for settling it once the round is over.

**Settings**

- **Imposter sees the category** — their card shows the category name so they can
  bluff plausibly. Switch it off for a harder game.
- **Shuffle the pass order** — cards come up in a random order each round.
- **Vibrate on reveal**, **keep the screen awake**, and **reset everything**.

## Layout

```
index.html              markup for the three screens and the two sheets
css/styles.css          mobile-first styles, light + dark via prefers-color-scheme
js/words.js             the 15 built-in categories
js/model.js             players, categories, storage and dealing a round
js/app.js               screens, the hold-to-reveal card and the editors
sw.js                   offline cache (bump VERSION when shell files change)
manifest.webmanifest    installable-app metadata
icons/                  app icons — make-icons.py regenerates the PNGs
```

## Notes

- Who the imposters are and what the word is live **in memory only** — they are
  never written to storage, so reloading the page cannot leak a round in progress
  (it ends the round instead). Only the setup is saved.
- Word and imposter picking use `crypto.getRandomValues` with rejection sampling,
  so every player and every word is equally likely — no modulo bias.
- The last dozen words used in a category are held back from coming round again.
- Data lives only in this browser on this device; there is no account or sync.
