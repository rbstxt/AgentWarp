// L4 Bullet. The original stays hidden; clones fly up from the Player and
// vanish at the top edge. Scoring is detected by the Enemy.
whenFlagClicked(() => {
  hide();
});

whenStartAsClone(() => {
  goTo("Player");
  show();
  repeatUntil(touching("_edge_"), () => {
    changeY(15);
  });
  deleteThisClone();
});
