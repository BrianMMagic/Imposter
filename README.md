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

This is already wired up for this repo — `js/firebase-config.js` holds the
database URL. To point it at a different project, or to set one up from
scratch, it is four steps:

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
like `.../imposter/#ABCD`, which fills it in for them. **Tap the code** in the
lobby to hand it out: the phone's own share sheet where there is one, the link
on the clipboard where there is not. Your name is remembered between games, so
after the first time the code is the only thing left to type. Names appear in
the host's lobby as they arrive. **Change** in the lobby sets the imposters and categories
while people are still arriving — the imposter count is capped by who has
actually joined, so it opens up as the room fills. The host taps **Start game**
and every phone shows its own card, held the same way as ever. Your card stays on screen for the whole round,
so forgetting your word is a non-issue. The host can deal again with **New
round** without anybody rejoining.

**Voting.** When the talking is done the host taps **Start the vote**, and every
phone holding a card gets a ballot: everyone else's name, tap the one you think
is faking it. You can change your mind until the last ballot is in; nothing is
shown while people are still deciding, only a count of how many have voted. Once
they are all in, every phone shows the same tally at the same moment — who got
how many, and who voted for them.

The host chooses **1, 2 or 3 rounds of voting** on the setup screen before
opening the room, or afterwards in the lobby under **Change** — the same setting
in both places.
After each tally the host can run the next one, or go straight to the answer —
the rounds are what is available, not what is compulsory. If somebody puts their
phone down mid-vote, **Close the vote now** tallies whatever arrived rather than
waiting for a ballot that is never coming.

Somebody who joined halfway through a round does not get a ballot, and is not
counted in the total, so they cannot leave a tally one short for ever. They vote
in the next round like everybody else.

**Settling it.** When the group has voted, the host taps **Reveal the imposter**
and every phone in the room shows the same thing at the same moment: the word,
the category it came from, and who was faking it. Nobody has to take the host's
word for it, and nobody has to lean over to see a screen. From there the host
picks **New round** or **End game**, and everybody else is simply carried along.
Names are worked out when the cards are dealt rather than when the answer is
called, so somebody who walks off mid-round still shows up in the answer. If the
room voted, the answer says what it decided and whether that was right.

**The room stays open all game.** Somebody arriving in the middle of a round
joins with the same code as everyone else, and is told a round is under way and
that they are in for the next one — no card is dealt to them for a round they did
not play. The host sees *4 in the room · 1 joined since* on their own screen and
deals them in with the next round. Nobody has to go back to the front and type a
new code, and the host never has to close and reopen the room to let a friend in.
The code is on the answer screen too, tappable to share, for exactly this.

**Reveal, New round and End game are the host's alone** — they never appear on
anybody else's phone, whichever screen it happens to be on. A guest gets the
round they are in, and a way out of the room.

**What the database is trusted with: almost nothing.** Each phone makes an
encryption keypair when it joins and publishes only the public half. The host
deals on their own phone exactly as they would passing it round, then seals every
card to the player it belongs to before uploading it. While a round is being
played the secret word and who is faking it are never uploaded in a form anyone
else can read — not the other players, not somebody who guesses your room code,
not you looking at your own database. The round only ever exists in the open on
the host's phone.

The one exception is deliberate: **revealing the answer publishes it**, because
the whole point is that everyone sees it at once. From the moment the host taps
reveal until the next round is dealt, the word and the imposters' names sit in
the room in plain text, where anyone who already knows the four-letter code could
read them. That is a round that is already over, and dealing again wipes them —
but if you would rather it never left the host's phone at all, don't use the
button.

Ballots are the same kind of thing. The app shows nobody anything until the last
one is in, but the votes themselves sit in the room in the open, so somebody with
the code and a browser console could see who voted for whom before the tally
appears. They are wiped when the next round is dealt. This is a party game and
that seemed a fair trade for everyone reaching the same tally without waiting on
the host's phone; it is not a secret ballot.

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
- **Imposters** — 1, 2 or 3, in either kind of game. Passing one phone, the
  choice is capped at `players − 2`, so at least two people always share the word
  and there is something to work out. In a room there is nobody to count yet when
  you are setting it up, so all three are open and the lobby brings the number
  down once people have actually joined.
- **Rounds of voting** — 1, 2 or 3, rooms only, since one phone passed round has
  nothing to vote on. The same setting as the one in the lobby, so it can be set
  before the room opens or changed once everyone is in.
- **How you are playing** — one phone passed round, or separate phones in a
  room. Only shown once a database is configured. Switching to a room hides the
  players list, since the players are on their own phones, and brings out the
  voting card.
- **Categories** — 15 built in (Animals, Food & Drink, Movies, Jobs, Places,
  Sports & Games, Around the House, Travel, Music, School, Tech, People,
  Transport, Nature, Celebrations), 38 words each. **People** spans actors,
  musicians, scientists, historical figures, leaders and athletes — everyone in
  it is a household name. Pick any combination; the header shows how many words
  are in play.
- **Your own** — build a category from your own list of words, saved on the
  device. Edit or delete it later from the pencil on its chip.
- **Your name** — whatever you last hosted or joined a room as is kept on the
  device and filled in for you next time. **Reset everything** forgets it.

Nothing in the app uses the browser's own `confirm`, `prompt` or `alert` boxes.
Anything worth asking about — leaving a room, revealing the answer, deleting a
category, renaming a player — is asked in the app's own dialog, which can be
dismissed by tapping outside it or pressing Escape.

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

- **Appearance** — **Auto**, **Light** or **Dark**, on every phone, whether it is
  hosting or not. Auto follows the phone. The choice is painted before the first
  frame rather than applied after it, so launching does not flash the other one.
- **Imposter sees the category** — their card shows the category name so they can
  bluff plausibly. Switch it off for a harder game.
- **Shuffle the pass order** — off by default, so cards follow the order you set
  in the players list. Turn it on to have them come up at random each round
  instead; the players list says so while it is on, with a one-tap way back.
- **Keep the screen awake**, and **reset everything**.

Both of the middle two change how a round is dealt, and only the phone doing the
dealing acts on them — so in a room they are the host's, and they are not shown
on anybody else's phone rather than sitting there wired to nothing. Shuffling the
pass order has no meaning in a room at all, so it goes away for everyone there.

There is no vibrate switch. Android phones buzz on a reveal, iPhones ignore the
request entirely, and a setting for something only half the room can do is worse
than no setting.

## Layout

```
index.html              markup for the screens and the sheets
css/styles.css          mobile-first styles; dark by default, light by system or by choice
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
