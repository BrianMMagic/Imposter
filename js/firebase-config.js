/* ============================================================
   firebase-config.js — the one thing you have to fill in

   Rooms need somewhere to hold a game while it is being played.
   Create a free Firebase project, turn on the Realtime Database,
   and paste its URL here. Everything else in the app works
   without this; leave it empty and the room mode simply stays
   switched off, with pass-the-phone unaffected.

   See "Playing on separate phones" in README.md for the four
   steps, including the database rules to paste in.
   ============================================================ */
window.ImposterFirebase = {
  databaseURL: 'https://imposter-app-game-default-rtdb.firebaseio.com'
};
