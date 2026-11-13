// L4 Enemy: the original hides offstage and spawns one clone per second;
// clones fall from a random x. A clone hit by a Bullet scores +1; a clone
// reaching the bottom costs one life.
whenFlagClicked(() => {
  goToXY(240, 180);
  hide();
  forever(() => {
    createCloneOf("_myself_");
    wait("1");
  });
});

whenStartAsClone(() => {
  goToXY(random(-200, 200), 150);
  show();
  repeatUntil(or(touching("Bullet"), lessThan(yPosition(), -150)), () => {
    changeY(-2);
  });
  ifElse(touching("Bullet"), () => {
    changeVariableBy(vars.score, 1);
  }, () => {
    changeVariableBy(vars.lives, -1);
  });
  deleteThisClone();
});
