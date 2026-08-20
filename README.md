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

There are two ways to play. **Pass one phone** round the group needs nothing at
all — no accounts, no connection, no setup. **Separate phones** lets everyone
join a room with a four-letter code and read their own card on their own phone;
it needs a free Firebase project wiring up once, see below.

## How the game works

1. Add everyone's name, pick how many imposters (1, 2 or 3) and choose the
   categories the secret word can come from.
2. **Pass the phone around.** Each player's name comes up on a card. They press
   and hold it to see the secret word — or that they're the imposter — then let
   go and hand the phone on. The card closes the instant they release.
3. Once everyone has looked, the app picks a **random player to start**. Anyone
   who forgets their word later can tap their own name to hold their card open
   again — it changes nothing about the round.
4. Go round the group, each saying **one word** about the secret word. The
   imposters have to blend in without knowing it. After a round or two, everyone
   votes on who's faking.

## Playing on separate phones

Rooms are switched off until you point the app at a database, and everything
else works without one. Four steps, once:

1. At [console.firebase.google.com](https://console.firebase.google.com) create a
   project. Analytics is not needed.
2. **Build → Realtime Database → Create Database**. Pick whichever region is
   nearest and start it in **locked mode**.
3. Open the **Rules** tab, paste this, and publish:

   ```json
   {
     "rules": {
       "rooms": {
         "$code": {
           ".read": true,
           ".write": true,
           ".validate": "$code.matches(/^[A-Z2-9]{4}$/)"
         }
       }
     }
   }
   ```

   Reading and writing is allowed **inside a room you already know the code
   of**, and nowhere else — there is no permission at `rooms` itself, so the
   list of rooms cannot be fetched and codes cannot be harvested.
4. Copy the database URL from the top of the **Data** tab — it looks like
   `https://your-project-default-rtdb.europe-west1.firebasedatabase.app` — and
   paste it into `js/firebase-config.js`. Commit and push.

The free Spark plan covers this many times over: phones watch a handful of
fields every second and a half, and only fetch anything larger when it actually
changes, so a long game is a few hundred kilobytes.

**Then, to play:** the host switches to **Separate phones**, puts their own name
in and taps **Create room**. Everyone else opens the app, taps **Join someone's
room** and types the four letters — or just follows a link ending in the code,
like `.../imposter/#ABCD`, which fills it in for them. Names appear in the host's
lobby as they arrive. **Change** in the lobby sets the imposters and categories
while people are still arriving — the imposter count is capped by who has
actually joined, so it opens up as the room fills. The host taps **Start game**
and every phone shows its own card, held the same way as ever. Your card stays on screen for the whole round,
so forgetting your word is a non-issue. The host can deal again with **New
round** without anybody rejoining.

**What the database is trusted with: nothing.** Each phone makes an encryption
keypair when it joins and publishes only the public half. The host deals on
their own phone exactly as they would passing it round, then seals every card to
the player it belongs to before uploading it. The secret word and who is faking
it are never uploaded in a form anyone else can read — not the other players,
not somebody who guesses your room code, not you looking at your own database.
The round only ever exists in the open on the host's phone, and only for as long
as the round lasts.

**Worth knowing.** Rooms need every phone online; pass-the-phone still needs
nothing, so it is the better bet on bad wifi. Reloading the page drops you back
to the start — rejoin with the same code and your card comes straight back, since
your key is kept on your own phone. The host closing the room ends it for
everyone. Rooms are deleted when the host leaves, and a code is free to be reused
a day later.

## The app

**Setup**

- **Players** — add, rename (tap a name) or remove. Up to 20. Each one gets its
  own colour, and the list is the **order the phone goes round**: hold a player
  and drag them, or drag straight away by the handle on the left (arrow keys
  work too, for a keyboard). A quick swipe on a row still scrolls the page —
  only a hold picks somebody up. Tap a player's
  swatch to give them a different colour — it steps to the next one nobody else
  is wearing, so no two cards ever look alike.
- **Imposters** — 1, 2 or 3. The choice is capped at `players − 2`, so at least
  two people always share the word and there is something to work out.
- **How you are playing** — one phone passed round, or separate phones in a
  room. Only shown once a database is configured. In a room the imposter count
  moves to the lobby, which is the only place that knows the line-up.
- **Categories** — 15 built in (Animals, Food & Drink, Movies, Jobs, Places,
  Sports & Games, Around the House, Travel, Music, School, Tech, People,
  Transport, Nature, Celebrations), 38 words each. **People** spans actors,
  musicians, scientists, historical figures, leaders and athletes — everyone in
  it is a household name. Pick any combination; the header shows how many words
  are in play.
- **Your own** — build a category from your own list of words, saved on the
  device. Edit or delete it later from the pencil on its chip.

**Passing the phone**

- Every player's card is in **their own colour** — the border, the wash behind
  their name and the mask emblem — so it is obvious at a glance whose turn it is
  and that the card has actually changed hands.
- Hold to reveal, release to hide. A card only opens after the finger has been
  down for a moment, so brushing the screen mid-handover can never show somebody
  else's card.
- **Next** stays disabled until the card has actually been opened, and it names
  who to pass to — so nobody gets skipped.
- Progress dots along the top show how far round the group you are.
- The screen is kept awake while cards are being passed.

**Starting the round**

- A random player is picked to start, shown in their own colour.
- **Forgotten yours?** Every player's name is listed underneath. Tap yours to
  see your card again, held open the same way so nothing flashes on screen.
  Looking is free: it does not change the pass, the starter or the word, and it
  can be done as often as anyone likes.
- **New round** deals a fresh word to the same players; **Change setup** goes back.
- At the bottom, **hold to reveal the answer** — the word and who the imposters
  were — for settling it once the round is over.

**Settings**

- **Imposter sees the category** — their card shows the category name so they can
  bluff plausibly. Switch it off for a harder game.
- **Shuffle the pass order** — off by default, so cards follow the order you set
  in the players list. Turn it on to have them come up at random each round
  instead; the players list says so while it is on, with a one-tap way back.
- **Vibrate on reveal**, **keep the screen awake**, and **reset everything**.

## Layout

```
index.html              markup for the three screens and the two sheets
css/styles.css          mobile-first styles, light + dark via prefers-color-scheme
js/words.js             the 15 built-in categories
js/model.js             players, categories, storage and dealing a round
js/app.js               screens, the hold-to-reveal card and the editors
js/seal.js              sealing a card to one phone (WebCrypto, no library)
js/room.js              rooms over the Realtime Database's REST API
js/firebase-config.js   the database URL — the only thing you fill in
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
- There are as many player colours as the 20-player maximum, so a full game
  never has to reuse a shade.
- Data lives only in this browser on this device; there is no account or sync.
  Rooms upload nothing but sealed cards and a name per player.
