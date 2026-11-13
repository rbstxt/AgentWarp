// L4 Enemy. The original hides; one clone falls from the top every second.
// A clone hit by a Bullet scores +1; a clone reaching the bottom costs a life.
whenFlagClicked(() => {
  hide();
  forever(() => {
    createCloneOf("_myself_");
    wait("1");
  });
});

whenStartAsClone(() => {
  goToXY(0, 150);
  show();
  repeatUntil(or(touching("Bullet"), lessThan(yPosition(), -140)), () => {
    changeY(-2);
  });
  ifElse(touching("Bullet"), () => {
    changeVariableBy(vars.score, 1);
  }, () => {
    changeVariableBy(vars.lives, -1);
  });
  deleteThisClone();
});
