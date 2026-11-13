// L1 Sprite1 (task ladder L1 — hello). Green flag: go to (0,0), move 10
// steps, say "Hello!" for 2 seconds. Probe: Sprite1.x == 10 and the bubble
// reads "Hello!".
whenFlagClicked(() => {
  goToXY(0, 0);
  moveSteps(10);
  sayFor("Hello!", 2);
});
