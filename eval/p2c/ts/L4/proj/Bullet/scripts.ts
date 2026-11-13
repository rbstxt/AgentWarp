// L4 Bullet: the original parks offstage (hidden originals still collide);
// clones fly up from the Player and die at the top edge. Scoring is detected
// by the Enemy so a single hit can never double-count.
whenFlagClicked(() => {
  goToXY(-240, 180);
  hide();
});

whenStartAsClone(() => {
  goTo("Player");
  show();
  repeatUntil(touching("_edge_"), () => {
    changeY(12);
  });
  deleteThisClone();
});
